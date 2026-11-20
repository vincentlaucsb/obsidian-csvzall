import { lstat, mkdir, readFile, writeFile, rename, unlink, open } from "fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { randomUUID, createHash } from "crypto";
import { execFile } from "child_process";
import { SKILL_PATHS, csvzallSkill } from "./skill.js";

export interface AgentHelper {
  executablePath: string;
  version: string;
  executableSha256: string;
}

/** Device-local ownership record; never persisted through plugin data.json. */
interface Installation {
  version: 1;
  enabled: boolean;
  files: Record<string, string>;
}

interface Options {
  root: string;
  pluginDirectory: string;
  target: string;
  load(): unknown;
  save(value: Installation): void;
  prepare(repair: boolean): Promise<AgentHelper>;
}

function record(value: unknown): Installation {
  if (!value || typeof value !== "object") return { version: 1, enabled: false, files: {} };
  if (!("version" in value) || value.version !== 1 || !("enabled" in value) || typeof value.enabled !== "boolean" ||
      !("files" in value) || !value.files || typeof value.files !== "object" || Array.isArray(value.files)) {
    throw new Error("Invalid agent integration record. Existing files have been preserved.");
  }
  const files: Record<string, string> = {};
  for (const [path, text] of Object.entries(value.files)) {
    if (typeof text !== "string") throw new Error("Invalid agent integration ownership record.");
    files[path] = text;
  }
  return { version: 1, enabled: value.enabled, files };
}

function missing(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

export class AgentIntegration {
  private pending = false;
  private readonly pluginDirectory: string;
  private readonly locator: string;

  constructor(private readonly options: Options) {
    this.pluginDirectory = relative(resolve(options.root), resolve(options.root, options.pluginDirectory)).split(sep).join("/");
    if (!this.pluginDirectory || this.pluginDirectory.startsWith("../") || isAbsolute(this.pluginDirectory)) throw new Error("Plugin directory must be inside this vault.");
    if (!/^(win32-x64|darwin-arm64|linux-x64)$/.test(options.target)) throw new Error("Agent integration has no bundled helper for this platform.");
    this.locator = `${this.pluginDirectory}/agent-runtime/${options.target}.json`;
  }

  private absolute(path: string): string {
    const full = resolve(this.options.root, path);
    const rel = relative(resolve(this.options.root), full);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Agent integration path leaves the vault.");
    return full;
  }

  /** Check each known component, never traverse links or discover other folders. */
  private async parents(path: string, create: boolean): Promise<void> {
    const rel = relative(resolve(this.options.root), dirname(this.absolute(path)));
    let current = resolve(this.options.root);
    for (const part of rel.split(sep)) {
      current = join(current, part);
      if (create) await mkdir(current).catch((error: unknown) => {
        if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
      });
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Agent integration preserves linked or non-directory paths: ${current}`);
    }
  }

  private async read(path: string): Promise<string | undefined> {
    try {
      await this.parents(path, false);
      const full = this.absolute(path);
      const info = await lstat(full);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Agent integration preserves linked or non-file paths: ${path}`);
      return await readFile(full, "utf8");
    } catch (error) { if (missing(error)) return undefined; throw error; }
  }

  private async write(path: string, before: string | undefined, text: string): Promise<void> {
    if (before === text) {
      if (await this.read(path) !== before) throw new Error(`Concurrent edit preserved: ${path}`);
      return;
    }
    await this.parents(path, true);
    const full = this.absolute(path);
    if (before === undefined) {
      // Exclusive creation prevents adopting a concurrently created file.
      await writeFile(full, text, { flag: "wx" });
      return;
    }
    const temporary = `${full}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, text, { flag: "wx" });
      if (await this.read(path) !== before) throw new Error(`Concurrent edit preserved: ${path}`);
      await rename(temporary, full);
    } finally { await unlink(temporary).catch((error: unknown) => { if (!missing(error)) throw error; }); }
  }

  private async exclusive(action: () => Promise<void>): Promise<void> {
    if (this.pending) throw new Error("Agent integration is already being updated.");
    this.pending = true;
    // A vault-wide lock coordinates profiles without reading another profile.
    const lock = ".agents/csvzall-install.lock";
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await this.parents(lock, true);
      handle = await open(this.absolute(lock), "wx").catch((error: unknown) => {
        if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
          throw new Error("Agent integration is locked by another setup. If a previous setup crashed, remove .agents/csvzall-install.lock after confirming no setup is running, then retry.");
        }
        throw error;
      });
      await action();
    } finally {
      try {
        if (handle) {
          try { await handle.close(); }
          finally { await unlink(this.absolute(lock)).catch((error: unknown) => { if (!missing(error)) throw error; }); }
        }
      } finally { this.pending = false; }
    }
  }

  async enable(): Promise<void> { await this.update(true); }

  /** Only opted-in devices refresh; deleted discovery entries stay deleted. */
  async refresh(): Promise<void> {
    if (record(this.options.load()).enabled) await this.update(false);
  }

  private async update(explicit: boolean): Promise<void> {
    await this.exclusive(async () => {
      const state = record(this.options.load());
      const template = csvzallSkill(this.pluginDirectory);
      const snapshots = new Map<string, string | undefined>();
      for (const path of SKILL_PATHS) {
        const before = await this.read(path);
        if (before !== undefined && before !== template && before !== state.files[path]) {
          throw new Error(`Agent skill belongs to another profile or was edited: ${path}. Existing files have been preserved.`);
        }
        if (explicit || before !== undefined) snapshots.set(path, before);
      }
      const locatorBefore = await this.read(this.locator);
      const helper = await this.options.prepare(explicit);
      const executable = relative(this.absolute(this.pluginDirectory), resolve(helper.executablePath)).split(sep).join("/");
      if (executable.startsWith("../") || isAbsolute(executable) || !executable.startsWith("csvzall-bin/")) throw new Error("Prepared agent helper must be inside this plugin's csvzall-bin directory.");
      const locatorText = JSON.stringify({ version: 1, target: this.options.target, executable,
        helperVersion: helper.version, executableSha256: helper.executableSha256 }, null, 2) + "\n";
      // Locators can arrive on another device, but only identical content is adopted.
      if (locatorBefore !== undefined && locatorBefore !== locatorText && locatorBefore !== state.files[this.locator]) {
        throw new Error(`Agent locator was changed: ${this.locator}. Use the same plugin version or resolve the conflict before repairing.`);
      }
      await this.write(this.locator, locatorBefore, locatorText);
      state.files[this.locator] = locatorText;
      state.enabled = true;
      this.options.save(state);
      for (const [path, before] of snapshots) {
        await this.write(path, before, template);
        state.files[path] = template;
        this.options.save(state);
      }
    });
  }

  async remove(): Promise<void> {
    await this.exclusive(async () => {
      const state = record(this.options.load());
      state.enabled = false;
      this.options.save(state);
      const conflicts: string[] = [];
      for (const path of [...SKILL_PATHS, this.locator]) {
        if (state.files[path] === undefined) continue;
        try {
          const before = await this.read(path);
          if (before !== undefined && before !== state.files[path]) { conflicts.push(path); continue; }
          if (before !== undefined) {
            if (await this.read(path) !== before) throw new Error(`Concurrent edit preserved: ${path}`);
            await unlink(this.absolute(path));
          }
          delete state.files[path];
          this.options.save(state);
        } catch { conflicts.push(path); }
      }
      if (conflicts.length) throw new Error(`Automatic refresh disabled; modified or linked files preserved: ${conflicts.join(", ")}`);
    });
  }

  async testConnection(): Promise<string> {
    const state = record(this.options.load());
    const text = await this.read(this.locator);
    if (!state.enabled || !text || text !== state.files[this.locator]) throw new Error("Enable or repair agent integration on this device first.");
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || !("executable" in value) || typeof value.executable !== "string" || !value.executable.startsWith("csvzall-bin/") ||
        !("executableSha256" in value) || typeof value.executableSha256 !== "string") throw new Error("Invalid helper locator.");
    const executable = this.absolute(`${this.pluginDirectory}/${value.executable}`);
    await this.parents(`${this.pluginDirectory}/${value.executable}`, false);
    const info = await lstat(executable);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Bundled agent helper is unavailable. Enable or repair it first.");
    if (createHash("sha256").update(await readFile(executable)).digest("hex") !== value.executableSha256) throw new Error("Bundled agent helper changed. Enable or repair it first.");
    return await new Promise<string>((accept, reject) => {
      execFile(executable, ["--help"], { cwd: this.options.root, env: { ...process.env, PATH: "", Path: "" },
        windowsHide: true, timeout: 10000, maxBuffer: 256 * 1024 }, (error, stdout) => {
        if (error) reject(new Error(error.message)); else accept(stdout);
      });
    });
  }
}

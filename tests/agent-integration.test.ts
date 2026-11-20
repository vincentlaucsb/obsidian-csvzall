import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { AgentIntegration } from "../src/agents/AgentIntegration.js";
import { SKILL_PATHS, csvzallSkill } from "../src/agents/skill.js";
import { installBundledCsvzall, bundledCsvzallAsset } from "../src/installer/bundledInstall.js";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "csvzall agent ü & '-"));
  const pluginDirectory = ".custom-profile/plugins/csvzall";
  let state: unknown;
  let preparations = 0;
  let version = "1.0.0";
  let duringPrepare = async () => {};
  const options = { root, pluginDirectory, target: "win32-x64", load: () => state,
    save: (value: unknown) => { state = structuredClone(value); },
    prepare: async () => {
      preparations++;
      await duringPrepare();
      return { executablePath: join(root, pluginDirectory, "csvzall-bin", version, "win32-x64-test", "csvzall.exe"),
        version, executableSha256: "a".repeat(64) };
    } };
  return { root, pluginDirectory, options, service: new AgentIntegration(options),
    get preparations() { return preparations; },
    setVersion(value: string) { version = value; },
    duringPrepare(callback: () => Promise<void>) { duringPrepare = callback; },
    async cleanup() { await rm(root, { recursive: true, force: true }); } };
}

test("opt-in installs identical native skills and a relative locator; refresh is stable", async () => {
  const f = await fixture();
  try {
    await f.service.refresh();
    assert.equal(f.preparations, 0);
    await f.service.enable();
    const files = await Promise.all(SKILL_PATHS.map(path => readFile(join(f.root, path), "utf8")));
    assert.deepEqual(files, SKILL_PATHS.map(() => csvzallSkill(f.pluginDirectory)));
    const path = join(f.root, f.pluginDirectory, "agent-runtime/win32-x64.json");
    const first = await stat(path);
    const locator = JSON.parse(await readFile(path, "utf8"));
    assert.equal(locator.executable, "csvzall-bin/1.0.0/win32-x64-test/csvzall.exe");
    assert.ok(!files[0]!.includes(f.root));
    await f.service.refresh();
    assert.equal((await stat(path)).mtimeMs, first.mtimeMs);
    await rm(join(f.root, SKILL_PATHS[1]!));
    f.setVersion("1.1.0");
    await f.service.refresh();
    assert.match(await readFile(path, "utf8"), /1\.1\.0/);
    await assert.rejects(stat(join(f.root, SKILL_PATHS[1]!)), /ENOENT/);
    await f.service.enable();
    assert.equal(await readFile(join(f.root, SKILL_PATHS[1]!), "utf8"), files[0]);
  } finally { await f.cleanup(); }
});

test("same-name skills and other profiles are preserved before helper preparation", async () => {
  const f = await fixture();
  try {
    await f.service.enable();
    const other = new AgentIntegration({ ...f.options, load: () => undefined, pluginDirectory: ".other/plugins/csvzall" });
    await assert.rejects(other.enable(), /another profile/);
    await writeFile(join(f.root, SKILL_PATHS[0]!), "user skill");
    const before = f.preparations;
    await assert.rejects(f.service.enable(), /was edited/);
    assert.equal(f.preparations, before);
    assert.equal(await readFile(join(f.root, SKILL_PATHS[0]!), "utf8"), "user skill");
  } finally { await f.cleanup(); }
});

test("a concurrent skill creation is not overwritten and a failed install can resume", async () => {
  const f = await fixture();
  try {
    f.duringPrepare(async () => {
      await mkdir(join(f.root, ".claude/skills/csvzall"), { recursive: true });
      await writeFile(join(f.root, SKILL_PATHS[1]!), "concurrent user skill");
    });
    await assert.rejects(f.service.enable(), /EEXIST/);
    assert.equal(await readFile(join(f.root, SKILL_PATHS[1]!), "utf8"), "concurrent user skill");
    await rm(join(f.root, SKILL_PATHS[1]!));
    f.duringPrepare(async () => {});
    await f.service.enable();
    assert.equal(await readFile(join(f.root, SKILL_PATHS[1]!), "utf8"), csvzallSkill(f.pluginDirectory));
  } finally { await f.cleanup(); }
});

test("removal disables refresh and preserves modified skills and extra user files", async () => {
  const f = await fixture();
  try {
    await f.service.enable();
    await writeFile(join(f.root, SKILL_PATHS[0]!), "edited");
    await writeFile(join(f.root, ".claude/skills/csvzall/notes.txt"), "keep");
    await assert.rejects(f.service.remove(), /modified or linked/);
    assert.equal(await readFile(join(f.root, SKILL_PATHS[0]!), "utf8"), "edited");
    assert.equal(await readFile(join(f.root, ".claude/skills/csvzall/notes.txt"), "utf8"), "keep");
    const before = f.preparations;
    await f.service.refresh();
    assert.equal(f.preparations, before);
    await assert.rejects(stat(join(f.root, SKILL_PATHS[2]!)), /ENOENT/);
  } finally { await f.cleanup(); }
});

test("Copilot migration to linked skill folders is never followed or overwritten", async () => {
  const f = await fixture();
  try {
    await f.service.enable();
    const native = join(f.root, ".claude/skills/csvzall");
    const shared = join(f.root, "copilot/skills/csvzall");
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, "SKILL.md"), "Copilot-owned skill");
    await rm(native, { recursive: true });
    await symlink(shared, native, "junction");
    await assert.rejects(f.service.refresh(), /linked/);
    await assert.rejects(f.service.remove(), /linked/);
    assert.equal(await readFile(join(shared, "SKILL.md"), "utf8"), "Copilot-owned skill");
  } finally { await f.cleanup(); }
});

test("failed extraction publishes no locator or skills", async () => {
  const f = await fixture();
  try {
    f.duringPrepare(async () => { throw new Error("checksum failure"); });
    await assert.rejects(f.service.enable(), /checksum failure/);
    await assert.rejects(stat(join(f.root, f.pluginDirectory, "agent-runtime/win32-x64.json")), /ENOENT/);
    await assert.rejects(stat(join(f.root, SKILL_PATHS[0]!)), /ENOENT/);
  } finally { await f.cleanup(); }
});

test("prepared bundled helper runs help and SQL without PATH, Node or Python", async () => {
  const f = await fixture();
  try {
    const asset = bundledCsvzallAsset();
    const target = `${process.platform}-${process.arch}`;
    const service = new AgentIntegration({ ...f.options, target, prepare: async () => {
      const result = await installBundledCsvzall({ pluginDir: join(f.root, f.pluginDirectory) });
      return { executablePath: result.executablePath, version: result.tagName, executableSha256: asset.executableSha256 };
    } });
    await service.enable();
    assert.match(await service.testConnection(), /sql/);
    const locator = JSON.parse(await readFile(join(f.root, f.pluginDirectory, `agent-runtime/${target}.json`), "utf8"));
    const executable = resolve(f.root, f.pluginDirectory, locator.executable);
    assert.equal(createHash("sha256").update(await readFile(executable)).digest("hex"), locator.executableSha256);
    const csv = join(f.root, "sales ü & ' sample.csv");
    await writeFile(csv, "item,amount\nA,2\nB,3\n");
    const result = execFileSync(executable, ["sql", "query", "--csv", csv, "--sql", "SELECT SUM(amount) AS total FROM data"],
      { cwd: f.root, env: { ...process.env, PATH: "", Path: "" }, encoding: "utf8" });
    assert.match(result, /total\r?\n5/);
    assert.equal(await readFile(csv, "utf8"), "item,amount\nA,2\nB,3\n");
    await rm(executable);
    await assert.rejects(service.testConnection(), /ENOENT/);
  } finally { await f.cleanup(); }
});

test("concurrent locator changes are preserved even when no rewrite was needed", async () => {
  const f = await fixture();
  try {
    await f.service.enable();
    const locator = join(f.root, f.pluginDirectory, 'agent-runtime/win32-x64.json');
    f.duringPrepare(async () => { await writeFile(locator, 'concurrent locator'); });
    await assert.rejects(f.service.refresh(), /Concurrent edit/);
    assert.equal(await readFile(locator, 'utf8'), 'concurrent locator');
    await assert.rejects(f.service.testConnection(), /Enable or repair/);
  } finally { await f.cleanup(); }
});

test("desktop agent integration emits CommonJS Node imports", () => {
  const bundle = readFileSync("main.js", "utf8");
  assert.doesNotMatch(bundle, /import\s*\(\s*["'](?:node:)?(?:fs|path|crypto|child_process)/);
  assert.ok(/require\(["']child_process["']\)/.test(bundle));
  assert.ok(/require\(["']fs\/promises["']\)/.test(bundle));
});

test("agent refresh reuses viewer preparation while explicit repair preserves custom settings", async () => {
  let extractions = 0;
  const compiled = await build({ entryPoints: ['src/installer/InstallerService.ts'], bundle: true,
    platform: 'node', format: 'cjs', write: false, external: ['obsidian'], plugins: [{
      name: 'fake-payload-extraction', setup(builder) {
        builder.onResolve({ filter: /bundledInstall\.js$/ }, () => ({ path: 'fake-extraction', external: true }));
      },
    }] });
  const module = { exports: {} as any };
  runInNewContext(compiled.outputFiles[0]!.text, { module, exports: module.exports, console,
    require(name: string) {
      if (name === 'obsidian') return { Platform: { isDesktopApp: true }, Notice: class {} };
      if (name === 'fake-extraction') return { installBundledCsvzall: async () => {
        extractions++;
        return { executablePath: '/vault/.obsidian/plugins/csvzall/csvzall-bin/helper', tagName: '1.0.0', assetName: 'test', changed: true, sha256: 'test' };
      } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const settings = { csvzallExecutableMode: 'bundled', csvzallPath: '' };
  let saves = 0;
  const service = new module.exports.InstallerService(() => settings, async () => { saves++; },
    { record: async () => {} }, { getPluginDataDir: () => '/vault/.obsidian/plugins/csvzall' });
  await service.ensureBundledCsvzall();
  await service.prepareBundledHelper(false);
  assert.equal(extractions, 1, 'startup agent refresh reuses completed verification');
  settings.csvzallExecutableMode = 'custom'; settings.csvzallPath = '/custom/csvzall';
  const before = structuredClone(settings);
  const saved = saves;
  await Promise.all([service.prepareBundledHelper(true), service.prepareBundledHelper(true)]);
  assert.equal(extractions, 2, 'concurrent preparation shares the in-flight extraction');
  assert.deepEqual(settings, before);
  assert.equal(saves, saved, 'agent preparation never saves viewer settings');
});

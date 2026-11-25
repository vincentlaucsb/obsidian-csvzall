import { Notice, Platform } from "obsidian";
import { lstat } from "fs/promises";
import { installBundledCsvzall } from "./bundledInstall.js";
import type { EventLog } from "../logging/EventLog.js";
import type { ObsidianFilesystem } from "../obsidian/filesystem.js";
import type { CsvzallPluginSettings } from "../settings/settings.js";
import { hasErrorCode } from "../utils/errors.js";

export class InstallerService {
  private pending?: Promise<boolean>;
  private preparedPath?: string;
  private preparedBundled?: { pluginDir: string; result: Awaited<ReturnType<typeof installBundledCsvzall>> };
  private preparingBundled?: Promise<Awaited<ReturnType<typeof installBundledCsvzall>>>;

  constructor(
    private readonly getSettings: () => CsvzallPluginSettings,
    private readonly saveSettings: () => Promise<void>,
    private readonly eventLog: EventLog,
    private readonly filesystem: ObsidianFilesystem,
  ) {}

  async ensureBundledCsvzall(): Promise<boolean> {
    if (this.getSettings().csvzallExecutableMode === "custom") return true;
    return await this.install(false);
  }

  async installDesktopCsvzall(): Promise<boolean> {
    return await this.install(true);
  }

  /** Share completed preparation with agent setup without changing viewer settings. */
  async prepareBundledHelper(repair = true): Promise<Awaited<ReturnType<typeof installBundledCsvzall>>> {
    if (this.preparingBundled) return await this.preparingBundled;
    const pluginDir = this.filesystem.getPluginDataDir();
    if (!pluginDir) throw new Error("Could not resolve the plugin data directory.");
    const cached = this.preparedBundled;
    if (!repair && cached?.pluginDir === pluginDir) {
      const info = await lstat(cached.result.executablePath).catch((error: unknown) => {
        if (!hasErrorCode(error, "ENOENT")) throw error;
      });
      // Only full preparation is shared. Explicit repair may have started during the probe.
      if (this.preparingBundled) return this.preparingBundled;
      if (this.preparedBundled?.pluginDir === pluginDir && this.preparedBundled !== cached) return this.preparedBundled.result;
      if (info?.isFile() && this.preparedBundled === cached) return cached.result;
    }
    this.preparedBundled = undefined;
    this.preparingBundled = installBundledCsvzall({ pluginDir });
    try {
      const result = await this.preparingBundled;
      this.preparedBundled = { pluginDir, result };
      return result;
    } finally { this.preparingBundled = undefined; }
  }

  getExecutablePath(): string {
    const settings = this.getSettings();
    if (settings.csvzallExecutableMode === "custom") return settings.csvzallPath;
    if (this.preparedPath === settings.csvzallPath) return this.preparedPath;
    throw new Error("The bundled csvzall helper is unavailable. Choose Use bundled helper or configure a custom executable path in settings.");
  }

  private async install(selectBundled: boolean): Promise<boolean> {
    if (this.pending) return await this.pending;
    this.pending = this.extract(selectBundled);
    try { return await this.pending; }
    finally { this.pending = undefined; }
  }

  private async extract(selectBundled: boolean): Promise<boolean> {
    if (!Platform.isDesktopApp) return false;
    // A settings edit during extraction takes precedence over startup work.
    const initialMode = this.getSettings().csvzallExecutableMode;
    const initialPath = this.getSettings().csvzallPath;
    this.preparedPath = undefined;
    try {
      const result = await this.prepareBundledHelper();
      const settings = this.getSettings();
      if (settings.csvzallPath !== initialPath || settings.csvzallExecutableMode !== initialMode) return false;
      const changed = result.changed || settings.csvzallPath !== result.executablePath ||
        settings.installedCsvzallVersion !== result.tagName || settings.installedCsvzallAssetName !== result.assetName ||
        settings.csvzallExecutableMode !== "bundled";
      settings.csvzallExecutableMode = "bundled";
      settings.csvzallPath = result.executablePath;
      settings.installedCsvzallVersion = result.tagName;
      settings.installedCsvzallAssetName = result.assetName;
      settings.csvzallLastUpdateCheckAt = "";
      this.preparedPath = result.executablePath;
      if (changed) {
        await this.saveSettings();
        await this.eventLog.record("info", `Prepared bundled csvzall ${result.tagName}`,
          `Asset: ${result.assetName}\nSHA-256: ${result.sha256}\nPath: ${result.executablePath}`);
      }
      if (selectBundled) new Notice(`Using bundled csvzall ${result.tagName}.`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Could not prepare bundled csvzall: ${message}`);
      await this.eventLog.record("error", "Failed to prepare bundled csvzall", message);
      console.error("Bundled csvzall preparation failed", error);
      return false;
    }
  }
}

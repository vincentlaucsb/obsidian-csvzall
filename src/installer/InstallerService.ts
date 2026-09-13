import { Notice, Platform } from "obsidian";
import { stat } from "fs/promises";
import { getLatestCsvzallReleaseInfo, installCsvzallBinary } from "../installer.js";
import type { EventLog } from "../logging/EventLog.js";
import type { ObsidianFilesystem } from "../obsidian/filesystem.js";
import type { CsvzallPluginSettings } from "../settings/settings.js";
import { isManagedCsvzallCurrent } from "./managedInstall.js";

export class InstallerService {
  constructor(
    private readonly getSettings: () => CsvzallPluginSettings,
    private readonly saveSettings: () => Promise<void>,
    private readonly eventLog: EventLog,
    private readonly filesystem: ObsidianFilesystem,
  ) {}

  async installDesktopCsvzall(): Promise<boolean> {
    if (!Platform.isDesktopApp) {
      const message = "csvzall installation requires the Obsidian desktop app.";
      new Notice(message);
      await this.eventLog.record("error", message);
      return false;
    }

    try {
      const pluginDir = this.filesystem.getPluginDataDir();
      if (!pluginDir) {
        throw new Error("Could not resolve the plugin data directory.");
      }
      const checkedAt = new Date().toISOString();
      const currentVersion = this.getSettings().installedCsvzallVersion;
      if (currentVersion) {
        const latest = await getLatestCsvzallReleaseInfo();
        this.getSettings().csvzallLastUpdateCheckAt = checkedAt;
        const executableExists = await stat(this.getSettings().csvzallPath)
          .then((entry) => entry.isFile(), () => false);
        if (executableExists && isManagedCsvzallCurrent(this.getSettings(), latest)) {
          await this.saveSettings();
          new Notice(`csvzall ${currentVersion} is up to date.`);
          await this.eventLog.record(
            "info",
            `Checked csvzall updates`,
            `Current version: ${currentVersion}\nLatest version: ${latest.tagName}\nAsset: ${latest.assetName}`,
          );
          return true;
        }
      }
      const result = await installCsvzallBinary({
        pluginDir,
      });
      this.getSettings().csvzallPath = result.executablePath;
      this.getSettings().installedCsvzallVersion = result.tagName;
      this.getSettings().installedCsvzallAssetName = result.assetName;
      this.getSettings().csvzallLastUpdateCheckAt = checkedAt;
      await this.saveSettings();
      new Notice(`csvzall ${result.tagName} installed.`);
      await this.eventLog.record(
        "info",
        `Installed csvzall ${result.tagName}`,
        `Asset: ${result.assetName}\nSHA-256: ${result.sha256}\nPath: ${result.executablePath}`,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`csvzall install failed: ${message}`);
      await this.eventLog.record("error", "Failed to install csvzall", message);
      console.error("csvzall install failed", error);
      return false;
    }
  }
}

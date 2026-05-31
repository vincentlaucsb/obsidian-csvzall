import { Notice, Platform } from "obsidian";
import { installCsvzallBinary } from "../installer.js";
import type { EventLog } from "../logging/EventLog.js";
import type { ObsidianFilesystem } from "../obsidian/filesystem.js";
import type { CsvzallPluginSettings } from "../settings/settings.js";

export class InstallerService {
  constructor(
    private readonly getSettings: () => CsvzallPluginSettings,
    private readonly saveSettings: () => Promise<void>,
    private readonly eventLog: EventLog,
    private readonly filesystem: ObsidianFilesystem,
  ) {}

  async installDesktopCsvzall(): Promise<void> {
    if (!Platform.isDesktopApp) {
      const message = "csvzall installation requires the Obsidian desktop app.";
      new Notice(message);
      await this.eventLog.record("error", message);
      return;
    }

    try {
      const pluginDir = this.filesystem.getPluginDataDir();
      if (!pluginDir) {
        throw new Error("Could not resolve the plugin data directory.");
      }
      const result = await installCsvzallBinary({
        pluginDir,
      });
      this.getSettings().csvzallPath = result.executablePath;
      await this.saveSettings();
      new Notice(`csvzall ${result.tagName} installed.`);
      await this.eventLog.record(
        "info",
        `Installed csvzall ${result.tagName}`,
        `Asset: ${result.assetName}\nSHA-256: ${result.sha256}\nPath: ${result.executablePath}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`csvzall install failed: ${message}`);
      await this.eventLog.record("error", "Failed to install csvzall", message);
      console.error("csvzall install failed", error);
    }
  }
}

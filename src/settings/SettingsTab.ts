import { Platform, PluginSettingTab, Setting } from "obsidian";
import type { Plugin, SettingDefinitionRender } from "obsidian";
import type { EventLog } from "../logging/EventLog.js";
import type { InstallerService } from "../installer/InstallerService.js";
import { stripOuterQuotes } from "../viewerHelpers.js";
import { DEFAULT_SETTINGS, MAX_EVENT_LOG_ENTRIES, type CsvzallPluginSettings } from "./settings.js";

const BUG_REPORT_URL = "https://github.com/vincentlaucsb/obsidian-csvzall/issues/new";

export interface CsvzallSettingTabServices {
  getSettings(): CsvzallPluginSettings;
  saveSettings(): Promise<void>;
  eventLog: EventLog;
  installer: InstallerService;
}

function formatSettingsTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString();
}

export class CsvzallSettingTab extends PluginSettingTab {
  private installing = false;

  constructor(
    plugin: Plugin,
    private readonly services: CsvzallSettingTabServices,
  ) {
    super(plugin.app, plugin);
  }

  display(): void {
    this.renderSettings();
  }

  private refreshSettings(): void {
    if (typeof this.update === "function") {
      this.update();
    } else {
      this.renderSettings();
    }
  }

  // Older hosts use the same row definitions as the searchable settings UI.
  private renderSettings(): void {
    this.containerEl.empty();
    for (const definition of this.getSettingDefinitions()) {
      const setting = new Setting(this.containerEl).setName(definition.name);
      if (definition.desc) setting.setDesc(definition.desc);
      definition.render(setting);
    }
  }

  getSettingDefinitions(): Array<Omit<SettingDefinitionRender, "render"> & { render: (setting: Setting) => void }> {
    const settings = this.services.getSettings();
    const hasManagedInstall = settings.installedCsvzallVersion.length > 0;
    const csvzallInstallDesc = [
      "Downloads the matching desktop binary from GitHub Releases, verifies its SHA-256 checksum, and updates the path above.",
      `Current version: ${settings.installedCsvzallVersion || "not installed by this plugin"}.`,
      `Current asset: ${settings.installedCsvzallAssetName || "unknown"}.`,
      `Last checked: ${
        settings.csvzallLastUpdateCheckAt ?
          formatSettingsTimestamp(settings.csvzallLastUpdateCheckAt) :
          "never"
      }.`,
    ].join(" ");
    return [
      {
        name: "csvzall path",
        desc: "Path to the csvzall executable. Use an absolute path if csvzall is not on PATH.",
        render: (setting) => {
          setting.addText((text) =>
            text
              .setPlaceholder("csvzall")
              .setValue(settings.csvzallPath)
              .onChange(async (value) => {
                const nextPath = stripOuterQuotes(value) || DEFAULT_SETTINGS.csvzallPath;
                const nextSettings = this.services.getSettings();
                if (nextPath !== nextSettings.csvzallPath) {
                  nextSettings.installedCsvzallVersion = "";
                  nextSettings.installedCsvzallAssetName = "";
                  nextSettings.csvzallLastUpdateCheckAt = "";
                }
                nextSettings.csvzallPath = nextPath;
                await this.services.saveSettings();
              }),
          );
        },
      },

      {
        name: hasManagedInstall ? "csvzall updates" : "Install csvzall",
        desc: csvzallInstallDesc,
        render: (setting) => {
          setting.addButton((button) =>
            button
              .setButtonText(this.installing ?
                (hasManagedInstall ? "Checking..." : "Installing...") :
                (hasManagedInstall ? "Check for updates" : "Install"))
              .setDisabled(this.installing || !Platform.isDesktopApp)
              .onClick(async () => {
                this.installing = true;
                this.refreshSettings();
                try {
                  await this.services.installer.installDesktopCsvzall();
                } finally {
                  this.installing = false;
                  this.refreshSettings();
                }
              }),
          );
        },
      },

      {
        name: "Open inside Obsidian",
        desc: "Embed the local csvzall viewer in an Obsidian pane instead of opening a browser.",
        render: (setting) => {
          setting.addToggle((toggle) =>
            toggle
              .setValue(settings.openInObsidian)
              .onChange(async (value) => {
                this.services.getSettings().openInObsidian = value;
                await this.services.saveSettings();
              }),
          );
        },
      },

      {
        name: "Startup timeout",
        desc: "Milliseconds to wait for csvzall view to print its local URL.",
        render: (setting) => {
          setting.addText((text) =>
            text
              .setPlaceholder(String(DEFAULT_SETTINGS.startupTimeoutMs))
              .setValue(String(settings.startupTimeoutMs))
              .onChange(async (value) => {
                const parsed = Number.parseInt(value, 10);
                this.services.getSettings().startupTimeoutMs =
                  Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SETTINGS.startupTimeoutMs;
                await this.services.saveSettings();
              }),
          );
        },
      },

      {
        name: "Report a bug",
        desc: "Open the csvzall for Obsidian issue tracker.",
        render: (setting) => {
          setting.addButton((button) =>
            button
              .setButtonText("Report a bug")
              .onClick(() => {
                window.open(BUG_REPORT_URL, "_blank", "noopener");
              }),
          );
        },
      },

      { name: "Log", render: (setting) => { setting.setHeading(); } },
      {
        name: "Chart and error log",
        desc: `Keeps the latest ${MAX_EVENT_LOG_ENTRIES} csvzall chart events and errors.`,
        render: (setting) => {
          setting.addButton((button) =>
            button
              .setButtonText("Clear")
              .setDisabled(settings.eventLog.length === 0)
              .onClick(async () => {
                await this.services.eventLog.clear();
                this.refreshSettings();
              }),
          );
          this.renderLog(setting.descEl);
        },
      },
    ];
  }

  private renderLog(containerEl: HTMLElement): void {
    const settings = this.services.getSettings();
    const log = containerEl.createDiv({ cls: "csvzall-settings-log" });
    if (settings.eventLog.length === 0) {
      log.createDiv({
        cls: "csvzall-settings-log-empty",
        text: "No csvzall events yet.",
      });
      return;
    }

    for (const entry of settings.eventLog) {
      const item = log.createDiv({ cls: `csvzall-settings-log-entry is-${entry.level}` });
      const header = item.createDiv({ cls: "csvzall-settings-log-entry-header" });
      header.createSpan({
        cls: "csvzall-settings-log-entry-level",
        text: entry.level,
      });
      header.createSpan({
        cls: "csvzall-settings-log-entry-time",
        text: new Date(entry.timestamp).toLocaleString(),
      });
      item.createDiv({
        cls: "csvzall-settings-log-entry-message",
        text: entry.message,
      });
      if (entry.detail) {
        item.createEl("pre", {
          cls: "csvzall-settings-log-entry-detail",
          text: entry.detail,
        });
      }
    }
  }
}

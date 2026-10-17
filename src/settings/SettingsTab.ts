import { Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import type { Plugin, SettingDefinitionRender } from "obsidian";
import type { EventLog } from "../logging/EventLog.js";
import type { InstallerService } from "../installer/InstallerService.js";
import { stripOuterQuotes } from "../viewerHelpers.js";
import { DEFAULT_SETTINGS, MAX_EVENT_LOG_ENTRIES, type CsvzallPluginSettings } from "./settings.js";
import type { ExportSettingsService } from "./ExportSettingsService.js";
import { BUNDLED_CSVZALL_VERSION } from "../installer/bundledBinaries.generated.js";
import { addExportActions } from "./exportActions.js";

const BUG_REPORT_URL = "https://github.com/vincentlaucsb/obsidian-csvzall/issues/new";

export interface CsvzallSettingTabServices {
  getSettings(): CsvzallPluginSettings;
  saveSettings(): Promise<void>;
  eventLog: EventLog;
  installer: InstallerService;
  exports: ExportSettingsService;
}

export class CsvzallSettingTab extends PluginSettingTab {
  private installing = false;
  private exportsRevision = 0;

  constructor(
    plugin: Plugin,
    private readonly services: CsvzallSettingTabServices,
  ) {
    super(plugin.app, plugin);
  }

  hide(): void { this.exportsRevision++; }

  private refreshSettings(): void {
    this.update();
  }

  private async useBundledHelper(): Promise<void> {
    if (this.installing) return;
    this.installing = true;
    this.refreshSettings();
    try { await this.services.installer.installDesktopCsvzall(); }
    finally {
      this.installing = false;
      this.refreshSettings();
    }
  }

  getSettingDefinitions(): Array<Omit<SettingDefinitionRender, "render"> & { render: (setting: Setting) => void }> {
    const settings = this.services.getSettings();
    const usesBundled = settings.csvzallExecutableMode === "bundled";
    const csvzallInstallDesc = `csvzall ${BUNDLED_CSVZALL_VERSION} is included with this plugin and updates with it. Restore its files or switch back from a custom executable without downloading anything.`;
    return [
      {
        name: "Custom executable path",
        desc: "Leave empty to use the bundled helper. Set an absolute path or a command on PATH to manage csvzall independently.",
        render: (setting) => {
          setting.addText((text) =>
            text
              .setPlaceholder("Use bundled helper")
              .setValue(usesBundled ? "" : settings.csvzallPath)
              .onChange(async (value) => {
                const nextPath = stripOuterQuotes(value);
                if (!nextPath) {
                  await this.useBundledHelper();
                  return;
                }
                const nextSettings = this.services.getSettings();
                if (nextPath !== nextSettings.csvzallPath) {
                  nextSettings.installedCsvzallVersion = "";
                  nextSettings.installedCsvzallAssetName = "";
                  nextSettings.csvzallLastUpdateCheckAt = "";
                }
                nextSettings.csvzallPath = nextPath;
                nextSettings.csvzallExecutableMode = "custom";
                await this.services.saveSettings();
              }),
          );
        },
      },

      {
        name: "Bundled helper",
        desc: csvzallInstallDesc,
        render: (setting) => {
          setting.addButton((button) =>
            button
              .setButtonText(this.installing ? "Preparing..." : "Use bundled helper")
              .setDisabled(this.installing || !Platform.isDesktopApp)
              .onClick(() => this.useBundledHelper()),
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

      { name: "Active exports", render: setting => { setting.setHeading(); } },
      { name: "Files with exports", desc: "Manage saved chart and note export configurations, including paused exports.",
        render: setting => { this.renderExports(setting); } },
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

  private renderExports(setting: Setting): void {
    const revision = ++this.exportsRevision;
    const container = setting.settingEl.createDiv({ cls: "csvzall-settings-exports" });
    const status = container.createDiv({ text: "Loading exports..." });
    const refresh = () => { if (this.exportsRevision === revision) this.refreshSettings(); };
    void this.services.exports.list().then(files => {
      if (this.exportsRevision !== revision) return;
      status.remove();
      if (files.length === 0) container.createDiv({ text: "No active exports." });
      for (const file of files) {
        const charts = file.entries.filter(entry => entry.kind === "chart" && entry.chart.definition.type !== "markdown-table").length;
        const tables = file.entries.length - charts;
        const counts = [charts ? `${charts} chart${charts === 1 ? "" : "s"}` : "", tables ? `${tables} table or value export${tables === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
        addExportActions(new Setting(container).setName(file.source).setDesc(`${counts}${file.missing ? " · CSV missing" : ""}`), {
          configureDisabled: file.missing,
          configure: () => {
            try { this.services.exports.configure(file, refresh); }
            catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
          },
          remove: () => { this.services.exports.confirmDelete(file, refresh); },
        });
      }
    }).catch((error: unknown) => {
      if (this.exportsRevision !== revision) return;
      status.setText(`Could not load exports: ${error instanceof Error ? error.message : String(error)}`);
      new Setting(container).addButton(button => button.setButtonText("Retry").onClick(refresh));
    });
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

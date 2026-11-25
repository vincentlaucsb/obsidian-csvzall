import { Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import type { Plugin, SettingDefinitionRender } from "obsidian";
import type { EventLog } from "../logging/EventLog.js";
import type { InstallerService } from "../installer/InstallerService.js";
import type { AgentIntegrationService } from "../agents/AgentIntegrationService.js";
import { stripOuterQuotes } from "../viewerHelpers.js";
import { DEFAULT_SETTINGS, MAX_EVENT_LOG_ENTRIES, type CsvzallPluginSettings } from "./settings.js";
import { autosaveSetting } from "./autosave.js";
import { jsonViewerSetting } from "./jsonViewer.js";
import type { ExportSettingsService } from "./ExportSettingsService.js";
import { BUNDLED_CSVZALL_VERSION } from "../installer/bundledPayloads.generated.js";
import { loadExports } from "./exportList.js";
import { exportSummaryText } from "./exportSummary.js";
import { closeSettings } from "../obsidian/settingsModal.js";
import { syncDescription, syncStatus } from "../obsidian/syncStatus.js";

const BUG_REPORT_URL = "https://github.com/vincentlaucsb/obsidian-csvzall/issues/new";

export interface CsvzallSettingTabServices {
  getSettings(): CsvzallPluginSettings;
  saveSettings(): Promise<void>;
  eventLog: EventLog;
  installer: InstallerService;
  agents: Pick<AgentIntegrationService, "enable" | "remove" | "testConnection">;
  exports: Pick<ExportSettingsService, "list">;
  openExports(): Promise<void>;
}

export class CsvzallSettingTab extends PluginSettingTab {
  private installing = false;
  private agentAction = false;
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

  private async persistSettings(): Promise<void> {
    try { await this.services.saveSettings(); }
    catch (error) { new Notice(`Could not save csvzall settings: ${error instanceof Error ? error.message : String(error)}`); }
  }

  private async useBundledHelper(): Promise<void> {
    if (this.installing) return;
    this.installing = true;
    this.refreshSettings();
    try { await this.services.installer.installDesktopCsvzall(); }
    catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
    finally {
      this.installing = false;
      this.refreshSettings();
    }
  }

  private async runAgentAction(action: "enable" | "remove" | "testConnection"): Promise<void> {
    if (this.agentAction) return;
    this.agentAction = true;
    this.refreshSettings();
    try {
      await this.services.agents[action]();
      new Notice(action === "testConnection" ? "Bundled helper ran successfully with PATH empty." :
        action === "remove" ? "Agent integration disabled; unchanged generated files removed." : "Agent skills installed. Open a new agent chat in the vault root.");
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
    finally { this.agentAction = false; this.refreshSettings(); }
  }

  getSettingDefinitions(): Array<Omit<SettingDefinitionRender, "render"> & { render: (setting: Setting) => void }> {
    const settings = this.services.getSettings();
    const usesBundled = settings.csvzallExecutableMode === "bundled";
    const csvzallInstallDesc = `csvzall ${BUNDLED_CSVZALL_VERSION} is included with this plugin and updates with it. Restore its files or switch back from a custom executable without downloading anything.`;
    return [
      autosaveSetting(settings.autosaveMode, async mode => {
        this.services.getSettings().autosaveMode = mode;
        await this.persistSettings();
      }),
      jsonViewerSetting(settings.defaultJsonViewer, async enabled => {
        this.services.getSettings().defaultJsonViewer = enabled;
        await this.persistSettings();
      }),
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
                await this.persistSettings();
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
                await this.persistSettings();
              }),
          );
        },
      },

      {
        name: "Agent integration",
        desc: "Install csvzall/SKILL.md in this vault's .agents/skills, .claude/skills, and .opencode/skills folders for Copilot, Claude Code, and Codex. Uses the bundled helper, independently of your custom executable. No PATH setup needed. Edited or linked skills are preserved.",
        render: setting => {
          setting.addButton(button => button.setButtonText("Enable or repair").setDisabled(this.agentAction || !Platform.isDesktopApp)
            .onClick(() => this.runAgentAction("enable")));
          setting.addButton(button => button.setButtonText("Test connection").setDisabled(this.agentAction || !Platform.isDesktopApp)
            .onClick(() => this.runAgentAction("testConnection")));
          setting.addButton(button => button.setButtonText("Remove").setDestructive().setDisabled(this.agentAction || !Platform.isDesktopApp)
            .onClick(() => this.runAgentAction("remove")));
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
                await this.persistSettings();
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

      { name: "Exports", render: setting => { setting.setHeading(); } },
      { name: "Export sync", desc: "Check export configuration and CSV/TSV source syncing.", render: setting => {
        setting.setDesc(syncDescription(syncStatus(this.app)));
        setting.addButton(button => button.setButtonText("Check again").onClick(() => this.refreshSettings()));
      } },
      { name: "Saved exports", desc: "Chart and note export configurations, including paused exports.",
        render: setting => { this.renderExportSummary(setting); } },
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
                try { await this.services.eventLog.clear(); }
                catch (error) { new Notice(`Could not clear the csvzall log: ${error instanceof Error ? error.message : String(error)}`); }
                finally { this.refreshSettings(); }
              }),
          );
          this.renderLog(setting.descEl);
        },
      },
    ];
  }

  /** Settings only show counts; the exports tab owns the full list and its actions. */
  private renderExportSummary(setting: Setting): void {
    const revision = ++this.exportsRevision;
    setting.addButton(button => button.setButtonText("Configure").onClick(() => {
      // Close settings so the exports tab is visible; a no-op if Obsidian's private API changes.
      closeSettings(this.app);
      void this.services.openExports().catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error)));
    }));
    const summary = setting.descEl.createDiv();
    loadExports(summary, this.services.exports, () => this.exportsRevision === revision,
      files => { summary.createDiv({ text: exportSummaryText(files) }); });
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

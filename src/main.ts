import { Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import { ChartService } from "./charts/ChartService.js";
import { registerChartCommands } from "./commands/registerChartCommands.js";
import { registerCsvCommands } from "./commands/registerCsvCommands.js";
import { CsvService } from "./csv/CsvService.js";
import { InstallerService } from "./installer/InstallerService.js";
import { EventLog } from "./logging/EventLog.js";
import { ObsidianFilesystem } from "./obsidian/filesystem.js";
import { CsvzallProcessService } from "./process/CsvzallProcessService.js";
import { CsvzallSettingTab } from "./settings/SettingsTab.js";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type CsvzallPluginSettings,
} from "./settings/settings.js";
import { CsvzallTableView } from "./views/CsvzallTableView.js";
import { VIEW_TYPE_CSVZALL } from "./views/viewTypes.js";
import { registerVaultWatchers } from "./watchers/registerVaultWatchers.js";

export default class CsvzallPlugin extends Plugin {
  settings: CsvzallPluginSettings = DEFAULT_SETTINGS;

  private eventLog!: EventLog;
  private filesystem!: ObsidianFilesystem;
  private processService!: CsvzallProcessService;
  private csvService!: CsvService;
  private chartService!: ChartService;
  private installerService!: InstallerService;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.createServices();
    await this.chartService.reloadChartConfig();

    this.registerView(VIEW_TYPE_CSVZALL, (leaf) => new CsvzallTableView(leaf, this));
    this.registerExtensions(["csv"], VIEW_TYPE_CSVZALL);
    this.addSettingTab(new CsvzallSettingTab(this, {
      getSettings: () => this.settings,
      saveSettings: () => this.saveSettings(),
      eventLog: this.eventLog,
      installer: this.installerService,
    }));

    registerCsvCommands(this, this.csvService);
    registerChartCommands(this, this.chartService, this.csvService);
    registerVaultWatchers(this, this.chartService, this.csvService);
  }

  onunload(): void {
    this.chartService?.scheduler.clear();
    this.processService?.unload();
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async clearEventLog(): Promise<void> {
    await this.eventLog.clear();
  }

  async installDesktopCsvzall(): Promise<void> {
    await this.installerService.installDesktopCsvzall();
  }

  handleLeafClosed(leaf: WorkspaceLeaf): void {
    this.processService.handleLeafClosed(leaf);
  }

  async openCsvInLeaf(file: TFile, leaf: WorkspaceLeaf): Promise<void> {
    await this.csvService.openCsvInLeaf(file, leaf);
  }

  private createServices(): void {
    this.eventLog = new EventLog(
      () => this.settings,
      () => this.saveSettings(),
    );
    this.filesystem = new ObsidianFilesystem(this.app, this.manifest);
    this.processService = new CsvzallProcessService(
      () => this.settings,
      this.eventLog,
    );
    this.csvService = new CsvService(
      this.app,
      () => this.settings,
      this.eventLog,
      this.filesystem,
      this.processService,
    );
    this.chartService = new ChartService(
      this.app,
      this.eventLog,
      this.filesystem,
      this.processService,
    );
    this.installerService = new InstallerService(
      () => this.settings,
      () => this.saveSettings(),
      this.eventLog,
      this.filesystem,
    );
  }
}

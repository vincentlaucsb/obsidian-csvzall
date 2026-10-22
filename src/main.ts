import { Plugin, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import { ChartService } from "./charts/ChartService.js";
import { registerChartCommands } from "./commands/registerChartCommands.js";
import { registerCsvCommands } from "./commands/registerCsvCommands.js";
import { CsvService } from "./csv/CsvService.js";
import { CSV_EXTENSIONS } from "./csv/csvFiles.js";
import { InstallerService } from "./installer/InstallerService.js";
import { EventLog } from "./logging/EventLog.js";
import { ObsidianFilesystem } from "./obsidian/filesystem.js";
import { CsvzallProcessService } from "./process/CsvzallProcessService.js";
import { CsvzallSettingTab } from "./settings/SettingsTab.js";
import {
  DEFAULT_SETTINGS,
  type CsvzallPluginSettings,
} from "./settings/settings.js";
import { CsvzallTableView } from "./views/CsvzallTableView.js";
import { VIEW_TYPE_CSVZALL, VIEW_TYPE_CSVZALL_EXPORTS } from "./views/viewTypes.js";
import { CsvzallExportsView, openExportsView } from "./views/ExportsView.js";
import { registerExportCommands } from "./commands/registerExportCommands.js";
import { PluginDataStore } from "./settings/PluginDataStore.js";
import { ExportReflection } from "./exports/ExportReflection.js";
import { SessionErrors } from "./logging/SessionErrors.js";
import { Notice } from "obsidian";
import { openPluginSettings } from "./obsidian/settingsModal.js";
import { registerVaultWatchers } from "./watchers/registerVaultWatchers.js";
import { MarkdownTableService } from "./markdown/MarkdownTableService.js";
import { registerMarkdownCommands } from "./commands/registerMarkdownCommands.js";
import { ExportSettingsService } from "./settings/ExportSettingsService.js";

export default class CsvzallPlugin extends Plugin {
  settings: CsvzallPluginSettings = DEFAULT_SETTINGS;

  private eventLog!: EventLog;
  private filesystem!: ObsidianFilesystem;
  private processService!: CsvzallProcessService;
  private csvService!: CsvService;
  private chartService!: ChartService;
  private installerService!: InstallerService;
  private markdownTables!: MarkdownTableService;
  private exportSettings!: ExportSettingsService;
  private dataStore!: PluginDataStore;
  private reflection!: ExportReflection;
  private readonly reflectionErrors = new SessionErrors();
  private exportsReady = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.createServices();
    await this.reflection.initialize();
    await this.installerService.ensureBundledCsvzall();
    await this.chartService.reloadChartConfig();

    this.registerView(VIEW_TYPE_CSVZALL, (leaf) => new CsvzallTableView(leaf, this));
    this.registerExtensions(CSV_EXTENSIONS, VIEW_TYPE_CSVZALL);
    this.registerView(VIEW_TYPE_CSVZALL_EXPORTS, (leaf) => new CsvzallExportsView(leaf, this.exportSettings));
    this.addSettingTab(new CsvzallSettingTab(this, {
      getSettings: () => this.settings,
      saveSettings: () => this.saveSettings(),
      eventLog: this.eventLog,
      installer: this.installerService,
      exports: this.exportSettings,
      openExports: () => openExportsView(this.app),
    }));

    registerCsvCommands(this, this.csvService);
    registerChartCommands(this, this.chartService, this.csvService);
    registerVaultWatchers(this, this.chartService, this.csvService);
    registerMarkdownCommands(this, this.markdownTables);
    registerExportCommands(this);
    this.markdownTables.register(this);
    this.exportSettings.register(this);
    this.exportsReady = true;
    this.registerInterval(window.setInterval(() => {
      void this.reflection.reconcile().catch((error: unknown) => this.reportReflectionError(error));
    }, 10000));
  }

  onunload(): void {
    this.exportsReady = false;
    this.reflection?.stop();
    this.chartService?.scheduler.clear();
    this.markdownTables?.unload();
    this.processService?.unload();
  }

  async loadSettings(): Promise<void> {
    this.dataStore = new PluginDataStore({ load: () => this.loadData(), save: value => this.saveData(value),
      loadLocal: (): unknown => this.app.loadLocalStorage(`${this.manifest.id}:${this.app.vault.configDir}:device-settings`),
      saveLocal: value => this.app.saveLocalStorage(`${this.manifest.id}:${this.app.vault.configDir}:device-settings`, value) });
    this.settings = await this.dataStore.initialize();
  }

  async saveSettings(): Promise<void> {
    await this.dataStore.saveSettings(this.settings);
  }

  async onExternalSettingsChange(): Promise<void> {
    try {
      await this.dataStore.externalSettings(this.settings);
      await this.reflection.reconcile();
    } catch (error) { this.reportReflectionError(error); }
  }

  private reportReflectionError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (this.reflectionErrors.first("reflection", message)) {
      new Notice(`Could not sync CSV export configurations: ${message}`);
      console.error("csvzall export reflection", error);
    }
  }

  async clearEventLog(): Promise<void> {
    await this.eventLog.clear();
  }

  async installDesktopCsvzall(): Promise<boolean> {
    return await this.installerService.installDesktopCsvzall();
  }

  handleLeafClosed(leaf: WorkspaceLeaf): void {
    this.processService.handleLeafClosed(leaf);
  }

  async openCsvInLeaf(file: TFile, leaf: WorkspaceLeaf): Promise<void> {
    await this.csvService.openCsvInLeaf(file, leaf);
  }

  async installCsvzallFromView(_file: TFile, _leaf: WorkspaceLeaf): Promise<boolean> {
    return await this.installerService.installDesktopCsvzall();
  }

  openCsvzallSettings(): void {
    openPluginSettings(this.app, this.manifest.id);
  }

  insertQueryIntoNote(file: TFile, sql: string, cancelled: () => boolean, lifecycle?: AbortSignal): Promise<boolean> {
    return this.markdownTables.insertQueryIntoNote(file, sql, cancelled, lifecycle);
  }

  private createServices(): void {
    this.reflection = new ExportReflection({ adapter: this.app.vault.adapter, store: this.dataStore,
      localDirectory: `${this.app.vault.configDir}/plugins/${this.manifest.id}/export-sync-local`,
      folders: () => this.app.vault.getAllLoadedFiles().filter(file => file instanceof TFolder).map(folder => folder.path),
      directFolders: true,
      references: () => this.markdownTables.migrationReferences(),
      report: error => this.reportReflectionError(error),
      changed: () => {
        if (!this.exportsReady) return;
        void this.chartService?.refreshAfterSync();
        void this.markdownTables?.refreshAfterSync();
      } });
    this.eventLog = new EventLog(
      () => this.settings,
      () => this.saveSettings(),
    );
    this.filesystem = new ObsidianFilesystem(this.app, this.manifest);
    this.processService = new CsvzallProcessService(
      () => this.settings,
      this.eventLog,
      () => this.installerService.getExecutablePath(),
      () => this.reflection.reconcile(),
    );
    this.csvService = new CsvService(
      this.app,
      () => this.settings,
      this.eventLog,
      this.filesystem,
      this.processService,
      this.reflection,
    );
    this.chartService = new ChartService(
      this.app,
      this.eventLog,
      this.filesystem,
      this.processService,
      this.reflection,
    );
    this.installerService = new InstallerService(
      () => this.settings,
      () => this.saveSettings(),
      this.eventLog,
      this.filesystem,
    );
    this.markdownTables = new MarkdownTableService(this.app, this.filesystem, this.processService, this.eventLog, this.reflection, {
      syntax: () => this.settings.exportSyntax,
      saveSyntax: async syntax => { if (this.settings.exportSyntax !== syntax) { this.settings.exportSyntax = syntax; await this.saveSettings(); } },
    });
    this.exportSettings = new ExportSettingsService(this.app, this.chartService, this.markdownTables, this.filesystem, this.processService, this.reflection);
  }
}

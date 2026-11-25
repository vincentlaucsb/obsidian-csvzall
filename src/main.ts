import { Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import { registerJsonExtension } from "./views/registerJsonExtension.js";
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
import { CsvzallTableView, updateViewerAutosave } from "./views/CsvzallTableView.js";
import type { AutosaveMode } from "./settings/autosave.js";
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
import { VaultExportDiscovery } from "./exports/VaultExportDiscovery.js";
import { AgentIntegrationService } from "./agents/AgentIntegrationService.js";
import { pluginVaultDirectory } from "./obsidian/pluginPaths.js";

export default class CsvzallPlugin extends Plugin {
  settings: CsvzallPluginSettings = DEFAULT_SETTINGS;

  private eventLog!: EventLog;
  private filesystem!: ObsidianFilesystem;
  private processService!: CsvzallProcessService;
  private csvService!: CsvService;
  private chartService!: ChartService;
  private installerService!: InstallerService;
  private agentIntegration!: AgentIntegrationService;
  private markdownTables!: MarkdownTableService;
  private exportSettings!: ExportSettingsService;
  private dataStore!: PluginDataStore;
  private reflection!: ExportReflection;
  private readonly reflectionErrors = new SessionErrors();
  private exportsReady = false;
  private appliedAutosave: AutosaveMode = "off";

  async onload(): Promise<void> {
    await this.loadSettings();
    this.appliedAutosave = this.settings.autosaveMode;
    this.createServices();
    await this.reflection.initialize();
    await this.installerService.ensureBundledCsvzall();
    void this.agentIntegration.refresh().catch((error: unknown) => new Notice(`Agent integration: ${error instanceof Error ? error.message : String(error)}`));
    await this.chartService.reloadChartConfig();

    this.registerView(VIEW_TYPE_CSVZALL, (leaf) => new CsvzallTableView(leaf, this));
    this.registerExtensions(CSV_EXTENSIONS, VIEW_TYPE_CSVZALL);
    const jsonView = this.manifest.id + "-json";
    this.registerView(jsonView, leaf => new CsvzallTableView(leaf, this, jsonView));
    registerJsonExtension(this, jsonView);
    this.registerView(VIEW_TYPE_CSVZALL_EXPORTS, (leaf) => new CsvzallExportsView(leaf, this.exportSettings));
    this.addSettingTab(new CsvzallSettingTab(this, {
      getSettings: () => this.settings,
      saveSettings: () => this.saveSettings(),
      eventLog: this.eventLog,
      installer: this.installerService,
      agents: this.agentIntegration,
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
      void this.reflection.reconcile().then(() => this.markdownTables.pruneDeadExports()).catch((error: unknown) => this.reportReflectionError(error));
    }, 10000));
  }

  onunload(): void {
    this.exportsReady = false;
    this.agentIntegration?.stop();
    this.reflection?.stop();
    this.chartService?.scheduler.clear();
    this.markdownTables?.unload();
    this.processService?.unload();
  }

  async loadSettings(): Promise<void> {
    const directory = pluginVaultDirectory(this.app.vault.configDir, { id: this.manifest.id, dir: this.manifest.dir });
    const adapter = this.app.vault.adapter;
    this.dataStore = new PluginDataStore({ load: async () => {
      const data: unknown = await this.loadData();
      if (data === undefined && await adapter.stat(`${directory}/data.json`)) throw new Error("Could not read existing csvzall plugin data.");
      return data;
    }, save: value => this.saveData(value), directoryAvailable: async () => (await adapter.stat(directory))?.type === "folder",
      loadLocal: (): unknown => this.app.loadLocalStorage(`${this.manifest.id}:${this.app.vault.configDir}:device-settings`),
      saveLocal: value => this.app.saveLocalStorage(`${this.manifest.id}:${this.app.vault.configDir}:device-settings`, value) });
    this.settings = await this.dataStore.initialize();
  }

  async saveSettings(): Promise<void> {
    await this.dataStore.saveSettings(this.settings);
    this.applyAutosave();
  }

  private applyAutosave(): void {
    if (this.appliedAutosave === this.settings.autosaveMode) return;
    this.appliedAutosave = this.settings.autosaveMode;
    updateViewerAutosave(this.app.workspace, VIEW_TYPE_CSVZALL);
  }

  async onExternalSettingsChange(): Promise<void> {
    try {
      await this.dataStore.externalSettings(this.settings);
      this.applyAutosave();
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
    const discovery = new VaultExportDiscovery(this.app);
    this.filesystem = new ObsidianFilesystem(this.app, this.manifest);
    const pluginDirectory = pluginVaultDirectory(this.app.vault.configDir, { id: this.manifest.id, dir: this.manifest.dir });
    this.reflection = new ExportReflection({ adapter: this.app.vault.adapter, store: this.dataStore,
      localDirectory: `${pluginDirectory}/export-sync-local`,
      createLocalDirectory: this.filesystem.getPluginDataDir() ? () => this.filesystem.createPluginSubdirectory("export-sync-local") : undefined,
      folders: () => { discovery.restart(); discovery.step(); return discovery.takeFolders(); },
      deferDiscovery: true,
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
    this.processService = new CsvzallProcessService(
      () => this.settings,
      this.eventLog,
      () => this.installerService.getExecutablePath(),
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
    this.agentIntegration = new AgentIntegrationService(this.app, this.filesystem, this.installerService);
    this.markdownTables = new MarkdownTableService(this.app, this.filesystem, this.processService, this.eventLog, this.reflection, {
      syntax: () => this.settings.exportSyntax,
      saveSyntax: async syntax => { if (this.settings.exportSyntax !== syntax) { this.settings.exportSyntax = syntax; await this.saveSettings(); } },
    });
    this.exportSettings = new ExportSettingsService(this.app, this.chartService, this.markdownTables, this.filesystem, this.processService, this.reflection);
  }
}

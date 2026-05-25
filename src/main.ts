import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { dirname, isAbsolute } from "path";
import {
  FileSystemAdapter,
  FileView,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  type WorkspaceLeaf,
} from "obsidian";
import {
  ChartRunScheduler,
  chartRunKey,
  isChartConfigPath,
  matchingRunOnSaveCharts,
  normalizeVaultPath,
  outputChartsForCsv,
  parseChartConfigText,
} from "./chartAutomation.js";
import {
  extractViewerUrl,
  formatProcessFailure,
  stripOuterQuotes,
  ViewerSessionRegistry,
} from "./viewerHelpers.js";

const VIEW_TYPE_CSVZALL = "csvzall-view";
const MAX_EVENT_LOG_ENTRIES = 100;

interface CsvzallEventLogEntry {
  timestamp: string;
  level: "info" | "error";
  message: string;
  detail?: string;
}

interface CsvzallPluginSettings {
  csvzallPath: string;
  openInObsidian: boolean;
  startupTimeoutMs: number;
  eventLog: CsvzallEventLogEntry[];
}

const DEFAULT_SETTINGS: CsvzallPluginSettings = {
  csvzallPath: "csvzall",
  openInObsidian: true,
  startupTimeoutMs: 10000,
  eventLog: [],
};

interface CsvzallServerHandle {
  filePath: string;
  process: ChildProcessWithoutNullStreams;
  url: string;
  stopping: boolean;
}

interface ConfiguredChart {
  id: string;
  type: string;
  input: string;
  output: string;
  configPath: string;
  runOnSave: boolean;
}

class CsvzallTableView extends FileView {
  private titleText = "csvzall";
  private url = "";
  private errorText = "";
  private loading = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly owner: CsvzallPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_CSVZALL;
  }

  getDisplayText(): string {
    return this.file?.basename ?? this.titleText;
  }

  getIcon(): string {
    return "table";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.owner.handleLeafClosed(this.leaf);
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.owner.handleLeafClosed(this.leaf);
    this.titleText = file.basename;
    this.url = "";
    this.errorText = "";
    this.loading = true;
    this.render();
    await this.owner.openCsvInLeaf(file, this.leaf);
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    this.owner.handleLeafClosed(this.leaf);
    this.url = "";
    this.loading = false;
    this.render();
  }

  async onRename(file: TFile): Promise<void> {
    this.titleText = file.basename;
    this.render();
  }

  showViewer(title: string, url: string): void {
    this.titleText = title;
    this.url = url;
    this.errorText = "";
    this.loading = false;
    this.render();
  }

  showError(message: string): void {
    this.errorText = message;
    this.url = "";
    this.loading = false;
    this.render();
  }

  private render(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("csvzall-view-container");

    if (this.errorText) {
      const state = containerEl.createDiv({ cls: "csvzall-view-state" });
      state.createEl("p", {
        text: this.errorText,
        cls: "csvzall-view-error",
      });
      return;
    }

    if (!this.url) {
      const state = containerEl.createDiv({ cls: "csvzall-view-state" });
      state.createEl("p", {
        text: this.loading ? "Starting csvzall viewer..." : "No csvzall viewer URL is active.",
      });
      return;
    }

    const frame = containerEl.createEl("iframe", {
      cls: "csvzall-view-frame",
      attr: {
        src: this.url,
        sandbox: "allow-scripts allow-same-origin allow-forms",
      },
    });
    frame.setAttr("title", this.titleText);
  }
}

export default class CsvzallPlugin extends Plugin {
  settings: CsvzallPluginSettings = DEFAULT_SETTINGS;
  private readonly sessions = new ViewerSessionRegistry();
  private readonly chartScheduler = new ChartRunScheduler({
    runner: (_inputPath: string, chartKeys: string[]) => this.runConfiguredCharts(chartKeys),
  });
  private charts: ConfiguredChart[] = [];
  private unloading = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.reloadChartConfig();

    this.registerView(VIEW_TYPE_CSVZALL, (leaf) => new CsvzallTableView(leaf, this));
    this.registerExtensions(["csv"], VIEW_TYPE_CSVZALL);
    this.addSettingTab(new CsvzallSettingTab(this));

    this.addCommand({
      id: "open-active-csv",
      name: "Open active CSV with csvzall",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.isCsv(file)) {
          return false;
        }
        if (!checking) {
          void this.openCsv(file);
        }
        return true;
      },
    });

    this.addCommand({
      id: "regenerate-charts",
      name: "Regenerate Charts",
      callback: () => void this.runConfiguredCharts(this.charts.map((chart) => chartRunKey(chart))),
    });

    this.addCommand({
      id: "regenerate-charts-for-current-csv",
      name: "Regenerate Charts for Current CSV",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.isCsv(file)) {
          return false;
        }
        const charts = outputChartsForCsv(this.charts, file.path) as ConfiguredChart[];
        if (charts.length === 0) {
          return false;
        }
        if (!checking) {
          void this.runConfiguredCharts(charts.map((chart) => chartRunKey(chart)));
        }
        return true;
      },
    });

    this.addCommand({
      id: "open-generated-chart",
      name: "Open Generated Chart",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.isCsv(file)) {
          return false;
        }
        const [chart] = outputChartsForCsv(this.charts, file.path) as ConfiguredChart[];
        if (!chart?.output) {
          return false;
        }
        if (!checking) {
          void this.app.workspace.openLinkText(chart.output, "", false);
        }
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle("New CSV")
              .setIcon("table")
              .onClick(() => void this.createCsvInFolder(file));
          });
          return;
        }

        if (!(file instanceof TFile) || !this.isCsv(file)) {
          return;
        }

        menu.addItem((item) => {
          item
            .setTitle("Open with csvzall")
            .setIcon("table")
            .onClick(() => void this.openCsv(file));
        });
      }),
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile)) {
          return;
        }
        const path = normalizeVaultPath(file.path);
        if (isChartConfigPath(path)) {
          void this.reloadChartConfig();
          return;
        }
        if (!this.isCsv(file)) {
          return;
        }
        void this.reloadChartConfig().then(() => this.scheduleChartsForCsv(file.path));
      }),
    );
  }

  onunload(): void {
    this.unloading = true;
    this.chartScheduler.clear();
    this.sessions.shutdownAll();
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    if (!Array.isArray(this.settings.eventLog)) {
      this.settings.eventLog = [];
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async clearEventLog(): Promise<void> {
    this.settings.eventLog = [];
    await this.saveSettings();
  }

  private async recordEvent(
    level: CsvzallEventLogEntry["level"],
    message: string,
    detail?: string,
  ): Promise<void> {
    this.settings.eventLog = [
      {
        timestamp: new Date().toISOString(),
        level,
        message,
        detail,
      },
      ...this.settings.eventLog,
    ].slice(0, MAX_EVENT_LOG_ENTRIES);
    await this.saveSettings();
  }

  private isCsv(file: TFile): boolean {
    return file.extension.toLowerCase() === "csv";
  }

  private getFullPath(file: TFile): string | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      return null;
    }
    return adapter.getFullPath(file.path);
  }

  private getVaultRoot(): string | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      return null;
    }
    return adapter.getBasePath();
  }

  private async nextCsvPathInFolder(folder: TFolder): Promise<string> {
    const folderPath = normalizeVaultPath(folder.path);
    for (let index = 0; index < 10000; index += 1) {
      const name = index === 0 ? "Untitled.csv" : `Untitled ${index}.csv`;
      const path = folderPath ? `${folderPath}/${name}` : name;
      if (!await this.app.vault.adapter.exists(path)) {
        return path;
      }
    }
    throw new Error("Could not find an available Untitled CSV filename.");
  }

  private async createCsvInFolder(folder: TFolder): Promise<void> {
    try {
      const path = await this.nextCsvPathInFolder(folder);
      const file = await this.app.vault.create(path, "column\n");
      await this.openCsv(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`csvzall failed to create CSV: ${message}`);
      await this.recordEvent("error", "Failed to create CSV", message);
      console.error("csvzall failed to create CSV", error);
    }
  }

  private async reloadChartConfig(): Promise<void> {
    try {
      const configFiles = this.app.vault.getFiles()
        .map((file) => normalizeVaultPath(file.path))
        .filter(isChartConfigPath)
        .sort();
      const charts: ConfiguredChart[] = [];
      for (const configPath of configFiles) {
        const text = await this.app.vault.adapter.read(configPath);
        charts.push(...parseChartConfigText(text, configPath) as ConfiguredChart[]);
      }
      this.charts = charts;
    } catch (error) {
      this.charts = [];
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`csvzall failed to load chart config: ${message}`);
      await this.recordEvent("error", "Failed to load chart config", message);
      console.error("csvzall failed to load chart config", error);
    }
  }

  private scheduleChartsForCsv(path: string): void {
    const charts = matchingRunOnSaveCharts(this.charts, path) as ConfiguredChart[];
    if (charts.length === 0) {
      return;
    }
    this.chartScheduler.schedule(path, charts.map((chart) => chartRunKey(chart)));
  }

  private async runConfiguredCharts(chartKeys: string[]): Promise<void> {
    if (!Platform.isDesktopApp) {
      const message = "csvzall chart generation requires the Obsidian desktop app.";
      new Notice(message);
      await this.recordEvent("error", message);
      return;
    }

    const vaultRoot = this.getVaultRoot();
    if (!vaultRoot) {
      const message = "csvzall chart generation requires a local filesystem vault.";
      new Notice(message);
      await this.recordEvent("error", message);
      return;
    }

    const keys = Array.from(new Set(chartKeys)).filter(Boolean).sort();
    if (keys.length === 0) {
      new Notice("No csvzall charts are configured.");
      return;
    }

    let failures = 0;
    for (const key of keys) {
      const chart = this.charts.find((candidate) => chartRunKey(candidate) === key);
      if (!chart) {
        failures += 1;
        await this.recordEvent("error", "Failed to regenerate chart", `Chart config entry not found: ${key}`);
        continue;
      }
      try {
        await this.runCsvzallCommand(
          ["charts", "run", chart.id, "--config", chart.configPath],
          vaultRoot,
          `chart ${chart.id}`,
        );
        await this.recordEvent(
          "info",
          `Generated chart ${chart.id}`,
          chart.output ? `Output: ${chart.output}` : undefined,
        );
      } catch {
        failures += 1;
      }
    }
    if (failures > 0) {
      return;
    }
    new Notice(keys.length === 1 ? "csvzall chart regenerated." : `csvzall regenerated ${keys.length} charts.`);
  }

  private async runCsvzallCommand(args: string[], cwd: string, label: string): Promise<void> {
    const executable = stripOuterQuotes(this.settings.csvzallPath);
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("exit", (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            formatProcessFailure({
              executable,
              args,
              cwd,
              code,
              signal,
              stdout,
              stderr,
            }),
          ),
        );
      });
    }).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`csvzall failed to regenerate ${label}: ${message}`);
      await this.recordEvent("error", `Failed to regenerate ${label}`, message);
      console.error(`csvzall failed to regenerate ${label}`, error);
      throw error;
    });
  }

  private async openCsv(file: TFile): Promise<void> {
    if (this.settings.openInObsidian) {
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.openFile(file);
      this.app.workspace.revealLeaf(leaf);
      return;
    }

    await this.openCsvInBrowser(file);
  }

  async openCsvInLeaf(file: TFile, leaf: WorkspaceLeaf): Promise<void> {
    if (!Platform.isDesktopApp) {
      this.showLeafErrorText(leaf, "csvzall requires the Obsidian desktop app.");
      return;
    }

    const fullPath = this.getFullPath(file);
    if (!fullPath) {
      this.showLeafErrorText(leaf, "csvzall can only open files from a local filesystem vault.");
      return;
    }

    try {
      const server = await this.startViewer(fullPath);
      if (leaf.view instanceof CsvzallTableView) {
        leaf.view.showViewer(file.basename, server.url);
        this.bindLeafToServer(leaf, server);
        return;
      }
      server.stopping = true;
      server.process.kill();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.showLeafErrorText(leaf, message);
      new Notice(`csvzall failed to open CSV: ${message}`);
      await this.recordEvent("error", `Failed to open CSV ${file.path}`, message);
      console.error("csvzall failed to open CSV", error);
    }
  }

  private async openCsvInBrowser(file: TFile): Promise<void> {
    if (!Platform.isDesktopApp) {
      new Notice("csvzall requires the Obsidian desktop app.");
      return;
    }

    const fullPath = this.getFullPath(file);
    if (!fullPath) {
      new Notice("csvzall can only open files from a local filesystem vault.");
      return;
    }

    try {
      const server = await this.startViewer(fullPath);
      window.open(server.url, "_blank", "noopener");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`csvzall failed to open CSV: ${message}`);
      await this.recordEvent("error", `Failed to open CSV ${file.path}`, message);
      console.error("csvzall failed to open CSV", error);
    }
  }

  private async startViewer(filePath: string): Promise<CsvzallServerHandle> {
    const executable = stripOuterQuotes(this.settings.csvzallPath);
    const args = ["view", filePath, "--edit", "--no-open", "--startup-json"];
    const cwd = isAbsolute(executable) ? dirname(executable) : undefined;
    console.info("Starting csvzall viewer", { executable, args, cwd });
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    return await new Promise<CsvzallServerHandle>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        settled = true;
        child.kill();
        reject(new Error(`timed out waiting for csvzall after ${this.settings.startupTimeoutMs}ms`));
      }, this.settings.startupTimeoutMs);

      const finish = (url: string) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        const handle = {
          filePath,
          process: child,
          url,
          stopping: false,
        };
        this.sessions.add(handle);
        resolve(handle);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        const url = this.extractUrl(stdout);
        if (url) {
          finish(url);
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        reject(error);
      });

      child.on("exit", (code, signal) => {
        window.clearTimeout(timeout);
        const existingUrl = extractViewerUrl(stdout);
        if (existingUrl) {
          const handle = this.sessions.list().find((candidate) => candidate.process === child);
          if (handle) {
            if (!handle.stopping && !this.unloading) {
              void this.showLeafError(
                handle,
                formatProcessFailure({
                  executable,
                  args,
                  cwd,
                  code,
                  signal,
                  stdout,
                  stderr,
                }),
              );
            }
            this.detachServer(handle);
          }
          return;
        }
        if (settled) {
          return;
        }
        settled = true;
        reject(
          new Error(
            formatProcessFailure({
              executable,
              args,
              cwd,
              code,
              signal,
              stdout,
              stderr,
            }),
          ),
        );
      });
    });
  }

  private extractUrl(output: string): string | null {
    return extractViewerUrl(output);
  }

  private detachServer(handle: CsvzallServerHandle): void {
    this.sessions.detachHandle(handle);
  }

  private async showLeafError(handle: CsvzallServerHandle, message: string): Promise<void> {
    const leaf = this.sessions.leafForHandle(handle);
    this.showLeafErrorText(leaf, message);
  }

  private showLeafErrorText(leaf: WorkspaceLeaf | null | undefined, message: string): void {
    if (leaf?.view instanceof CsvzallTableView) {
      leaf.view.showError(message);
    }
  }

  handleLeafClosed(leaf: WorkspaceLeaf): void {
    this.sessions.closeLeaf(leaf);
  }

  private bindLeafToServer(leaf: WorkspaceLeaf, handle: CsvzallServerHandle): void {
    this.sessions.bindLeaf(leaf, handle);
  }

}

class CsvzallSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: CsvzallPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "csvzall" });

    new Setting(containerEl)
      .setName("csvzall path")
      .setDesc("Path to the csvzall executable. Use an absolute path if csvzall is not on PATH.")
      .addText((text) =>
        text
          .setPlaceholder("csvzall")
          .setValue(this.plugin.settings.csvzallPath)
          .onChange(async (value) => {
            this.plugin.settings.csvzallPath =
              stripOuterQuotes(value) || DEFAULT_SETTINGS.csvzallPath;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Open inside Obsidian")
      .setDesc("Embed the local csvzall viewer in an Obsidian pane instead of opening a browser.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openInObsidian)
          .onChange(async (value) => {
            this.plugin.settings.openInObsidian = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Startup timeout")
      .setDesc("Milliseconds to wait for csvzall view to print its local URL.")
      .addText((text) =>
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.startupTimeoutMs))
          .setValue(String(this.plugin.settings.startupTimeoutMs))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.startupTimeoutMs =
              Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SETTINGS.startupTimeoutMs;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl("h2", { text: "Log" });
    new Setting(containerEl)
      .setName("Chart and error log")
      .setDesc(`Keeps the latest ${MAX_EVENT_LOG_ENTRIES} csvzall chart events and errors.`)
      .addButton((button) =>
        button
          .setButtonText("Clear")
          .setDisabled(this.plugin.settings.eventLog.length === 0)
          .onClick(async () => {
            await this.plugin.clearEventLog();
            this.display();
          }),
      );

    const log = containerEl.createDiv({ cls: "csvzall-settings-log" });
    if (this.plugin.settings.eventLog.length === 0) {
      log.createDiv({
        cls: "csvzall-settings-log-empty",
        text: "No csvzall events yet.",
      });
      return;
    }

    for (const entry of this.plugin.settings.eventLog) {
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

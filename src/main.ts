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
  type WorkspaceLeaf,
} from "obsidian";
import {
  extractViewerUrl,
  formatProcessFailure,
  stripOuterQuotes,
  ViewerSessionRegistry,
} from "./viewerHelpers.js";

const VIEW_TYPE_CSVZALL = "csvzall-view";

interface CsvzallPluginSettings {
  csvzallPath: string;
  openInObsidian: boolean;
  startupTimeoutMs: number;
}

const DEFAULT_SETTINGS: CsvzallPluginSettings = {
  csvzallPath: "csvzall",
  openInObsidian: true,
  startupTimeoutMs: 10000,
};

interface CsvzallServerHandle {
  filePath: string;
  process: ChildProcessWithoutNullStreams;
  url: string;
  stopping: boolean;
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
  private unloading = false;

  async onload(): Promise<void> {
    await this.loadSettings();

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

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
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
  }

  onunload(): void {
    this.unloading = true;
    this.sessions.shutdownAll();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
      console.error("csvzall failed to open CSV", error);
    }
  }

  private async startViewer(filePath: string): Promise<CsvzallServerHandle> {
    const executable = stripOuterQuotes(this.settings.csvzallPath);
    const args = ["view", filePath, "--no-open", "--startup-json"];
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
  }
}

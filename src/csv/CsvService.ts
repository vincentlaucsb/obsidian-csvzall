import { Notice, Platform, TFile, TFolder, type App, type WorkspaceLeaf } from "obsidian";
import type { EventLog } from "../logging/EventLog.js";
import type { ObsidianFilesystem } from "../obsidian/filesystem.js";
import { CsvzallProcessService, ViewerStartupCancelledError } from "../process/CsvzallProcessService.js";
import type { CsvzallPluginSettings } from "../settings/settings.js";
import { CsvzallTableView } from "../views/CsvzallTableView.js";
import { isCsv, nextCsvPath } from "./csvFiles.js";
import type { ExportReflection } from "../exports/ExportReflection.js";
import type { CsvzallServerHandle } from "../types.js";
import { hasErrorCode } from "../utils/errors.js";

export class CsvService {
  constructor(
    private readonly app: App,
    private readonly getSettings: () => CsvzallPluginSettings,
    private readonly eventLog: EventLog,
    private readonly filesystem: ObsidianFilesystem,
    private readonly processService: CsvzallProcessService,
    private readonly reflection?: ExportReflection,
  ) {}

  isCsv(file: TFile): boolean {
    return isCsv(file);
  }

  async openCsv(file: TFile): Promise<void> {
    try {
      if (this.getSettings().openInObsidian || !Platform.isDesktopApp) {
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.openFile(file);
        this.app.workspace.setActiveLeaf(leaf, { focus: true });
      } else {
        await this.openCsvInBrowser(file);
      }
    } catch (error) {
      await this.reportOpenFailure(file, error);
    }
  }

  async openCsvInLeaf(file: TFile, leaf: WorkspaceLeaf): Promise<void> {
    if (!Platform.isDesktopApp) {
      await this.openCsvInWasmViewer(file, leaf);
      return;
    }

    const view = leaf.view;
    const path = file.path;
    const isCurrent = () => leaf.view === view && view instanceof CsvzallTableView &&
      view.file === file && file.path === path;
    if (!isCurrent()) return;
    let mayContinue = () => true;
    let launchingHelper = false;
    try {
      const fullPath = this.filesystem.getFullPath(file);
      if (!fullPath) throw new Error("csvzall can only open files from a local filesystem vault.");
      launchingHelper = true;
      const startup = this.processService.startViewer(fullPath, leaf);
      // startViewer takes ownership of a new generation for this leaf.
      if (this.reflection) mayContinue = this.processService.viewerContinuation(leaf);
      const server = await (path.toLowerCase().endsWith(".json") ? startup : this.waitForCharts(path, startup));
      launchingHelper = false;
      if (mayContinue() && isCurrent() && !server.process.stopped && leaf.view instanceof CsvzallTableView) {
        leaf.view.showViewer(file.basename, server.url);
        return;
      }
      server.process.stop();
    } catch (error) {
      if (error instanceof ViewerStartupCancelledError || !mayContinue() || !isCurrent()) return;
      const message = error instanceof Error ? error.message : String(error);
      if (launchingHelper && leaf.view instanceof CsvzallTableView && (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR"))) {
        leaf.view.showMissingCsvzall(message);
      } else {
        this.processService.showLeafErrorText(leaf, message);
      }
      await this.reportOpenFailure(file, error);
    }
  }

  async createCsvInFolder(folder: TFolder): Promise<void> {
    try {
      const path = nextCsvPath(folder.path, candidate => !!this.app.vault.getAbstractFileByPath(candidate));
      const file = await this.app.vault.create(path, "column\n");
      await this.openCsv(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`csvzall failed to create CSV: ${message}`);
      await this.eventLog.record("error", "Failed to create CSV", message);
      console.error("csvzall failed to create CSV", error);
    }
  }

  private async openCsvInBrowser(file: TFile): Promise<void> {
    const fullPath = this.filesystem.getFullPath(file);
    if (!fullPath) throw new Error("csvzall can only open files from a local filesystem vault.");
    const server = await this.waitForCharts(file.path, this.processService.startViewer(fullPath));
    if (!server.process.stopped) window.open(server.url, "_blank", "noopener");
  }

  private async waitForCharts(path: string, startup: Promise<CsvzallServerHandle>): Promise<CsvzallServerHandle> {
    if (!this.reflection) return startup;
    // Native startup indexes the CSV. Chart configuration is first read by a
    // viewer request, so wait for both before exposing the URL.
    const charts = this.reflection.prepareViewer(path).catch(async (error: unknown) => {
      const server = await startup.catch(() => null);
      server?.process.stop();
      throw new Error(`Could not prepare charts for ${path}: ${error instanceof Error ? error.message : String(error)}`);
    });
    const [server] = await Promise.all([startup, charts]);
    return server;
  }

  private async reportOpenFailure(file: TFile, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    new Notice(`csvzall failed to open CSV: ${message}`);
    await this.eventLog.record("error", `Failed to open CSV ${file.path}`, message);
    console.error("csvzall failed to open CSV", error);
  }

  private async openCsvInWasmViewer(file: TFile, leaf: WorkspaceLeaf): Promise<void> {
    const url = this.filesystem.getPluginResourcePath("wasm-viewer/index.html");
    if (!url) {
      this.processService.showLeafErrorText(leaf, "The bundled WASM viewer could not be resolved.");
      return;
    }

    if (leaf.view instanceof CsvzallTableView) {
      leaf.view.showWasmViewer(file.basename, url, file);
      return;
    }

    this.processService.showLeafErrorText(leaf, "The CSV view is not ready.");
  }
}

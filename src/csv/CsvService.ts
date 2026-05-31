import { Notice, Platform, TFile, TFolder, type App, type WorkspaceLeaf } from "obsidian";
import type { EventLog } from "../logging/EventLog.js";
import type { ObsidianFilesystem } from "../obsidian/filesystem.js";
import type { CsvzallProcessService } from "../process/CsvzallProcessService.js";
import type { CsvzallPluginSettings } from "../settings/settings.js";
import { normalizeVaultPath } from "../chartAutomation.js";
import { CsvzallTableView } from "../views/CsvzallTableView.js";
import { isCsv } from "./csvFiles.js";

function isMissingExecutableError(message: string): boolean {
  return /\bENOENT\b/i.test(message) || /not found/i.test(message);
}

export class CsvService {
  constructor(
    private readonly app: App,
    private readonly getSettings: () => CsvzallPluginSettings,
    private readonly eventLog: EventLog,
    private readonly filesystem: ObsidianFilesystem,
    private readonly processService: CsvzallProcessService,
  ) {}

  isCsv(file: TFile): boolean {
    return isCsv(file);
  }

  async openCsv(file: TFile): Promise<void> {
    if (this.getSettings().openInObsidian) {
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.openFile(file);
      this.app.workspace.revealLeaf(leaf);
      return;
    }

    await this.openCsvInBrowser(file);
  }

  async openCsvInLeaf(file: TFile, leaf: WorkspaceLeaf): Promise<void> {
    if (!Platform.isDesktopApp) {
      this.processService.showLeafErrorText(leaf, "csvzall requires the Obsidian desktop app.");
      return;
    }

    const fullPath = this.filesystem.getFullPath(file);
    if (!fullPath) {
      this.processService.showLeafErrorText(leaf, "csvzall can only open files from a local filesystem vault.");
      return;
    }

    try {
      const server = await this.processService.startViewer(fullPath);
      if (leaf.view instanceof CsvzallTableView) {
        leaf.view.showViewer(file.basename, server.url);
        this.processService.bindLeafToServer(leaf, server);
        return;
      }
      server.stopping = true;
      server.process.kill();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (leaf.view instanceof CsvzallTableView && isMissingExecutableError(message)) {
        leaf.view.showMissingCsvzall(message);
      } else {
        this.processService.showLeafErrorText(leaf, message);
      }
      new Notice(`csvzall failed to open CSV: ${message}`);
      await this.eventLog.record("error", `Failed to open CSV ${file.path}`, message);
      console.error("csvzall failed to open CSV", error);
    }
  }

  async createCsvInFolder(folder: TFolder): Promise<void> {
    try {
      const path = await this.nextCsvPathInFolder(folder);
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
    if (!Platform.isDesktopApp) {
      new Notice("csvzall requires the Obsidian desktop app.");
      return;
    }

    const fullPath = this.filesystem.getFullPath(file);
    if (!fullPath) {
      new Notice("csvzall can only open files from a local filesystem vault.");
      return;
    }

    try {
      const server = await this.processService.startViewer(fullPath);
      window.open(server.url, "_blank", "noopener");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`csvzall failed to open CSV: ${message}`);
      await this.eventLog.record("error", `Failed to open CSV ${file.path}`, message);
      console.error("csvzall failed to open CSV", error);
    }
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
}

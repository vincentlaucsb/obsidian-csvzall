import { Notice, Platform, Plugin, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import { isCsv } from "../src/csv/csvFiles.js";
import { CsvzallTableView } from "../src/views/CsvzallTableView.js";
import {
  embeddedWasmViewerUrl,
  ensureEmbeddedWasmViewerAssets,
} from "./WasmAssetInstaller.js";

const VIEW_TYPE_CSVZALL_MOBILE = "csvzall-mobile-view";
const DEFAULT_CSV_TEXT = "column\n";

function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//u, "").replace(/^\/+/u, "").replace(/\/+/gu, "/");
}

function parentPathForFile(file: TFile): string {
  const index = file.path.lastIndexOf("/");
  return index >= 0 ? file.path.slice(0, index) : "";
}

export default class CsvzallMobilePlugin extends Plugin {
  private assetError = "";

  async onload(): Promise<void> {
    if (!Platform.isMobileApp) {
      return;
    }

    try {
      await ensureEmbeddedWasmViewerAssets(this.app, this.manifest);
    } catch (error) {
      this.assetError = error instanceof Error ? error.message : String(error);
      console.error("csvzall mobile failed to install bundled WASM viewer assets", error);
    }

    this.registerView(
      VIEW_TYPE_CSVZALL_MOBILE,
      (leaf) => new CsvzallTableView(leaf, this, VIEW_TYPE_CSVZALL_MOBILE),
    );
    this.registerExtensions(["csv"], VIEW_TYPE_CSVZALL_MOBILE);
    this.addRibbonIcon("table", "New CSV", () => void this.createCsvInActiveFolder());
    this.registerCsvCommands();
    this.registerCsvFileMenu();
  }

  handleLeafClosed(_leaf: WorkspaceLeaf): void {
    // Mobile WASM sessions do not spawn external processes.
  }

  async openCsvInLeaf(file: TFile, leaf: WorkspaceLeaf): Promise<void> {
    if (!(leaf.view instanceof CsvzallTableView)) {
      return;
    }
    if (this.assetError) {
      leaf.view.showError(`The bundled WASM viewer could not be installed: ${this.assetError}`);
      return;
    }

    leaf.view.showWasmViewer(file.basename, embeddedWasmViewerUrl(this.app, this.manifest), file);
  }

  async installCsvzallFromView(_file: TFile, _leaf: WorkspaceLeaf): Promise<boolean> {
    new Notice("csvzall Mobile uses the bundled WASM viewer and does not install a desktop helper.");
    return false;
  }

  openCsvzallSettings(): void {
    new Notice("csvzall Mobile does not have desktop helper settings.");
  }

  private async openCsv(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  private async createCsvInFolder(folder: TFolder): Promise<void> {
    try {
      const path = await this.nextCsvPathInFolder(folder.path);
      const file = await this.app.vault.create(path, DEFAULT_CSV_TEXT);
      await this.openCsv(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`csvzall Mobile failed to create CSV: ${message}`);
      console.error("csvzall Mobile failed to create CSV", error);
    }
  }

  private async createCsvInActiveFolder(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    const folderPath = activeFile ? parentPathForFile(activeFile) : "";
    try {
      const path = await this.nextCsvPathInFolder(folderPath);
      const file = await this.app.vault.create(path, DEFAULT_CSV_TEXT);
      await this.openCsv(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`csvzall Mobile failed to create CSV: ${message}`);
      console.error("csvzall Mobile failed to create CSV", error);
    }
  }

  private async nextCsvPathInFolder(folderPath: string): Promise<string> {
    const normalizedFolderPath = normalizeVaultPath(folderPath);
    for (let index = 0; index < 10000; index += 1) {
      const name = index === 0 ? "Untitled.csv" : `Untitled ${index}.csv`;
      const path = normalizedFolderPath ? `${normalizedFolderPath}/${name}` : name;
      if (!this.app.vault.getAbstractFileByPath(path)) {
        return path;
      }
    }
    throw new Error("Could not find an available Untitled CSV filename.");
  }

  private registerCsvCommands(): void {
    this.addCommand({
      id: "new-csv",
      name: "New CSV",
      callback: () => {
        void this.createCsvInActiveFolder();
      },
    });

    this.addCommand({
      id: "open-active-csv",
      name: "Open active CSV",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !isCsv(file)) {
          return false;
        }
        if (!checking) {
          void this.openCsv(file);
        }
        return true;
      },
    });
  }

  private registerCsvFileMenu(): void {
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof TFolder) {
        menu.addItem((item) => {
          item
            .setTitle("New CSV")
            .setIcon("table")
            .onClick(() => void this.createCsvInFolder(file));
        });
        return;
      }

      if (!(file instanceof TFile) || !isCsv(file)) {
        return;
      }
      menu.addItem((item) => {
        item
          .setTitle("Open with csvzall Mobile")
          .setIcon("table")
          .onClick(() => void this.openCsv(file));
      });
    }));
  }
}

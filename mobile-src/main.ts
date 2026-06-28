import { Notice, Platform, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import { isCsv } from "../src/csv/csvFiles.js";
import { CsvzallTableView } from "../src/views/CsvzallTableView.js";
import {
  embeddedWasmViewerUrl,
  ensureEmbeddedWasmViewerAssets,
} from "./WasmAssetInstaller.js";

const VIEW_TYPE_CSVZALL_MOBILE = "csvzall-mobile-view";

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

  private registerCsvCommands(): void {
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

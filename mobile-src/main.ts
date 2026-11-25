import { Notice, Plugin, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import { registerJsonView } from "../src/views/JsonFileView.js";
import { CSV_EXTENSIONS, isCsv, nextCsvPath } from "../src/csv/csvFiles.js";
import { parentVaultPath } from "../src/utils/paths.js";
import { CsvzallTableView, updateViewerAutosave } from "../src/views/CsvzallTableView.js";
import { autosaveMode, type AutosaveMode } from "../src/settings/autosave.js";
import { isRecord } from "../src/utils/validateObject.js";
import { AutosaveSettingsTab } from "./AutosaveSettingsTab.js";
import { openPluginSettings } from "../src/obsidian/settingsModal.js";
import {
  embeddedWasmViewerUrl,
  releaseEmbeddedWasmViewer,
} from "./WasmViewerSession.js";

const VIEW_TYPE_CSVZALL_MOBILE = "csvzall-mobile-view";
const DEFAULT_CSV_TEXT = "column\n";

export default class CsvzallMobilePlugin extends Plugin {
  private assetError = "";
  settings: { autosaveMode: AutosaveMode } = { autosaveMode: "off" };
  private settingsWrite = Promise.resolve();

  async onload(): Promise<void> {
    await this.onExternalSettingsChange();
    this.addSettingTab(new AutosaveSettingsTab(this, mode => this.setAutosaveMode(mode)));
    try {
      embeddedWasmViewerUrl();
    } catch (error) {
      this.assetError = error instanceof Error ? error.message : String(error);
      console.error("csvzall Lite failed to install bundled WASM viewer assets", error);
    }

    this.registerView(
      VIEW_TYPE_CSVZALL_MOBILE,
      (leaf) => new CsvzallTableView(leaf, this, VIEW_TYPE_CSVZALL_MOBILE),
    );
    this.registerExtensions(CSV_EXTENSIONS, VIEW_TYPE_CSVZALL_MOBILE);
    registerJsonView(this);
    this.addRibbonIcon("table", "New CSV", () => void this.createCsvInActiveFolder());
    this.registerCsvCommands();
    this.registerCsvFileMenu();
  }

  async onExternalSettingsChange(): Promise<void> {
    try {
      const data: unknown = await this.loadData();
      this.applyAutosave(autosaveMode(isRecord(data) ? data.autosaveMode : undefined));
    } catch (error) {
      new Notice(`Could not read AutoSave settings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private applyAutosave(mode: AutosaveMode): void {
    if (this.settings.autosaveMode === mode) return;
    this.settings.autosaveMode = mode;
    updateViewerAutosave(this.app.workspace, VIEW_TYPE_CSVZALL_MOBILE);
  }

  private setAutosaveMode(mode: AutosaveMode): Promise<void> {
    this.settingsWrite = this.settingsWrite.then(async () => {
      const data: unknown = await this.loadData();
      await this.saveData({ ...(isRecord(data) ? data : {}), autosaveMode: mode });
      this.applyAutosave(mode);
    }).catch((error: unknown) => {
      new Notice(`Could not save AutoSave settings: ${error instanceof Error ? error.message : String(error)}`);
    });
    return this.settingsWrite;
  }

  handleLeafClosed(_leaf: WorkspaceLeaf): void {
    // Bundled WASM sessions do not spawn external processes on either platform.
  }

  onunload(): void {
    releaseEmbeddedWasmViewer();
  }

  async openCsvInLeaf(file: TFile, leaf: WorkspaceLeaf): Promise<void> {
    if (!(leaf.view instanceof CsvzallTableView)) {
      return;
    }
    if (this.assetError) {
      leaf.view.showError(`The bundled WASM viewer could not be installed: ${this.assetError}`);
      return;
    }

    leaf.view.showWasmViewer(file.basename, embeddedWasmViewerUrl(), file);
  }

  async installCsvzallFromView(_file: TFile, _leaf: WorkspaceLeaf): Promise<boolean> {
    new Notice("csvzall Lite uses the bundled WASM viewer and does not install a desktop helper.");
    return false;
  }

  openCsvzallSettings(): void {
    openPluginSettings(this.app, this.manifest.id);
  }

  private async openCsv(file: TFile): Promise<void> {
    try { await this.openCsvView(file); }
    catch (error) {
      new Notice(`csvzall Lite failed to open CSV: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async openCsvView(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: VIEW_TYPE_CSVZALL_MOBILE,
      state: { file: file.path },
      active: true,
    });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  private async createCsvInFolder(folder: TFolder): Promise<void> {
    try {
      const path = nextCsvPath(folder.path, candidate => !!this.app.vault.getAbstractFileByPath(candidate));
      const file = await this.app.vault.create(path, DEFAULT_CSV_TEXT);
      await this.openCsvView(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`csvzall Lite failed to create CSV: ${message}`);
      console.error("csvzall Lite failed to create CSV", error);
    }
  }

  private async createCsvInActiveFolder(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    const folderPath = activeFile ? parentVaultPath(activeFile.path) : "";
    try {
      const path = nextCsvPath(folderPath, candidate => !!this.app.vault.getAbstractFileByPath(candidate));
      const file = await this.app.vault.create(path, DEFAULT_CSV_TEXT);
      await this.openCsvView(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`csvzall Lite failed to create CSV: ${message}`);
      console.error("csvzall Lite failed to create CSV", error);
    }
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
          .setTitle("Open with csvzall Lite")
          .setIcon("table")
          .onClick(() => void this.openCsv(file));
      });
    }));
  }
}

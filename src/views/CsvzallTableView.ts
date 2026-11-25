import { FileView, Notice, Platform, setIcon, TFile, type OpenViewState, type ViewState, type WorkspaceLeaf } from "obsidian";
import { ViewerFrameSession } from "./ViewerFrameSession.js";
import { UnsavedChangesModal } from "./UnsavedChangesModal.js";
import { VIEW_TYPE_CSVZALL } from "./viewTypes.js";

export interface CsvzallTableViewOwner {
  handleLeafClosed(leaf: WorkspaceLeaf): void;
  openCsvInLeaf(file: TFile, leaf: WorkspaceLeaf): Promise<void>;
  installCsvzallFromView(file: TFile, leaf: WorkspaceLeaf): Promise<boolean>;
  openCsvzallSettings(): void;
  insertQueryIntoNote?(file: TFile, sql: string, cancelled: () => boolean, lifecycle?: AbortSignal): Promise<boolean>;
}

type ProtectedLeaf = WorkspaceLeaf & {
  detach: () => void | Promise<void>;
  openFile: (file: TFile, openState?: OpenViewState) => Promise<void>;
  setViewState: (viewState: ViewState, eState?: unknown) => Promise<void>;
};

export class CsvzallTableView extends FileView {
  private titleText = "csvzall";
  private url = "";
  private errorText = "";
  private missingCsvzallText = "";
  private loading = false;
  private dirty = false;
  private wasmFile: TFile | null = null;
  // Writes to the same file stay ordered when a render replaces its iframe.
  private saveQueue: Promise<void> = Promise.resolve();
  private desktopSourcePath = "";
  private renameWarning: HTMLElement | null = null;
  private renderGeneration = 0;
  private session: ViewerFrameSession | null = null;

  private originalDetach: ProtectedLeaf["detach"] | null = null;
  private patchedDetach: ProtectedLeaf["detach"] | null = null;
  private originalOpenFile: ProtectedLeaf["openFile"] | null = null;
  private patchedOpenFile: ProtectedLeaf["openFile"] | null = null;
  private originalSetViewState: ProtectedLeaf["setViewState"] | null = null;
  private patchedSetViewState: ProtectedLeaf["setViewState"] | null = null;
  private pendingDiscardConfirmation: Promise<boolean> | null = null;
  private allowingProtectedLeafAction = false;

  private get frame(): HTMLIFrameElement | null {
    return this.session?.frame ?? null;
  }

  constructor(
    leaf: WorkspaceLeaf,
    private readonly owner: CsvzallTableViewOwner,
    private readonly viewType = VIEW_TYPE_CSVZALL,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return this.viewType;
  }

  getDisplayText(): string {
    return this.file?.basename ?? this.titleText;
  }

  getIcon(): string {
    return this.file?.extension?.toLowerCase() === "json" ? "braces" : "table";
  }

  async onOpen(): Promise<void> {
    if (this.viewType === "csvzall-json") {
      this.registerEvent(this.app.vault.on("modify", file => {
        if (file === this.file) this.frame?.contentWindow?.postMessage({
          source: "obsidian-csvzall", type: "json-file-modified", version: 1,
        }, "*");
      }));
    }
    this.patchLeafNavigation();
    this.render();
  }

  async onClose(): Promise<void> {
    this.renderGeneration++;
    this.setDirty(false);
    this.session?.dispose();
    this.session = null;
    this.restoreLeafNavigation();
    this.owner.handleLeafClosed(this.leaf);
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.owner.handleLeafClosed(this.leaf);
    this.setDirty(false);
    this.titleText = file.basename;
    this.url = "";
    this.wasmFile = null;
    this.errorText = "";
    this.missingCsvzallText = "";
    this.loading = true;
    this.render();
    await this.openCurrentFile(file);
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    this.owner.handleLeafClosed(this.leaf);
    this.setDirty(false);
    this.url = "";
    this.wasmFile = null;
    this.errorText = "";
    this.missingCsvzallText = "";
    this.loading = false;
    this.render();
  }

  async onRename(file: TFile): Promise<void> {
    const viewerActive = Boolean(this.url || this.loading);
    this.titleText = file.basename;
    // The vault updates this file object's path; host saves already use that object.
    if (viewerActive && this.wasmFile === file) {
      this.frame?.setAttr("title", this.titleText);
      return;
    }
    if (viewerActive && this.dirty) {
      this.frame?.setAttr("title", this.titleText);
      if (!this.wasmFile && this.frame) {
        this.renameWarning?.remove();
        this.renameWarning = null;
        const renamed = Boolean(this.desktopSourcePath && file.path !== this.desktopSourcePath);
        this.frame.inert = renamed;
        if (renamed) {
          this.frame.blur();
          const warning = this.containerEl.createDiv({ cls: "csvzall-view-error" });
          this.renameWarning = warning;
          warning.createEl("p", { text: `This file moved while it had unsaved edits. Editing is paused to protect the save destination. Move it back to “${this.desktopSourcePath}”, save your edits, then move it again.` });
          warning.createEl("button", { text: "Discard edits and reopen" }).addEventListener("click", () => {
            void this.runProtectedLeafAction(() => this.onLoadFile(file))
              .catch((error: unknown) => new Notice(String(error)));
          });
          this.containerEl.prepend(warning);
        }
      }
      return;
    }
    if (viewerActive) {
      this.owner.handleLeafClosed(this.leaf);
      this.setDirty(false);
      this.url = "";
      this.errorText = "";
      this.missingCsvzallText = "";
      this.loading = true;
      this.render();
      await this.openCurrentFile(file);
      return;
    }
    this.render();
  }

  private async openCurrentFile(file: TFile): Promise<void> {
    const generation = this.renderGeneration;
    try { await this.owner.openCsvInLeaf(file, this.leaf); }
    catch (error) {
      if (generation === this.renderGeneration && file === this.file) {
        this.showError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  showViewer(title: string, url: string): void {
    this.desktopSourcePath = this.file?.path ?? "";
    this.setDirty(false);
    this.titleText = title;
    this.url = url;
    this.errorText = "";
    this.missingCsvzallText = "";
    this.wasmFile = null;
    this.loading = false;
    this.render();
  }

  showWasmViewer(title: string, url: string, file: TFile): void {
    this.setDirty(false);
    this.titleText = title;
    this.url = url;
    this.wasmFile = file;
    this.errorText = "";
    this.missingCsvzallText = "";
    this.loading = false;
    this.render();
  }

  showError(message: string): void {
    this.setDirty(false);
    this.errorText = message;
    this.missingCsvzallText = "";
    this.url = "";
    this.wasmFile = null;
    this.loading = false;
    this.render();
  }

  showMissingCsvzall(message: string): void {
    this.setDirty(false);
    this.errorText = "";
    this.missingCsvzallText = message;
    this.url = "";
    this.wasmFile = null;
    this.loading = false;
    this.render();
  }

  private render(): void {
    this.renderGeneration++;
    const { containerEl } = this;
    this.session?.dispose();
    this.session = null;
    containerEl.empty();
    this.renameWarning = null;
    containerEl.addClass("csvzall-view-container");

    if (this.missingCsvzallText) {
      this.renderMissingCsvzall();
      return;
    }

    if (this.errorText) {
      const state = containerEl.createDiv({ cls: "csvzall-view-state" });
      state.createEl("p", {
        text: this.errorText,
        cls: "csvzall-view-error",
      });
      return;
    }

    if (!this.url) return;

    this.renderMobileToolbar(containerEl);

    const frame = containerEl.createEl("iframe", {
      cls: "csvzall-view-frame",
      attr: {
        sandbox: "allow-scripts allow-same-origin allow-forms",
      },
    });
    frame.setAttr("title", this.titleText);
    const file = this.file;
    const wasmFile = this.wasmFile;
    const insertQuery = this.owner.insertQueryIntoNote?.bind(this.owner);
    this.session = new ViewerFrameSession(frame, {
      app: this.app,
      wasmFile,
      sourceIsCurrent: () => this.file === file && (!!wasmFile || file?.path === this.desktopSourcePath),
      isDirty: () => this.dirty,
      setDirty: dirty => this.setDirty(dirty),
      showError: message => this.showError(message),
      enqueueWrite: write => { this.saveQueue = this.saveQueue.then(write, write); },
      insertQuery: file && file.extension?.toLowerCase() !== "json" && !wasmFile && Platform.isDesktopApp && insertQuery
        ? (sql, cancelled, signal) => insertQuery(file, sql, cancelled, signal)
        : undefined,
    });
    this.session.open(containerEl, this.url);
  }

  private renderMobileToolbar(containerEl: HTMLElement): void {
    if (!Platform.isMobileApp) {
      return;
    }

    const toolbar = containerEl.createDiv({ cls: "csvzall-mobile-toolbar" });
    const navigationButton = toolbar.createEl("button", {
      cls: "csvzall-mobile-toolbar-button",
      attr: {
        "aria-label": "Open navigation",
        type: "button",
      },
    });
    setIcon(navigationButton, "panel-left");
    navigationButton.addEventListener("click", () => {
      this.openNavigationPane();
    });

    toolbar.createDiv({
      cls: "csvzall-mobile-toolbar-title",
      text: this.titleText,
    });
  }

  private openNavigationPane(): void {
    const workspace = this.app.workspace as typeof this.app.workspace & {
      leftSplit?: {
        expand?: () => void;
        toggle?: () => void;
      };
    };
    if (typeof workspace.leftSplit?.expand === "function") {
      workspace.leftSplit.expand();
      return;
    }
    if (typeof workspace.leftSplit?.toggle === "function") {
      workspace.leftSplit.toggle();
      return;
    }

    const app = this.app as typeof this.app & {
      commands?: {
        executeCommandById?: (id: string) => boolean;
      };
    };
    app.commands?.executeCommandById?.("app:toggle-left-sidebar");
  }

  private patchLeafNavigation(): void {
    if (this.patchedDetach) {
      return;
    }

    const leaf = this.leaf as ProtectedLeaf;
    /* eslint-disable @typescript-eslint/unbound-method -- Preserve identity for restoration; calls below explicitly use .call(leaf). */
    const originalDetach = leaf.detach;
    const originalOpenFile = leaf.openFile;
    const originalSetViewState = leaf.setViewState;
    /* eslint-enable @typescript-eslint/unbound-method -- Resume checks after capturing methods whose receivers are supplied explicitly. */
    const patchedDetach = (): void => {
      void this.runProtectedLeafAction(() => originalDetach.call(leaf))
        .catch((error: unknown) => new Notice(String(error)));
    };
    const patchedOpenFile = async (file: TFile, openState?: OpenViewState): Promise<void> => {
      await this.runProtectedLeafAction(() => originalOpenFile.call(leaf, file, openState));
    };
    const patchedSetViewState = async (viewState: ViewState, eState?: unknown): Promise<void> => {
      await this.runProtectedLeafAction(() => originalSetViewState.call(leaf, viewState, eState));
    };

    this.originalDetach = originalDetach;
    this.patchedDetach = patchedDetach;
    this.originalOpenFile = originalOpenFile;
    this.patchedOpenFile = patchedOpenFile;
    this.originalSetViewState = originalSetViewState;
    this.patchedSetViewState = patchedSetViewState;
    leaf.detach = patchedDetach;
    leaf.openFile = patchedOpenFile;
    leaf.setViewState = patchedSetViewState;
  }

  private restoreLeafNavigation(): void {
    if (
      !this.originalDetach ||
      !this.patchedDetach ||
      !this.originalOpenFile ||
      !this.patchedOpenFile ||
      !this.originalSetViewState ||
      !this.patchedSetViewState
    ) {
      return;
    }

    const leaf = this.leaf as ProtectedLeaf;
    if (leaf.detach === this.patchedDetach) {
      leaf.detach = this.originalDetach;
    }
    if (leaf.openFile === this.patchedOpenFile) {
      leaf.openFile = this.originalOpenFile;
    }
    if (leaf.setViewState === this.patchedSetViewState) {
      leaf.setViewState = this.originalSetViewState;
    }
    this.originalDetach = null;
    this.patchedDetach = null;
    this.originalOpenFile = null;
    this.patchedOpenFile = null;
    this.originalSetViewState = null;
    this.patchedSetViewState = null;
    this.pendingDiscardConfirmation = null;
  }

  private async runProtectedLeafAction(action: () => void | Promise<void>): Promise<void> {
    if (this.allowingProtectedLeafAction || !this.dirty) {
      await action();
      return;
    }

    const generation = this.renderGeneration;
    const file = this.file;
    const discard = await this.confirmDiscardChanges();
    if (!discard || this.allowingProtectedLeafAction || generation !== this.renderGeneration || file !== this.file) {
      return;
    }

    const wasDirty = this.dirty;
    this.setDirty(false);
    this.allowingProtectedLeafAction = true;
    try {
      await action();
    } catch (error) {
      if (generation === this.renderGeneration && file === this.file) this.setDirty(wasDirty);
      throw error;
    } finally {
      this.allowingProtectedLeafAction = false;
    }
  }

  private async confirmDiscardChanges(): Promise<boolean> {
    if (!this.pendingDiscardConfirmation) {
      this.pendingDiscardConfirmation = new UnsavedChangesModal(this.app, () => this.saveBeforeLeaving())
        .confirmDiscard()
        .finally(() => {
          this.pendingDiscardConfirmation = null;
        });
    }
    return await this.pendingDiscardConfirmation;
  }

  private async saveBeforeLeaving(): Promise<void> {
    if (!this.session) throw new Error("The file viewer is unavailable. Your edits have not been discarded.");
    await this.session.requestSave();
  }

  private setDirty(dirty: boolean): void {
    this.dirty = dirty;
  }


  private renderMissingCsvzall(): void {
    const state = this.containerEl.createDiv({ cls: "csvzall-view-state" });
    const panel = state.createDiv({ cls: "csvzall-view-recovery" });
    panel.createEl("h3", { text: "csvzall was not found" });
    panel.createEl("p", {
      text: "The configured executable is missing. Use the helper included with this plugin, or choose a different executable path in settings.",
    });

    const actions = panel.createDiv({ cls: "csvzall-view-recovery-actions" });
    const installButton = actions.createEl("button", {
      text: "Use bundled helper",
      cls: "mod-cta",
    });
    installButton.addEventListener("click", () => {
      const file = this.file;
      if (!file) {
        return;
      }
      const message = this.missingCsvzallText;
      const path = file.path;
      this.errorText = "";
      this.missingCsvzallText = "";
      this.loading = true;
      this.render();
      const generation = this.renderGeneration;
      const current = () => generation === this.renderGeneration && this.file === file && file.path === path;
      void this.owner.installCsvzallFromView(file, this.leaf).then(async installed => {
        if (!current()) return;
        if (!installed) {
          this.showMissingCsvzall(message);
        } else {
          await this.openCurrentFile(file);
        }
      }).catch((error: unknown) => {
        if (current()) this.showMissingCsvzall(error instanceof Error ? error.message : String(error));
      });
    });

    const settingsButton = actions.createEl("button", {
      text: "Open settings",
    });
    settingsButton.addEventListener("click", () => {
      this.owner.openCsvzallSettings();
    });

    panel.createEl("pre", {
      text: this.missingCsvzallText,
      cls: "csvzall-view-recovery-detail",
    });
  }
}

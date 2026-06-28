import { FileView, Platform, setIcon, TFile, type OpenViewState, type ViewState, type WorkspaceLeaf } from "obsidian";
import { csvzallDirtyStateFromMessageEvent } from "../viewerHelpers.js";
import { UnsavedChangesModal } from "./UnsavedChangesModal.js";
import { VIEW_TYPE_CSVZALL } from "./viewTypes.js";

export interface CsvzallTableViewOwner {
  handleLeafClosed(leaf: WorkspaceLeaf): void;
  openCsvInLeaf(file: TFile, leaf: WorkspaceLeaf): Promise<void>;
  installCsvzallFromView(file: TFile, leaf: WorkspaceLeaf): Promise<boolean>;
  openCsvzallSettings(): void;
}

type WasmViewerMessage =
  | { source: "csvzall-wasm-viewer"; type: "ready" }
  | { source: "csvzall-wasm-viewer"; type: "dirty-state"; dirty: boolean }
  | {
    source: "csvzall-wasm-viewer";
    type: "save-file";
    buffer: ArrayBuffer;
    byteOffset?: number;
    byteLength?: number;
  };

type ProtectedLeaf = WorkspaceLeaf & {
  detach: () => void | Promise<void>;
  openFile: (file: TFile, openState?: OpenViewState) => Promise<void>;
  setViewState: (viewState: ViewState, eState?: unknown) => Promise<void>;
};

function wasmViewerMessageFromData(data: unknown): WasmViewerMessage | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const candidate = data as Record<string, unknown>;
  if (candidate.source !== "csvzall-wasm-viewer") {
    return null;
  }

  if (candidate.type === "ready") {
    return {
      source: "csvzall-wasm-viewer",
      type: "ready",
    };
  }

  if (candidate.type === "dirty-state" && typeof candidate.dirty === "boolean") {
    return {
      source: "csvzall-wasm-viewer",
      type: "dirty-state",
      dirty: candidate.dirty,
    };
  }

  if (candidate.type === "save-file" && candidate.buffer instanceof ArrayBuffer) {
    const byteOffset = typeof candidate.byteOffset === "number" ? candidate.byteOffset : undefined;
    const byteLength = typeof candidate.byteLength === "number" ? candidate.byteLength : undefined;
    return {
      source: "csvzall-wasm-viewer",
      type: "save-file",
      buffer: candidate.buffer,
      byteOffset,
      byteLength,
    };
  }

  return null;
}

export class CsvzallTableView extends FileView {
  private titleText = "csvzall";
  private url = "";
  private errorText = "";
  private missingCsvzallText = "";
  private loading = false;
  private dirty = false;
  private wasmFile: TFile | null = null;
  private wasmOpenPosted = false;
  private frame: HTMLIFrameElement | null = null;
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private mobileViewportCleanup: (() => void) | null = null;
  private originalDetach: ProtectedLeaf["detach"] | null = null;
  private patchedDetach: ProtectedLeaf["detach"] | null = null;
  private originalOpenFile: ProtectedLeaf["openFile"] | null = null;
  private patchedOpenFile: ProtectedLeaf["openFile"] | null = null;
  private originalSetViewState: ProtectedLeaf["setViewState"] | null = null;
  private patchedSetViewState: ProtectedLeaf["setViewState"] | null = null;
  private pendingDiscardConfirmation: Promise<boolean> | null = null;
  private allowingProtectedLeafAction = false;

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
    return "table";
  }

  async onOpen(): Promise<void> {
    this.patchLeafNavigation();
    this.render();
  }

  async onClose(): Promise<void> {
    this.setDirty(false);
    this.removeMobileViewportHandler();
    this.removeMessageListener();
    this.restoreLeafNavigation();
    this.owner.handleLeafClosed(this.leaf);
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.owner.handleLeafClosed(this.leaf);
    this.setDirty(false);
    this.titleText = file.basename;
    this.url = "";
    this.wasmFile = null;
    this.wasmOpenPosted = false;
    this.errorText = "";
    this.missingCsvzallText = "";
    this.loading = true;
    this.render();
    await this.owner.openCsvInLeaf(file, this.leaf);
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    this.owner.handleLeafClosed(this.leaf);
    this.setDirty(false);
    this.url = "";
    this.wasmFile = null;
    this.wasmOpenPosted = false;
    this.errorText = "";
    this.missingCsvzallText = "";
    this.loading = false;
    this.render();
  }

  async onRename(file: TFile): Promise<void> {
    const viewerActive = Boolean(this.url || this.loading);
    this.titleText = file.basename;
    if (viewerActive && this.dirty) {
      this.frame?.setAttr("title", this.titleText);
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
      await this.owner.openCsvInLeaf(file, this.leaf);
      return;
    }
    this.render();
  }

  showViewer(title: string, url: string): void {
    this.setDirty(false);
    this.titleText = title;
    this.url = url;
    this.errorText = "";
    this.missingCsvzallText = "";
    this.wasmFile = null;
    this.wasmOpenPosted = false;
    this.loading = false;
    this.render();
  }

  showWasmViewer(title: string, url: string, file: TFile): void {
    this.setDirty(false);
    this.titleText = title;
    this.url = url;
    this.wasmFile = file;
    this.wasmOpenPosted = false;
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
    this.wasmOpenPosted = false;
    this.loading = false;
    this.render();
  }

  showMissingCsvzall(message: string): void {
    this.setDirty(false);
    this.errorText = "";
    this.missingCsvzallText = message;
    this.url = "";
    this.wasmFile = null;
    this.wasmOpenPosted = false;
    this.loading = false;
    this.render();
  }

  private render(): void {
    const { containerEl } = this;
    this.removeMobileViewportHandler();
    this.removeMessageListener();
    containerEl.empty();
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

    if (!this.url) {
      const state = containerEl.createDiv({ cls: "csvzall-view-state" });
      state.createEl("p", {
        text: this.loading ? "Starting csvzall viewer..." : "No csvzall viewer URL is active.",
      });
      return;
    }

    this.renderMobileToolbar(containerEl);

    const frame = containerEl.createEl("iframe", {
      cls: "csvzall-view-frame",
      attr: {
        sandbox: "allow-scripts allow-same-origin allow-forms",
      },
    });
    frame.setAttr("title", this.titleText);
    this.listenForDirtyState(frame);
    this.installMobileViewportHandler(containerEl, frame);
    frame.setAttr("src", this.url);
  }

  private installMobileViewportHandler(containerEl: HTMLElement, frame: HTMLIFrameElement): void {
    if (!Platform.isMobileApp) {
      return;
    }

    const viewport = window.visualViewport;
    let animationFrame = 0;
    const update = (): void => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        const rect = containerEl.getBoundingClientRect();
        const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
        const visibleHeight = Math.max(240, Math.floor(viewportBottom - rect.top));
        frame.contentWindow?.postMessage({
          source: "obsidian-csvzall",
          type: "viewport-resized",
          height: visibleHeight,
        }, "*");
        try {
          frame.contentWindow?.dispatchEvent(new Event("resize"));
        } catch {
          // Cross-origin resource URLs can reject direct event dispatch; postMessage still reaches the viewer.
        }
      });
    };

    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    update();
    this.mobileViewportCleanup = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }

  private removeMobileViewportHandler(): void {
    this.mobileViewportCleanup?.();
    this.mobileViewportCleanup = null;
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
    const originalDetach = leaf.detach;
    const originalOpenFile = leaf.openFile;
    const originalSetViewState = leaf.setViewState;
    const patchedDetach = (): void => {
      void this.runProtectedLeafAction(() => originalDetach.call(leaf));
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

    const discard = await this.confirmDiscardChanges();
    if (!discard || this.allowingProtectedLeafAction) {
      return;
    }

    this.setDirty(false);
    this.allowingProtectedLeafAction = true;
    try {
      await action();
    } finally {
      this.allowingProtectedLeafAction = false;
    }
  }

  private async confirmDiscardChanges(): Promise<boolean> {
    if (!this.pendingDiscardConfirmation) {
      this.pendingDiscardConfirmation = new UnsavedChangesModal(this.app)
        .confirmDiscard()
        .finally(() => {
          this.pendingDiscardConfirmation = null;
        });
    }
    return await this.pendingDiscardConfirmation;
  }

  private listenForDirtyState(frame: HTMLIFrameElement): void {
    this.frame = frame;
    this.messageHandler = (event) => {
      if (event.source !== this.frame?.contentWindow) {
        return;
      }
      if (this.handleWasmViewerMessage(event)) {
        return;
      }
      const dirty = csvzallDirtyStateFromMessageEvent(event, this.frame?.contentWindow ?? null);
      if (dirty === null) {
        return;
      }
      this.setDirty(dirty);
    };
    window.addEventListener("message", this.messageHandler);
  }

  private removeMessageListener(): void {
    if (this.messageHandler) {
      window.removeEventListener("message", this.messageHandler);
      this.messageHandler = null;
    }
    this.frame = null;
  }

  private setDirty(dirty: boolean): void {
    this.dirty = dirty;
  }

  private async postWasmFileToFrame(frame: HTMLIFrameElement): Promise<void> {
    if (this.wasmOpenPosted || !this.wasmFile || frame !== this.frame || !frame.contentWindow) {
      return;
    }

    this.wasmOpenPosted = true;
    try {
      const buffer = await this.app.vault.readBinary(this.wasmFile);
      frame.contentWindow.postMessage({
        source: "obsidian-csvzall",
        type: "open-file",
        name: this.wasmFile.name,
        buffer,
      }, "*", [buffer]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.showError(`Failed to load CSV for the WASM viewer: ${message}`);
    }
  }

  private handleWasmViewerMessage(event: MessageEvent): boolean {
    const data = wasmViewerMessageFromData(event.data);
    if (!data) {
      return false;
    }

    if (data.type === "ready") {
      if (this.frame) {
        void this.postWasmFileToFrame(this.frame);
      }
      return true;
    }

    if (data.type === "dirty-state") {
      this.setDirty(data.dirty);
      return true;
    }

    if (data.type === "save-file") {
      void this.saveWasmViewerFile(data);
      return true;
    }

    return false;
  }

  private async saveWasmViewerFile(data: {
    buffer?: ArrayBuffer;
    byteOffset?: number;
    byteLength?: number;
  }): Promise<void> {
    if (!this.wasmFile || !(data.buffer instanceof ArrayBuffer)) {
      return;
    }

    const byteOffset = typeof data.byteOffset === "number" ? data.byteOffset : 0;
    const byteLength = typeof data.byteLength === "number" ? data.byteLength : data.buffer.byteLength - byteOffset;
    const bytes = new Uint8Array(data.buffer, byteOffset, byteLength);
    const output = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ?
      bytes.buffer :
      bytes.slice().buffer;
    try {
      await this.app.vault.modifyBinary(this.wasmFile, output);
      this.setDirty(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.showError(`Failed to save CSV from the WASM viewer: ${message}`);
    }
  }

  private renderMissingCsvzall(): void {
    const state = this.containerEl.createDiv({ cls: "csvzall-view-state" });
    const panel = state.createDiv({ cls: "csvzall-view-recovery" });
    panel.createEl("h3", { text: "csvzall was not found" });
    panel.createEl("p", {
      text: "The configured executable is missing. Install a managed copy, or choose a different executable path in settings.",
    });

    const actions = panel.createDiv({ cls: "csvzall-view-recovery-actions" });
    const installButton = actions.createEl("button", {
      text: "Install csvzall",
      cls: "mod-cta",
    });
    installButton.addEventListener("click", () => {
      const file = this.file;
      if (!file) {
        return;
      }
      const message = this.missingCsvzallText;
      this.errorText = "";
      this.missingCsvzallText = "";
      this.loading = true;
      this.render();
      void this.owner.installCsvzallFromView(file, this.leaf).then((installed) => {
        if (!installed) {
          this.showMissingCsvzall(message);
        }
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

import { FileView, TFile, type WorkspaceLeaf } from "obsidian";
import { csvzallDirtyStateFromMessageEvent } from "../viewerHelpers.js";
import { UnsavedChangesModal } from "./UnsavedChangesModal.js";
import { VIEW_TYPE_CSVZALL } from "./viewTypes.js";

export interface CsvzallTableViewOwner {
  handleLeafClosed(leaf: WorkspaceLeaf): void;
  openCsvInLeaf(file: TFile, leaf: WorkspaceLeaf): Promise<void>;
  installCsvzallFromView(file: TFile, leaf: WorkspaceLeaf): Promise<boolean>;
  openCsvzallSettings(): void;
}

type DetachableLeaf = WorkspaceLeaf & {
  detach: () => Promise<void>;
};

export class CsvzallTableView extends FileView {
  private titleText = "csvzall";
  private url = "";
  private errorText = "";
  private missingCsvzallText = "";
  private loading = false;
  private dirty = false;
  private frame: HTMLIFrameElement | null = null;
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private originalDetach: (() => Promise<void>) | null = null;
  private patchedDetach: (() => Promise<void>) | null = null;
  private pendingDetachConfirmation: Promise<boolean> | null = null;
  private detachingAfterConfirmation = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly owner: CsvzallTableViewOwner,
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
    this.patchLeafDetach();
    this.render();
  }

  async onClose(): Promise<void> {
    this.setDirty(false);
    this.removeMessageListener();
    this.restoreLeafDetach();
    this.owner.handleLeafClosed(this.leaf);
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.owner.handleLeafClosed(this.leaf);
    this.setDirty(false);
    this.titleText = file.basename;
    this.url = "";
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
    this.errorText = "";
    this.missingCsvzallText = "";
    this.loading = false;
    this.render();
  }

  async onRename(file: TFile): Promise<void> {
    const shouldRestartViewer = Boolean(this.url || this.loading);
    this.titleText = file.basename;

    if (shouldRestartViewer && this.dirty) {
      this.frame?.setAttr("title", this.titleText);
      return;
    }

    if (shouldRestartViewer) {
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
    this.loading = false;
    this.render();
  }

  showError(message: string): void {
    this.setDirty(false);
    this.errorText = message;
    this.missingCsvzallText = "";
    this.url = "";
    this.loading = false;
    this.render();
  }

  showMissingCsvzall(message: string): void {
    this.setDirty(false);
    this.errorText = "";
    this.missingCsvzallText = message;
    this.url = "";
    this.loading = false;
    this.render();
  }

  private render(): void {
    const { containerEl } = this;
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

    const frame = containerEl.createEl("iframe", {
      cls: "csvzall-view-frame",
      attr: {
        src: this.url,
        sandbox: "allow-scripts allow-same-origin allow-forms",
      },
    });
    frame.setAttr("title", this.titleText);
    this.listenForDirtyState(frame);
  }

  private patchLeafDetach(): void {
    if (this.patchedDetach) {
      return;
    }

    const leaf = this.leaf as DetachableLeaf;
    const originalDetach = leaf.detach;
    const patchedDetach = async (): Promise<void> => {
      if (this.detachingAfterConfirmation) {
        await originalDetach.call(leaf);
        return;
      }

      if (!this.dirty) {
        await originalDetach.call(leaf);
        return;
      }

      const discard = await this.confirmDiscardChanges();
      if (!discard || this.detachingAfterConfirmation) {
        return;
      }

      this.setDirty(false);
      this.detachingAfterConfirmation = true;
      try {
        await originalDetach.call(leaf);
      } finally {
        this.detachingAfterConfirmation = false;
      }
    };

    this.originalDetach = originalDetach;
    this.patchedDetach = patchedDetach;
    leaf.detach = patchedDetach;
  }

  private restoreLeafDetach(): void {
    if (!this.originalDetach || !this.patchedDetach) {
      return;
    }

    const leaf = this.leaf as DetachableLeaf;
    if (leaf.detach === this.patchedDetach) {
      leaf.detach = this.originalDetach;
    }
    this.originalDetach = null;
    this.patchedDetach = null;
    this.pendingDetachConfirmation = null;
  }

  private async confirmDiscardChanges(): Promise<boolean> {
    if (!this.pendingDetachConfirmation) {
      this.pendingDetachConfirmation = new UnsavedChangesModal(this.app)
        .confirmDiscard()
        .finally(() => {
          this.pendingDetachConfirmation = null;
        });
    }
    return await this.pendingDetachConfirmation;
  }

  private listenForDirtyState(frame: HTMLIFrameElement): void {
    this.frame = frame;
    this.messageHandler = (event) => {
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

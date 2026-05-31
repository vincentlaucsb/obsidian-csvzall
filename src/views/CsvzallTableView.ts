import { FileView, TFile, type WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_CSVZALL } from "./viewTypes.js";

export interface CsvzallTableViewOwner {
  handleLeafClosed(leaf: WorkspaceLeaf): void;
  openCsvInLeaf(file: TFile, leaf: WorkspaceLeaf): Promise<void>;
  installCsvzallFromView(file: TFile, leaf: WorkspaceLeaf): Promise<boolean>;
  openCsvzallSettings(): void;
}

export class CsvzallTableView extends FileView {
  private titleText = "csvzall";
  private url = "";
  private errorText = "";
  private missingCsvzallText = "";
  private loading = false;

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
    this.missingCsvzallText = "";
    this.loading = true;
    this.render();
    await this.owner.openCsvInLeaf(file, this.leaf);
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    this.owner.handleLeafClosed(this.leaf);
    this.url = "";
    this.errorText = "";
    this.missingCsvzallText = "";
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
    this.missingCsvzallText = "";
    this.loading = false;
    this.render();
  }

  showError(message: string): void {
    this.errorText = message;
    this.missingCsvzallText = "";
    this.url = "";
    this.loading = false;
    this.render();
  }

  showMissingCsvzall(message: string): void {
    this.errorText = "";
    this.missingCsvzallText = message;
    this.url = "";
    this.loading = false;
    this.render();
  }

  private render(): void {
    const { containerEl } = this;
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

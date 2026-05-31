import { FileView, TFile, type WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_CSVZALL } from "./viewTypes.js";

export interface CsvzallTableViewOwner {
  handleLeafClosed(leaf: WorkspaceLeaf): void;
  openCsvInLeaf(file: TFile, leaf: WorkspaceLeaf): Promise<void>;
}

export class CsvzallTableView extends FileView {
  private titleText = "csvzall";
  private url = "";
  private errorText = "";
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

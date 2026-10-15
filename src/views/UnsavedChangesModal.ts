import { App, Modal, Notice } from "obsidian";

export class UnsavedChangesModal extends Modal {
  private resolveResult: ((discard: boolean) => void) | null = null;
  private closed = false;

  constructor(app: App, private readonly save: () => Promise<void>) {
    super(app);
  }

  confirmDiscard(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolveResult = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    this.closed = false;
    contentEl.empty();
    this.titleEl.setText("Unsaved changes");
    contentEl.createEl("p", { text: "This CSV has unsaved changes." });

    const actions = contentEl.createDiv({ cls: "modal-button-container" });
    const saveButton = actions.createEl("button", { text: "Save", cls: "mod-cta", attr: { autofocus: "" } });
    const discardButton = actions.createEl("button", {
      text: "Discard changes",
      cls: "mod-warning",
    });
    discardButton.addEventListener("click", () => {
      this.finish(true);
    });

    const cancelButton = actions.createEl("button", {
      text: "Cancel",
    });
    cancelButton.addEventListener("click", () => {
      this.finish(false);
    });
    saveButton.addEventListener("click", () => {
      saveButton.disabled = true;
      discardButton.disabled = true;
      void this.save().then(() => {
        if (!this.closed) this.finish(true);
      }).catch((error: unknown) => {
        if (!this.closed) new Notice(error instanceof Error ? error.message : String(error));
      }).finally(() => {
        if (!this.closed) {
          saveButton.disabled = false;
          discardButton.disabled = false;
          saveButton.focus();
        }
      });
    });
    saveButton.focus();
  }

  onClose(): void {
    this.closed = true;
    this.contentEl.empty();
    this.resolve(false);
  }

  private finish(discard: boolean): void {
    this.resolve(discard);
    this.close();
  }

  private resolve(discard: boolean): void {
    const resolve = this.resolveResult;
    this.resolveResult = null;
    resolve?.(discard);
  }
}

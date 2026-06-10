import { App, Modal } from "obsidian";

export class UnsavedChangesModal extends Modal {
  private resolveResult: ((discard: boolean) => void) | null = null;

  constructor(app: App) {
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
    contentEl.empty();
    contentEl.createEl("p", { text: "This CSV has unsaved changes." });

    const actions = contentEl.createDiv({ cls: "modal-button-container" });
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
  }

  onClose(): void {
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

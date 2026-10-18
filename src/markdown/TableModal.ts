import { Modal, Notice, Setting, type App } from 'obsidian';
import { mountTableForm, type TableFormOptions } from './table-form.mjs';

/** The Markdown note that contains a saved export's managed region. */
export interface ExportNoteLink {
  path?: string;
  exists: boolean;
  open(): Promise<void>;
}

export class TableModal extends Modal {
  private form: ReturnType<typeof mountTableForm> | null = null;

  constructor(app: App, private readonly options: TableFormOptions, private readonly note?: ExportNoteLink) { super(app); }

  onOpen(): void {
    this.titleEl.setText(this.options.submitLabel ?? 'Insert from CSV');
    this.modalEl.addClass('csvzall-table-modal');
    if (this.note) this.renderNote(this.note);
    this.form = mountTableForm(this.contentEl, {
      ...this.options,
      submit: async (value, signal) => { await this.options.submit?.(value, signal); if (!signal.aborted) this.close(); },
    });
    const cancel = this.contentEl.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
  }

  private renderNote(note: ExportNoteLink): void {
    const desc = !note.path ? 'Not linked to a note' : note.exists ? note.path : `${note.path} (not found)`;
    new Setting(this.contentEl).setName('Note').setDesc(desc).addButton(button => button
      .setButtonText('Go to note')
      .setDisabled(!note.path || !note.exists)
      .onClick(() => {
        this.close();
        void note.open().catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error)));
      }));
  }

  onClose(): void { this.form?.dispose(); this.form = null; this.contentEl.empty(); }
}

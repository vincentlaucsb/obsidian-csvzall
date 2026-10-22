import { FuzzySuggestModal, Modal, Notice, Setting, type App, type TFile } from 'obsidian';
import { mountTableForm, type TableFormOptions } from './table-form.mjs';

/** The Markdown note that contains a saved export's managed region. */
export interface ExportNoteLink {
  path?: string;
  exists: boolean;
  open(): Promise<void>;
}

class NotePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private readonly choose: (file: TFile) => void) { super(app); this.setPlaceholder('Find a note in this vault'); }
  getItems(): TFile[] { return this.app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path)); }
  getItemText(file: TFile): string { return file.path; }
  onChooseItem(file: TFile): void { this.choose(file); }
}

export class TableModal extends Modal {
  private form: ReturnType<typeof mountTableForm> | null = null;

  constructor(app: App, private readonly options: TableFormOptions, private readonly note?: ExportNoteLink,
    private readonly destination?: { initial?: TFile; closed(): void }) { super(app); }

  onOpen(): void {
    this.titleEl.setText(this.options.submitLabel ?? 'Insert from CSV');
    this.modalEl.addClass('csvzall-table-modal');
    if (this.note) this.renderNote(this.note);
    let selected = this.destination?.initial;
    if (this.destination) {
      const setting = new Setting(this.contentEl).setName('Note').setDesc(selected?.path ?? 'Choose a note in this vault');
      setting.addButton(button => button.setButtonText('Choose note').onClick(() => new NotePicker(this.app, file => {
        selected = file; setting.setDesc(file.path);
      }).open()));
    }
    this.form = mountTableForm(this.contentEl, {
      ...this.options,
      submit: async (value, signal) => {
        if (this.destination && !selected) throw new Error('Choose a destination note.');
        await this.options.submit?.(this.destination ? { ...value, destination: selected!.path } : value, signal);
        if (!signal.aborted) this.close();
      },
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

  onClose(): void { this.form?.dispose(); this.form = null; this.contentEl.empty(); this.destination?.closed(); }
}

import { Modal, type App } from 'obsidian';
import { mountTableForm, type TableFormOptions } from './table-form.mjs';

export class TableModal extends Modal {
  private form: ReturnType<typeof mountTableForm> | null = null;

  constructor(app: App, private readonly options: TableFormOptions) { super(app); }

  onOpen(): void {
    this.titleEl.setText(this.options.submitLabel ?? 'Insert from CSV');
    this.modalEl.addClass('csvzall-table-modal');
    this.form = mountTableForm(this.contentEl, {
      ...this.options,
      submit: async (value, signal) => { await this.options.submit?.(value, signal); if (!signal.aborted) this.close(); },
    });
    const cancel = this.contentEl.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
  }

  onClose(): void { this.form?.dispose(); this.form = null; this.contentEl.empty(); }
}

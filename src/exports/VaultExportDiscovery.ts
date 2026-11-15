import { TFile, TFolder, type App, type TAbstractFile } from 'obsidian';

/** Walk the loaded tree a few entries at a time; registration never awaits discovery. */
export class VaultExportDiscovery {
  private readonly pending: Array<Iterator<TAbstractFile>> = [];
  private started = false;
  private readonly folders = new Set<string>();
  private readonly notes = new Set<TFile>();

  constructor(private readonly app: App) {}

  restart(): void { if (this.complete) this.started = false; }

  step(limit = 16): void {
    if (!this.started) {
      this.started = true;
      this.folders.add('');
      this.pending.push(this.app.vault.getRoot().children.values());
    }
    for (let count = 0; count < limit && this.pending.length; count++) {
      const iterator = this.pending[this.pending.length - 1]!;
      const next = iterator.next();
      if (next.done) { this.pending.pop(); continue; }
      this.observe(next.value);
      if (next.value instanceof TFolder) this.pending.push(next.value.children.values());
    }
  }

  observe(file: TAbstractFile): void {
    if (file instanceof TFolder) this.folders.add(file.path === '/' ? '' : file.path);
    if (file instanceof TFile && file.extension === 'md') this.notes.add(file);
  }

  takeFolders(): string[] { const result = [...this.folders]; this.folders.clear(); return result; }
  takeNotes(): TFile[] { const result = [...this.notes]; this.notes.clear(); return result; }
  get complete(): boolean { return this.started && this.pending.length === 0; }
}

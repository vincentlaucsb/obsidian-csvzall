import { MarkdownView, type App, type Editor, type TFile } from 'obsidian';
import { findManagedTables, replaceManagedTable, type ManagedTable } from './managedTables.js';

/** Owns authoritative note content, parse caching and guarded editor/vault writes. */
export class MarkdownNoteStore {
  private noteTables = new WeakMap<TFile, { path: string; mtime: number; size: number; tables: ManagedTable[] }>();
  private notesRevision = 0;

  constructor(private readonly app: App, private readonly signal: AbortSignal) {}

  get revision(): number { return this.notesRevision; }

  invalidateAll(): void { this.noteTables = new WeakMap(); ++this.notesRevision; }

  editorFor(file: TFile): Editor | null {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      if (leaf.view instanceof MarkdownView && leaf.view.file === file && leaf.view.getMode() === 'source') return leaf.view.editor;
    }
    return null;
  }

  async textFor(file: TFile): Promise<string> {
    return this.editorFor(file)?.getValue() ?? await this.app.vault.read(file);
  }

  invalidateNote(file: TFile): void {
    if (file.extension !== 'md') return;
    this.noteTables.delete(file); ++this.notesRevision;
  }

  async tablesFor(file: TFile): Promise<ManagedTable[]> {
    // Open editors are authoritative, even before their buffer reaches disk.
    const editor = this.editorFor(file);
    if (editor) return findManagedTables(editor.getValue());
    const cached = this.noteTables.get(file), { path } = file;
    const mtime = file.stat?.mtime, size = file.stat?.size, revision = this.notesRevision;
    if (cached && cached.path === path && cached.mtime === mtime && cached.size === size) return cached.tables;
    const tables = findManagedTables(await this.app.vault.read(file));
    // An event during the read invalidates its snapshot, including same-size
    // edits with coarse filesystem timestamps. Failed parses are never cached.
    if (mtime !== undefined && size !== undefined && revision === this.notesRevision &&
      file.path === path && file.stat.mtime === mtime && file.stat.size === size && !this.editorFor(file)) {
      this.noteTables.set(file, { path, mtime, size, tables });
    }
    return tables;
  }

  async replace(file: TFile, table: ManagedTable, text: string, guardSnapshot = false): Promise<void> {
    if (this.signal.aborted || table.text === text) return;
    if (this.app.vault.getAbstractFileByPath(file.path) !== file) return;
    this.invalidateNote(file);
    const editor = this.editorFor(file);
    if (editor) {
      const current = editor.getValue();
      const next = replaceManagedTable(current, table, text, guardSnapshot);
      const block = findManagedTables(current).find(candidate => candidate.id === table.id)!;
      if (next !== current) editor.replaceRange(text, editor.offsetToPos(block.from), editor.offsetToPos(block.to));
    } else {
      await this.app.vault.process(file, current => this.signal.aborted ? current : replaceManagedTable(current, table, text, guardSnapshot));
    }
  }

  async commitToNote(note: TFile, text: string, assertCurrent: () => void): Promise<void> {
    const append = (current: string) => `${current}${current && !current.endsWith('\n\n') ? current.endsWith('\n') ? '\n' : '\n\n' : ''}${text}\n`;
    const editor = this.editorFor(note);
    if (editor) {
      const current = editor.getValue();
      assertCurrent();
      editor.replaceRange(append(current).slice(current.length), editor.offsetToPos(current.length));
    } else await this.app.vault.process(note, current => {
      assertCurrent();
      return append(current);
    });
    this.invalidateNote(note);
  }

  currentTable(editor: Editor): ManagedTable | undefined {
    const offset = editor.posToOffset(editor.getCursor());
    try { return findManagedTables(editor.getValue()).find(table => offset >= table.from && offset <= table.to); }
    catch { return undefined; }
  }
}

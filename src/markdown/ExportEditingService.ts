import { MarkdownView, Notice, TFile, type App } from 'obsidian';
import { isCanonicalVaultPath } from '../utils/paths.js';
import { exportMarkerLine, findManagedTables, managedTableText, replaceManagedTable, tableBody, validateSource, type ManagedTable, type TableRecipe } from './managedTables.js';
import type { TableValue } from './table-form.mjs';
import type { ExportDefinitions, SavedExport } from './ExportDefinitions.js';
import { TableModal } from './TableModal.js';
import { isCsv } from '../csv/csvFiles.js';
import { fencedTableText } from './fencedTables.js';
import { exportDefinitionId } from './fencedExports.js';
import { exportRegionText } from './exportContent.js';
import type { MarkdownNoteStore } from './MarkdownNoteStore.js';
import type { ExportRenderer } from './ExportRenderer.js';
import type { ExportMaintenanceService } from './ExportMaintenanceService.js';
import type { ExportRefreshService } from './ExportRefreshService.js';
import type { ExportReporter } from './exportReporting.js';

export interface ExportPreferences {
  syntax(): 'comment' | 'code';
  saveSyntax(syntax: 'comment' | 'code'): Promise<void>;
}

/** Owns user-driven export editing, insertion, conversion and note navigation. */
export class ExportEditingService {
  constructor(private readonly app: App, private readonly notes: MarkdownNoteStore, private readonly renderer: ExportRenderer,
    private readonly definitions: ExportDefinitions, private readonly maintenance: ExportMaintenanceService,
    private readonly refresh: ExportRefreshService, private readonly report: ExportReporter,
    private readonly signal: AbortSignal, private readonly preferences?: ExportPreferences) {}

  async openSource(file: TFile, table: ManagedTable): Promise<void> {
    const recipe = table.recipe ?? (await this.maintenance.resolveTable(file.path, table)).recipe;
    await this.app.workspace.openLinkText(recipe.source, '', true);
  }

  open(view: MarkdownView | null, source?: TFile, existing?: ManagedTable): void {
    void this.openModal(view, source, existing).catch(error => this.report(view?.file ?? null, error));
  }

  insertQueryIntoNote(source: TFile, sql: string, cancelled: () => boolean, lifecycle?: AbortSignal): Promise<boolean> {
    return new Promise(resolve => {
      let inserted = false;
      const active = this.app.workspace.getActiveFile();
      const modal = new TableModal(this.app, {
        value: { source: source.path, sql, syntax: this.preferences?.syntax() ?? 'comment', autoUpdate: true },
        showSource: false, showFormat: false, showSyntax: true, submitLabel: 'Insert into note',
        preview: value => this.renderer.render(value, 20),
        submit: async (value, signal) => {
          if (inserted) return;
          const aborted = () => this.signal.aborted || cancelled() || signal.aborted;
          await this.insertQueryExport(source, value, aborted, () => { inserted = true; });
        },
      }, undefined, { initial: active?.extension === 'md' ? active : undefined, closed: () => {
        lifecycle?.removeEventListener('abort', close); resolve(inserted);
      } });
      const close = () => modal.close();
      if (lifecycle?.aborted || cancelled()) { resolve(false); return; }
      lifecycle?.addEventListener('abort', close, { once: true });
      modal.open();
    });
  }

  private async insertQueryExport(source: TFile, value: TableValue, aborted: () => boolean, onInserted: () => void): Promise<void> {
    const note = this.app.vault.getAbstractFileByPath(value.destination);
    if (!(note instanceof TFile) || note.extension !== 'md') throw new Error('Choose an existing Markdown note.');
    const sourcePath = source.path, notePath = note.path, { mtime, size } = source.stat;
    const assertCurrent = () => {
      if (aborted()) throw new Error('Export insertion cancelled.');
      if (source.path !== sourcePath || source.stat.mtime !== mtime || source.stat.size !== size ||
        this.app.vault.getAbstractFileByPath(sourcePath) !== source || note.path !== notePath ||
        this.app.vault.getAbstractFileByPath(notePath) !== note) throw new Error('The CSV or destination changed. Run the query and try inserting again.');
    };
    assertCurrent();
    await this.maintenance.withWrite(async () => {
      const markdown = await this.renderer.render({ ...value, source: sourcePath });
      assertCurrent();

      const initial: TableRecipe = { version: 1, id: crypto.randomUUID(), source: sourcePath, sql: value.sql, columns: value.columns, format: 'table' };
      const recipe = value.syntax === 'code' ? await this.maintenance.saveFence(notePath, initial, value.autoUpdate, aborted) : await this.definitions.save(notePath, initial, aborted, value.autoUpdate);
      assertCurrent();

      const text = value.syntax === 'code' ? fencedTableText(notePath, recipe, markdown) : managedTableText(recipe, markdown);
      await this.notes.commitToNote(note, text, assertCurrent);
      // Record the completed write before follow-up work, so a retry cannot append twice.
      onInserted();
      await this.preferences?.saveSyntax(value.syntax ?? 'comment');
      await this.refresh.index(note);
      if (!aborted()) await this.app.workspace.getLeaf('tab').openFile(note, { active: true });
    });
  }

  private async openModal(view: MarkdownView | null, source?: TFile, existing?: ManagedTable): Promise<void> {
    const file = view?.file;
    if (!source && (!view || !file)) return;
    if (!existing && view && this.notes.currentTable(view.editor)) { new Notice('Place the cursor outside the existing CSV export to insert another export.'); return; }
    const sources = this.app.vault.getFiles().filter(candidate => isCsv(candidate)).map(candidate => candidate.path).sort();
    if (existing?.fence && file) {
      replaceManagedTable(await this.notes.textFor(file), existing, existing.text, true);
      await this.maintenance.prepare(file);
      replaceManagedTable(await this.notes.textFor(file), existing, existing.text, true);
    }
    const saved = existing && !existing.recipe ? await this.maintenance.resolveTable(file!.path, existing) : undefined;
    const initial = existing?.recipe ?? saved?.recipe;
    if (this.signal.aborted) return;
    new TableModal(this.app, {
      sources,
      value: { source: initial?.source ?? source?.path ?? '', columns: initial?.columns ?? [], sql: initial?.sql ?? '', format: initial?.format ?? 'table', autoUpdate: saved?.runOnSave ?? true, syntax: existing ? existing.fence ? 'code' : 'comment' : this.preferences?.syntax() ?? 'comment',
        destination: source ? `${source.parent?.path && source.parent.path !== '/' ? `${source.parent.path}/` : ''}${source.basename}.md` : '' },
      showDestination: !!source,
      showFormat: true,
      showSyntax: true,
      submitLabel: existing ? 'Update export' : source ? 'Export to note' : 'Insert from CSV',
      loadColumns: path => this.renderer.loadColumns(path),
      preview: value => this.renderer.render(value, 20),
      submit: async (value, signal) => {
        await this.maintenance.withWrite(async () => {
          const markdown = await this.renderer.render(value);
          if (this.signal.aborted || signal.aborted) throw new Error('Export insertion cancelled.');
          let recipe: TableRecipe = { version: 1, id: initial?.id ?? crypto.randomUUID(), source: validateSource(value.source), columns: value.columns, sql: value.sql, format: value.format ?? 'table' };
          const path = source ? value.destination.replace(/\\/g, '/') : file!.path;
          if (source && (!path.endsWith('.md') || !isCanonicalVaultPath(path))) throw new Error('Enter a new Markdown note path inside an existing vault folder.');
          if (view && file && (view.file !== file || view.getMode() !== 'source')) throw new Error('Return to the original note in editing mode to insert this table.');
          if (existing && file) replaceManagedTable(await this.notes.textFor(file), existing, existing.text, true);
          const changedRecipe = initial && (initial.source !== recipe.source || initial.sql !== recipe.sql ||
            JSON.stringify(initial.columns) !== JSON.stringify(recipe.columns) || initial.format !== recipe.format);
          if (value.syntax === 'code' && recipe.format !== 'value') recipe = await this.maintenance.saveFence(path, recipe, value.autoUpdate, () => signal.aborted, saved);
          else if (existing?.fence) recipe = await this.definitions.save(path, { ...recipe, id: crypto.randomUUID() }, () => signal.aborted, value.autoUpdate, false, saved);
          else if (saved && !(saved.output && saved.output !== path && changedRecipe)) await this.definitions.update(saved, recipe, value.autoUpdate, () => signal.aborted);
          else recipe = await this.definitions.save(path, recipe, () => signal.aborted, value.autoUpdate);
          if (this.signal.aborted || signal.aborted) throw new Error('Export insertion cancelled.');
          const text = value.syntax === 'code' && recipe.format !== 'value' ? fencedTableText(path, recipe, markdown) : managedTableText(recipe, markdown);
          if (source) {
            const note = await this.app.vault.create(path, `${text}\n`);
            await this.refresh.index(note);
            if (!signal.aborted && !this.signal.aborted) await this.app.workspace.getLeaf(true).openFile(note);
          } else if (view && file) {
            if (view.file !== file || view.getMode() !== 'source') throw new Error('Return to the original note in editing mode to insert this table.');
            if (existing) await this.notes.replace(file, existing, exportRegionText(existing, recipe, markdown, path, value.syntax), true);
            else {
              const cursor = view.editor.getCursor();
              view.editor.replaceRange(recipe.format === 'value' ? text : `\n\n${text}\n\n`, cursor);
            }
            await this.refresh.index(file);
          }
          await this.preferences?.saveSyntax(value.syntax ?? 'comment');
        });
      },
    }).open();
  }

  async detach(file: TFile, table: ManagedTable): Promise<void> {
    const body = tableBody(table);
    await this.notes.replace(file, table, body, true);
    await this.refresh.index(file);
  }

  configureExport(saved: SavedExport, onSaved: () => void): void {
    void this.openConfiguredExport(saved, onSaved).catch(error => this.report(null, error, false));
  }

  private async openConfiguredExport(saved: SavedExport, onSaved: () => void): Promise<void> {
    const linked = await this.findExportRegion(saved);
    const note = linked?.note ?? this.exportNote(saved), table = linked?.table;
    if (this.signal.aborted) return;
    new TableModal(this.app, {
      value: { source: saved.recipe.source, columns: saved.recipe.columns, sql: saved.recipe.sql,
        format: saved.recipe.format, autoUpdate: saved.runOnSave, syntax: table?.fence ? 'code' : 'comment' },
      showSource: false, showFormat: true, showSyntax: !!table, submitLabel: 'Update export',
      loadColumns: source => this.renderer.loadColumns(source),
      preview: value => this.renderer.render(value, 20),
      submit: async (value, signal) => {
        await this.maintenance.withWrite(async () => {
          if (/^sql-[a-f0-9]{64}$/.test(saved.recipe.id) && !table) throw new Error('No note currently contains this SQL query. Insert the query into a note to edit it.');
          const markdown = await this.renderer.render(value);
          let recipe: TableRecipe = { ...saved.recipe, columns: value.columns, sql: value.sql, format: value.format ?? 'table' };
          if (table && note) replaceManagedTable(await this.notes.textFor(note), table, table.text, true);
          if (table && note && value.syntax === 'code' && recipe.format !== 'value') recipe = await this.maintenance.saveFence(note.path, recipe, value.autoUpdate, () => signal.aborted, saved);
          else if (table?.fence && note) recipe = await this.definitions.save(note.path, { ...recipe, id: crypto.randomUUID() }, () => signal.aborted, value.autoUpdate, false, saved);
          else await this.definitions.update(saved, recipe, value.autoUpdate, () => signal.aborted);
          if (table && note) await this.notes.replace(note, table, exportRegionText(table, recipe, markdown, note.path, value.syntax), true);
          await this.refresh.initialize();
          onSaved();
        });
      },
    }, { path: note?.path ?? saved.output, exists: note !== null, open: () => this.openExportNote(saved) }).open();
  }

  private async findExportRegion(saved: SavedExport): Promise<{ note: TFile; table: ManagedTable } | undefined> {
    const original = this.exportNote(saved);
    // Shared queries can outlive the first note recorded in output. This search
    // runs only for an explicit settings/open action, never viewer startup.
    const files = /^sql-[a-f0-9]{64}$/.test(saved.recipe.id) ? this.app.vault.getMarkdownFiles() : [];
    for (const note of new Set([...(original ? [original] : []), ...files])) {
      for (const table of await this.notes.tablesFor(note)) {
        if (exportDefinitionId(note.path, table) !== saved.recipe.id) continue;
        const bound = await this.definitions.find(note.path, saved.recipe.id);
        if (bound?.configPath === saved.configPath) return { note, table };
      }
    }
    return undefined;
  }

  private exportNote(saved: SavedExport): TFile | null {
    const file = saved.output ? this.app.vault.getAbstractFileByPath(saved.output) : null;
    return file instanceof TFile ? file : null;
  }

  async openExportNote(saved: SavedExport): Promise<void> {
    const file = (await this.findExportRegion(saved))?.note ?? this.exportNote(saved);
    if (!file) throw new Error(saved.output ? `Note not found: ${saved.output}` : 'This export is not linked to a note.');
    const text = await this.notes.textFor(file);
    const block = findManagedTables(text).find(table => exportDefinitionId(file.path, table) === saved.recipe.id);
    const line = block ? text.slice(0, block.from).split('\n').length - 1 : exportMarkerLine(text, saved.recipe.id);
    const eState = line === undefined ? undefined : { line };
    const existing = this.app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view instanceof MarkdownView && leaf.view.file === file);
    if (!existing) { await this.app.workspace.getLeaf('tab').openFile(file, { active: true, eState }); return; }
    await this.app.workspace.revealLeaf(existing);
    this.app.workspace.setActiveLeaf(existing, { focus: true });
    if (eState) existing.setEphemeralState(eState);
  }
}

import { MarkdownView, Notice, TFile, TFolder, type App, type Editor, type Plugin } from 'obsidian';
import type { EventLog } from '../logging/EventLog.js';
import type { ObsidianFilesystem } from '../obsidian/filesystem.js';
import type { CsvzallProcessService } from '../process/CsvzallProcessService.js';
import { csvHeader, exportMarkerLine, findManagedTables, managedTableText, replaceManagedTable, scalarMarkdown, shortenManagedTable, tableBody, validateSource, type ManagedTable, type TableRecipe } from './managedTables.js';
import { tableQuery, type TableValue } from './table-form.mjs';
import { ExportDefinitions, type ResolvedExport, type SavedExport } from './ExportDefinitions.js';
import { TableModal } from './TableModal.js';
import { isCsv } from '../csv/csvFiles.js';
import type { ExportReflection } from '../exports/ExportReflection.js';
import { SessionErrors } from '../logging/SessionErrors.js';
import { syncStatus } from '../obsidian/syncStatus.js';
import type { ExportReference, ReferenceScan } from '../exports/localFolders.js';

export class MarkdownTableService {
  private stopped = false;
  private pendingWrites = 0;
  private pruneRevision = 0;
  private pruning: Promise<void> = Promise.resolve();
  private readonly definitions: ExportDefinitions;
  private readonly exportListeners = new Set<() => void>();
  private poll: number | null = null;
  private indexing = false;
  private timer: number | null = null;
  private running = false;
  private readonly queued = new Set<TFile>();
  private readonly bindings = new Map<TFile, ResolvedExport[]>();
  private readonly sources = new Map<TFile, string[]>();
  private readonly signatures = new Map<TFile, string>();
  private readonly revisions = new Map<string, number>();
  private readonly errors = new SessionErrors();
  private readonly indexRevisions = new Map<TFile, number>();
  private readonly deletingSources = new Set<string>();

  constructor(private readonly app: App, private readonly filesystem: ObsidianFilesystem,
    private readonly processService: CsvzallProcessService, private readonly eventLog: EventLog,
    private readonly reflection?: ExportReflection) {
    this.definitions = new ExportDefinitions(app.vault.adapter, () => this.stopped,
      (path, reason) => this.reflection?.edited(path, reason) ?? Promise.resolve(), this.reflection?.usesDirectFolders);
  }

  async migrationReferences(): Promise<ReferenceScan> {
    const references: ExportReference[] = [];
    let complete = true;
    for (const file of this.app.vault.getMarkdownFiles()) {
      try {
      for (const table of findManagedTables(await this.textFor(file))) {
        if (!table.recipe) references.push({ note: file.path, id: table.id, legacy: table.marker === 'table' });
      }
      } catch (error) { complete = false; await this.report(file, error); }
    }
    return { references, complete };
  }

  register(plugin: Plugin): void {
    plugin.register(() => this.unload());
    plugin.registerEvent(this.app.vault.on('modify', file => {
      if (!(file instanceof TFile)) return;
      if (isCsv(file)) { this.sourceChanged(file.path); void this.initialize(); }
      if (file.extension === 'md') { ++this.pruneRevision; void this.index(file).then(changed => changed ? this.pruneDeadExports() : undefined).catch(error => this.report(file, error)); }
    }));
    plugin.registerEvent(this.app.vault.on('create', file => {
      ++this.pruneRevision;
      if (file instanceof TFile && file.extension === 'md') void this.index(file).catch(error => this.report(file, error));
      if (file instanceof TFile && isCsv(file)) this.sourceChanged(file.path);
    }));
    plugin.registerEvent(this.app.vault.on('delete', file => {
      if (file instanceof TFile) { this.sources.delete(file); this.bindings.delete(file); this.signatures.delete(file); this.queued.delete(file); this.indexRevisions.delete(file); }
      this.sourceChanged(file.path);
      ++this.pruneRevision;
      void this.pruneDeadExports().catch(error => this.report(null, error));
    }));
    plugin.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      ++this.pendingWrites; ++this.pruneRevision;
      const rename = async () => {
        // Rebase the ordinary files through the existing SQL workflow, then reflect
        // the explicit vault move before any missing old scope can be restored.
        await this.reflection?.renamed(oldPath, file.path);
        await this.renameSource(oldPath, file.path);
      };
      void rename().catch(error => this.report(null, error)).finally(() => { --this.pendingWrites; });
    }));
    plugin.registerEvent(this.app.workspace.on('editor-change', (_editor, view) => {
      if (!(view instanceof MarkdownView) || !view.file) return;
      ++this.pruneRevision;
      void this.index(view.file).then(changed => changed ? this.pruneDeadExports() : undefined).catch(error => this.report(view.file, error));
    }));
    this.app.workspace.onLayoutReady(() => {
      void this.initialize().catch(error => this.report(null, error));
      this.poll = window.setInterval(() => { void this.initialize().catch(error => this.report(null, error)); }, 10_000);
    });
  }

  unload(): void {
    this.stopped = true;
    if (this.poll !== null) window.clearInterval(this.poll);
    this.poll = null;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null; this.queued.clear();
  }

  private async initialize(): Promise<void> {
    if (this.indexing || this.stopped) return;
    this.indexing = true;
    let failed = false;
    try {
      await this.reflection?.reconcile();
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (this.stopped) return;
        try { await this.index(file); } catch (error) { failed = true; await this.report(file, error); }
      }
    } finally { this.indexing = false; }
    if (!failed) await this.pruneDeadExports().catch(error => this.report(null, error));
  }

  async refreshAfterSync(): Promise<void> {
    try { await this.initialize(); } catch (error) { await this.report(null, error); }
  }

  private async prepare(file: TFile): Promise<ManagedTable[]> {
    ++this.pendingWrites;
    try {
      for (const table of findManagedTables(await this.textFor(file))) {
        if (!table.recipe && table.marker !== 'table') continue;
        const legacy = table.recipe ? undefined : await this.resolveDefinition(file.path, table.id, true);
        // Rebind in the note's current scope so a nearer, unrelated export ID
        // cannot shadow the migrated table once its marker becomes canonical.
        const recipe = await this.definitions.save(file.path, table.recipe ?? legacy!.recipe, undefined, legacy?.runOnSave ?? true);
        // Persist the definition first. A failed or concurrent note edit keeps its inline recipe.
        await this.replace(file, table, shortenManagedTable(table, recipe.id));
      }
      return findManagedTables(await this.textFor(file));
    } finally { --this.pendingWrites; }
  }

  private editorFor(file: TFile): Editor | null {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      if (leaf.view instanceof MarkdownView && leaf.view.file === file && leaf.view.getMode() === 'source') return leaf.view.editor;
    }
    return null;
  }

  private async textFor(file: TFile): Promise<string> {
    return this.editorFor(file)?.getValue() ?? await this.app.vault.read(file);
  }

  private async index(file: TFile): Promise<boolean> {
    const revision = (this.indexRevisions.get(file) ?? 0) + 1;
    this.indexRevisions.set(file, revision);
    const tables = await this.prepare(file);
    if (this.reflection) for (const table of tables) {
      if (!table.recipe) await this.reflection.recoverSql(file.path, table.id);
    }
    const results = await Promise.allSettled(tables.map(table => this.resolveDefinition(file.path, table.id)));
    const resolved = [];
    for (const result of results) {
      if (result.status === 'fulfilled') resolved.push(result.value);
      else await this.report(file, result.reason);
    }
    if (this.stopped || this.indexRevisions.get(file) !== revision || this.app.vault.getAbstractFileByPath(file.path) !== file) return false;
    this.bindings.set(file, resolved);
    this.sources.set(file, resolved.filter(table => table.runOnSave).map(table => table.recipe.source));
    const signature = JSON.stringify(resolved);
    const changed = this.signatures.get(file) !== signature;
    this.signatures.set(file, signature);
    if (changed && resolved.some(table => table.runOnSave)) this.schedule(file);
    return changed;
  }

  private resolveDefinition(note: string, id: string, legacy = false): Promise<ResolvedExport> {
    const result = this.definitions.resolve(note, id, legacy);
    if (!this.reflection) return result;
    return result.then(resolved => {
      this.reflection?.assertSqlBinding(note, resolved.recipe.id, resolved.configPath);
      this.reflection?.assertReady(resolved.configPath);
      return resolved;
    });
  }

  private sourceChanged(path: string): void {
    this.revisions.set(path, (this.revisions.get(path) ?? 0) + 1);
    for (const [file, paths] of this.sources) if (paths.some(source => source === path || source.startsWith(`${path}/`))) this.schedule(file);
  }

  private schedule(file: TFile): void {
    if (this.stopped) return;
    this.queued.add(file);
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = null; void this.drain(); }, 500);
  }

  private async drain(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (!this.stopped && this.queued.size) {
        const [file] = this.queued;
        if (!(file instanceof TFile)) break;
        this.queued.delete(file);
        try { await this.refresh(file, undefined, true); } catch (error) { await this.report(file, error); }
      }
    } finally { this.running = false; }
  }

  private async report(file: TFile | null, error: unknown, automatic = true): Promise<void> {
    if (this.stopped) return;
    const message = error instanceof Error ? error.message : String(error);
    const key = file?.path ?? 'tables';
    const first = this.errors.first(key, message);
    if (automatic && !first) return;
    new Notice(`Could not update CSV export${file ? ` in ${file.path}` : ''}: ${message}`);
    await this.eventLog.record('error', 'Could not update CSV export', `${key}: ${message}`);
  }

  private sourceFile(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(validateSource(path));
    if (!(file instanceof TFile)) throw new Error(`CSV source not found: ${path}. The previous table has been kept.`);
    return file;
  }

  async render(value: Pick<TableValue, 'source' | 'columns' | 'sql' | 'format'>, limit?: number, validate?: () => void): Promise<string> {
    if (this.stopped) throw new Error('Plugin unloaded.');
    const source = this.sourceFile(value.source);
    const root = this.filesystem.getVaultRoot();
    if (!root) throw new Error('Export generation requires a local desktop vault.');
    const markdown = await this.processService.captureCommand([
      'sql', 'query', '--csv', source.path, '--format', value.format === 'value' ? 'csv' : 'markdown', '--sql', tableQuery(value, value.format === 'value' ? 2 : limit),
    ], root, validate);
    return value.format === 'value' ? scalarMarkdown(markdown) : markdown.replace(/\r\n?/g, '\n');
  }

  async refresh(file: TFile, onlyId?: string, automatic = false): Promise<void> {
    await this.reflection?.reconcile();
    const tables = await this.prepare(file);
    for (const table of tables) {
      if (onlyId && table.id !== onlyId) continue;
      try {
        const path = file.path;
        const snapshot = await this.definitions.snapshot(path);
        const definition = await this.resolveDefinition(file.path, table.id);
        if (automatic && !definition.runOnSave) continue;
        const recipe = definition.recipe;
        if (this.deletingSources.has(recipe.source)) continue;
        const revision = this.revisions.get(recipe.source);
        const validate = () => {
          this.reflection?.assertReady(definition.configPath);
          this.reflection?.assertSqlBinding(file.path, recipe.id, definition.configPath);
        };
        const markdown = await this.render(recipe, undefined, validate);
        if (this.stopped) return;
        if (this.deletingSources.has(recipe.source)) continue;
        if (path !== file.path || snapshot !== await this.definitions.snapshot(file.path) || revision !== this.revisions.get(recipe.source)) { this.schedule(file); continue; }
        validate();
        await this.replace(file, table, this.regionText(table, recipe, markdown));
      } catch (error) { await this.report(file, error, automatic); }
    }
  }

  private regionText(table: ManagedTable, recipe: TableRecipe, markdown: string, autoUpdate = true): string {
    const text = autoUpdate ? managedTableText(recipe, markdown) : recipe.format === 'value' ? markdown : markdown.trimEnd();
    // Converting an inline value to a table needs paragraph boundaries.
    return recipe.format !== 'value' && !/^<!-- csvzall:(?:table|export) \S+ -->\r?\n/.test(table.text) ? `\n\n${text}\n\n` : text;
  }

  private async replace(file: TFile, table: ManagedTable, text: string): Promise<void> {
    if (this.stopped || table.text === text) return;
    if (this.app.vault.getAbstractFileByPath(file.path) !== file) return;
    const editor = this.editorFor(file);
    if (editor) {
      const current = editor.getValue();
      const next = replaceManagedTable(current, table, text);
      const block = findManagedTables(current).find(candidate => candidate.id === table.id)!;
      if (next !== current) editor.replaceRange(text, editor.offsetToPos(block.from), editor.offsetToPos(block.to));
    } else {
      await this.app.vault.process(file, current => this.stopped ? current : replaceManagedTable(current, table, text));
    }
  }

  private async renameSource(oldPath: string, path: string): Promise<void> {
    this.sourceChanged(oldPath);
    const files = this.app.vault.getMarkdownFiles();
    // Carry bindings when notes move outside the scope of their old config.
    for (const file of files) {
      if (file.path !== path && !file.path.startsWith(`${path}/`)) continue;
      const previousPath = oldPath + file.path.slice(path.length);
      for (const table of findManagedTables(await this.textFor(file))) {
        if (table.recipe) continue;
        try {
          const previous = this.bindings.get(file)?.find(binding => binding.recipe.id === table.id) ?? await this.resolveDefinition(previousPath, table.id);
          const source = previous.recipe.source;
          const recipe = { ...previous.recipe, source: source === oldPath || source.startsWith(`${oldPath}/`) ? path + source.slice(oldPath.length) : source };
          // If its configuration moved too, rename() below adjusts its paths.
          if (previous.configPath.startsWith(`${oldPath}/`)) continue;
          const saved = await this.definitions.save(file.path, recipe, undefined, previous.runOnSave);
          await this.replace(file, table, shortenManagedTable(table, saved.id));
        } catch (error) { await this.report(file, error); }
      }
    }
    for (const file of files) {
      try { await this.prepare(file); } catch (error) { await this.report(file, error); }
    }
    if (!this.reflection) await this.definitions.rename(files.map(file => file.path), oldPath, path);
    for (const file of files) {
      try { await this.index(file); } catch (error) { await this.report(file, error); }
    }
  }

  async openSource(file: TFile, table: ManagedTable): Promise<void> {
    const recipe = table.recipe ?? (await this.resolveDefinition(file.path, table.id, table.marker === 'table')).recipe;
    await this.app.workspace.openLinkText(recipe.source, '', true);
  }

  currentTable(editor: Editor): ManagedTable | undefined {
    const offset = editor.posToOffset(editor.getCursor());
    try { return findManagedTables(editor.getValue()).find(table => offset >= table.from && offset <= table.to); }
    catch { return undefined; }
  }

  open(view: MarkdownView | null, source?: TFile, existing?: ManagedTable): void {
    void this.openModal(view, source, existing).catch(error => this.report(view?.file ?? null, error));
  }

  private async openModal(view: MarkdownView | null, source?: TFile, existing?: ManagedTable): Promise<void> {
    const file = view?.file;
    if (!source && (!view || !file)) return;
    if (!existing && view && this.currentTable(view.editor)) { new Notice('Place the cursor outside the existing CSV export to insert another export.'); return; }
    const sources = this.app.vault.getFiles().filter(candidate => isCsv(candidate)).map(candidate => candidate.path).sort();
    const initial = existing ? existing.recipe ?? (await this.resolveDefinition(file!.path, existing.id, existing.marker === 'table')).recipe : undefined;
    if (this.stopped) return;
    new TableModal(this.app, {
      sources,
      value: { source: initial?.source ?? source?.path ?? '', columns: initial?.columns ?? [], sql: initial?.sql ?? '', format: initial?.format ?? 'table', autoUpdate: true,
        destination: source ? `${source.parent?.path && source.parent.path !== '/' ? `${source.parent.path}/` : ''}${source.basename}.md` : '' },
      showDestination: !!source,
      showFormat: true,
      submitLabel: existing ? 'Update export' : source ? 'Export to note' : 'Insert from CSV',
      loadColumns: async path => {
        const csv = this.sourceFile(path);
        const root = this.filesystem.getVaultRoot();
        if (!root) throw new Error('Export generation requires a local desktop vault.');
        return csvHeader(await this.processService.captureCommand(['sql', 'query', '--csv', csv.path, '--format', 'csv', '--sql', 'SELECT * FROM data LIMIT 0'], root));
      },
      preview: value => this.render(value, 20),
      submit: async (value, signal) => {
        ++this.pendingWrites;
        try {
          const markdown = await this.render(value);
          if (this.stopped || signal.aborted) throw new Error('Export insertion cancelled.');
          let recipe: TableRecipe = { version: 1, id: crypto.randomUUID(), source: validateSource(value.source), columns: value.columns, sql: value.sql, format: value.format ?? 'table' };
          const path = source ? value.destination.replace(/\\/g, '/') : file!.path;
          if (source && (!path.endsWith('.md') || path.startsWith('/') || path.includes(':') || path.split('/').some(part => !part || part === '.' || part === '..'))) throw new Error('Enter a new Markdown note path inside an existing vault folder.');
          if (view && file && (view.file !== file || view.getMode() !== 'source')) throw new Error('Return to the original note in editing mode to insert this table.');
          if (existing && file) replaceManagedTable(await this.textFor(file), existing, existing.text);
          if (value.autoUpdate) recipe = await this.definitions.save(path, recipe, () => signal.aborted);
          if (this.stopped || signal.aborted) throw new Error('Export insertion cancelled.');
          const text = value.autoUpdate ? managedTableText(recipe, markdown) : recipe.format === 'value' ? markdown : markdown.trimEnd();
          if (source) {
            const note = await this.app.vault.create(path, `${text}\n`);
            await this.index(note);
            if (!signal.aborted && !this.stopped) await this.app.workspace.getLeaf(true).openFile(note);
          } else if (view && file) {
            if (view.file !== file || view.getMode() !== 'source') throw new Error('Return to the original note in editing mode to insert this table.');
            if (existing) await this.replace(file, existing, this.regionText(existing, recipe, markdown, value.autoUpdate));
            else {
              const cursor = view.editor.getCursor();
              view.editor.replaceRange(recipe.format === 'value' ? text : `\n\n${text}\n\n`, cursor);
            }
            await this.index(file);
          }
        } finally { --this.pendingWrites; }
      },
    }).open();
  }

  async detach(file: TFile, table: ManagedTable): Promise<void> {
    const body = tableBody(table);
    await this.replace(file, table, body);
    await this.index(file);
  }

  async listExports(folders: string[]): Promise<SavedExport[]> {
    await this.pruneDeadExports(folders);
    return this.definitions.list(folders);
  }

  onExportsChanged(listener: () => void): () => void {
    this.exportListeners.add(listener);
    return () => { this.exportListeners.delete(listener); };
  }

  /** Remove only linked definitions with no remaining live marker in their scope. */
  pruneDeadExports(folders?: string[]): Promise<void> {
    const work = this.pruning.catch(() => {}).then(async () => {
      if (this.stopped || this.pendingWrites) return;
      const revision = this.pruneRevision;
      const cancelled = () => this.stopped || this.pendingWrites > 0 || revision !== this.pruneRevision;
      const directories = folders ?? this.app.vault.getAllLoadedFiles()
        .filter(file => file instanceof TFolder).map(file => file.path === '/' ? '' : file.path);
      const saved = (await this.definitions.list(directories)).filter(entry => entry.output !== undefined);
      if (!saved.length || cancelled()) return;
      if (this.reflection?.pending) return;
      if (this.reflection) {
        const sync = syncStatus(this.app);
        if (sync.state !== 'inactive' && sync.idle !== true) return;
      }
      const notes = this.app.vault.getMarkdownFiles();
      const markers: Array<{ file: TFile; tables: ManagedTable[] }> = [];
      // An unreadable note or incomplete edit is not evidence that its export died.
      try {
        for (const file of notes) markers.push({ file, tables: findManagedTables(await this.textFor(file)) });
      } catch { return; }
      const live = new Set<string>();
      for (const { file, tables } of markers) for (const table of tables) {
        if (table.recipe) continue;
        const resolved = await this.definitions.find(file.path, table.id, table.marker === 'table');
        if (resolved) this.reflection?.assertSqlBinding(file.path, resolved.recipe.id, resolved.configPath);
        if (resolved) live.add(`${resolved.configPath}\0${resolved.recipe.id}`);
      }
      let changed = false;
      for (const entry of saved) {
        if (cancelled()) break;
        if (!live.has(`${entry.configPath}\0${entry.recipe.id}`)) {
          // Missing notes on a receiving device are not evidence of intentional deletion.
          if (this.reflection && entry.output && !(this.app.vault.getAbstractFileByPath(entry.output) instanceof TFile)) {
            const sync = syncStatus(this.app);
            if (sync.state !== 'inactive' && sync.idle !== true) continue;
          }
          try { await this.definitions.removeExport(entry, cancelled, 'stale-sql'); if (!cancelled()) changed = true; }
          catch (error) { if (!cancelled()) throw error; }
        }
      }
      if (changed) for (const listener of this.exportListeners) listener();
    });
    this.pruning = work;
    return work;
  }

  async loadColumns(source: string): Promise<string[]> {
    const root = this.filesystem.getVaultRoot();
    if (!root) throw new Error('Export generation requires a local desktop vault.');
    return csvHeader(await this.processService.captureCommand(['sql', 'query', '--csv', this.sourceFile(source).path,
      '--format', 'csv', '--sql', 'SELECT * FROM data LIMIT 0'], root));
  }

  configureExport(saved: SavedExport, onSaved: () => void): void {
    new TableModal(this.app, {
      value: { source: saved.recipe.source, columns: saved.recipe.columns, sql: saved.recipe.sql,
        format: saved.recipe.format, autoUpdate: saved.runOnSave },
      showSource: false, showFormat: true, submitLabel: 'Update export',
      loadColumns: source => this.loadColumns(source),
      preview: value => this.render(value, 20),
      submit: async (value, signal) => {
        await this.render(value);
        await this.definitions.update(saved, { ...saved.recipe, columns: value.columns, sql: value.sql,
          format: value.format ?? 'table' }, value.autoUpdate, () => signal.aborted);
        await this.initialize();
        onSaved();
      },
    }, { path: saved.output, exists: this.exportNote(saved) !== null, open: () => this.openExportNote(saved) }).open();
  }

  /** `output` is the note that holds the export's marker. Legacy entries have none; do not scan the vault for them. */
  private exportNote(saved: SavedExport): TFile | null {
    const file = saved.output ? this.app.vault.getAbstractFileByPath(saved.output) : null;
    return file instanceof TFile ? file : null;
  }

  async openExportNote(saved: SavedExport): Promise<void> {
    const file = this.exportNote(saved);
    if (!file) throw new Error(saved.output ? `Note not found: ${saved.output}` : 'This export is not linked to a note.');
    const line = exportMarkerLine(await this.textFor(file), saved.recipe.id);
    const eState = line === undefined ? undefined : { line };
    const existing = this.app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view instanceof MarkdownView && leaf.view.file === file);
    if (!existing) { await this.app.workspace.getLeaf('tab').openFile(file, { active: true, eState }); return; }
    await this.app.workspace.revealLeaf(existing);
    this.app.workspace.setActiveLeaf(existing, { focus: true });
    if (eState) existing.setEphemeralState(eState);
  }

  async removeExport(saved: SavedExport): Promise<void> {
    await this.definitions.checkCurrent(saved);
    await this.removeLinkedExports(saved.recipe.source, async (file, table) => {
      // Inline legacy recipes are self-contained, not links to the selected definition.
      if (table.recipe || (table.marker === 'export' && table.id !== saved.recipe.id)) return false;
      const definition = await this.definitions.find(file.path, table.id, table.marker === 'table');
      return definition?.configPath === saved.configPath && definition.recipe.id === saved.recipe.id;
    }, () => this.definitions.removeExport(saved));
  }

  async removeExports(source: string, configPaths: string[]): Promise<void> {
    await this.removeLinkedExports(source, async (file, table) => {
      if (table.recipe) return table.recipe.source === source;
      const definition = await this.definitions.find(file.path, table.id, table.marker === 'table');
      return definition?.recipe.source === source && configPaths.includes(definition.configPath);
    }, () => this.definitions.removeSource(source, configPaths));
  }

  /** Detach all matching copies first; failed detaches leave definitions available for retry. */
  private async removeLinkedExports(source: string, matches: (file: TFile, table: ManagedTable) => Promise<boolean>,
    removeDefinitions: () => Promise<void>): Promise<void> {
    if (this.stopped) throw new Error('Export deletion cancelled.');
    if (this.deletingSources.has(source)) throw new Error('An export deletion for this CSV is already in progress. Please try again.');
    this.deletingSources.add(source);
    this.sourceChanged(source);
    try {
      const targets: Array<{ file: TFile; table: ManagedTable }> = [];
      for (const file of this.app.vault.getMarkdownFiles()) {
        for (const table of findManagedTables(await this.textFor(file))) {
          if (await matches(file, table)) targets.push({ file, table });
        }
      }
      for (const { file, table } of targets) {
        if (this.stopped) throw new Error('Export deletion cancelled.');
        await this.replace(file, table, tableBody(table));
      }
      if (this.stopped) throw new Error('Export deletion cancelled.');
      await removeDefinitions();
      await this.initialize();
    } finally { this.deletingSources.delete(source); }
  }
}

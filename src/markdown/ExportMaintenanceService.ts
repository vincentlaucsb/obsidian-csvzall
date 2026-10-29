import { TFile, TFolder, type App } from 'obsidian';
import type { ExportReflection } from '../exports/ExportReflection.js';
import type { ExportReference, ReferenceScan } from '../exports/localFolders.js';
import { syncStatus } from '../obsidian/syncStatus.js';
import { findManagedTables, replaceManagedTable, shortenManagedTable, tableBody, type ManagedTable, type TableRecipe } from './managedTables.js';
import type { ExportDefinitions, ResolvedExport, SavedExport } from './ExportDefinitions.js';
import type { MarkdownNoteStore } from './MarkdownNoteStore.js';
import type { ExportRenderer } from './ExportRenderer.js';
import type { ExportReporter } from './exportReporting.js';
import { fencedTableText } from './fencedTables.js';
import { canonicalFenceRecipe, exportDefinitionId, fenceRecipe, resolveFencedExport } from './fencedExports.js';
import { rebaseSqlSource } from './sqlSources.js';

export interface MaintenanceRefreshActions {
  index(file: TFile): Promise<boolean>;
  initialize(): Promise<void>;
  sourceChanged(path: string): void;
  bindingsFor(file: TFile): readonly ResolvedExport[] | undefined;
  isEditing(file: TFile): boolean;
}

/** Owns migration, definition maintenance, deletion and the cleanup write barrier. */
export class ExportMaintenanceService {
  private pendingWrites = 0;
  private pruneRevision = 0;
  private pruning: Promise<void> = Promise.resolve();
  private readonly exportListeners = new Set<() => void>();
  private readonly deletingSources = new Set<string>();

  constructor(private readonly app: App, private readonly notes: MarkdownNoteStore, private readonly renderer: ExportRenderer,
    private readonly definitions: ExportDefinitions, private readonly refresh: MaintenanceRefreshActions,
    private readonly report: ExportReporter, private readonly signal: AbortSignal, private readonly reflection?: ExportReflection) {}

  invalidatePruning(): void { ++this.pruneRevision; }

  isDeleting(source: string): boolean { return this.deletingSources.has(source); }

  async withWrite<T>(work: () => Promise<T>): Promise<T> {
    if (this.signal.aborted) throw new Error('Export update cancelled.');
    ++this.pendingWrites; this.invalidatePruning();
    try { return await work(); } finally { --this.pendingWrites; }
  }

  async rename(oldPath: string, path: string): Promise<void> {
    this.notes.invalidateAll();
    await this.withWrite(async () => {
      await this.reflection?.renamed(oldPath, path);
      await this.renameSource(oldPath, path);
    });
  }

  async migrationReferences(): Promise<ReferenceScan> {
    const references: ExportReference[] = [];
    const revision = this.notes.revision;
    let complete = true;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (this.refresh.isEditing(file)) { complete = false; continue; }
      try {
        for (const table of await this.notes.tablesFor(file)) {
          if (!table.recipe) references.push({ note: file.path, id: table.fence?.legacy?.id ?? exportDefinitionId(file.path, table), legacy: table.marker === 'table' });
        }
      } catch (error) { complete = false; await this.report(file, error); }
    }
    return { references, complete: complete && revision === this.notes.revision };
  }

  async prepare(file: TFile): Promise<ManagedTable[]> {
    return this.withWrite(async () => {
      for (const table of await this.notes.tablesFor(file)) {
        if (table.fence) {
          const recipe = fenceRecipe(file.path, table);
          this.renderer.sourceFile(recipe.source);
          let policy: boolean | undefined;
          let inherited: ResolvedExport | undefined;
          if (table.fence.legacy) {
            let legacy: ResolvedExport;
            try { legacy = await this.resolveDefinition(file.path, table.fence.legacy.id); }
            catch (error) {
              if (!await this.reflection?.recoverSql(file.path, table.fence.legacy.id)) throw error;
              legacy = await this.resolveDefinition(file.path, table.fence.legacy.id);
            }
            inherited = legacy;
            if (!await this.definitions.find(file.path, recipe.id)) policy = legacy.runOnSave;
          }
          await resolveFencedExport(file.path, recipe, this.definitions, this.reflection, { autoUpdate: policy, inherit: inherited });
          if (table.fence.legacy) await this.notes.replace(file, table, fencedTableText(file.path, recipe, table.body));
          continue;
        }
        if (!table.recipe && table.marker !== 'table') continue;
        const legacy = table.recipe ? undefined : await this.resolveDefinition(file.path, table.id, true);
        // Rebind in the note's current scope so a nearer, unrelated export ID
        // cannot shadow the migrated table once its marker becomes canonical.
        const recipe = await this.definitions.save(file.path, table.recipe ?? legacy!.recipe, undefined, legacy?.runOnSave ?? true);
        // Persist the definition first. A failed or concurrent note edit keeps its inline recipe.
        await this.notes.replace(file, table, shortenManagedTable(table, recipe.id));
      }
      return await this.notes.tablesFor(file);
    });
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

  resolveTable(note: string, table: ManagedTable): Promise<ResolvedExport> {
    return this.resolveDefinition(note, exportDefinitionId(note, table), table.marker === 'table');
  }

  async saveFence(note: string, recipe: TableRecipe, autoUpdate: boolean, cancelled: () => boolean, inherit?: ResolvedExport): Promise<TableRecipe> {
    const canonical = canonicalFenceRecipe(note, recipe);
    return (await resolveFencedExport(note, canonical, this.definitions, this.reflection, { autoUpdate, cancelled, explicit: true, inherit })).recipe;
  }

  private async renameSource(oldPath: string, path: string): Promise<void> {
    this.refresh.sourceChanged(oldPath);
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) for (const table of findManagedTables(await this.notes.textFor(file))) {
      if (!table.fence) continue;
      try {
        const noteMoved = file.path === path || file.path.startsWith(`${path}/`);
        const previousNote = noteMoved ? oldPath + file.path.slice(path.length) : file.path;
        const previous = fenceRecipe(previousNote, table);
        const previousSource = previous.source;
        if (!noteMoved && previousSource !== oldPath && !previousSource.startsWith(`${oldPath}/`)) continue;
        const saved = this.refresh.bindingsFor(file)?.find(binding => binding.recipe.id === previous.id) ?? await this.definitions.find(previousNote, previous.id);
        const source = previousSource === oldPath || previousSource.startsWith(`${oldPath}/`) ? path + previousSource.slice(oldPath.length) : previousSource;
        const recipe = canonicalFenceRecipe(file.path, { ...previous, source, sql: rebaseSqlSource(previous.sql, source) });
        await resolveFencedExport(file.path, recipe, this.definitions, this.reflection, { autoUpdate: saved?.runOnSave, inherit: saved });
        await this.notes.replace(file, table, fencedTableText(file.path, recipe, table.body));
      } catch (error) { await this.report(file, error); }
    }
    // Carry bindings when notes move outside the scope of their old config.
    for (const file of files) {
      if (file.path !== path && !file.path.startsWith(`${path}/`)) continue;
      const previousPath = oldPath + file.path.slice(path.length);
      for (const table of findManagedTables(await this.notes.textFor(file))) {
        if (table.recipe || table.fence) continue;
        try {
          const previous = this.refresh.bindingsFor(file)?.find(binding => binding.recipe.id === table.id) ?? await this.resolveDefinition(previousPath, table.id);
          const source = previous.recipe.source;
          const recipe = { ...previous.recipe, source: source === oldPath || source.startsWith(`${oldPath}/`) ? path + source.slice(oldPath.length) : source };
          // If its configuration moved too, rename() below adjusts its paths.
          if (previous.configPath.startsWith(`${oldPath}/`)) continue;
          const saved = await this.definitions.save(file.path, recipe, undefined, previous.runOnSave);
          await this.notes.replace(file, table, shortenManagedTable(table, saved.id));
        } catch (error) { await this.report(file, error); }
      }
    }
    for (const file of files) {
      try { await this.prepare(file); } catch (error) { await this.report(file, error); }
    }
    if (!this.reflection) await this.definitions.rename(files.map(file => file.path), oldPath, path);
    for (const file of files) {
      try { await this.refresh.index(file); } catch (error) { await this.report(file, error); }
    }
  }

  async listExports(folders: string[]): Promise<SavedExport[]> {
    await this.pruneDeadExports(folders);
    return this.definitions.list(folders);
  }

  onExportsChanged(listener: () => void): () => void {
    this.exportListeners.add(listener);
    return () => { this.exportListeners.delete(listener); };
  }

  pruneDeadExports(folders?: string[]): Promise<void> {
    const work = this.pruning.catch(() => {}).then(async () => {
      if (this.signal.aborted || this.pendingWrites) return;
      const revision = this.pruneRevision;
      const cancelled = () => this.signal.aborted || this.pendingWrites > 0 || revision !== this.pruneRevision;
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
        for (const file of notes) {
          if (this.refresh.isEditing(file)) return;
          markers.push({ file, tables: await this.notes.tablesFor(file) });
        }
      } catch { return; }
      const live = new Set<string>();
      try {
        for (const { file, tables } of markers) {
          for (const table of tables) {
            if (table.recipe) continue;
            const resolved = await this.definitions.find(file.path, exportDefinitionId(file.path, table), table.marker === 'table');
            if (resolved) this.reflection?.assertSqlBinding(file.path, resolved.recipe.id, resolved.configPath);
            if (resolved) live.add(`${resolved.configPath}\0${resolved.recipe.id}`);
          }
        }
      } catch { return; }
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

  async removeExport(saved: SavedExport): Promise<void> {
    await this.definitions.checkCurrent(saved);
    await this.removeLinkedExports(saved.recipe.source, async (file, table) => {
      // Inline legacy recipes are self-contained, not links to the selected definition.
      if (table.recipe || (table.marker === 'export' && table.id !== saved.recipe.id)) return false;
      const definition = await this.definitions.find(file.path, exportDefinitionId(file.path, table), table.marker === 'table');
      return definition?.configPath === saved.configPath && definition.recipe.id === saved.recipe.id;
    }, () => this.definitions.removeExport(saved));
  }

  async removeExports(source: string, configPaths: string[]): Promise<void> {
    await this.removeLinkedExports(source, async (file, table) => {
      if (table.recipe) return table.recipe.source === source;
      const definition = await this.definitions.find(file.path, exportDefinitionId(file.path, table), table.marker === 'table');
      return definition?.recipe.source === source && configPaths.includes(definition.configPath);
    }, () => this.definitions.removeSource(source, configPaths));
  }

  private async removeLinkedExports(source: string, matches: (file: TFile, table: ManagedTable) => Promise<boolean>,
    removeDefinitions: () => Promise<void>): Promise<void> {
    if (this.signal.aborted) throw new Error('Export deletion cancelled.');
    if (this.deletingSources.has(source)) throw new Error('An export deletion for this CSV is already in progress. Please try again.');
    this.deletingSources.add(source);
    this.refresh.sourceChanged(source);
    try {
      await this.withWrite(async () => {
        const targets: Array<{ file: TFile; table: ManagedTable }> = [];
        const snapshots = new Map<TFile, string>();
        for (const file of this.app.vault.getMarkdownFiles()) {
          const text = await this.notes.textFor(file);
          snapshots.set(file, text);
          for (const table of findManagedTables(text)) {
            if (await matches(file, table)) targets.push({ file, table });
          }
        }
        for (const { file, table } of targets.reverse()) {
          if (this.signal.aborted) throw new Error('Export deletion cancelled.');
          const snapshot = snapshots.get(file)!;
          const expected = findManagedTables(snapshot).find(candidate => candidate.id === table.id)!;
          await this.notes.replace(file, expected, tableBody(expected), true);
          snapshots.set(file, replaceManagedTable(snapshot, expected, tableBody(expected)));
        }
        if (this.signal.aborted) throw new Error('Export deletion cancelled.');
        await removeDefinitions();
        await this.refresh.initialize();
      });
    } finally { this.deletingSources.delete(source); }
  }
}

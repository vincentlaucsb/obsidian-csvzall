import { MarkdownView, TFile, type App, type Editor, type Plugin } from 'obsidian';
import type { EventLog } from '../logging/EventLog.js';
import type { ObsidianFilesystem } from '../obsidian/filesystem.js';
import type { CsvzallProcessService } from '../process/CsvzallProcessService.js';
import type { ExportReflection } from '../exports/ExportReflection.js';
import type { ReferenceScan } from '../exports/localFolders.js';
import { isCsv } from '../csv/csvFiles.js';
import type { ManagedTable } from './managedTables.js';
import type { TableValue } from './table-form.mjs';
import { ExportDefinitions, type SavedExport } from './ExportDefinitions.js';
import { MarkdownNoteStore } from './MarkdownNoteStore.js';
import { ExportRenderer } from './ExportRenderer.js';
import { ExportMaintenanceService } from './ExportMaintenanceService.js';
import { ExportRefreshService } from './ExportRefreshService.js';
import { ExportEditingService, type ExportPreferences } from './ExportEditingService.js';
import { createExportReporter, type ExportReporter } from './exportReporting.js';

/** Stable public facade: composes export services and routes Obsidian events. */
export class MarkdownTableService {
  private readonly lifetime = new AbortController();
  private readonly notes: MarkdownNoteStore;
  private readonly renderer: ExportRenderer;
  private readonly definitions: ExportDefinitions;
  private readonly maintenance: ExportMaintenanceService;
  private readonly refreshes: ExportRefreshService;
  private readonly editing: ExportEditingService;
  private readonly report: ExportReporter;

  constructor(private readonly app: App, filesystem: ObsidianFilesystem,
    processService: CsvzallProcessService, eventLog: EventLog,
    reflection?: ExportReflection, preferences?: ExportPreferences) {
    const signal = this.lifetime.signal;
    this.report = createExportReporter(eventLog, signal);
    this.notes = new MarkdownNoteStore(app, signal);
    this.renderer = new ExportRenderer(app, filesystem, processService, signal);
    this.definitions = new ExportDefinitions(app.vault.adapter, () => signal.aborted,
      (path, reason) => reflection?.edited(path, reason) ?? Promise.resolve(), reflection?.usesDirectFolders);
    this.maintenance = new ExportMaintenanceService(app, this.notes, this.renderer, this.definitions, {
      index: file => this.refreshes.index(file), initialize: () => this.refreshes.initialize(),
      sourceChanged: path => this.refreshes.sourceChanged(path), bindingsFor: file => this.refreshes.bindingsFor(file),
    }, this.report, signal, reflection);
    this.refreshes = new ExportRefreshService(app, this.notes, this.renderer, this.definitions, this.maintenance, this.report, signal, reflection);
    this.editing = new ExportEditingService(app, this.notes, this.renderer, this.definitions, this.maintenance, this.refreshes, this.report, signal, preferences);
  }

  register(plugin: Plugin): void {
    plugin.register(() => this.unload());
    plugin.registerEvent(this.app.vault.on('modify', file => {
      if (!(file instanceof TFile)) return;
      this.notes.invalidateNote(file);
      if (isCsv(file)) { this.refreshes.sourceChanged(file.path); void this.refreshes.initialize().catch(error => this.report(file, error)); }
      if (file.extension === 'md') { this.maintenance.invalidatePruning(); void this.refreshes.index(file).then(changed => changed ? this.pruneDeadExports() : undefined).catch(error => this.report(file, error)); }
    }));
    plugin.registerEvent(this.app.vault.on('create', file => {
      if (file instanceof TFile) this.notes.invalidateNote(file);
      this.maintenance.invalidatePruning();
      if (file instanceof TFile && file.extension === 'md') void this.refreshes.index(file).catch(error => this.report(file, error));
      if (file instanceof TFile && isCsv(file)) this.refreshes.sourceChanged(file.path);
    }));
    plugin.registerEvent(this.app.vault.on('delete', file => {
      if (file instanceof TFile) this.notes.invalidateNote(file);
      if (file instanceof TFile) this.refreshes.forget(file);
      this.refreshes.sourceChanged(file.path);
      this.maintenance.invalidatePruning();
      void this.pruneDeadExports().catch(error => this.report(null, error));
    }));
    plugin.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      void this.maintenance.rename(oldPath, file.path).catch(error => this.report(null, error));
    }));
    plugin.registerEvent(this.app.workspace.on('editor-change', (_editor, view) => {
      if (!(view instanceof MarkdownView) || !view.file) return;
      this.notes.invalidateNote(view.file);
      this.maintenance.invalidatePruning();
      void this.refreshes.index(view.file).then(changed => changed ? this.pruneDeadExports() : undefined).catch(error => this.report(view.file, error));
    }));
    this.refreshes.start();
  }

  unload(): void { this.lifetime.abort(); this.refreshes.stop(); }

  migrationReferences(): Promise<ReferenceScan> { return this.maintenance.migrationReferences(); }
  refreshAfterSync(): Promise<void> { return this.refreshes.refreshAfterSync(); }
  render(value: Pick<TableValue, 'source' | 'columns' | 'sql' | 'format'>, limit?: number, validate?: () => void): Promise<string> { return this.renderer.render(value, limit, validate); }
  refresh(file: TFile, onlyId?: string, automatic = false): Promise<void> { return this.refreshes.refresh(file, onlyId, automatic); }
  currentTable(editor: Editor): ManagedTable | undefined { return this.notes.currentTable(editor); }
  open(view: MarkdownView | null, source?: TFile, existing?: ManagedTable): void { this.editing.open(view, source, existing); }
  insertQueryIntoNote(source: TFile, sql: string, cancelled: () => boolean, lifecycle?: AbortSignal): Promise<boolean> { return this.editing.insertQueryIntoNote(source, sql, cancelled, lifecycle); }
  detach(file: TFile, table: ManagedTable): Promise<void> { return this.editing.detach(file, table); }
  listExports(folders: string[]): Promise<SavedExport[]> { return this.maintenance.listExports(folders); }
  onExportsChanged(listener: () => void): () => void { return this.maintenance.onExportsChanged(listener); }
  pruneDeadExports(folders?: string[]): Promise<void> { return this.maintenance.pruneDeadExports(folders); }
  loadColumns(source: string): Promise<string[]> { return this.renderer.loadColumns(source); }
  configureExport(saved: SavedExport, onSaved: () => void): void { this.editing.configureExport(saved, onSaved); }
  openExportNote(saved: SavedExport): Promise<void> { return this.editing.openExportNote(saved); }
  openSource(file: TFile, table: ManagedTable): Promise<void> { return this.editing.openSource(file, table); }
  removeExport(saved: SavedExport): Promise<void> { return this.maintenance.removeExport(saved); }
  removeExports(source: string, configPaths: string[]): Promise<void> { return this.maintenance.removeExports(source, configPaths); }
}

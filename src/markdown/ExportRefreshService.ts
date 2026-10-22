import { TFile, type App } from 'obsidian';
import type { ExportReflection } from '../exports/ExportReflection.js';
import type { ExportDefinitions, ResolvedExport } from './ExportDefinitions.js';
import type { MarkdownNoteStore } from './MarkdownNoteStore.js';
import type { ExportRenderer } from './ExportRenderer.js';
import type { ExportMaintenanceService } from './ExportMaintenanceService.js';
import type { ExportReporter } from './exportReporting.js';
import { exportDefinitionId } from './fencedExports.js';
import { exportRegionText } from './exportContent.js';

enum RefreshWorkerState { Idle, Running, Stopped }
enum ScanState { Idle, Running }

/** Owns refresh scheduling, index bindings, source revisions and scan ordering. */
export class ExportRefreshService {
  private workerState = RefreshWorkerState.Idle;
  private scanState = ScanState.Idle;
  private poll: number | null = null;
  private timer: number | null = null;
  private readonly queued = new Set<TFile>();
  private readonly bindings = new Map<TFile, ResolvedExport[]>();
  private readonly sources = new Map<TFile, string[]>();
  private readonly signatures = new Map<TFile, string>();
  private readonly revisions = new Map<string, number>();
  private readonly indexRevisions = new Map<TFile, number>();

  constructor(private readonly app: App, private readonly notes: MarkdownNoteStore, private readonly renderer: ExportRenderer,
    private readonly definitions: ExportDefinitions, private readonly maintenance: ExportMaintenanceService,
    private readonly report: ExportReporter, private readonly signal: AbortSignal, private readonly reflection?: ExportReflection) {}

  private isStopped(): boolean { return this.signal.aborted || this.workerState === RefreshWorkerState.Stopped; }

  start(): void {
    this.app.workspace.onLayoutReady(() => {
      if (this.isStopped()) return;
      void this.initialize().catch(error => this.report(null, error));
      this.poll = window.setInterval(() => { void this.initialize().catch(error => this.report(null, error)); }, 10_000);
    });
  }

  stop(): void {
    this.workerState = RefreshWorkerState.Stopped;
    if (this.poll !== null) window.clearInterval(this.poll);
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.poll = null; this.timer = null; this.queued.clear();
  }

  bindingsFor(file: TFile): readonly ResolvedExport[] | undefined { return this.bindings.get(file); }

  forget(file: TFile): void {
    this.sources.delete(file); this.bindings.delete(file); this.signatures.delete(file); this.queued.delete(file); this.indexRevisions.delete(file);
  }

  async initialize(): Promise<void> {
    if (this.scanState === ScanState.Running || this.isStopped()) return;
    this.scanState = ScanState.Running;
    let failed = false;
    try {
      await this.reflection?.reconcile();
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (this.isStopped()) return;
        try { await this.index(file); } catch (error) { failed = true; await this.report(file, error); }
      }
    } finally { this.scanState = ScanState.Idle; }
    if (!failed) await this.maintenance.pruneDeadExports().catch(error => this.report(null, error));
  }

  async refreshAfterSync(): Promise<void> {
    try { await this.initialize(); } catch (error) { await this.report(null, error); }
  }

  async index(file: TFile): Promise<boolean> {
    if (this.isStopped()) return false;
    const revision = (this.indexRevisions.get(file) ?? 0) + 1;
    this.indexRevisions.set(file, revision);
    const tables = await this.maintenance.prepare(file);
    if (this.reflection) for (const table of tables) {
      if (!table.recipe && !table.fence) await this.reflection.recoverSql(file.path, table.id);
    }
    const results = await Promise.allSettled(tables.map(table => this.maintenance.resolveTable(file.path, table)));
    const resolved = [];
    for (const result of results) {
      if (result.status === 'fulfilled') resolved.push(result.value);
      else await this.report(file, result.reason);
    }
    if (this.isStopped() || this.indexRevisions.get(file) !== revision || this.app.vault.getAbstractFileByPath(file.path) !== file) return false;
    this.bindings.set(file, resolved);
    this.sources.set(file, resolved.filter(table => table.runOnSave).map(table => table.recipe.source));
    const signature = JSON.stringify(resolved);
    const changed = this.signatures.get(file) !== signature;
    this.signatures.set(file, signature);
    if (changed && resolved.some(table => table.runOnSave)) this.schedule(file);
    return changed;
  }

  sourceChanged(path: string): void {
    this.revisions.set(path, (this.revisions.get(path) ?? 0) + 1);
    for (const [file, paths] of this.sources) if (paths.some(source => source === path || source.startsWith(`${path}/`))) this.schedule(file);
  }

  private schedule(file: TFile): void {
    if (this.isStopped()) return;
    this.queued.add(file);
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = null; void this.drain(); }, 500);
  }

  private async drain(): Promise<void> {
    if (this.workerState !== RefreshWorkerState.Idle || this.isStopped()) return;
    this.workerState = RefreshWorkerState.Running;
    try {
      while (!this.isStopped() && this.queued.size) {
        const [file] = this.queued;
        if (!(file instanceof TFile)) break;
        this.queued.delete(file);
        try { await this.refresh(file, undefined, true); } catch (error) { await this.report(file, error); }
      }
    } finally { if (!this.isStopped()) this.workerState = RefreshWorkerState.Idle; }
  }

  async refresh(file: TFile, onlyId?: string, automatic = false): Promise<void> {
    if (this.isStopped()) return;
    await this.reflection?.reconcile();
    if (this.isStopped()) return;
    const tables = await this.maintenance.prepare(file);
    const results = new Map<string, string>();
    for (const table of tables) {
      if (onlyId && table.id !== onlyId && exportDefinitionId(file.path, table) !== onlyId) continue;
      try {
        const path = file.path;
        const snapshot = await this.definitions.snapshot(path);
        const definition = await this.maintenance.resolveTable(file.path, table);
        if (automatic && !definition.runOnSave) continue;
        const recipe = definition.recipe;
        if (this.maintenance.isDeleting(recipe.source)) continue;
        const revision = this.revisions.get(recipe.source);
        const validate = () => {
          this.reflection?.assertReady(definition.configPath);
          this.reflection?.assertSqlBinding(file.path, recipe.id, definition.configPath);
        };
        const key = JSON.stringify([definition.configPath, recipe.id, snapshot, revision]);
        let markdown = results.get(key);
        if (markdown === undefined) { markdown = await this.renderer.render(recipe, undefined, validate); results.set(key, markdown); }
        if (this.isStopped()) return;
        if (this.maintenance.isDeleting(recipe.source)) continue;
        if (path !== file.path || snapshot !== await this.definitions.snapshot(file.path) || revision !== this.revisions.get(recipe.source)) { this.schedule(file); continue; }
        validate();
        await this.notes.replace(file, table, exportRegionText(table, recipe, markdown, file.path));
      } catch (error) { await this.report(file, error, automatic); }
    }
  }
}

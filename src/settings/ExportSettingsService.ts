import { Notice, TFile, TFolder, type App, type Plugin } from "obsidian";
import { ChartDefinitions, type SavedChart } from "../charts/ChartDefinitions.js";
import { findChartConfigPaths } from "../charts/chartConfigFiles.js";
import { normalizeVaultPath, resolveChartPath } from "../chartAutomation.js";
import type { ChartService } from "../charts/ChartService.js";
import type { SavedExport } from "../markdown/ExportDefinitions.js";
import type { MarkdownTableService } from "../markdown/MarkdownTableService.js";
import type { ObsidianFilesystem } from "../obsidian/filesystem.js";
import type { CsvzallProcessService } from "../process/CsvzallProcessService.js";
import { ChartOptionsModal, ChooseExportModal, DeleteExportsModal } from "./ExportModals.js";

export type ExportEntry = { kind: "chart"; chart: SavedChart } | { kind: "table"; table: SavedExport };
export interface FileExports { source: string; entries: ExportEntry[]; missing: boolean }

export class ExportSettingsService {
  private readonly definitions: ChartDefinitions;
  private stopped = false;
  private readonly listeners = new Set<() => void>();
  private pruning: Promise<void> = Promise.resolve();
  constructor(private readonly app: App, private readonly charts: ChartService,
    private readonly tables: MarkdownTableService, private readonly filesystem: ObsidianFilesystem,
    private readonly process: CsvzallProcessService) {
    this.definitions = new ChartDefinitions(app.vault.adapter);
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    const unsubscribe = this.tables.onExportsChanged(listener);
    return () => { this.listeners.delete(listener); unsubscribe(); };
  }

  register(plugin: Plugin): void {
    plugin.register(() => { this.stopped = true; });
    plugin.registerEvent(this.app.vault.on("delete", file => {
      const path = normalizeVaultPath(file.path);
      this.pruning = this.pruning.catch(() => {}).then(() => this.pruneDeletedCharts(path));
      void this.pruning.catch((error: unknown) => {
        if (!this.stopped) new Notice(`Could not prune chart exports: ${error instanceof Error ? error.message : String(error)}`);
      });
    }));
  }

  private async pruneDeletedCharts(path: string): Promise<void> {
    if (this.stopped) return;
    const folders = this.app.vault.getAllLoadedFiles().filter(file => file instanceof TFolder).map(file => normalizeVaultPath(file.path));
    const entries = await this.definitions.list(await findChartConfigPaths(this.app.vault.adapter, folders));
    let changed = false;
    for (const chart of entries) {
      if (this.stopped) return;
      if (!chart.definition.output) continue;
      const output = resolveChartPath(chart.configPath, chart.definition.output);
      if (output !== path && !output.startsWith(`${path}/`)) continue;
      if (await this.app.vault.adapter.exists(output)) continue;
      await this.definitions.removeChart(chart, () => this.stopped || this.app.vault.getAbstractFileByPath(output) !== null);
      changed = true;
    }
    if (changed) {
      await this.charts.reloadChartConfig();
      for (const listener of this.listeners) listener();
    }
  }

  async list(): Promise<FileExports[]> {
    const folders = this.app.vault.getAllLoadedFiles().filter(file => file instanceof TFolder).map(file => normalizeVaultPath(file.path));
    const charts = await this.definitions.list(await findChartConfigPaths(this.app.vault.adapter, folders));
    const tables = await this.tables.listExports(folders);
    const groups = new Map<string, FileExports>();
    const add = (source: string, entry: ExportEntry) => {
      const group = groups.get(source) ?? { source, entries: [], missing: !(this.app.vault.getAbstractFileByPath(source) instanceof TFile) };
      group.entries.push(entry);
      groups.set(source, group);
    };
    for (const chart of charts) add(chart.source, { kind: "chart", chart });
    for (const table of tables) add(table.recipe.source, { kind: "table", table });
    return Array.from(groups.values()).sort((left, right) => left.source.localeCompare(right.source));
  }

  configure(file: FileExports, onSaved: () => void): void {
    const configure = (entry: ExportEntry) => {
      if (entry.kind === "table") { this.tables.configureExport(entry.table, onSaved); return; }
      const root = this.filesystem.getVaultRoot();
      if (!root) throw new Error("Chart generation requires a local filesystem vault.");
      new ChartOptionsModal(this.app, entry.chart, this.definitions, this.tables, this.process, root,
        () => { void this.charts.reloadChartConfig(); onSaved(); }).open();
    };
    new ChooseExportModal(this.app, file, configure, async entry => {
      await this.removeEntry(entry);
      onSaved();
    }).open();
  }

  confirmDelete(file: FileExports, onDeleted: () => void): void {
    new DeleteExportsModal(this.app, file, async () => { await this.remove(file.source); onDeleted(); }).open();
  }

  async removeEntry(entry: ExportEntry): Promise<void> {
    try {
      if (entry.kind === "chart") await this.definitions.removeChart(entry.chart);
      else await this.tables.removeExport(entry.table);
    }
    finally { await this.charts.reloadChartConfig(); }
  }

  async remove(source: string): Promise<void> {
    // Re-read before acting: settings may have been open while configurations changed.
    const current = (await this.list()).find(file => file.source === source);
    if (!current) return;
    const chartPaths = current.entries.flatMap(entry => entry.kind === "chart" ? [entry.chart.configPath] : []);
    const tablePaths = current.entries.flatMap(entry => entry.kind === "table" ? [entry.table.configPath] : []);
    try {
      if (tablePaths.length) await this.tables.removeExports(source, tablePaths);
      await this.definitions.remove(source, Array.from(new Set(chartPaths)));
    } finally { await this.charts.reloadChartConfig(); }
  }
}

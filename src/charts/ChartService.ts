import { Notice, Platform, TFolder, type App } from "obsidian";
import type { EventLog } from "../logging/EventLog.js";
import type { ObsidianFilesystem } from "../obsidian/filesystem.js";
import type { CsvzallProcessService } from "../process/CsvzallProcessService.js";
import type { ConfiguredChart } from "../types.js";
import {
  ChartRunScheduler,
  chartRunKey,
  isChartConfigPath,
  matchingRunOnSaveCharts,
  outputChartsForCsv,
  parseChartConfigText,
} from "../chartAutomation.js";

import { findChartConfigPaths } from "./chartConfigFiles.js";
import { SessionErrors } from "../logging/SessionErrors.js";
import type { ExportReflection } from "../exports/ExportReflection.js";
import { directConfig } from "../exports/paths.js";
import { normalizeVaultPath } from "../utils/paths.js";

export class ChartService {
  readonly scheduler: ChartRunScheduler;
  private charts: ConfiguredChart[] = [];
  private reloadPromise: Promise<void> | null = null;
  private readonly errors = new SessionErrors();

  constructor(
    private readonly app: App,
    private readonly eventLog: EventLog,
    private readonly filesystem: ObsidianFilesystem,
    private readonly processService: CsvzallProcessService,
    private readonly reflection?: ExportReflection,
  ) {
    this.scheduler = new ChartRunScheduler({
      runner: (_inputPath: string, chartKeys: string[]) => this.runConfiguredCharts(chartKeys, true),
    });
  }

  allChartKeys(): string[] {
    return this.charts.map((chart) => chartRunKey(chart));
  }

  outputChartsForCsv(path: string): ConfiguredChart[] {
    return outputChartsForCsv(this.charts, path);
  }

  isChartConfigPath(path: string): boolean {
    return isChartConfigPath(normalizeVaultPath(path));
  }

  reloadChartConfig(): Promise<void> {
    if (!this.reloadPromise) {
      this.reloadPromise = this.loadChartConfig().finally(() => { this.reloadPromise = null; });
    }
    return this.reloadPromise;
  }

  private async loadChartConfig(): Promise<void> {
    try {
      await this.reflection?.reconcile();
      const folders = this.app.vault.getAllLoadedFiles()
        .filter((file) => file instanceof TFolder)
        .map((folder) => folder.path);
      const configPaths = await findChartConfigPaths(this.app.vault.adapter, folders);
      const charts: ConfiguredChart[] = [];
      for (const configPath of configPaths) {
        try {
        const text = await this.app.vault.adapter.read(configPath);
        this.reflection?.assertReady(configPath);
        charts.push(...parseChartConfigText(text, configPath).filter(chart => !this.reflection?.usesDirectFolders || directConfig(chart.input, "charts") === configPath));
        } catch (error) { await this.reportConfigError(error, configPath); }
      }
      this.charts = charts;
    } catch (error) {
      await this.reportConfigError(error, "load");
    }
  }

  private async reportConfigError(error: unknown, context: string): Promise<void> {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.errors.first(context, message)) return;
      new Notice(`csvzall failed to load chart config: ${message}`);
      await this.eventLog.record("error", "Failed to load chart config", message);
      console.error("csvzall failed to load chart config", error);
  }

  async refreshAfterSync(): Promise<void> {
    await this.reloadChartConfig();
    for (const input of new Set(this.charts.map(chart => chart.input))) {
      if (this.app.vault.getAbstractFileByPath(input)) this.scheduleChartsForCsv(input);
    }
  }

  scheduleChartsForCsv(path: string): void {
    const charts = matchingRunOnSaveCharts(this.charts, path);
    if (charts.length === 0) {
      return;
    }
    this.scheduler.schedule(path, charts.map((chart) => chartRunKey(chart)));
  }

  async runConfiguredCharts(chartKeys: string[], automatic = false): Promise<void> {
    if (!Platform.isDesktopApp) {
      const message = "csvzall chart generation requires the Obsidian desktop app.";
      if (!automatic || this.errors.first("platform", message)) {
        new Notice(message);
        await this.eventLog.record("error", message);
      }
      return;
    }

    const vaultRoot = this.filesystem.getVaultRoot();
    if (!vaultRoot) {
      const message = "csvzall chart generation requires a local filesystem vault.";
      if (!automatic || this.errors.first("vault", message)) {
        new Notice(message);
        await this.eventLog.record("error", message);
      }
      return;
    }

    const keys = Array.from(new Set(chartKeys)).filter(Boolean).sort();
    if (keys.length === 0) {
      if (!automatic) new Notice("No csvzall charts are configured.");
      return;
    }

    let failures = 0;
    for (const key of keys) {
      const chart = this.charts.find((candidate) => chartRunKey(candidate) === key);
      if (!chart) {
        failures += 1;
        if (!automatic || this.errors.first("missing", key)) await this.eventLog.record("error", "Failed to regenerate chart", `Chart config entry not found: ${key}`);
        continue;
      }
      try { this.reflection?.assertReady(chart.configPath); }
      catch (error) {
        failures++;
        const message = error instanceof Error ? error.message : String(error);
        if (!automatic || this.errors.first(key, message)) new Notice(message);
        continue;
      }
      try {
        await this.processService.runCommand(
          ["charts", "run", chart.id, "--config", chart.configPath],
          vaultRoot,
          `chart ${chart.id}`,
          automatic,
          () => this.reflection?.assertReady(chart.configPath),
        );
        await this.eventLog.record(
          "info",
          `Generated chart ${chart.id}`,
          chart.output ? `Output: ${chart.output}` : undefined,
        );
      } catch {
        failures += 1;
      }
    }
    if (failures > 0) {
      return;
    }
    if (!automatic) new Notice(keys.length === 1 ? "csvzall chart regenerated." : `csvzall regenerated ${keys.length} charts.`);
  }
}

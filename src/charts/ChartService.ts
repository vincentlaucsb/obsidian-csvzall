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
  normalizeVaultPath,
  outputChartsForCsv,
  parseChartConfigText,
} from "../chartAutomation.js";

import { findChartConfigPaths } from "./chartConfigFiles.js";

export class ChartService {
  readonly scheduler: ChartRunScheduler;
  private charts: ConfiguredChart[] = [];
  private reloadPromise: Promise<void> | null = null;
  private lastLoadError: string | null = null;

  constructor(
    private readonly app: App,
    private readonly eventLog: EventLog,
    private readonly filesystem: ObsidianFilesystem,
    private readonly processService: CsvzallProcessService,
  ) {
    this.scheduler = new ChartRunScheduler({
      runner: (_inputPath: string, chartKeys: string[]) => this.runConfiguredCharts(chartKeys),
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
      const folders = this.app.vault.getAllLoadedFiles()
        .filter((file) => file instanceof TFolder)
        .map((folder) => folder.path);
      const configPaths = await findChartConfigPaths(this.app.vault.adapter, folders);
      const charts: ConfiguredChart[] = [];
      for (const configPath of configPaths) {
        const text = await this.app.vault.adapter.read(configPath);
        charts.push(...parseChartConfigText(text, configPath));
      }
      this.charts = charts;
      this.lastLoadError = null;
    } catch (error) {
      this.charts = [];
      const message = error instanceof Error ? error.message : String(error);
      if (this.lastLoadError === message) return;
      this.lastLoadError = message;
      new Notice(`csvzall failed to load chart config: ${message}`);
      await this.eventLog.record("error", "Failed to load chart config", message);
      console.error("csvzall failed to load chart config", error);
    }
  }

  scheduleChartsForCsv(path: string): void {
    const charts = matchingRunOnSaveCharts(this.charts, path);
    if (charts.length === 0) {
      return;
    }
    this.scheduler.schedule(path, charts.map((chart) => chartRunKey(chart)));
  }

  async runConfiguredCharts(chartKeys: string[]): Promise<void> {
    if (!Platform.isDesktopApp) {
      const message = "csvzall chart generation requires the Obsidian desktop app.";
      new Notice(message);
      await this.eventLog.record("error", message);
      return;
    }

    const vaultRoot = this.filesystem.getVaultRoot();
    if (!vaultRoot) {
      const message = "csvzall chart generation requires a local filesystem vault.";
      new Notice(message);
      await this.eventLog.record("error", message);
      return;
    }

    const keys = Array.from(new Set(chartKeys)).filter(Boolean).sort();
    if (keys.length === 0) {
      new Notice("No csvzall charts are configured.");
      return;
    }

    let failures = 0;
    for (const key of keys) {
      const chart = this.charts.find((candidate) => chartRunKey(candidate) === key);
      if (!chart) {
        failures += 1;
        await this.eventLog.record("error", "Failed to regenerate chart", `Chart config entry not found: ${key}`);
        continue;
      }
      try {
        await this.processService.runCommand(
          ["charts", "run", chart.id, "--config", chart.configPath],
          vaultRoot,
          `chart ${chart.id}`,
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
    new Notice(keys.length === 1 ? "csvzall chart regenerated." : `csvzall regenerated ${keys.length} charts.`);
  }
}

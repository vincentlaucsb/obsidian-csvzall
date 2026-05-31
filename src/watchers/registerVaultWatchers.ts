import { TFile, type Plugin } from "obsidian";
import type { ChartService } from "../charts/ChartService.js";
import type { CsvService } from "../csv/CsvService.js";
import { normalizeVaultPath } from "../chartAutomation.js";

export function registerVaultWatchers(plugin: Plugin, charts: ChartService, csv: CsvService): void {
  plugin.registerEvent(
    plugin.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile)) {
        return;
      }
      const path = normalizeVaultPath(file.path);
      if (charts.isChartConfigPath(path)) {
        void charts.reloadChartConfig();
        return;
      }
      if (!csv.isCsv(file)) {
        return;
      }
      void charts.reloadChartConfig().then(() => charts.scheduleChartsForCsv(file.path));
    }),
  );
}

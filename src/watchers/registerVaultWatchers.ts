import { TFile, type Plugin } from "obsidian";
import type { ChartService } from "../charts/ChartService.js";
import type { CsvService } from "../csv/CsvService.js";
import { normalizeVaultPath } from "../chartAutomation.js";

export function registerVaultWatchers(plugin: Plugin, charts: ChartService, csv: CsvService): void {
  let active = true;
  plugin.register(() => { active = false; });
  // Vault events exclude hidden folders. Poll for chart configuration edits,
  // creations and deletions; CSV saves also refresh immediately below.
  plugin.registerInterval(window.setInterval(() => void charts.reloadChartConfig(), 10000));
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
      void charts.reloadChartConfig().then(() => {
        if (active) charts.scheduleChartsForCsv(file.path);
      });
    }),
  );
}

import type { Plugin } from "obsidian";
import type { ChartService } from "../charts/ChartService.js";
import type { CsvService } from "../csv/CsvService.js";
import { chartRunKey } from "../chartAutomation.js";

export function registerChartCommands(plugin: Plugin, charts: ChartService, csv: CsvService): void {
  plugin.addCommand({
    id: "regenerate-charts",
    name: "Regenerate charts",
    callback: () => void charts.runConfiguredCharts(charts.allChartKeys()),
  });

  plugin.addCommand({
    id: "regenerate-charts-for-current-csv",
    name: "Regenerate charts for current CSV",
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file || !csv.isCsv(file)) {
        return false;
      }
      const outputCharts = charts.outputChartsForCsv(file.path);
      if (outputCharts.length === 0) {
        return false;
      }
      if (!checking) {
        void charts.runConfiguredCharts(outputCharts.map((chart) => chartRunKey(chart)));
      }
      return true;
    },
  });

  plugin.addCommand({
    id: "open-generated-chart",
    name: "Open generated chart",
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file || !csv.isCsv(file)) {
        return false;
      }
      const [chart] = charts.outputChartsForCsv(file.path);
      if (!chart?.output) {
        return false;
      }
      if (!checking) {
        void plugin.app.workspace.openLinkText(chart.output, "", false);
      }
      return true;
    },
  });
}

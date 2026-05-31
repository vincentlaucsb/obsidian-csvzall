import { TFile, TFolder, type Plugin } from "obsidian";
import type { CsvService } from "../csv/CsvService.js";

export function registerCsvCommands(plugin: Plugin, csv: CsvService): void {
  plugin.addCommand({
    id: "open-active-csv",
    name: "Open active CSV with csvzall",
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file || !csv.isCsv(file)) {
        return false;
      }
      if (!checking) {
        void csv.openCsv(file);
      }
      return true;
    },
  });

  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof TFolder) {
        menu.addItem((item) => {
          item
            .setTitle("New CSV")
            .setIcon("table")
            .onClick(() => void csv.createCsvInFolder(file));
        });
        return;
      }

      if (!(file instanceof TFile) || !csv.isCsv(file)) {
        return;
      }

      menu.addItem((item) => {
        item
          .setTitle("Open with csvzall")
          .setIcon("table")
          .onClick(() => void csv.openCsv(file));
      });
    }),
  );
}

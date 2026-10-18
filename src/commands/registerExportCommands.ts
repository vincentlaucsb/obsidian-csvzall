import { Notice, type Plugin } from "obsidian";
import { openExportsView } from "../views/ExportsView.js";

export function registerExportCommands(plugin: Plugin): void {
  plugin.addCommand({
    id: "open-exports",
    name: "Open exports",
    callback: () => {
      void openExportsView(plugin.app).catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error)));
    },
  });
}

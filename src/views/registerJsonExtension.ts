import { Notice, type Plugin, TFile } from "obsidian";

export function registerJsonExtension(plugin: Plugin, type: string, useAsDefault: boolean): void {
  plugin.registerEvent(plugin.app.workspace.on("file-menu", (menu, file) => {
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "json") return;
    menu.addItem(item => item.setTitle("Open in csvzall").setIcon("braces").onClick(async () => {
      try {
        await plugin.app.workspace.getLeaf(true).setViewState({ type, state: { file: file.path }, active: true });
      } catch (openError) {
        new Notice(`Could not open JSON: ${openError instanceof Error ? openError.message : String(openError)}`);
      }
    }));
  }));
  if (!useAsDefault) return;
  try {
    plugin.registerExtensions(["json"], type);
  } catch (error) {
    // Obsidian permits only one default handler. Keep JSON reachable when
    // another plugin already owns the extension.
    console.warn("csvzall could not register the default JSON view", error);
  }
}

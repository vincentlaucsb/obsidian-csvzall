import { PluginSettingTab, Setting } from "obsidian";
import { autosaveSetting } from "../src/settings/autosave.js";
import { jsonViewerSetting } from "../src/settings/jsonViewer.js";
import type CsvzallMobilePlugin from "./main.js";

export class LiteSettingsTab extends PluginSettingTab {
  constructor(private readonly owner: CsvzallMobilePlugin) {
    super(owner.app, owner);
  }

  display(): void {
    this.containerEl.empty();
    const { settings } = this.owner;
    for (const definition of [
      autosaveSetting(settings.autosaveMode, mode => this.owner.saveSettings({ autosaveMode: mode })),
      jsonViewerSetting(settings.defaultJsonViewer, enabled => this.owner.saveSettings({ defaultJsonViewer: enabled })),
    ]) {
      definition.render(new Setting(this.containerEl).setName(definition.name).setDesc(definition.desc));
    }
  }
}

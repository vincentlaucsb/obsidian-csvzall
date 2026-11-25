import { PluginSettingTab, Setting } from "obsidian";
import { autosaveSetting, type AutosaveMode } from "../src/settings/autosave.js";
import type CsvzallMobilePlugin from "./main.js";

export class AutosaveSettingsTab extends PluginSettingTab {
  constructor(private readonly owner: CsvzallMobilePlugin, private readonly change: (mode: AutosaveMode) => Promise<void>) {
    super(owner.app, owner);
  }

  display(): void {
    this.containerEl.empty();
    const definition = autosaveSetting(this.owner.settings.autosaveMode, this.change);
    definition.render(new Setting(this.containerEl).setName(definition.name).setDesc(definition.desc));
  }
}

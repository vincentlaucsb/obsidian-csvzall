import type { Setting } from "obsidian";

export type AutosaveMode = "on" | "off" | "hidden";

export function autosaveMode(value: unknown): AutosaveMode {
  return value === "on" || value === "hidden" ? value : "off";
}

export function autosaveSetting(mode: AutosaveMode, change: (mode: AutosaveMode) => Promise<void>) {
  return {
    name: "AutoSave",
    desc: "Choose how AutoSave starts in CSV, TSV, and JSON panes. Hiding the switch keeps AutoSave off.",
    render(setting: Setting): void {
      setting.addDropdown(dropdown => dropdown.addOptions({
        off: "Off by default", on: "On by default", hidden: "Hide switch",
      }).setValue(mode).onChange(value => change(autosaveMode(value))));
    },
  };
}

import type { Setting } from "obsidian";

export function defaultJsonViewer(value: unknown): boolean {
  return value !== false;
}

export function jsonViewerSetting(enabled: boolean, change: (enabled: boolean) => Promise<void>) {
  return {
    name: "Use csvzall as the default JSON viewer",
    desc: "Reload Obsidian to apply. Choose “Open in csvzall” from a JSON file’s menu at any time. If JSON files disappear from the file explorer, enable “Show all file types” under Files and links.",
    render(setting: Setting): void {
      setting.addToggle(toggle => toggle.setValue(enabled).onChange(change));
    },
  };
}

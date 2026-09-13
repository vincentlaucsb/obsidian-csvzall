import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { DEFAULT_SETTINGS } from "../src/settings/settings.js";

class Element {
  children: Element[] = [];
  constructor(public options: { text?: string; cls?: string } = {}) {}
  empty() { this.children = []; }
  createDiv(options = {}) { const child = new Element(options); this.children.push(child); return child; }
  createSpan(options = {}) { return this.createDiv(options); }
  createEl(_tag: string, options = {}) { return this.createDiv(options); }
}
class Control {
  value: unknown;
  disabled = false;
  label = "";
  change: (value: any) => Promise<void> = async () => {};
  click: () => Promise<void> = async () => {};
  setValue(value: unknown) { this.value = value; return this; }
  setPlaceholder(_value: string) { return this; }
  setButtonText(value: string) { this.label = value; return this; }
  setDisabled(value: boolean) { this.disabled = value; return this; }
  onChange(callback: typeof this.change) { this.change = callback; return this; }
  onClick(callback: typeof this.click) { this.click = callback; return this; }
}
class Row extends Element {
  name = "";
  descEl = new Element();
  control?: Control;
  constructor(parent: Element) { super(); parent.children.push(this); }
  setName(value: string) { this.name = value; return this; }
  setDesc(_value: unknown) { return this; }
  setHeading() { return this; }
  addText(callback: (control: Control) => void) { this.control = new Control(); callback(this.control); return this; }
  addToggle(callback: (control: Control) => void) { return this.addText(callback); }
  addButton(callback: (control: Control) => void) { return this.addText(callback); }
}

async function loadTab(modern: boolean) {
  class BaseTab { containerEl = new Element(); updates = 0; }
  if (modern) Object.assign(BaseTab.prototype, {
    update(this: any) {
      this.updates++;
      this.containerEl.empty();
      for (const definition of this.getSettingDefinitions()) {
        const row = new Row(this.containerEl).setName(definition.name).setDesc(definition.desc);
        definition.render(row, {});
      }
    },
  });
  const result = await build({ entryPoints: ["src/settings/SettingsTab.ts"], bundle: true,
    platform: "node", format: "cjs", write: false, external: ["obsidian"] });
  const module = { exports: {} as any };
  runInNewContext(result.outputFiles[0]!.text, { module, exports: module.exports,
    require: () => ({ PluginSettingTab: BaseTab, Setting: Row, Platform: { isDesktopApp: true } }),
    window: { open() {} },
  });
  return module.exports.CsvzallSettingTab;
}

for (const modern of [false, true]) {
  test(`settings ${modern ? "declarative" : "legacy"} UI persists controls and refreshes install/log actions`, async () => {
    const Tab = await loadTab(modern);
    const settings = { ...DEFAULT_SETTINGS, eventLog: [{ level: "error" as const,
      timestamp: "2026-09-13T00:00:00Z", message: "Failed", detail: "Details" }],
      installedCsvzallVersion: "1.0", installedCsvzallAssetName: "binary.zip", csvzallLastUpdateCheckAt: "today" };
    let saves = 0;
    let installs = 0;
    let rejectInstall = false;
    let finishInstall: () => void = () => {};
    const tab = new Tab({ app: {} }, {
      getSettings: () => settings,
      saveSettings: async () => { saves++; },
      eventLog: { clear: async () => { settings.eventLog = []; } },
      installer: { installDesktopCsvzall: async () => {
        installs++;
        await new Promise<void>(resolve => { finishInstall = resolve; });
        if (rejectInstall) throw new Error("download failed");
        settings.installedCsvzallVersion = "2.0";
      } },
    });
    const definitions = tab.getSettingDefinitions();
    assert.equal(tab.containerEl.children.length, 0, "indexing must not render or perform actions");
    assert.equal(installs + saves, 0);
    assert.deepEqual(Array.from(definitions, (d: any) => d.name), ["csvzall path", "csvzall updates", "Open inside Obsidian", "Startup timeout", "Report a bug", "Log", "Chart and error log"]);
    if (modern) { tab.display = () => { throw new Error("legacy display must be skipped"); }; tab.update(); }
    else tab.display();
    const row = (name: string): Row => tab.containerEl.children.find((r: Row) => r.name === name);
    assert.equal(tab.containerEl.children.length, 7);
    assert.equal(row("csvzall path").control!.value, settings.csvzallPath);
    await row("csvzall path").control!.change('"C:/csvzall.exe"');
    assert.equal(settings.csvzallPath, "C:/csvzall.exe");
    assert.equal(settings.installedCsvzallVersion + settings.installedCsvzallAssetName + settings.csvzallLastUpdateCheckAt, "");
    await row("Open inside Obsidian").control!.change(false);
    assert.equal(settings.openInObsidian, false);
    await row("Startup timeout").control!.change("3000");
    assert.equal(settings.startupTimeoutMs, 3000);
    await row("Startup timeout").control!.change("invalid");
    assert.equal(settings.startupTimeoutMs, DEFAULT_SETTINGS.startupTimeoutMs);
    assert.equal(saves, 4);
    const pending = row("csvzall updates").control!.click();
    assert.equal(row("Install csvzall").control!.disabled, true);
    finishInstall(); await pending;
    assert.equal(row("csvzall updates").control!.disabled, false);
    assert.equal(row("csvzall updates").control!.label, "Check for updates");
    rejectInstall = true;
    const failed = row("csvzall updates").control!.click();
    finishInstall(); await assert.rejects(failed, /download failed/);
    assert.equal(row("csvzall updates").control!.disabled, false);
    assert.equal(row("Chart and error log").descEl.children[0]!.children.length, 1);
    await row("Chart and error log").control!.click();
    assert.equal(row("Chart and error log").control!.disabled, true);
    assert.equal(row("Chart and error log").descEl.children[0]!.children[0]!.options.text, "No csvzall events yet.");
    assert.equal(tab.containerEl.children.length, 7, "refresh must not duplicate rows");
    assert.equal(modern ? tab.updates > 1 : tab.updates === 0, true);
  });
}

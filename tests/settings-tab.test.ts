import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { DEFAULT_SETTINGS } from "../src/settings/settings.js";

class Element {
  children: Element[] = [];
  parent?: Element;
  constructor(public options: { text?: string; cls?: string } = {}) {}
  empty() { this.children = []; }
  createDiv(options = {}) { const child = new Element(options); child.parent = this; this.children.push(child); return child; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  setText(text: string) { this.options.text = text; }
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
  setWarning() { return this; }
  setDisabled(value: boolean) { this.disabled = value; return this; }
  onChange(callback: typeof this.change) { this.change = callback; return this; }
  onClick(callback: typeof this.click) { this.click = callback; return this; }
}
class Row extends Element {
  name = "";
  descEl = new Element();
  control?: Control;
  controls: Control[] = [];
  settingEl = this;
  description: unknown;
  constructor(parent: Element) { super(); parent.children.push(this); }
  setName(value: string) { this.name = value; return this; }
  setDesc(value: unknown) { this.description = value; return this; }
  setHeading() { return this; }
  addText(callback: (control: Control) => void) { this.control = new Control(); this.controls.push(this.control); callback(this.control); return this; }
  addToggle(callback: (control: Control) => void) { return this.addText(callback); }
  addButton(callback: (control: Control) => void) { return this.addText(callback); }
}

async function loadTab() {
  class BaseTab { containerEl = new Element(); updates = 0;  }
  Object.assign(BaseTab.prototype, {
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

test("declarative settings persist controls and refresh install/log actions", async () => {
    const Tab = await loadTab();
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
      exports: { list: async () => [] },
      installer: { installDesktopCsvzall: async () => {
        installs++;
        await new Promise<void>(resolve => { finishInstall = resolve; });
        if (rejectInstall) throw new Error("extraction failed");
        settings.installedCsvzallVersion = "2.0";
        settings.csvzallExecutableMode = "bundled";
      } },
    });
    const definitions = tab.getSettingDefinitions();
    assert.equal(tab.containerEl.children.length, 0, "indexing must not render or perform actions");
    assert.equal(installs + saves, 0);
    assert.deepEqual(Array.from(definitions, (d: any) => d.name), ["Custom executable path", "Bundled helper", "Open inside Obsidian", "Startup timeout", "Report a bug", "Active exports", "Files with exports", "Log", "Chart and error log"]);
    tab.update();
    const row = (name: string): Row => tab.containerEl.children.find((r: Row) => r.name === name);
    assert.equal(tab.containerEl.children.length, 9);
    assert.equal(row("Custom executable path").control!.value, "");
    await row("Custom executable path").control!.change('"C:/csvzall.exe"');
    assert.equal(settings.csvzallPath, "C:/csvzall.exe");
    assert.equal(settings.csvzallExecutableMode, "custom");
    assert.equal(settings.installedCsvzallVersion + settings.installedCsvzallAssetName + settings.csvzallLastUpdateCheckAt, "");
    await row("Open inside Obsidian").control!.change(false);
    assert.equal(settings.openInObsidian, false);
    await row("Startup timeout").control!.change("3000");
    assert.equal(settings.startupTimeoutMs, 3000);
    await row("Startup timeout").control!.change("invalid");
    assert.equal(settings.startupTimeoutMs, DEFAULT_SETTINGS.startupTimeoutMs);
    assert.equal(saves, 4);
    const pending = row("Bundled helper").control!.click();
    assert.equal(row("Bundled helper").control!.disabled, true);
    finishInstall(); await pending;
    assert.equal(row("Bundled helper").control!.disabled, false);
    assert.equal(row("Bundled helper").control!.label, "Use bundled helper");
    rejectInstall = true;
    const failed = row("Bundled helper").control!.click();
    finishInstall(); await assert.rejects(failed, /extraction failed/);
    assert.equal(row("Bundled helper").control!.disabled, false);
    assert.equal(row("Chart and error log").descEl.children[0]!.children.length, 1);
    await row("Chart and error log").control!.click();
    assert.equal(row("Chart and error log").control!.disabled, true);
    assert.equal(row("Chart and error log").descEl.children[0]!.children[0]!.options.text, "No csvzall events yet.");
    assert.equal(tab.containerEl.children.length, 9, "refresh must not duplicate rows");
    assert.ok(tab.updates > 1);
});

test('active exports load only during rendering and route both file actions', async () => {
  const Tab = await loadTab();
  const file = { source: 'Data/tasks.csv', missing: false, entries: [{ kind: 'chart', chart: { definition: { type: 'bar' } } }, { kind: 'table' }] };
  const missing = { ...file, source: 'missing.csv', missing: true };
  let reads = 0, configured: unknown, deleted: unknown;
  const tab = new Tab({ app: {} }, {
    getSettings: () => DEFAULT_SETTINGS, installer: {}, eventLog: {},
    exports: { list: async () => { reads++; return [file, missing]; },
      configure: (value: unknown) => { configured = value; }, confirmDelete: (value: unknown) => { deleted = value; } },
  });
  tab.getSettingDefinitions(); assert.equal(reads, 0);
  tab.update(); await Promise.resolve();
  const container = tab.containerEl.children.find((row: Row) => row.name === 'Files with exports').children[0];
  const rows = container.children as Row[];
  assert.equal(rows[0]!.name, file.source);
  assert.equal(rows[0]!.description, '1 chart, 1 table or value export');
  assert.deepEqual(rows[0]!.controls.map(button => button.label), ['Configure', 'Delete']);
  await rows[0]!.controls[0]!.click(); await rows[0]!.controls[1]!.click();
  assert.equal(configured, file); assert.equal(deleted, file);
  assert.equal(rows[1]!.controls[0]!.disabled, true);
  assert.equal(rows[1]!.controls[1]!.disabled, false);
});

test('stale export listings cannot overwrite a refreshed or closed settings tab', async () => {
  const Tab = await loadTab();
  const finish: Array<(files: unknown[]) => void> = [];
  const tab = new Tab({ app: {} }, { getSettings: () => DEFAULT_SETTINGS,
    exports: { list: () => new Promise(resolve => finish.push(resolve)) } });
  tab.update(); const first = tab.containerEl.children;
  tab.update(); tab.hide();
  finish[0]!([]); finish[1]!([]); await Promise.resolve();
  assert.equal(first[6].children[0].children[0].options.text, 'Loading exports...');
});

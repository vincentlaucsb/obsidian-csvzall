import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";

// Keep the real plugin entry point and isolate the shared viewer/asset boundaries.
const compiled = buildSync({
  entryPoints: ["mobile-src/main.ts"], bundle: true, write: false,
  platform: "browser", format: "cjs",
  external: ["obsidian", "./WasmViewerSession.js", "../src/views/CsvzallTableView.js"],
}).outputFiles[0].text;

function fixture(isMobileApp, jsonClaimed = false) {
  const views = [], extensions = [], commands = [], menus = [], notices = [], opened = [], writes = [];
  let releases = 0, activeFile = null;
  class TFile {
    constructor(path) { this.path = path; this.name = path.split("/").at(-1); this.basename = this.name.replace(/\.[^.]+$/, ""); this.extension = this.name.split(".").at(-1); }
  }
  class TFolder { constructor(path) { this.path = path; } }
  class TableView {
    showWasmViewer(...args) { this.shown = args; }
    showError(message) { this.error = message; }
  }
  const leaf = { view: new TableView(), async setViewState(state) { opened.push(state); } };
  class Plugin {
    async loadData() { return this.data ?? null; }
    async saveData(value) { this.data = value; }
    addSettingTab(tab) { this.tab = tab; }
    registerView(...args) { views.push(args); }
    registerExtensions(...args) {
      extensions.push(args);
      if (jsonClaimed && args[0].includes("json")) throw new Error("JSON already registered");
    }
    addRibbonIcon() {}
    addCommand(command) { commands.push(command); }
    registerEvent() {}
  }
  const module = { exports: {} };
  runInNewContext(compiled, { module, exports: module.exports, console, require(name) {
    if (name === "obsidian") return { Plugin, TFile, TFolder, PluginSettingTab: class {}, FileView: class {}, Platform: { isMobileApp }, Notice: class { constructor(message) { notices.push(message); } } };
    if (name.endsWith("CsvzallTableView.js")) return { CsvzallTableView: TableView, updateViewerAutosave() {} };
    if (name.endsWith("WasmViewerSession.js")) return {
      embeddedWasmViewerUrl() { return "resource://bundled-viewer/index.html"; },
      releaseEmbeddedWasmViewer() { releases++; },
    };
    throw new Error(`Unexpected runtime dependency: ${name}`);
  } });
  const plugin = new module.exports.default();
  plugin.manifest = { id: "csvzall-mobile" };
  plugin.app = {
    vault: {
      getAbstractFileByPath(path) { return path.endsWith("Untitled.csv") ? new TFile(path) : null; },
      async create(path, text) { writes.push({ path, text }); return new TFile(path); },
    },
    workspace: {
      getLeaf() { return leaf; }, getActiveFile() { return activeFile; },
      setActiveLeaf() {}, on(event, callback) { menus.push(callback); return {}; },
    },
  };
  return { plugin, views, extensions, commands, menus, notices, opened, writes, leaf, TFile,
    releases: () => releases, setFile: file => { activeFile = file; } };
}

for (const mobile of [false, true]) test(`bundled plugin registers and opens the WASM viewer on ${mobile ? "mobile" : "desktop"}`, async () => {
  const f = fixture(mobile);
  await f.plugin.onload();
  assert.equal(f.views[0][0], "csvzall-mobile-view");
  assert.deepEqual(Array.from(f.extensions[0][0]), ["csv", "tsv"]);
  assert.equal(f.extensions[0][1], "csvzall-mobile-view");
  assert.deepEqual(Array.from(f.extensions[1][0]), ["json"]);
  assert.equal(f.extensions[1][1], "csvzall-mobile-json");
  assert.equal(f.commands.length, 2);
  assert.equal(f.menus.length, 2);
  const file = new f.TFile("Tasks.csv");
  await f.plugin.openCsvInLeaf(file, f.leaf);
  assert.equal(f.leaf.view.shown[1], "resource://bundled-viewer/index.html");
  assert.equal(f.leaf.view.shown[2], file);
  f.setFile(file);
  const command = f.commands.find(item => item.id === "open-active-csv");
  assert.equal(command.checkCallback(true), true);
  command.checkCallback(false);
  assert.equal(f.opened[0].type, "csvzall-mobile-view");
  assert.equal(f.opened[0].state.file, "Tasks.csv");
  f.plugin.onunload();
  assert.equal(f.releases(), 1);
});

test("Lite loads and saves all three AutoSave modes and retains unrelated plugin data", async () => {
  const f = fixture(true);
  f.plugin.data = { custom: 42, autosaveMode: "old-value" };
  await f.plugin.onload();
  assert.equal(f.plugin.settings.autosaveMode, "off");
  for (const mode of ["hidden", "on", "off"]) {
    await f.plugin.saveSettings({ autosaveMode: mode });
    assert.equal(f.plugin.settings.autosaveMode, mode);
    assert.equal(f.plugin.data.autosaveMode, mode);
    assert.equal(f.plugin.data.custom, 42);
  }
});

function fileMenu(f, file) {
  const items = [];
  for (const listener of f.menus) listener({ addItem(build) {
    const item = { setTitle(title) { this.title = title; return this; }, setIcon() { return this; },
      onClick(click) { this.click = click; return this; } };
    build(item); items.push(item);
  } }, file);
  return items;
}

test("Lite keeps Open in csvzall available with JSON enabled, disabled, or already claimed", async () => {
  for (const [enabled, claimed] of [[true, false], [false, false], [false, true], [true, true]]) {
    const f = fixture(true, claimed);
    f.plugin.data = { defaultJsonViewer: enabled, custom: 42 };
    await f.plugin.onload();
    assert.equal(f.extensions.some(([extensions]) => extensions.includes("json")), enabled);
    assert.equal(f.plugin.settings.defaultJsonViewer, enabled);
    const items = fileMenu(f, new f.TFile("notes/Config.JSON"));
    assert.deepEqual(items.map(item => item.title), ["Open in csvzall"]);
    await items[0].click();
    assert.equal(f.opened[0].type, "csvzall-mobile-json");
    assert.equal(f.opened[0].state.file, "notes/Config.JSON");
    assert.deepEqual(fileMenu(f, new f.TFile("Config.md")), []);
    await f.plugin.saveSettings({ defaultJsonViewer: !enabled });
    await f.plugin.saveSettings({ autosaveMode: "on" });
    assert.equal(f.plugin.data.defaultJsonViewer, !enabled);
    assert.equal(f.plugin.data.custom, 42);
  }
});

test("desktop New CSV keeps its folder, avoids filename collisions, and opens the bundled view", async () => {
  const f = fixture(false);
  await f.plugin.onload();
  f.setFile(new f.TFile("Projects/Tasks.csv"));
  await f.plugin.createCsvInActiveFolder();
  assert.deepEqual(f.writes, [{ path: "Projects/Untitled 1.csv", text: "column\n" }]);
  assert.equal(f.opened[0].type, "csvzall-mobile-view");
  assert.equal(f.opened[0].state.file, "Projects/Untitled 1.csv");
});

test("TSV files use the same command and context menu on desktop and mobile", async () => {
  for (const mobile of [false, true]) {
    const f = fixture(mobile);
    await f.plugin.onload();
    const command = f.commands.find(item => item.id === "open-active-csv");
    for (const extension of ["tsv", "TSV", "csv"]) {
      f.setFile(new f.TFile(`Tasks.${extension}`));
      assert.equal(command.checkCallback(true), true);
      command.checkCallback(false);
      assert.equal(f.opened.at(-1).state.file, `Tasks.${extension}`);
      assert.equal(fileMenu(f, { extension }).length, 0, "non-TFile values remain excluded");
      assert.equal(fileMenu(f, new f.TFile(`Tasks.${extension}`)).length, 1);
    }
    f.setFile(new f.TFile("Note.md"));
    assert.equal(command.checkCallback(true), false);
  }
});

test("the bundled viewer loads when the plugin filesystem is unavailable", async () => {
  const f = fixture(false);
  Object.defineProperty(f.plugin.app.vault, "adapter", { get() { throw new Error("Plugin filesystem is unavailable"); } });
  await f.plugin.onload();
  await f.plugin.openCsvInLeaf(new f.TFile("Tasks.csv"), f.leaf);
  assert.equal(f.views.length, 2);
  assert.equal(f.leaf.view.error, undefined);
  assert.equal(f.leaf.view.shown[1], "resource://bundled-viewer/index.html");
});

test("opening a Lite CSV removed after command selection shows a notice", async () => {
  const f = fixture(true);
  await f.plugin.onload();
  f.setFile(new f.TFile("Tasks.csv"));
  f.leaf.setViewState = async () => { throw Object.assign(new Error("CSV disappeared"), { code: "ENOENT" }); };
  f.commands.find(command => command.id === "open-active-csv").checkCallback(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(f.notices[0], /failed to open CSV:.*CSV disappeared/);
});

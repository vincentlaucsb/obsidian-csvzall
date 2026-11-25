import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";

const nodeRequire = createRequire(import.meta.url);
class Folder {
  children: Array<Folder | File> = [];
  constructor(public path: string) {}
}
class File {
  extension = "md";
  stat = { mtime: 1, size: 12 };
  constructor(public path: string) {}
}

async function startup(noteCount: number, disappearingPaths = false) {
  const root = new Folder("");
  for (let i = 0; i < noteCount; i++) {
    const folder = new Folder(`notes-${i}`);
    folder.children.push(new File(`${folder.path}/note.md`));
    root.children.push(folder);
  }
  const entries = new Map<string, Folder | File>([["", root]]);
  for (const folder of root.children) {
    entries.set(folder.path, folder);
    if (folder instanceof Folder) for (const file of folder.children) entries.set(file.path, file);
  }
  const files = new Map<string, string>();
  const timers = new Map<number, () => unknown>();
  const intervals = new Map<number, () => unknown>();
  let timerId = 0, noteReads = 0, globalScans = 0, adapterCalls = 0;
  let disk: unknown = null;
  let saveUnavailable = disappearingPaths;
  const journal = ".obsidian/plugins/csvzall/export-sync-local/state.json";
  const missing = () => Object.assign(new Error("Path disappeared"), { code: "ENOENT" });
  const notices: string[] = [];
  const local = new Map<string, unknown>();
  const adapter = {
    exists: async (path: string) => { adapterCalls++; return files.has(path) || disappearingPaths && path === journal; },
    read: async (path: string) => {
      adapterCalls++;
      if (disappearingPaths && path === journal && !files.has(path)) throw missing();
      assert.ok(files.has(path), `missing ${path}`);
      return files.get(path)!;
    },
    write: async (path: string, text: string) => { files.set(path, text); },
    mkdir: async (_path: string) => {},
    rename: async (from: string, to: string) => { files.set(to, files.get(from)!); files.delete(from); },
    remove: async (path: string) => { files.delete(path); },
    process: async (path: string, change: (text: string) => string) => { files.set(path, change(files.get(path)!)); },
    list: async (_path: string) => { adapterCalls++; return { files: [], folders: [] }; },
    stat: async (path: string) => files.has(path) || disappearingPaths && path === journal
      ? { mtime: 1, size: files.get(path)?.length ?? 0, type: "file" } : null,
  };
  const app = {
    loadLocalStorage: (key: string) => local.get(key),
    saveLocalStorage: (key: string, value: unknown) => { local.set(key, value); },
    vault: {
      configDir: ".obsidian", adapter,
      getRoot: () => root,
      getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
      getAllLoadedFiles: () => { globalScans++; throw new Error("startup must not enumerate the vault"); },
      getMarkdownFiles: () => { globalScans++; throw new Error("startup must not enumerate notes"); },
      read: async (_file: File) => { noteReads++; return "Plain note.\n"; },
      cachedRead: async (_file: File) => { noteReads++; return "Plain note.\n"; },
      on: () => ({}),
    },
    workspace: { on: () => ({}), onLayoutReady: (callback: () => void) => callback(),
      getLeavesOfType: () => [], getActiveFile: () => null },
    metadataCache: { on: () => ({}), getFileCache: () => null },
  };
  class Plugin {
    app = app;
    manifest = { id: "csvzall", dir: ".obsidian/plugins/csvzall" };
    commands: unknown[] = [];
    views: string[] = [];
    cleanup: Array<() => void> = [];
    // Obsidian can suppress a write error and return null on the following read.
    async loadData() { return disk; }
    async saveData(value: unknown) { if (!saveUnavailable) disk = structuredClone(value); }
    register(callback: () => void) { this.cleanup.push(callback); }
    registerEvent(_event: unknown) {}
    registerInterval(_id: number) {}
    registerExtensions(_extensions: string[], _view: string) {}
    registerView(view: string, _factory: unknown) { this.views.push(view); }
    addSettingTab(_tab: unknown) {}
    addCommand(command: unknown) { this.commands.push(command); }
  }
  const result = await build({ entryPoints: ["src/main.ts"], bundle: true, platform: "node", format: "cjs", write: false,
    external: ["obsidian", "electron"], plugins: [{ name: "native-install-boundary", setup(builder) {
      builder.onResolve({ filter: /installer\/InstallerService\.js$/ }, () => ({ path: "native-installer", external: true }));
      builder.onResolve({ filter: /bundledPayloads\.generated\.js$/ }, () => ({ path: "payload-metadata", external: true }));
    } }] });
  const module = { exports: {} as any };
  const primitive = class {};
  runInNewContext(result.outputFiles[0]!.text, {
    module, exports: module.exports, console, crypto: webcrypto, AbortController, URL, Buffer, setTimeout, clearTimeout,
    window: {
      setTimeout: (callback: () => unknown) => { const id = ++timerId; timers.set(id, callback); return id; },
      clearTimeout: (id: number) => timers.delete(id),
      setInterval: (callback: () => unknown) => { const id = ++timerId; intervals.set(id, callback); return id; },
      clearInterval: (id: number) => intervals.delete(id),
    },
    require(name: string) {
      if (name === "obsidian") return { Plugin, TFile: File, TFolder: Folder, PluginSettingTab: primitive,
        ItemView: primitive, TextFileView: primitive, FileView: primitive, MarkdownView: primitive,
        Modal: primitive, SuggestModal: primitive, FuzzySuggestModal: primitive, FileSystemAdapter: primitive,
        Platform: { isDesktopApp: true }, Notice: class { constructor(message: string) { notices.push(message); } } };
      if (name === "native-installer") return { InstallerService: class { async ensureBundledCsvzall() { return true; } } };
      if (name === "payload-metadata") return { BUNDLED_CSVZALL_VERSION: "test" };
      return nodeRequire(name);
    },
  });
  const plugin = new module.exports.default();
  await plugin.onload();
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
  return { plugin, timers, intervals, notices, settle, restorePluginData: () => { saveUnavailable = false; }, get noteReads() { return noteReads; },
    get globalScans() { return globalScans; }, get adapterCalls() { return adapterCalls; }, get disk() { return disk; } };
}

test("desktop registers its CSV view when plugin data and the optional journal disappear during startup", async () => {
  const run = await startup(0, true);
  try {
    assert.ok(run.plugin.views.includes("csvzall-view"));
    assert.equal(run.globalScans, 0);
    assert.equal(run.disk, null);
    run.restorePluginData();
    await run.plugin.saveSettings();
    assert.deepEqual(JSON.parse(JSON.stringify(run.disk)), {});
  } finally { run.plugin.onunload(); for (const cleanup of run.plugin.cleanup) cleanup(); }
});

for (const noteCount of [0, 120]) {
  test(`actual plugin onload completes first install with ${noteCount} ordinary notes and no CSV`, async () => {
    const run = await startup(noteCount);
    try {
      assert.equal(run.globalScans, 0);
      assert.equal(run.noteReads, 0, "foreground startup does not read notes");
      assert.deepEqual(JSON.parse(JSON.stringify(run.disk)), {});
      assert.ok(run.plugin.commands.length > 0);
      assert.ok(run.plugin.views.includes("csvzall-view"));
      let turns = 0;
      while (run.timers.size) {
        assert.ok(++turns < 200, "background discovery reaches idle");
        const [id, callback] = run.timers.entries().next().value!;
        run.timers.delete(id);
        const before = run.noteReads;
        await callback();
        await run.settle();
        assert.ok(run.noteReads - before <= 32, "background work yields between bounded note batches");
      }
      assert.equal(run.globalScans, 0);
      const completedReads = run.noteReads;
      assert.equal(completedReads, noteCount, "background discovery eventually indexes every ordinary note");
      for (let poll = 0; poll < 3; poll++) {
        const before = run.adapterCalls;
        for (const callback of run.intervals.values()) await callback();
        await run.settle();
        assert.ok(run.adapterCalls - before <= 160, "a poll probes only a bounded folder batch");
      }
      assert.equal(run.noteReads, completedReads, "unchanged polls reuse completed note discovery");
      assert.equal(run.globalScans, 0);
      assert.deepEqual(run.notices, []);
    } finally { run.plugin.onunload(); for (const cleanup of run.plugin.cleanup) cleanup(); }
  });
}

test("unloading immediately after first-install startup cancels deferred note discovery", async () => {
  const run = await startup(120);
  const callbacks = [...run.timers.values()];
  run.plugin.onunload();
  for (const cleanup of run.plugin.cleanup) cleanup();
  assert.equal(run.timers.size, 0);
  // A callback already delivered by the host must still honor service lifetime.
  for (const callback of callbacks) await callback();
  await run.settle();
  assert.equal(run.noteReads, 0);
  assert.equal(run.globalScans, 0);
  assert.deepEqual(run.notices, []);
});

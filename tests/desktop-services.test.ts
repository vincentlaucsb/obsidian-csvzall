import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { findChartConfigPaths } from "../src/charts/chartConfigFiles.js";

const nodeRequire = createRequire(import.meta.url);
class FakeFile { constructor(public path: string) {} }

class FakeView {
  file: unknown;
  displayed: string[] = [];
  showViewer(_title: string, url: string) { this.displayed.push(url); }
}

async function loadService(entry: string, spawn?: () => unknown, notices: string[] = []): Promise<any> {
  const result = await build({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false,
    external: ["obsidian", "child_process"],
    plugins: [{ name: "mock-view", setup(builder) {
      builder.onResolve({ filter: /views\/CsvzallTableView\.js$/ }, () => ({ path: "mock-view", external: true }));
    } }],
  });
  const module = { exports: {} };
  runInNewContext(result.outputFiles[0]!.text, {
    module, exports: module.exports, console, URL, setTimeout, clearTimeout,
    window: { setTimeout, clearTimeout, setInterval: () => 1 },
    require(name: string) {
      if (name === "obsidian") return { Notice: class { constructor(message: string) { notices.push(message); } }, TFile: FakeFile, TFolder: class {}, Platform: { isDesktopApp: true } };
      if (name === "mock-view") return { CsvzallTableView: FakeView };
      if (name === "child_process") return { spawn };
      return nodeRequire(name);
    },
  });
  return module.exports;
}

function childProcess() {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(), killed: false,
    kill() { this.killed = true; },
  });
}

test("an unavailable bundled helper prevents both commands and viewers from spawning", async () => {
  let spawns = 0;
  const { CsvzallProcessService } = await loadService("src/process/CsvzallProcessService.ts", () => { spawns++; return childProcess(); });
  const service = new CsvzallProcessService(() => ({ csvzallPath: "old-managed-helper" }), {},
    () => { throw new Error("bundled helper unavailable"); });
  await assert.rejects(service.captureCommand(["--version"], "."), /bundled helper unavailable/);
  await assert.rejects(service.startViewer("data.csv"), /bundled helper unavailable/);
  assert.equal(spawns, 0);
});

test("process failures reject with Error objects even for untyped event payloads", async () => {
  for (const command of [false, true]) {
    const child = childProcess();
    const { CsvzallProcessService } = await loadService("src/process/CsvzallProcessService.ts", () => child);
    const service = new CsvzallProcessService(
      () => ({ csvzallPath: "csvzall", startupTimeoutMs: 30000 }),
      { record: async () => {} },
    );
    const pending = command ? service.runCommand([], ".", "test") : service.startViewer("a.csv");
    child.emit("error", "untyped failure");
    await assert.rejects(pending, { name: "Error", message: "untyped failure" });
    service.unload();
  }
});

test("Obsidian startup accepts split acknowledgment and rejects truncated exits", async () => {
  for (const truncated of [false, true]) {
    const child = childProcess(); let started = false;
    const { CsvzallProcessService } = await loadService("src/process/CsvzallProcessService.ts", () => { started = true; return child; });
    const service = new CsvzallProcessService(() => ({ csvzallPath: "csvzall", startupTimeoutMs: 30000 }), {}, undefined, async () => {});
    service.captureCommand = async () => '--obsidian';
    const pending = service.startViewer("data.csv");
    while (!started) await Promise.resolve();
    child.stdout.emit("data", Buffer.from('{"url":"http://127.0.0.1:1234/?token=test",'));
    if (truncated) {
      child.emit("exit", 1, null); await assert.rejects(pending);
    } else {
      child.stdout.emit("data", Buffer.from('"obsidianMode":{"version":1,"chartAutomation":"host"}}\n'));
      assert.equal((await pending).url, "http://127.0.0.1:1234/?token=test");
    }
    service.unload();
  }
});

test("background failures stay suppressed but a manual retry has visible feedback", async () => {
  const notices: string[] = [];
  const { CsvzallProcessService } = await loadService("src/process/CsvzallProcessService.ts", undefined, notices);
  const service = new CsvzallProcessService(() => ({}), { record: async () => {} });
  service.captureCommand = async () => { throw new Error("Missing source"); };
  await assert.rejects(service.runCommand(["charts"], ".", "chart", true));
  await assert.rejects(service.runCommand(["charts"], ".", "chart", true));
  assert.equal(notices.length, 1);
  await assert.rejects(service.runCommand(["charts"], ".", "chart", false));
  assert.equal(notices.length, 2);
});

test("closing a leaf during capability probing prevents a later viewer spawn", async () => {
  let spawns = 0, finish: ((help: string) => void) | undefined;
  const { CsvzallProcessService } = await loadService("src/process/CsvzallProcessService.ts", () => { spawns++; return childProcess(); });
  const service = new CsvzallProcessService(() => ({ csvzallPath: "csvzall" }), {}, undefined, async () => {});
  service.captureCommand = () => new Promise<string>(resolve => { finish = resolve; });
  const leaf = {};
  const pending = service.startViewer("data.csv", leaf);
  while (!finish) await Promise.resolve();
  service.handleLeafClosed(leaf); finish("--obsidian");
  await assert.rejects(pending, /cancelled/);
  assert.equal(spawns, 0);
});

test("scope validation runs after command preflight and before any process spawn", async () => {
  let spawns = 0, blocked = false;
  const { CsvzallProcessService } = await loadService("src/process/CsvzallProcessService.ts", () => { spawns++; return childProcess(); });
  const service = new CsvzallProcessService(() => ({ csvzallPath: "csvzall" }), {}, undefined, async () => { blocked = true; });
  await assert.rejects(service.captureCommand([], ".", () => { if (blocked) throw new Error("Scope not ready"); }), /Scope not ready/);
  assert.equal(spawns, 0);
});

test("captured commands wait for stdout EOF and preserve split UTF-8 characters", async () => {
  const child = childProcess();
  const { CsvzallProcessService } = await loadService("src/process/CsvzallProcessService.ts", () => child);
  const service = new CsvzallProcessService(() => ({ csvzallPath: "csvzall" }), { record: async () => {} });
  const pending = service.captureCommand([], ".");
  const bytes = Buffer.from("Hello 😀\n");
  child.stdout.emit("data", bytes.subarray(0, 8));
  child.emit("exit", 0, null);
  child.stdout.emit("data", bytes.subarray(8));
  child.emit("close", 0, null);
  assert.equal(await pending, "Hello 😀\n");
  service.unload();
});

test("adapter discovery finds root and nested hidden configs from indexed folders", async () => {
  const configs = new Set([".csvzall/charts.json", "reports/.csvzall/charts.json"]);
  const adapter = { exists: async (path: string) => configs.has(path) };
  assert.deepEqual(await findChartConfigPaths(adapter, ["", "reports"]), [...configs]);
  configs.delete(".csvzall/charts.json");
  assert.deepEqual(await findChartConfigPaths(adapter, ["reports"]), ["reports/.csvzall/charts.json"]);
});

test("unload cancels pending viewer startups and ignores late ready output", async () => {
  const child = childProcess();
  const { CsvzallProcessService, ViewerStartupCancelledError } = await loadService("src/process/CsvzallProcessService.ts", () => child);
  const service = new CsvzallProcessService(() => ({ csvzallPath: "csvzall", startupTimeoutMs: 30000 }), {});
  const pending = service.startViewer("a.csv");
  service.unload();
  await assert.rejects(pending, ViewerStartupCancelledError);
  child.stdout.emit("data", Buffer.from('{"url":"http://127.0.0.1:1234/?token=secret"}\n'));
  assert.equal(child.killed, true);
  assert.equal(service.sessions.list().length, 0);
  await assert.rejects(service.startViewer("b.csv"), ViewerStartupCancelledError);
});

test("closing a leaf cancels its startup without cancelling another leaf", async () => {
  const children = [childProcess(), childProcess()];
  let next = 0;
  const { CsvzallProcessService, ViewerStartupCancelledError } = await loadService("src/process/CsvzallProcessService.ts", () => children[next++]!);
  const service = new CsvzallProcessService(() => ({ csvzallPath: "csvzall", startupTimeoutMs: 30000 }), {});
  const first = {};
  const pending = service.startViewer("a.csv", first);
  const other = service.startViewer("b.csv", {});
  service.handleLeafClosed(first);
  await assert.rejects(pending, ViewerStartupCancelledError);
  children[1]!.stdout.emit("data", Buffer.from('{"url":"http://127.0.0.1:1234/?token=secret"}\n'));
  const handle = await other;
  assert.equal(handle.stopping, false);
  assert.equal(children[0]!.killed, true);
  assert.equal(children[1]!.killed, false);
  service.unload();
});

test("a late startup cannot display an earlier CSV in a reused view", async () => {
  const { CsvService } = await loadService("src/csv/CsvService.ts");
  let ready!: (handle: unknown) => void;
  const view = new FakeView();
  const file = { path: "a.csv", basename: "a" };
  view.file = file;
  const leaf = { view };
  const child = childProcess();
  const handle = { process: child, stopping: false, url: "old" };
  let detached = false;
  const service = new CsvService({}, () => ({}), {}, { getFullPath: () => "a.csv" }, {
    startViewer: () => new Promise((resolve) => { ready = resolve; }),
    sessions: { detachHandle: () => { detached = true; } },
  });
  const pending = service.openCsvInLeaf(file, leaf);
  view.file = { path: "b.csv", basename: "b" };
  ready(handle);
  await pending;
  assert.deepEqual(view.displayed, []);
  assert.equal(child.killed, true);
  assert.equal(detached, true);
});

test("direct chart preparation cannot revive a closed or reused CSV pane", async () => {
  for (const reused of [false, true]) {
    const { CsvService } = await loadService("src/csv/CsvService.ts");
    const view = new FakeView(), file = { path: "A/data.csv", basename: "data" }, leaf = { view };
    view.file = file;
    let complete!: () => void, generation = 0, starts = 0;
    const service = new CsvService({}, () => ({}), {}, { getFullPath: () => "A/data.csv" }, {
      viewerContinuation: () => { const token = generation; return () => generation === token; },
      startViewer: () => { starts++; throw new Error("An obsolete pane must not start"); },
    }, { prepareViewer: () => new Promise<void>(resolve => { complete = resolve; }) });
    const pending = service.openCsvInLeaf(file, leaf);
    generation++;
    if (reused) view.file = { path: "B/data.csv", basename: "data" };
    complete(); await pending;
    assert.equal(starts, 0); assert.deepEqual(view.displayed, []);
  }
});



test("chart service reload observes hidden configuration edits and deletions", async () => {
  const { ChartService } = await loadService("src/charts/ChartService.ts");
  let config: string | null = JSON.stringify({ charts: [{ id: "first", input: "data.csv", output: "plot.svg" }] });
  const service = new ChartService({ vault: { getAllLoadedFiles: () => [], adapter: {
    list: async () => ({ files: [], folders: [] }),
    exists: async () => config !== null,
    read: async () => config,
  } } }, { record: async () => {} }, {}, {});
  await service.reloadChartConfig();
  assert.equal(service.outputChartsForCsv("data.csv")[0].id, "first");
  config = JSON.stringify({ charts: [{ id: "updated", input: "data.csv", output: "plot.svg" }] });
  await service.reloadChartConfig();
  assert.equal(service.outputChartsForCsv("data.csv")[0].id, "updated");
  config = null;
  await service.reloadChartConfig();
  assert.equal(service.allChartKeys().length, 0);
});


test("delayed reopen for an old file never starts a viewer or cancels the current file", async () => {
  const { CsvService } = await loadService("src/csv/CsvService.ts");
  const view = new FakeView();
  const oldFile = { path: "a.csv", basename: "a" };
  view.file = { path: "b.csv", basename: "b" };
  let starts = 0;
  const service = new CsvService({}, () => ({}), {}, { getFullPath: () => "a.csv" }, {
    startViewer: () => { starts += 1; throw new Error("Must not start"); },
  });
  await service.openCsvInLeaf(oldFile, { view });
  assert.equal(starts, 0);
});


test("unload cancels chart commands and prevents new commands from spawning", async () => {
  const child = childProcess();
  let starts = 0;
  const { CsvzallProcessService } = await loadService("src/process/CsvzallProcessService.ts", () => { starts += 1; return child; });
  const service = new CsvzallProcessService(() => ({ csvzallPath: "csvzall" }), {});
  const pending = service.runCommand(["charts"], ".", "chart");
  service.unload();
  await assert.rejects(pending, /Plugin unloaded/);
  assert.equal(child.killed, true);
  await assert.rejects(service.runCommand(["charts"], ".", "chart"), /Plugin unloaded/);
  assert.equal(starts, 1);
});


test("a chart reload completing after watcher teardown cannot schedule a run", async () => {
  const { registerVaultWatchers } = await loadService("src/watchers/registerVaultWatchers.ts");
  let modified!: (file: FakeFile) => void;
  let teardown!: () => void;
  let finish!: () => void;
  let scheduled = 0;
  const plugin = {
    register: (callback: () => void) => { teardown = callback; },
    registerInterval: () => {}, registerEvent: () => {},
    app: { vault: { on: (_event: string, callback: (file: FakeFile) => void) => { modified = callback; } } },
  };
  registerVaultWatchers(plugin, {
    isChartConfigPath: () => false,
    reloadChartConfig: () => new Promise<void>((resolve) => { finish = resolve; }),
    scheduleChartsForCsv: () => { scheduled += 1; },
  }, { isCsv: () => true });
  modified(new FakeFile("data.csv"));
  teardown();
  finish();
  await Promise.resolve();
  assert.equal(scheduled, 0);
});

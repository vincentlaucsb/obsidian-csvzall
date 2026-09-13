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

async function loadService(entry: string, spawn?: () => unknown): Promise<any> {
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
      if (name === "obsidian") return { Notice: class {}, TFile: FakeFile, TFolder: class {}, Platform: { isDesktopApp: true } };
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

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  extractViewerUrl,
  formatProcessFailure,
  isAllowedViewerUrl,
  stripOuterQuotes,
  ViewerSessionRegistry,
} from "../src/viewerHelpers.js";
import {
  chartConfigRoot,
  chartRunKey,
  ChartRunScheduler,
  isChartConfigPath,
  matchingRunOnSaveCharts,
  normalizeVaultPath,
  parseChartConfigText,
} from "../src/chartAutomation.js";

test("isAllowedViewerUrl requires tokenized localhost URLs", () => {
  assert.equal(isAllowedViewerUrl("http://127.0.0.1:43117/?token=abc"), true);
  assert.equal(isAllowedViewerUrl("http://127.0.0.1:43117/"), false);
  assert.equal(isAllowedViewerUrl("http://localhost:43117/?token=abc"), false);
  assert.equal(isAllowedViewerUrl("https://127.0.0.1:43117/?token=abc"), false);
});

test("extractViewerUrl accepts JSON or plain tokenized URL output only", () => {
  assert.equal(
    extractViewerUrl('{"url":"http://127.0.0.1:43117/?token=abc"}'),
    "http://127.0.0.1:43117/?token=abc",
  );
  assert.equal(
    extractViewerUrl("http://127.0.0.1:43117/?token=abc"),
    "http://127.0.0.1:43117/?token=abc",
  );
  assert.equal(extractViewerUrl('{"url":"http://127.0.0.1:43117/"}'), null);
  assert.equal(extractViewerUrl("http://127.0.0.1:43117/"), null);
});

test("stripOuterQuotes normalizes pasted executable paths", () => {
  assert.equal(stripOuterQuotes('"E:\\GitHub\\csvzall\\csvzall.exe"'), "E:\\GitHub\\csvzall\\csvzall.exe");
  assert.equal(stripOuterQuotes("'E:\\GitHub\\csvzall\\csvzall.exe'"), "E:\\GitHub\\csvzall\\csvzall.exe");
  assert.equal(stripOuterQuotes("csvzall"), "csvzall");
});

test("formatProcessFailure includes command context and captured streams", () => {
  const message = formatProcessFailure({
    executable: "csvzall",
    args: ["view", "notes.csv", "--no-open"],
    cwd: undefined,
    code: 1,
    signal: null,
    stdout: "",
    stderr: "[error] view: unable to open input file",
  });

  assert.match(message, /csvzall exited with code 1/);
  assert.match(message, /Command: csvzall view notes.csv --no-open/);
  assert.match(message, /unable to open input file/);
});

test("formatProcessFailure summarizes empty CSV viewer errors", () => {
  const message = formatProcessFailure({
    executable: "csvzall",
    args: ["view", "empty.csv", "--edit"],
    cwd: undefined,
    code: 1,
    signal: null,
    stdout: "",
    stderr: "[error] view: CSV file is empty. Add a header row first, for example: column",
  });

  assert.match(message, /does not have a header row/);
  assert.doesNotMatch(message, /Command:/);
});

test("built plugin launches csvzall view in edit mode", () => {
  const bundle = readFileSync(new URL("../main.js", import.meta.url), "utf8");
  assert.match(bundle, /"--edit"/);
  assert.match(bundle, /"--startup-json"/);
  assert.match(bundle, /New CSV/);
  assert.match(bundle, /column/);
});

test("ViewerSessionRegistry closes leaf-bound processes and unload kills remaining", () => {
  const registry = new ViewerSessionRegistry();

  const makeHandle = (name) => ({
    name,
    stopping: false,
    process: {
      killed: false,
      kill() {
        this.killed = true;
      },
    },
  });

  const leafA = { id: "A" };
  const leafB = { id: "B" };
  const handleA = makeHandle("A");
  const handleB = makeHandle("B");

  registry.add(handleA);
  registry.add(handleB);
  registry.bindLeaf(leafA, handleA);
  registry.bindLeaf(leafB, handleB);

  registry.closeLeaf(leafA);
  assert.equal(handleA.stopping, true);
  assert.equal(handleA.process.killed, true);
  assert.equal(registry.leafForHandle(handleA), null);

  registry.shutdownAll();
  assert.equal(handleB.stopping, true);
  assert.equal(handleB.process.killed, true);
  assert.equal(registry.list().length, 0);
});

test("chart config matching ignores generated outputs and non-runOnSave charts", () => {
  const charts = parseChartConfigText(JSON.stringify({
    charts: [
      {
        id: "gym",
        type: "heatmap",
        input: "Exercise/output/gym.csv",
        output: "Exercise/output/gym.svg",
        runOnSave: true,
      },
      {
        id: "manual",
        type: "heatmap",
        input: "Exercise/output/gym.csv",
        output: "Exercise/output/manual.svg",
        runOnSave: false,
      },
    ],
  }));

  assert.equal(normalizeVaultPath(".\\Exercise\\output\\gym.csv"), "Exercise/output/gym.csv");
  assert.deepEqual(
    matchingRunOnSaveCharts(charts, "Exercise/output/gym.csv").map((chart) => chart.id),
    ["gym"],
  );
  assert.deepEqual(matchingRunOnSaveCharts(charts, "Exercise/output/gym.svg"), []);
  assert.deepEqual(matchingRunOnSaveCharts(charts, "Exercise/output/readme.md"), []);
});

test("nested chart configs resolve paths relative to their folder", () => {
  const charts = parseChartConfigText(JSON.stringify({
    charts: [
      {
        id: "table",
        type: "markdown-table",
        input: "test.csv",
        output: "charts/test.md",
        runOnSave: true,
      },
    ],
  }), "Truck/.csvzall/charts.json");

  assert.equal(isChartConfigPath("Truck/.csvzall/charts.json"), true);
  assert.equal(chartConfigRoot("Truck/.csvzall/charts.json"), "Truck");
  assert.deepEqual(
    matchingRunOnSaveCharts(charts, "Truck/test.csv").map((chart) => chart.id),
    ["table"],
  );
  assert.equal(charts[0].input, "Truck/test.csv");
  assert.equal(charts[0].output, "Truck/charts/test.md");
  assert.equal(chartRunKey(charts[0]), "Truck/.csvzall/charts.json\u0000table");
});

test("ChartRunScheduler debounces repeated modify events for the same CSV", async () => {
  const timers = [];
  const cleared = new Set();
  const runs = [];
  const scheduler = new ChartRunScheduler({
    delayMs: 25,
    runner: async (inputPath, chartIds) => {
      runs.push({ inputPath, chartIds });
    },
    setTimeoutFn: (callback, _delay) => {
      timers.push(callback);
      return timers.length - 1;
    },
    clearTimeoutFn: (id) => {
      cleared.add(id);
    },
  });

  scheduler.schedule("data/gym.csv", ["gym"]);
  scheduler.schedule("data/gym.csv", ["gym"]);

  assert.equal(cleared.has(0), true);
  await timers[1]();

  assert.deepEqual(runs, [{ inputPath: "data/gym.csv", chartIds: ["gym"] }]);
});

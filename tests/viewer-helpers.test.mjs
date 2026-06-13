import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  csvzallDirtyStateFromMessageEvent,
  extractViewerUrl,
  formatProcessFailure,
  isAllowedViewerUrl,
  isCsvzallDirtyStateMessage,
  stripOuterQuotes,
  ViewerSessionRegistry,
} from "../src/viewerHelpers.js";
import {
  csvzallInstallTarget,
  installCsvzallBinary,
  parseSha256ChecksumText,
  selectCsvzallReleaseAsset,
  sha256Hex,
} from "../src/installer.js";
import {
  chartConfigRoot,
  chartRunKey,
  ChartRunScheduler,
  isChartConfigPath,
  matchingRunOnSaveCharts,
  normalizeVaultPath,
  parseChartConfigText,
} from "../src/chartAutomation.js";

function createStoredZip(entryName, entryBytes) {
  const nameBytes = Buffer.from(entryName, "utf8");
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(entryBytes.length, 18);
  localHeader.writeUInt32LE(entryBytes.length, 22);
  localHeader.writeUInt16LE(nameBytes.length, 26);

  const centralDirectory = Buffer.alloc(46);
  centralDirectory.writeUInt32LE(0x02014b50, 0);
  centralDirectory.writeUInt16LE(20, 4);
  centralDirectory.writeUInt16LE(20, 6);
  centralDirectory.writeUInt16LE(0, 8);
  centralDirectory.writeUInt16LE(0, 10);
  centralDirectory.writeUInt32LE(0, 16);
  centralDirectory.writeUInt32LE(entryBytes.length, 20);
  centralDirectory.writeUInt32LE(entryBytes.length, 24);
  centralDirectory.writeUInt16LE(nameBytes.length, 28);

  const centralDirectoryOffset = localHeader.length + nameBytes.length + entryBytes.length;
  const centralDirectorySize = centralDirectory.length + nameBytes.length;
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(1, 8);
  endOfCentralDirectory.writeUInt16LE(1, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12);
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16);

  return Buffer.concat([
    localHeader,
    nameBytes,
    entryBytes,
    centralDirectory,
    nameBytes,
    endOfCentralDirectory,
  ]);
}

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

test("isCsvzallDirtyStateMessage validates viewer dirty-state payloads", () => {
  assert.equal(isCsvzallDirtyStateMessage({
    source: "csvzall-viewer",
    type: "dirty-state",
    dirty: true,
  }), true);
  assert.equal(isCsvzallDirtyStateMessage({
    source: "csvzall-viewer",
    type: "dirty-state",
    dirty: false,
  }), true);
  assert.equal(isCsvzallDirtyStateMessage({ source: "csvzall-viewer", type: "dirty-state" }), false);
  assert.equal(isCsvzallDirtyStateMessage({ source: "csvzall-viewer", type: "dirty-state", dirty: 1 }), false);
  assert.equal(isCsvzallDirtyStateMessage({ source: "other", type: "dirty-state", dirty: true }), false);
});

test("csvzallDirtyStateFromMessageEvent accepts messages only from the current iframe window", () => {
  const currentWindow = {};
  const staleWindow = {};
  const data = {
    source: "csvzall-viewer",
    type: "dirty-state",
    dirty: true,
  };

  assert.equal(csvzallDirtyStateFromMessageEvent({ source: currentWindow, data }, currentWindow), true);
  assert.equal(csvzallDirtyStateFromMessageEvent({ source: staleWindow, data }, currentWindow), null);
  assert.equal(csvzallDirtyStateFromMessageEvent({ source: currentWindow, data: { ...data, dirty: 1 } }, currentWindow), null);
  assert.equal(csvzallDirtyStateFromMessageEvent({ source: currentWindow, data }, null), null);
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
  assert.match(bundle, /Install or update/);
  assert.match(bundle, /installDesktopCsvzall/);
  assert.match(bundle, /New CSV/);
  assert.match(bundle, /column/);
  assert.match(bundle, /csvzall-viewer/);
  assert.match(bundle, /dirty-state/);
  assert.match(bundle, /Unsaved changes/);
  assert.match(bundle, /This CSV has unsaved changes\./);
  assert.match(bundle, /Discard changes/);
  assert.match(bundle, /openFile/);
  assert.match(bundle, /setViewState/);
});

test("installer selects the matching desktop binary asset", () => {
  const release = {
    assets: [
      { name: "csvzall-linux-x64", browser_download_url: "https://example.test/linux" },
      { name: "csvzall-windows-x64.zip", browser_download_url: "https://example.test/win" },
      { name: "SHA256SUMS.txt", browser_download_url: "https://example.test/sums" },
      { name: "csvzall-windows-arm64.exe", browser_download_url: "https://example.test/arm" },
    ],
  };

  const asset = selectCsvzallReleaseAsset(release, csvzallInstallTarget("win32", "x64"));
  assert.equal(asset.name, "csvzall-windows-x64.zip");
});

test("installer parses common SHA-256 checksum formats", () => {
  const hash = "b".repeat(64);
  assert.equal(
    parseSha256ChecksumText(`${hash}  csvzall-windows-x64.exe`, "csvzall-windows-x64.exe"),
    hash,
  );
  assert.equal(
    parseSha256ChecksumText(`SHA256 (csvzall-linux-x64) = ${hash}`, "csvzall-linux-x64"),
    hash,
  );
});

test("installer verifies and stores csvzall under plugin-managed data", async (t) => {
  const binary = Buffer.from("fake csvzall binary");
  const hash = sha256Hex(binary);
  const release = {
    tag_name: "v1.2.3",
    assets: [
      {
        name: "csvzall-windows-x64.exe",
        browser_download_url: "https://example.test/csvzall.exe",
        digest: `sha256:${hash}`,
      },
    ],
  };
  const { mkdtemp, readFile, rm, stat } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "obsidian-csvzall-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const result = await installCsvzallBinary({
    pluginDir: dir,
    platform: "win32",
    arch: "x64",
    fetchBuffer: async (url) => {
      if (url.endsWith("/latest")) {
        return Buffer.from(JSON.stringify(release));
      }
      return binary;
    },
  });

  assert.equal(result.assetName, "csvzall-windows-x64.exe");
  assert.equal(result.sha256, hash);
  assert.match(result.executablePath, /csvzall-bin/);
  assert.equal(await readFile(result.executablePath, "utf8"), "fake csvzall binary");
  assert.equal((await stat(result.executablePath)).isFile(), true);
});

test("installer extracts a verified zip release asset before storing csvzall", async (t) => {
  const binary = Buffer.from("fake zipped csvzall binary");
  const archive = createStoredZip("csvzall/csvzall.exe", binary);
  const hash = sha256Hex(archive);
  const release = {
    tag_name: "v1.2.4",
    assets: [
      {
        name: "csvzall-windows-x64.zip",
        browser_download_url: "https://example.test/csvzall.zip",
        digest: `sha256:${hash}`,
      },
    ],
  };
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "obsidian-csvzall-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const result = await installCsvzallBinary({
    pluginDir: dir,
    platform: "win32",
    arch: "x64",
    fetchBuffer: async (url) => {
      if (url.endsWith("/latest")) {
        return Buffer.from(JSON.stringify(release));
      }
      return archive;
    },
  });

  assert.equal(result.assetName, "csvzall-windows-x64.zip");
  assert.equal(result.installedFromArchive, true);
  assert.equal(result.sha256, hash);
  assert.equal(await readFile(result.executablePath, "utf8"), "fake zipped csvzall binary");
});

test("installer verifies with a release checksum asset when no digest is present", async (t) => {
  const binary = Buffer.from("fake linux csvzall binary");
  const hash = sha256Hex(binary);
  const release = {
    tag_name: "v2.0.0",
    assets: [
      {
        name: "csvzall-linux-x64",
        browser_download_url: "https://example.test/csvzall",
      },
      {
        name: "SHA256SUMS.txt",
        browser_download_url: "https://example.test/SHA256SUMS.txt",
      },
    ],
  };
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "obsidian-csvzall-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const result = await installCsvzallBinary({
    pluginDir: dir,
    platform: "linux",
    arch: "x64",
    fetchBuffer: async (url) => {
      if (url.endsWith("/latest")) {
        return Buffer.from(JSON.stringify(release));
      }
      if (url.endsWith("SHA256SUMS.txt")) {
        return Buffer.from(`${hash}  csvzall-linux-x64\n`);
      }
      return binary;
    },
  });

  assert.equal(result.checksumAssetName, "SHA256SUMS.txt");
  assert.equal(result.sha256, hash);
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

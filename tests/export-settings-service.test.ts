import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { build } from "esbuild";
import type { DataAdapter } from "obsidian";
import { ExportDefinitions, type SavedExport } from "../src/markdown/ExportDefinitions.js";

class File { constructor(public path: string) {} }
class Folder { constructor(public path: string) {} }

async function fixture() {
  const files = new Map<string, string>([
    [".csvzall/charts.json", JSON.stringify({ owner: "keep", charts: [
      { id: "sales", type: "bar", input: "Data/sales.csv", output: "sales.svg", runOnSave: false },
      { id: "missing", type: "markdown-table", input: "missing.csv", output: "missing.md" },
    ] })],
    ["Project/.csvzall/charts.json", JSON.stringify({ charts: [
      { id: "sales", type: "line", input: "../Data/sales.csv", output: "chart.svg" },
    ] })],
    ["Project/.csvzall/exports.json", JSON.stringify({ exports: [
      { id: "sales", input: "../Data/sales.csv", output: "note.md", runOnSave: false },
      { id: "other", input: "other.csv", output: "other.md" },
    ] })],
    ["Data/sales.csv", "name,amount\nA,1"], ["sales.svg", "SVG"], ["Project/note.md", "Markdown"],
  ]);
  const adapter = {
    exists: async (path: string) => { assert.ok(!path.startsWith("/"), "configuration discovery must use vault-relative paths"); return files.has(path) || path.endsWith(".csvzall"); },
    read: async (path: string) => { if (!files.has(path)) throw new Error(`Missing: ${path}`); return files.get(path)!; },
    write: async (path: string, text: string) => { files.set(path, text); },
    process: async (path: string, update: (text: string) => string) => {
      if (!files.has(path)) throw new Error(`Missing: ${path}`);
      const text = update(files.get(path)!);
      files.set(path, text);
      return text;
    },
    rename: async (old: string, path: string) => {
      if (files.has(path)) throw new Error("Destination file already exists!");
      files.set(path, files.get(old)!); files.delete(old);
    },
    remove: async (path: string) => { files.delete(path); }, mkdir: async () => {},
  };
  const definitions = new ExportDefinitions(adapter as unknown as DataAdapter, () => false);
  const result = await build({ entryPoints: ["src/settings/ExportSettingsService.ts"], bundle: true, platform: "node",
    format: "cjs", write: false, external: ["obsidian"], plugins: [{ name: "mock-modals", setup(builder) {
      builder.onResolve({ filter: /ExportModals\.js$/ }, () => ({ path: "mock-modals", external: true }));
    } }] });
  const module = { exports: {} as any };
  let modal = "", reloads = 0, configured: unknown;
  let chooseOptions: { configure: (entry: unknown) => void; deleteExport: (entry: unknown) => Promise<void> };
  runInNewContext(result.outputFiles[0]!.text, { module, exports: module.exports, crypto: webcrypto,
    require(name: string) {
      if (name === "obsidian") return { TFile: File, TFolder: Folder };
      return { ChartOptionsModal: class { open() { modal = "chart"; } }, ChooseExportModal: class {
        constructor(_app: unknown, _file: unknown, configure: (entry: unknown) => void, deleteExport: (entry: unknown) => Promise<void>) {
          chooseOptions = { configure, deleteExport };
        }
        open() { modal = "choose"; }
      }, DeleteExportsModal: class {} };
    } });
  const app = { vault: { adapter, getAllLoadedFiles: () => [new Folder("/"), new Folder("Project"), new Folder("Data")],
    getAbstractFileByPath: (path: string) => files.has(path) ? new File(path) : null } };
  const service = new module.exports.ExportSettingsService(app, { reloadChartConfig: async () => { reloads++; } }, {
    listExports: (folders: string[]) => definitions.list(folders),
    removeExports: (source: string, paths: string[]) => definitions.removeSource(source, paths),
    removeExport: (saved: SavedExport) => definitions.removeExport(saved),
    configureExport: (value: unknown) => { configured = value; },
  }, { getVaultRoot: () => "vault" }, {});
  return { service, files, get modal() { return modal; }, get reloads() { return reloads; }, get configured() { return configured; },
    get chooseOptions() { return chooseOptions; } };
}

test("settings inventory groups all export types and paused nested definitions by source", async () => {
  const f = await fixture(), groups = await f.service.list();
  const sales = groups.find((group: any) => group.source === "Data/sales.csv");
  assert.equal(sales.entries.length, 3);
  assert.equal(sales.missing, false);
  assert.equal(groups.find((group: any) => group.source === "missing.csv").missing, true);
  f.service.configure(sales, () => {}); assert.equal(f.modal, "choose");
  f.service.configure(groups.find((group: any) => group.source === "missing.csv"), () => {});
  assert.equal(f.modal, "choose");
  f.chooseOptions.configure(groups.find((group: any) => group.source === "missing.csv").entries[0]);
  assert.equal(f.modal, "chart");
  f.service.configure(groups.find((group: any) => group.source === "Project/other.csv"), () => {});
  assert.equal(f.modal, "choose", "single SQL exports must also expose the action list");
  f.chooseOptions.configure(groups.find((group: any) => group.source === "Project/other.csv").entries[0]);
  assert.equal((f.configured as { recipe: { id: string } }).recipe.id, "other");
});

test("Configure deletes only the selected chart scope and refreshes settings and scheduling", async () => {
  const f = await fixture();
  const sales = (await f.service.list()).find((group: any) => group.source === "Data/sales.csv");
  let refreshes = 0;
  f.service.configure(sales, () => { refreshes++; });
  const root = sales.entries.find((entry: any) => entry.kind === "chart" && entry.chart.configPath === ".csvzall/charts.json");
  await f.chooseOptions.deleteExport(root);
  const remaining = (await f.service.list()).find((group: any) => group.source === "Data/sales.csv");
  assert.equal(remaining.entries.length, 2);
  assert.ok(remaining.entries.some((entry: any) => entry.kind === "chart" && entry.chart.configPath === "Project/.csvzall/charts.json"));
  assert.ok(remaining.entries.some((entry: any) => entry.kind === "table"));
  const rootConfig = JSON.parse(f.files.get(".csvzall/charts.json")!);
  assert.equal(rootConfig.owner, "keep");
  assert.equal(rootConfig.charts[0].id, "missing");
  assert.equal(f.files.get("Data/sales.csv"), "name,amount\nA,1");
  assert.equal(f.files.get("sales.svg"), "SVG");
  assert.equal(f.files.get("Project/note.md"), "Markdown");
  assert.equal(refreshes, 1);
  assert.equal(f.reloads, 1);
});

test("Configure deletes only the selected SQL export while preserving charts and sibling queries", async () => {
  const f = await fixture(), path = "Project/.csvzall/exports.json";
  const config = JSON.parse(f.files.get(path)!);
  config.exports.push({ id: "count", input: "../Data/sales.csv", format: "value", options: { sql: "SELECT COUNT(*) FROM data" } });
  f.files.set(path, JSON.stringify(config));
  const sales = (await f.service.list()).find((group: any) => group.source === "Data/sales.csv");
  let refreshes = 0;
  f.service.configure(sales, () => { refreshes++; });
  const selected = sales.entries.find((entry: any) => entry.kind === "table" && entry.table.recipe.id === "sales");
  await f.chooseOptions.deleteExport(selected);
  const remaining = (await f.service.list()).find((group: any) => group.source === "Data/sales.csv");
  assert.equal(remaining.entries.length, 3);
  assert.equal(remaining.entries.filter((entry: any) => entry.kind === "chart").length, 2);
  assert.equal(remaining.entries.find((entry: any) => entry.kind === "table").table.recipe.id, "count");
  assert.equal(f.files.get("Project/note.md"), "Markdown");
  assert.equal(refreshes, 1);
  assert.equal(f.reloads, 1);
});

test("file deletion removes nested chart and table configurations while retaining files and other definitions", async () => {
  const f = await fixture();
  await f.service.remove("Data/sales.csv");
  const groups = await f.service.list();
  assert.equal(groups.some((group: any) => group.source === "Data/sales.csv"), false);
  assert.equal(groups.length, 2);
  assert.equal(f.files.get("Data/sales.csv"), "name,amount\nA,1");
  assert.equal(f.files.get("sales.svg"), "SVG");
  assert.equal(f.files.get("Project/note.md"), "Markdown");
  assert.equal(JSON.parse(f.files.get(".csvzall/charts.json")!).owner, "keep");
  assert.equal(f.reloads, 1);
});

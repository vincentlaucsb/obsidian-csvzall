import test from "node:test";
import assert from "node:assert/strict";
import type { DataAdapter } from "obsidian";
import { ChartDefinitions } from "../src/charts/ChartDefinitions.js";
import type { ChartFormPayload } from "../src/charts/chart-form.mjs";
import { resolveChartPath } from "../src/chartAutomation.js";

function fixture() {
  const path = "Project/.csvzall/charts.json";
  const entry = { id: "sales", type: "bar", input: "../Data/sales.csv", output: "sales.svg", runOnSave: false,
    extra: "keep", options: { label: "name", value: "amount", xLabel: "Custom axis", future: 42 } };
  const unrelated = { ...entry, id: "other", input: "other.csv" };
  const files = new Map([[path, JSON.stringify({ metadata: "keep", charts: [entry, unrelated] })],
    ["Data/sales.csv", "name,amount\nA,1"], ["Project/sales.svg", "generated output"]]);
  const adapter = { read: async (path: string) => files.get(path)!, exists: async (path: string) => files.has(path),
    write: async (path: string, text: string) => { files.set(path, text); },
    process: async (path: string, update: (text: string) => string) => {
      if (!files.has(path)) throw new Error("Missing file");
      const text = update(files.get(path)!);
      files.set(path, text);
      return text;
    },
    rename: async (old: string, path: string) => {
      if (files.has(path)) throw new Error("Destination file already exists!");
      files.set(path, files.get(old)!); files.delete(old);
    },
    remove: async (path: string) => { files.delete(path); } };
  return { path, entry, unrelated, files, adapter, store: new ChartDefinitions(adapter as unknown as DataAdapter) };
}

test("chart paths resolve nested parents without rejecting existing external outputs", () => {
  assert.equal(resolveChartPath("Project/.csvzall/charts.json", "../Data/sales.csv"), "Data/sales.csv");
  assert.equal(resolveChartPath(".csvzall/charts.json", "../outside.svg"), "../outside.svg");
  assert.equal(resolveChartPath("Project/.csvzall/charts.json", "../../outside.svg"), "../outside.svg");
});

test("chart deletion matches resolved source and preserves unrelated configuration and generated files", async () => {
  const f = fixture();
  const list = await f.store.list([f.path]);
  assert.equal(list[0]!.source, "Data/sales.csv");
  await f.store.remove("Data/sales.csv", [f.path]);
  assert.deepEqual(JSON.parse(f.files.get(f.path)!), { metadata: "keep", charts: [f.unrelated] });
  assert.equal(f.files.get("Project/sales.svg"), "generated output");
  assert.equal(f.files.get("Data/sales.csv"), "name,amount\nA,1");
  assert.equal(f.files.size, 3);
});

test("individual deletion keeps other charts for the same CSV and preserves generated files", async () => {
  const f = fixture();
  const sibling = { ...f.entry, id: "monthly" };
  f.files.set(f.path, JSON.stringify({ metadata: "keep", charts: [f.entry, sibling, f.unrelated] }));
  const chart = (await f.store.list([f.path]))[0]!;
  await f.store.removeChart(chart);
  assert.deepEqual(JSON.parse(f.files.get(f.path)!), { metadata: "keep", charts: [sibling, f.unrelated] });
  assert.equal(f.files.get("Project/sales.svg"), "generated output");
  assert.equal(f.files.get("Data/sales.csv"), "name,amount\nA,1");
  assert.equal(f.files.size, 3);
});

test("deleting the final chart leaves a valid empty configuration", async () => {
  const f = fixture();
  f.files.set(f.path, JSON.stringify({ metadata: "keep", charts: [f.entry] }));
  await f.store.removeChart((await f.store.list([f.path]))[0]!);
  assert.deepEqual(JSON.parse(f.files.get(f.path)!), { metadata: "keep", charts: [] });
  assert.deepEqual(await f.store.list([f.path]), []);
  assert.equal(f.files.size, 3);
});

test("stale chart deletion refuses changed or missing definitions", async () => {
  for (const removed of [false, true]) {
    const f = fixture(), chart = (await f.store.list([f.path]))[0]!;
    const current = JSON.stringify({ charts: removed ? [f.unrelated] : [{ ...f.entry, runOnSave: true }, f.unrelated] });
    f.files.set(f.path, current);
    await assert.rejects(f.store.removeChart(chart), /chart changed/);
    assert.equal(f.files.get(f.path), current);
    assert.equal(f.files.size, 3);
  }
});

test("chart deletion preserves edits made at the atomic save boundary", async () => {
  const f = fixture(), chart = (await f.store.list([f.path]))[0]!;
  const current = JSON.stringify({ metadata: "external edit", charts: [f.entry, f.unrelated] });
  const processFile = f.adapter.process;
  f.adapter.process = async (path, update) => { f.files.set(path, current); return processFile(path, update); };
  await assert.rejects(f.store.removeChart(chart), /changed while saving/);
  assert.equal(f.files.get(f.path), current);
  assert.equal(f.files.size, 3);
});

test("failed chart deletion leaves the configuration intact and can be retried", async () => {
  const f = fixture(), chart = (await f.store.list([f.path]))[0]!;
  const original = f.files.get(f.path), processFile = f.adapter.process;
  f.adapter.process = async () => { throw new Error("Disk full"); };
  await assert.rejects(f.store.removeChart(chart), /Disk full/);
  assert.equal(f.files.get(f.path), original);
  assert.equal(f.files.size, 3);
  f.adapter.process = processFile;
  await f.store.removeChart(chart);
  assert.deepEqual(JSON.parse(f.files.get(f.path)!).charts, [f.unrelated]);
  assert.equal(f.files.size, 3);
});

test("chart options validate a staged config and preserve unexposed fields", async () => {
  const f = fixture(), chart = (await f.store.list([f.path]))[0]!;
  const payload = { ...f.entry, label: "name", value: "amount", values: [], title: "Revenue", presentation: "grouped", colorScheme: "sequential" } as unknown as ChartFormPayload;
  let validations = 0;
  await f.store.update(chart, payload, async temporary => {
    validations++; assert.match(temporary, /^Project\/\.csvzall\/\.charts-/);
    assert.equal(JSON.parse(f.files.get(temporary)!).charts[0].options.title, "Revenue");
  });
  assert.equal(validations, 1);
  const saved = JSON.parse(f.files.get(f.path)!);
  assert.equal(saved.charts[0].extra, "keep");
  assert.equal(saved.charts[0].options.xLabel, "Custom axis");
  assert.equal(saved.charts[0].options.future, 42);
  assert.deepEqual(saved.charts[1], f.unrelated);
});

test("failed validation and concurrent edits do not replace chart configurations", async () => {
  const f = fixture(), chart = (await f.store.list([f.path]))[0]!;
  const before = f.files.get(f.path);
  const payload = { type: "bar", output: "changed.svg", runOnSave: true, values: [] } as unknown as ChartFormPayload;
  await assert.rejects(f.store.update(chart, payload, async () => { throw new Error("invalid options"); }), /invalid options/);
  assert.equal(f.files.get(f.path), before);
  await assert.rejects(f.store.update(chart, payload, async () => { f.files.set(f.path, "external edit"); }), /changed while saving/);
  assert.equal(f.files.get(f.path), "external edit");
  assert.equal(f.files.size, 3);
});

test("editing multiseries charts preserves saved series labels and colors", async () => {
  const f = fixture();
  const config = JSON.parse(f.files.get(f.path)!);
  config.charts[0].options.values = [{ column: "amount", label: "Revenue", color: "#123456" }, { column: "count", label: "Orders" }];
  delete config.charts[0].options.value;
  f.files.set(f.path, JSON.stringify(config));
  const chart = (await f.store.list([f.path]))[0]!;
  await f.store.update(chart, { type: "bar", output: "sales.svg", runOnSave: false, values: ["amount", "count"] } as unknown as ChartFormPayload, async () => {});
  assert.deepEqual(JSON.parse(f.files.get(f.path)!).charts[0].options.values, config.charts[0].options.values);
});

for (const type of ["bar", "line", "heatmap"]) {
  for (const count of [1, 3]) {
    test(`editing ${type} title preserves ${count} saved value series and their metadata`, async () => {
      const f = fixture(), config = JSON.parse(f.files.get(f.path)!);
      const values = [{ column: "amount", label: "Revenue", color: "#123456" },
        { column: "count", label: "Orders" }, { column: "profit", label: "Profit", color: "#abcdef", future: 123 }].slice(0, count);
      config.charts[0].type = type;
      config.charts[0].options.values = values;
      delete config.charts[0].options.value;
      f.files.set(f.path, JSON.stringify(config));
      const chart = (await f.store.list([f.path]))[0]!;
      const scalarKey = type === "line" ? "y" : "value";
      await f.store.update(chart, { type, output: "changed.svg", runOnSave: false, title: "Updated title",
        values: count === 1 ? [] : ["amount", "count"], [scalarKey]: count === 1 ? "amount" : "" } as unknown as ChartFormPayload, async () => {});
      const updated = JSON.parse(f.files.get(f.path)!).charts[0];
      assert.deepEqual(updated.options.values, values);
      assert.equal(updated.options.title, "Updated title");
      assert.equal(updated.output, "changed.svg");
      assert.equal(updated.options[scalarKey], undefined);
    });
  }
}

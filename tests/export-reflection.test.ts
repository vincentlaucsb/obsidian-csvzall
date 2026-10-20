import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import type { DataAdapter } from "obsidian";
import { ExportReflection } from "../src/exports/ExportReflection.js";
import { PluginDataStore } from "../src/settings/PluginDataStore.js";
import { canonical, readRevisions, winners, revisionKey, type JsonObject } from "../src/exports/revisions.js";
import type { ExportReference } from "../src/exports/localFolders.js";

if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
const path = ".csvzall/charts.json";
const config = (label = "first") => JSON.stringify({ custom: { keep: true }, charts: [{ id: "one", type: "bar", input: "data.csv", output: "graph.svg", options: { label } }] });

test("direct-folder migration waits for verified destinations and preserves raw options and edit time", async () => {
  const original = JSON.stringify({ custom: { retained: true }, charts: [{ id: "chart", type: "bar", input: "Project/Deep/data.csv", output: "Project/Deep/charts/result.svg", options: { extra: 3 }, runOnSave: false }] });
  const a = await device(original, 1000, {}, true);
  assert.equal(JSON.parse(a.files.get(path)!).charts.length, 1, "keep inherited original while destination is unavailable");
  a.directories.add("Project"); a.directories.add("Project/Deep");
  await a.reflection.reconcile();
  const local = JSON.parse(a.files.get("Project/Deep/.csvzall/charts.json")!);
  assert.equal(local.charts[0].input, "data.csv");
  assert.equal(local.charts[0].output, "charts/result.svg");
  assert.deepEqual(local.custom, { retained: true });
  assert.equal(local.charts[0].runOnSave, false);
  assert.equal(local.charts[0].options.extra, 3);
  assert.equal(JSON.parse(a.files.get(path)!).charts.length, 0);
  const moved = [...winners(readRevisions(a.data).values()).values()].find(record => record.path === "Project/Deep/.csvzall/charts.json" && record.id === "entry:chart")!;
  assert.equal(moved.clockMs, 1000);
  const stable = canonical(a.data);
  await a.reflection.reconcile(); await a.reflection.reconcile();
  assert.equal(canonical(a.data), stable);
  assert.equal(a.errors.length, 0);
});

test("independent scoped chart IDs survive a shared direct destination", async () => {
  const a = await device(null, 1000, {}, true);
  a.directories.add("Data");
  a.files.set(path, JSON.stringify({ charts: [{ id: "same", type: "bar", input: "Data/a.csv" }] }));
  a.files.set("Data/.csvzall/charts.json", JSON.stringify({ local: true, charts: [{ id: "same", type: "line", input: "b.csv" }] }));
  await a.reflection.reconcile();
  const entries = JSON.parse(a.files.get("Data/.csvzall/charts.json")!).charts;
  assert.equal(entries.length, 2);
  assert.equal(entries.find((entry: { id: string }) => entry.id === "same").input, "b.csv");
  assert.equal(entries.find((entry: { input: string }) => entry.input === "a.csv").id.startsWith("same-"), true);
  const stable = canonical(a.data); await a.reflection.reconcile(); assert.equal(canonical(a.data), stable);
});

test("shared SQL definitions become local copies and late notes recover relocation history", async () => {
  const a = await device(null, 1000, {}, true, [{ note: "A/note.md", id: "table", legacy: false }, { note: "B/note.md", id: "table", legacy: false }]);
  a.directories.add("A"); a.directories.add("B");
  a.files.set(".csvzall/exports.json", JSON.stringify({ retained: 4, exports: [{ id: "table", input: "data.csv", runOnSave: false, options: { sql: "select * from data", custom: true } }] }));
  await a.reflection.reconcile();
  for (const folder of ["A", "B"]) {
    const local = JSON.parse(a.files.get(`${folder}/.csvzall/exports.json`)!);
    assert.equal(local.exports[0].id, "table"); assert.equal(local.exports[0].input, "../data.csv");
    assert.equal(local.exports[0].runOnSave, false); assert.equal(local.retained, 4);
  }
  assert.equal(JSON.parse(a.files.get(".csvzall/exports.json")!).exports.length, 0);
  a.directories.add("C"); a.references.push({ note: "C/late.md", id: "table", legacy: false });
  await a.reflection.reconcile();
  assert.equal(JSON.parse(a.files.get("C/.csvzall/exports.json")!).exports[0].output, "late.md");
  a.files.set("C/.csvzall/exports.json", '{"exports":[]}'); await a.reflection.edited("C/.csvzall/exports.json");
  await a.reflection.reconcile();
  assert.equal(JSON.parse(a.files.get("C/.csvzall/exports.json")!).exports.length, 0);
});

test("delayed SQL output hints localize before their note is available", async () => {
  const a = await device(null, 1000, {}, true);
  a.files.set(".csvzall/exports.json", JSON.stringify({ exports: [{ id: "table", input: "Notes/data.csv", output: "Notes/note.md" }] }));
  await a.reflection.reconcile();
  assert.equal(JSON.parse(a.files.get(".csvzall/exports.json")!).exports.length, 1);
  a.directories.add("Notes"); await a.reflection.reconcile();
  assert.equal(JSON.parse(a.files.get("Notes/.csvzall/exports.json")!).exports[0].input, "data.csv");
  assert.equal(JSON.parse(a.files.get(".csvzall/exports.json")!).exports.length, 0);
});

test("a new device reconstructs localized configs and a promoted folder needs no ancestors", async () => {
  const a = await device(JSON.stringify({ charts: [{ id: "chart", type: "bar", input: "Project/data.csv", output: "Project/chart.svg" }] }), 1000, {}, true);
  a.directories.add("Project"); await a.reflection.reconcile();
  const b = await device(null, 5000, a.data, true); b.directories.add("Project"); await b.reflection.reconcile();
  assert.deepEqual(JSON.parse(b.files.get("Project/.csvzall/charts.json")!), JSON.parse(a.files.get("Project/.csvzall/charts.json")!));
  const promoted = await device(b.files.get("Project/.csvzall/charts.json")!, 6000, {}, true);
  assert.equal(JSON.parse(promoted.files.get(path)!).charts[0].input, "data.csv");
  assert.equal(promoted.errors.length, 0);
});

test("viewer preparation creates a direct config and refuses malformed direct JSON", async () => {
  const a = await device(null, 1000, {}, true); a.directories.add("Project");
  await a.reflection.prepareViewer("Project/data.csv");
  assert.deepEqual(JSON.parse(a.files.get("Project/.csvzall/charts.json")!), { charts: [] });
  a.files.set("Project/.csvzall/charts.json", "{");
  await assert.rejects(a.reflection.prepareViewer("Project/data.csv"));
  assert.equal(a.files.get("Project/.csvzall/charts.json"), "{");
});

test("cross-folder CSV moves relocate chart ownership without duplicating original lineage", async () => {
  const a = await device(JSON.stringify({ charts: [{ id: "one", type: "bar", input: "A/data.csv", output: "A/graph.svg" }] }), 1000, {}, true);
  a.directories.add("A"); a.directories.add("B"); await a.reflection.reconcile();
  await a.reflection.renamed("A/data.csv", "B/data.csv");
  assert.equal(JSON.parse(a.files.get("A/.csvzall/charts.json")!).charts.length, 0);
  const local = JSON.parse(a.files.get("B/.csvzall/charts.json")!).charts;
  assert.equal(local.length, 1); assert.equal(local[0].input, "data.csv"); assert.equal(local[0].output, "../A/graph.svg");
  const stable = canonical(a.data); await a.reflection.reconcile(); assert.equal(canonical(a.data), stable);
});

test("inherited legacy tables migrate before local-only lookup is needed", async () => {
  const a = await device(null, 1000, {}, true, [{ note: "Notes/note.md", id: "old", legacy: true }]);
  a.directories.add("Notes");
  a.files.set(".csvzall/tables.json", JSON.stringify({ tables: [{ id: "old", input: "data.csv", options: { sql: "select * from data" } }] }));
  await a.reflection.reconcile();
  const entry = JSON.parse(a.files.get("Notes/.csvzall/exports.json")!).exports[0];
  assert.equal(entry.legacyTableId, "old"); assert.equal(entry.input, "../data.csv");
  assert.equal(a.files.has(".csvzall/tables.json.bak"), true);
});

test("frozen nearest SQL bindings own their original IDs ahead of unrelated output hints", async () => {
  const a = await device(null, 1000, {}, true, [{ note: "A/Deep/note.md", id: "same", legacy: false }]);
  a.directories.add("A"); a.directories.add("A/Deep");
  a.files.set(".csvzall/exports.json", JSON.stringify({ exports: [{ id: "same", input: "data.csv", output: "A/Deep/note.md", options: { sql: "root" } }] }));
  a.files.set("A/.csvzall/exports.json", JSON.stringify({ exports: [{ id: "same", input: "data.csv", options: { sql: "nearest" } }] }));
  await a.reflection.reconcile();
  const entries = JSON.parse(a.files.get("A/Deep/.csvzall/exports.json")!).exports;
  assert.equal(entries.find((entry: { id: string }) => entry.id === "same").options.sql, "nearest");
  assert.equal(entries.length, 2);
});

test("a late ancestor edit cannot overwrite a newer localized edit", async () => {
  const initial = JSON.stringify({ charts: [{ id: "one", type: "bar", input: "A/data.csv", options: { label: "first" } }] });
  const a = await device(initial, 1000, {}, true); a.directories.add("A"); await a.reflection.reconcile();
  const local = "A/.csvzall/charts.json";
  a.files.set(local, JSON.stringify({ charts: [{ id: "one", type: "bar", input: "data.csv", options: { label: "newer" } }] }));
  a.times.set(local, 3000); await a.reflection.reconcile();
  a.files.set(path, JSON.stringify({ charts: [{ id: "one", type: "bar", input: "A/data.csv", options: { label: "older" } }] }));
  a.times.set(path, 2000); await a.reflection.reconcile();
  assert.equal(JSON.parse(a.files.get(local)!).charts[0].options.label, "newer");
  assert.equal(JSON.parse(a.files.get(local)!).charts.length, 1);
});

test("destination write failures retain inherited originals and retry without resurrection", async () => {
  const a = await device(null, 1000, {}, true); a.directories.add("A");
  a.files.set(path, JSON.stringify({ charts: [{ id: "one", type: "bar", input: "A/data.csv" }] }));
  const write = a.adapter.write;
  a.adapter.write = async (name, text, options) => { if (name.startsWith("A/.csvzall/.reflect")) throw new Error("Read-only destination"); await write(name, text, options); };
  await a.reflection.reconcile();
  assert.equal(JSON.parse(a.files.get(path)!).charts.length, 1);
  a.adapter.write = write; await a.reflection.reconcile();
  assert.equal(JSON.parse(a.files.get(path)!).charts.length, 0);
  assert.equal(JSON.parse(a.files.get("A/.csvzall/charts.json")!).charts.length, 1);
});

test("moving a migrated SQL note follows transitive relocation history without duplicate exports", async () => {
  const a = await device(null, 1000, {}, true, [{ note: "A/note.md", id: "table", legacy: false }]);
  a.directories.add("A"); a.directories.add("B");
  a.files.set(".csvzall/exports.json", JSON.stringify({ exports: [{ id: "table", input: "data.csv", output: "A/note.md" }] }));
  await a.reflection.reconcile();
  a.references[0]!.note = "B/note.md";
  await a.reflection.renamed("A/note.md", "B/note.md");
  await a.reflection.reconcile();
  assert.equal(JSON.parse(a.files.get("B/.csvzall/exports.json")!).exports.length, 1);
  assert.equal(JSON.parse(a.files.get("A/.csvzall/exports.json")!).exports.length, 0);
});

test("legacy aliases preserve the frozen nearest binding even when canonical IDs differ", async () => {
  const a = await device(null, 1000, {}, true, [{ note: "A/Deep/note.md", id: "old", legacy: true }]);
  a.directories.add("A"); a.directories.add("A/Deep");
  a.files.set(".csvzall/exports.json", JSON.stringify({ exports: [{ id: "root", legacyTableId: "old", input: "data.csv", output: "A/Deep/note.md" }] }));
  a.files.set("A/.csvzall/exports.json", JSON.stringify({ exports: [{ id: "nearest", legacyTableId: "old", input: "data.csv" }] }));
  await a.reflection.reconcile();
  const entries = JSON.parse(a.files.get("A/Deep/.csvzall/exports.json")!).exports;
  assert.equal(entries.length, 2);
  assert.equal(entries.find((entry: { legacyTableId: string }) => entry.legacyTableId === "old").id, "nearest");
  assert.equal(a.errors.length, 0);
});

test("an incomplete note scan postpones SQL localization while charts and viewers continue", async () => {
  const a = await device(null, 1000, {}, true); a.directories.add("A"); a.scan.fail = true;
  a.files.set(path, JSON.stringify({ charts: [{ id: "chart", type: "bar", input: "A/data.csv" }] }));
  a.files.set(".csvzall/exports.json", JSON.stringify({ exports: [{ id: "table", input: "A/data.csv", output: "A/note.md" }] }));
  await a.reflection.reconcile();
  await a.reflection.prepareViewer("A/data.csv");
  assert.equal(JSON.parse(a.files.get("A/.csvzall/charts.json")!).charts.length, 1);
  assert.equal(JSON.parse(a.files.get(".csvzall/exports.json")!).exports.length, 1);
  assert.equal(a.reflection.pending, true);
  a.scan.fail = false; await a.reflection.reconcile();
  assert.equal(JSON.parse(a.files.get("A/.csvzall/exports.json")!).exports.length, 1);
  assert.equal(a.reflection.pending, false);
});

test("accented scope names use device-independent ordering for colliding IDs", async () => {
  const a = await device(null, 1000, {}, true);
  for (const folder of ["Data", "Z", "Ä"]) a.directories.add(folder);
  a.files.set("Z/.csvzall/charts.json", JSON.stringify({ charts: [{ id: "same", type: "bar", input: "../Data/one.csv" }] }));
  a.files.set("Ä/.csvzall/charts.json", JSON.stringify({ charts: [{ id: "same", type: "bar", input: "../Data/two.csv" }] }));
  await a.reflection.reconcile();
  const entries = JSON.parse(a.files.get("Data/.csvzall/charts.json")!).charts;
  assert.equal(entries.find((entry: { id: string }) => entry.id === "same").input, "one.csv");
  assert.equal(entries.length, 2);
});

test("legacy alias reservations work when configs precede their notes", async () => {
  const a = await device(null, 1000, {}, true);
  a.directories.add("A"); a.directories.add("A/Deep");
  a.files.set(".csvzall/exports.json", JSON.stringify({ exports: [{ id: "root", legacyTableId: "old", input: "data.csv", output: "A/Deep/one.md" }] }));
  a.files.set("A/.csvzall/exports.json", JSON.stringify({ exports: [{ id: "nearest", legacyTableId: "old", input: "data.csv", output: "Deep/two.md" }] }));
  await a.reflection.reconcile();
  let entries = JSON.parse(a.files.get("A/Deep/.csvzall/exports.json")!).exports;
  assert.equal(entries.length, 2); assert.equal(entries.find((entry: { legacyTableId: string }) => entry.legacyTableId === "old").id, "nearest");
  a.references.push({ note: "A/Deep/two.md", id: "old", legacy: true });
  await a.reflection.reconcile();
  entries = JSON.parse(a.files.get("A/Deep/.csvzall/exports.json")!).exports;
  assert.equal(entries.length, 2); assert.equal(entries.find((entry: { legacyTableId: string }) => entry.legacyTableId === "old").id, "nearest");
  assert.equal(a.errors.length, 0);
});

test("late SQL references in the original folder recover without losing existing local copies", async () => {
  const a = await device(null, 1000, {}, true, [{ note: "A/note.md", id: "table", legacy: false }]); a.directories.add("A");
  a.files.set(".csvzall/exports.json", JSON.stringify({ exports: [{ id: "table", input: "data.csv" }] }));
  await a.reflection.reconcile();
  a.references.push({ note: "late.md", id: "table", legacy: false });
  await a.reflection.reconcile();
  assert.equal(JSON.parse(a.files.get(".csvzall/exports.json")!).exports[0].id, "table");
  assert.equal(JSON.parse(a.files.get("A/.csvzall/exports.json")!).exports.length, 1);
  const stable = canonical(a.data); await a.reflection.reconcile(); assert.equal(canonical(a.data), stable);
});

test("an edited migrated SQL note can return to its original folder with its ID and latest query", async () => {
  const a = await device(null, 1000, {}, true, [{ note: "A/note.md", id: "table", legacy: false }]); a.directories.add("A");
  a.files.set(".csvzall/exports.json", JSON.stringify({ exports: [{ id: "table", input: "data.csv", options: { sql: "old" } }] }));
  await a.reflection.reconcile();
  const local = "A/.csvzall/exports.json", document = JSON.parse(a.files.get(local)!);
  document.exports[0].options.sql = "latest"; a.files.set(local, JSON.stringify(document)); a.times.set(local, 2000);
  await a.reflection.reconcile();
  a.references[0]!.note = "note.md"; await a.reflection.renamed("A/note.md", "note.md");
  const entries = JSON.parse(a.files.get(".csvzall/exports.json")!).exports;
  assert.equal(entries.length, 1); assert.equal(entries[0].id, "table"); assert.equal(entries[0].options.sql, "latest");
  const stable = canonical(a.data); await a.reflection.reconcile(); assert.equal(canonical(a.data), stable);
});

async function device(initial: string | null = config(), clock = 1000, data: JsonObject = {}, directFolders = false, references: ExportReference[] = []) {
  const files = new Map<string, string>(), times = new Map<string, number>();
  const directories = new Set(["", ".obsidian", ".obsidian/plugins", ".obsidian/plugins/csvzall"]);
  let disk = structuredClone(data), writes = 0, now = clock;
  const scan = { complete: true, fail: false };
  if (initial !== null) { files.set(path, initial); times.set(path, clock); directories.add(".csvzall"); }
  const adapter = {
    exists: async (path: string) => files.has(path) || directories.has(path),
    read: async (path: string) => { const text = files.get(path); if (text === undefined) throw new Error(`Missing ${path}`); return text; },
    stat: async (path: string) => files.has(path) ? { type: "file", mtime: times.get(path) ?? now, ctime: 0, size: files.get(path)!.length } : null,
    mkdir: async (path: string) => { directories.add(path); },
    write: async (path: string, text: string) => { writes++; files.set(path, text); times.set(path, now); },
    process: async (path: string, update: (text: string) => string) => { const text = update(files.get(path)!); files.set(path, text); times.set(path, now); return text; },
    rename: async (from: string, to: string) => { if (files.has(to)) throw new Error("Already exists"); files.set(to, files.get(from)!); times.set(to, now); files.delete(from); },
    remove: async (path: string) => { files.delete(path); },
  } as unknown as DataAdapter;
  const store = new PluginDataStore({ load: async () => structuredClone(disk), save: async value => { disk = structuredClone(value); } });
  await store.initialize();
  const errors: unknown[] = [];
  const reflection = new ExportReflection({ adapter, store, localDirectory: ".obsidian/plugins/csvzall/export-sync-local",
    folders: () => [...directories].filter(path => !path.startsWith(".")), report: error => errors.push(error), changed: () => {}, now: () => now,
    directFolders, references: async () => { if (scan.fail) throw new Error("Unreadable note"); return scan.complete ? references : { references, complete: false }; } });
  await reflection.initialize();
  return { files, times, adapter, store, reflection, errors, directories, references, scan,
    get data() { return structuredClone(disk); }, set data(value: JsonObject) { disk = structuredClone(value); },
    edit(text: string, time: number) { files.set(path, text); times.set(path, time); now = time; },
    get writes() { return writes; } };
}

test("data.json alone reconstructs missing CLI configs and retains nested scope and metadata", async () => {
  const first = await device();
  first.directories.add("Project");
  first.files.set("Project/.csvzall/charts.json", config("nested"));
  await first.reflection.reconcile();
  const second = await device(null, 5000, first.data);
  assert.deepEqual(JSON.parse(second.files.get(path)!), JSON.parse(config()));
  assert.equal(second.files.has("Project/.csvzall/charts.json"), false, "wait for source scope folder");
  second.directories.add("Project");
  await second.reflection.reconcile();
  assert.deepEqual(JSON.parse(second.files.get("Project/.csvzall/charts.json")!), JSON.parse(config("nested")));
  assert.equal(second.errors.length, 0);
});

test("repeated reflection and reconstruction do not create newer revisions", async () => {
  const first = await device();
  const original = first.data;
  for (let i = 0; i < 3; i++) await first.reflection.reconcile();
  assert.equal(canonical(first.data), canonical(original));
  first.files.delete(path);
  await first.reflection.reconcile();
  assert.equal(canonical(first.data), canonical(original));
  assert.deepEqual(JSON.parse(first.files.get(path)!), JSON.parse(config()));
});

test("offline concurrent edits converge per export by actual edit time in either arrival order", async () => {
  const a = await device();
  const b = await device(null, 5000, a.data);
  a.edit(config("older"), 2000); b.edit(config("newer"), 3000);
  await a.reflection.reconcile(); await b.reflection.reconcile();
  const merged = { ...b.data, ...a.data };
  a.data = merged; b.data = merged;
  await a.reflection.reconcile(); await b.reflection.reconcile();
  assert.equal(JSON.parse(a.files.get(path)!).charts[0].options.label, "newer");
  assert.equal(canonical(JSON.parse(a.files.get(path)!)), canonical(JSON.parse(b.files.get(path)!)));
  assert.equal(winners(readRevisions(a.data).values()).size, 2);
});

test("explicit deletion survives stale copies, while later intentional recreation wins", async () => {
  const a = await device(); const b = await device(null, 5000, a.data);
  a.edit('{"custom":{"keep":true},"charts":[]}', 6000);
  await a.reflection.edited(path);
  b.data = a.data; await b.reflection.reconcile();
  assert.equal(JSON.parse(b.files.get(path)!).charts.length, 0);
  const count = Object.keys(b.data).length;
  await b.reflection.reconcile(); assert.equal(Object.keys(b.data).length, count);
  b.edit(config("recreated"), 7000); await b.reflection.edited(path);
  a.data = b.data; await a.reflection.reconcile();
  assert.equal(JSON.parse(a.files.get(path)!).charts[0].options.label, "recreated");
});

test("invalid or partially written JSON is never published or replaced", async () => {
  const a = await device(); const original = a.data;
  a.edit("{", 9000); await a.reflection.reconcile();
  assert.equal(a.files.get(path), "{"); assert.ok(a.errors.length > 0);
  assert.equal(canonical(a.data), canonical(original));
  assert.throws(() => a.reflection.assertReady(path));
  a.edit(config("fixed"), 10000); await a.reflection.reconcile();
  assert.doesNotThrow(() => a.reflection.assertReady(path));
});

test("SQL stale cleanup can recover a late reference but explicit deletion cannot", async () => {
  const a = await device(null);
  const sql = ".csvzall/exports.json";
  const text = JSON.stringify({ exports: [{ id: "query", input: "data.csv", output: "note.md", options: { sql: "SELECT 1" } }] });
  a.files.set(sql, text); await a.reflection.edited(sql);
  a.files.set(sql, '{"exports":[]}'); await a.reflection.edited(sql, "stale-sql");
  assert.equal(await a.reflection.recoverSql("note.md", "query"), true);
  assert.equal(JSON.parse(a.files.get(sql)!).exports.length, 1);
  a.files.set(sql, '{"exports":[]}'); await a.reflection.edited(sql, "explicit");
  assert.equal(await a.reflection.recoverSql("note.md", "query"), false);
});

test("settings saves preserve unknown fields, incoming exports, and independent remote settings", async () => {
  const a = await device();
  const settings = await a.store.initialize();
  a.data = { ...a.data, unknown: { retained: true }, startupTimeoutMs: 999 };
  settings.openInObsidian = false;
  await a.store.saveSettings(settings);
  assert.equal(a.data.startupTimeoutMs, 999);
  assert.deepEqual(a.data.unknown, { retained: true });
  assert.equal(a.data.openInObsidian, false);
  assert.ok(readRevisions(a.data).size);
});

test("unsafe paths and tampered revisions cannot be materialized", async () => {
  const a = await device();
  const entries = [...readRevisions(a.data).values()];
  const malicious = { ...entries[0]!, path: "../.csvzall/charts.json" };
  assert.throws(() => readRevisions({ [revisionKey(malicious)]: malicious }));
  const tampered = { ...entries[0]!, clockMs: 42 };
  assert.throws(() => readRevisions({ [revisionKey(entries[0]!)]: tampered }));
});

test("losing a journal does not turn an unchanged reconstructed file into a new edit", async () => {
  const a = await device(); const b = await device(null, 5000, a.data);
  a.edit('{"charts":[]}', 3000); await a.reflection.edited(path);
  const restarted = await device(b.files.get(path)!, 5000, a.data);
  assert.equal(JSON.parse(restarted.files.get(path)!).charts.length, 0);
});

test("folder renames preserve unobserved CLI edits, publish tombstones and rebase references", async () => {
  const a = await device(null);
  const old = "Project/.csvzall/charts.json", next = "Moved/.csvzall/charts.json";
  a.directories.add("Project"); a.files.set(old, config()); await a.reflection.reconcile();
  a.directories.delete("Project"); a.directories.add("Moved");
  a.files.set(old, config("offline-edit-before-rename")); a.times.set(old, 2000);
  a.files.set(next, a.files.get(old)!); a.times.set(next, a.times.get(old)!); a.files.delete(old);
  await a.reflection.renamed("Project", "Moved");
  a.directories.add("Project"); await a.reflection.reconcile();
  assert.equal(a.files.has(old), false);
  assert.equal(JSON.parse(a.files.get(next)!).charts[0].input, "data.csv");
  assert.equal(JSON.parse(a.files.get(next)!).charts[0].options.label, "offline-edit-before-rename");
  const b = await device(null, 9000, a.data); b.directories.add("Moved"); b.directories.add("Project");
  await b.reflection.reconcile(); assert.equal(b.files.has(old), false); assert.ok(b.files.has(next));
});

test("a materialization error blocks only its scope and preserves unrelated generation", async () => {
  const a = await device(null);
  for (const scope of ["Good", "Bad"]) {
    a.directories.add(scope); a.files.set(`${scope}/.csvzall/charts.json`, config(scope));
  }
  await a.reflection.reconcile();
  const b = await device(null, 5000, a.data);
  b.directories.add("Good"); b.directories.add("Bad");
  const write = b.adapter.write;
  b.adapter.write = async (path, text) => { if (path.startsWith("Bad/")) throw new Error("Read only"); await write(path, text); };
  await b.reflection.reconcile();
  assert.ok(b.files.has("Good/.csvzall/charts.json"));
  assert.doesNotThrow(() => b.reflection.assertReady("Good/.csvzall/charts.json"));
  assert.throws(() => b.reflection.assertReady("Bad/.csvzall/charts.json"));
});

test("renames proceed past unrelated malformed files and retry their rebasing after recovery", async () => {
  const a = await device(); a.directories.add("Project");
  const nested = JSON.stringify({ charts: [{ id: "one", type: "bar", input: "../shared.csv", output: "plot.svg" }] });
  a.files.set("Project/.csvzall/charts.json", nested); await a.reflection.reconcile();
  a.files.set(path, "{");
  a.directories.delete("Project"); a.directories.add("Deep/Moved");
  a.files.set("Deep/Moved/.csvzall/charts.json", a.files.get("Project/.csvzall/charts.json")!);
  a.files.delete("Project/.csvzall/charts.json");
  await a.reflection.renamed("Project", "Deep/Moved");
  assert.equal(JSON.parse(a.files.get("Deep/Moved/.csvzall/charts.json")!).charts[0].input, "../../shared.csv");
  a.directories.add("Project");
  a.files.set(path, config()); await a.reflection.reconcile();
  assert.equal(a.files.has("Project/.csvzall/charts.json"), false);
  assert.doesNotThrow(() => a.reflection.assertReady("Deep/Moved/.csvzall/charts.json"));
  assert.equal(a.reflection.pending, false);
});

test("moving a config to a shallower scope validates its bytes in the original scope first", async () => {
  const a = await device(null); a.directories.add("Deep/Project");
  a.files.set("Deep/Project/.csvzall/charts.json", JSON.stringify({ charts: [{ id: "one", type: "bar", input: "../../shared.csv" }] }));
  await a.reflection.reconcile();
  a.directories.delete("Deep/Project"); a.directories.add("Moved");
  a.files.set("Moved/.csvzall/charts.json", a.files.get("Deep/Project/.csvzall/charts.json")!); a.files.delete("Deep/Project/.csvzall/charts.json");
  await a.reflection.renamed("Deep/Project", "Moved");
  assert.equal(JSON.parse(a.files.get("Moved/.csvzall/charts.json")!).charts[0].input, "../shared.csv");
  assert.doesNotThrow(() => a.reflection.assertReady("Moved/.csvzall/charts.json"));
});

test("manual correction recovers a shallower move after materialization initially fails", async () => {
  const a = await device(null); a.directories.add("Deep/Project");
  const old = "Deep/Project/.csvzall/charts.json", next = "Moved/.csvzall/charts.json";
  a.files.set(old, JSON.stringify({ charts: [{ id: "one", type: "bar", input: "../../shared.csv" }] }));
  await a.reflection.reconcile();
  a.directories.delete("Deep/Project"); a.directories.add("Moved");
  a.files.set(next, a.files.get(old)!); a.files.delete(old);
  const write = a.adapter.write;
  a.adapter.write = async (path, text) => { if (path.startsWith("Moved/")) throw new Error("Read only"); await write(path, text); };
  await a.reflection.renamed("Deep/Project", "Moved");
  assert.throws(() => a.reflection.assertReady(next));
  a.adapter.write = write;
  a.files.set(next, JSON.stringify({ charts: [{ id: "one", type: "bar", input: "../shared.csv", options: { title: "Corrected" } }] }));
  a.times.set(next, 3000); await a.reflection.reconcile();
  assert.doesNotThrow(() => a.reflection.assertReady(next));
  assert.equal(JSON.parse(a.files.get(next)!).charts[0].options.title, "Corrected");
});

test("late SQL references recover their own scope before an ancestor with the same ID", async () => {
  const a = await device(null); a.directories.add("Project");
  const sql = (source: string) => JSON.stringify({ exports: [{ id: "same", input: source, output: "note.md" }] });
  a.files.set(".csvzall/exports.json", sql("root.csv"));
  a.files.set("Project/.csvzall/exports.json", sql("project.csv"));
  await a.reflection.reconcile();
  a.files.set("Project/.csvzall/exports.json", '{"exports":[]}');
  await a.reflection.edited("Project/.csvzall/exports.json", "stale-sql");
  assert.throws(() => a.reflection.assertSqlBinding("Project/note.md", "same", ".csvzall/exports.json"));
  assert.equal(await a.reflection.recoverSql("Project/note.md", "same"), true);
  assert.doesNotThrow(() => a.reflection.assertSqlBinding("Project/note.md", "same", "Project/.csvzall/exports.json"));
  assert.equal(JSON.parse(a.files.get("Project/.csvzall/exports.json")!).exports[0].input, "project.csv");
});

test("incoming settings cannot replace this device's prepared helper path", async () => {
  let disk: JsonObject = { csvzallPath: "C:/device-a/helper.exe", csvzallExecutableMode: "bundled" };
  let local: unknown;
  const store = new PluginDataStore({ load: async () => disk, save: async value => { disk = value; },
    loadLocal: () => local, saveLocal: value => { local = value; } });
  const settings = await store.initialize();
  disk = { csvzallPath: "/device-b/helper", csvzallExecutableMode: "bundled", startupTimeoutMs: 9876 };
  await store.externalSettings(settings);
  assert.equal(settings.csvzallPath, "C:/device-a/helper.exe"); assert.equal(settings.startupTimeoutMs, 9876);
  settings.csvzallPath = "C:/new-local/helper.exe"; await store.saveSettings(settings);
  const restarted = await new PluginDataStore({ load: async () => disk, save: async value => { disk = value; }, loadLocal: () => local }).initialize();
  assert.equal(restarted.csvzallPath, "C:/new-local/helper.exe");
});

test("a revision observed in a racing second disk read is retained and republished", async () => {
  const a = await device();
  const [key, revision] = [...readRevisions(a.data)][0]!;
  let disk: JsonObject = {}, reads = 0, overwrite = true;
  const store = new PluginDataStore({ load: async () => {
    if (++reads === 3) disk = { ...disk, [key]: revision };
    return structuredClone(disk);
  }, save: async value => {
    disk = structuredClone(value);
    if (overwrite) { delete disk[key]; overwrite = false; }
  } });
  await store.initialize();
  await store.patch({ openInObsidian: false });
  assert.deepEqual(disk[key], revision);
});

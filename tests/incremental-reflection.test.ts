import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import type { DataAdapter } from "obsidian";
import { ExportReflection } from "../src/exports/ExportReflection.js";
import { PluginDataStore } from "../src/settings/PluginDataStore.js";
import { canonical, type JsonObject } from "../src/exports/revisions.js";
import type { ExportReference } from "../src/exports/localFolders.js";
if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });
const path = ".csvzall/charts.json";
const config = (label = "first") => JSON.stringify({ custom: { keep: true }, charts: [{ id: "one", type: "bar", input: "data.csv", output: "graph.svg", options: { label } }] });

async function device(initial: string | null = config(), clock = 1000, data: JsonObject = {}, directFolders = false, references: ExportReference[] = []) {
  const files = new Map<string, string>(), times = new Map<string, number>();
  const directories = new Set(["", ".obsidian", ".obsidian/plugins", ".obsidian/plugins/csvzall"]);
  let disk = structuredClone(data), writes = 0, now = clock;
  const scan = { complete: true, fail: false };
  const scans = { notes: 0, folders: 0 };
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
    folders: () => { scans.folders++; return [...directories].filter(path => !path.startsWith(".")); }, report: error => errors.push(error), changed: () => {}, now: () => now,
    directFolders, deferDiscovery: true, references: async () => { scans.notes++; if (scan.fail) throw new Error("Unreadable note"); return scan.complete ? references : { references, complete: false }; } });
  await reflection.initialize();
  return { files, times, adapter, store, reflection, errors, directories, references, scan, scans,
    get data() { return structuredClone(disk); }, set data(value: JsonObject) { disk = structuredClone(value); },
    edit(text: string, time: number) { files.set(path, text); times.set(path, time); now = time; },
    get writes() { return writes; } };
}

test("deferred startup skips global discovery while affected chart preparation continues", async () => {
  const a = await device(null, 1000, {}, true);
  assert.deepEqual(a.scans, { notes: 0, folders: 0 });
  a.directories.add("Data"); a.scan.fail = true;
  a.files.set(path, JSON.stringify({ charts: [{ id: "chart", input: "Data/data.csv", type: "bar", runOnSave: false }] }));
  a.files.set(".csvzall/exports.json", "{");
  await a.reflection.prepareViewer("Data/data.csv");
  assert.deepEqual(a.scans, { notes: 0, folders: 0 });
  const local = JSON.parse(a.files.get("Data/.csvzall/charts.json")!);
  assert.equal(local.charts[0].input, "data.csv"); assert.equal(local.charts[0].runOnSave, false);
  assert.equal(a.errors.length, 0);
});

test('deferred legacy SQL lookup migrates only affected ancestors and preserves aliases', async () => {
  const a = await device(null, 1000, {}, true);
  a.directories.add('Notes');
  a.files.set('.csvzall/tables.json', JSON.stringify({ custom: 5, tables: [{ id: 'old', input: 'data.csv', runOnSave: false, options: { sql: 'select * from data' } }] }));
  a.files.set('Unrelated/.csvzall/tables.json', '{');
  await a.reflection.recoverSql('Notes/note.md', 'old', true);
  const local = JSON.parse(a.files.get('Notes/.csvzall/exports.json')!);
  assert.equal(local.exports[0].legacyTableId, 'old');
  assert.equal(local.exports[0].runOnSave, false);
  assert.equal(local.custom, 5);
  assert.equal(a.files.get('Unrelated/.csvzall/tables.json'), '{');
  assert.deepEqual(a.scans, { notes: 0, folders: 0 });
  assert.deepEqual(a.errors, []);
});

test('malformed legacy SQL blocks its affected scope during deferred background and foreground preparation', async () => {
  const a = await device(null, 1000, {}, true);
  a.directories.add('Notes');
  const path = 'Notes/.csvzall/exports.json';
  const text = JSON.stringify({ exports: [{ id: 'keep', input: '../data.csv', options: { sql: 'select * from data' } }] });
  a.files.set(path, text);
  a.files.set('Notes/.csvzall/tables.json', '{');
  await a.reflection.reconcile();
  assert.throws(() => a.reflection.assertReady(path), /not ready/);
  assert.equal(a.files.get(path), text);
  await a.reflection.reconcileSql('Notes/note.md', 'keep');
  assert.throws(() => a.reflection.assertReady(path), /not ready/);
  assert.equal(a.files.get(path), text);
  a.files.delete('Notes/.csvzall/tables.json');
  await a.reflection.reconcileSql('Notes/note.md', 'keep');
  assert.doesNotThrow(() => a.reflection.assertReady(path));
  assert.equal(a.files.get(path), text);
});

test("deferred incoming chart definitions wait for delayed folders and reconstruct without timestamp churn", async () => {
  const a = await device(null, 1000, {}, true); a.directories.add("Data");
  a.files.set("Data/.csvzall/charts.json", config("nested"));
  await a.reflection.edited("Data/.csvzall/charts.json");
  const b = await device(null, 5000, a.data, true);
  assert.equal(b.files.has("Data/.csvzall/charts.json"), false);
  await b.reflection.reconcile();
  assert.equal(b.files.has("Data/.csvzall/charts.json"), false);
  b.directories.add("Data"); await b.reflection.reconcile();
  assert.deepEqual(JSON.parse(b.files.get("Data/.csvzall/charts.json")!), JSON.parse(a.files.get("Data/.csvzall/charts.json")!));
  const stable = canonical(b.data); b.files.delete("Data/.csvzall/charts.json");
  await b.reflection.reconcile();
  assert.equal(canonical(b.data), stable); assert.ok(b.files.has("Data/.csvzall/charts.json"));
  assert.equal(b.errors.length, 0);
});

test("deferred first scoped viewer open preserves newer offline local chart edits", async () => {
  const a = await device(config("remote"), 1000, {}, true); await a.reflection.reconcile();
  const b = await device(config("offline newer"), 5000, a.data, true);
  assert.equal(JSON.parse(b.files.get(path)!).charts[0].options.label, "offline newer");
  await b.reflection.prepareViewer("data.csv");
  assert.equal(JSON.parse(b.files.get(path)!).charts[0].options.label, "offline newer");
  a.data = { ...a.data, ...b.data }; await a.reflection.reconcile();
  assert.equal(JSON.parse(a.files.get(path)!).charts[0].options.label, "offline newer");
  assert.deepEqual(b.scans, { notes: 0, folders: 0 });
  assert.equal(b.errors.length, 0);
});

test("delayed reflected ancestor charts do not overwrite newer direct-folder edits on first open", async () => {
  const a = await device(null, 1000, {}, true); a.directories.add("Data");
  a.files.set(path, JSON.stringify({ charts: [{ id: "one", input: "Data/data.csv", type: "bar", options: { label: "remote inherited" } }] }));
  await a.reflection.reconcile();
  const b = await device(null, 5000, a.data, true); b.directories.add("Data");
  b.files.set("Data/.csvzall/charts.json", config("newer local"));
  await b.reflection.prepareViewer("Data/data.csv");
  assert.equal(JSON.parse(b.files.get("Data/.csvzall/charts.json")!).charts[0].options.label, "newer local");
  assert.deepEqual(b.scans, { notes: 0, folders: 0 });
  assert.equal(b.errors.length, 0);
});

test("deferred SQL scope uses the requesting note without waiting for full reference discovery", async () => {
  const a = await device(null, 1000, {}, true); a.directories.add("Notes"); a.scan.fail = true;
  a.files.set(".csvzall/exports.json", JSON.stringify({ metadata: { keep: true }, exports: [{ id: "table", input: "data.csv", runOnSave: false, options: { sql: "select 1" } }] }));
  a.files.set("Unrelated/.csvzall/exports.json", "{");
  await a.reflection.reconcileSql("Notes/note.md", "table");
  assert.deepEqual(a.scans, { notes: 0, folders: 0 });
  const local = JSON.parse(a.files.get("Notes/.csvzall/exports.json")!);
  assert.equal(local.exports[0].input, "../data.csv"); assert.equal(local.exports[0].runOnSave, false);
  assert.equal(local.exports[0].options.sql, "select 1"); assert.deepEqual(local.metadata, { keep: true });
  assert.equal(JSON.parse(a.files.get(".csvzall/exports.json")!).exports.length, 1, "retain ancestor for other owners while discovery is incomplete");
  const stable = canonical(a.data);
  await a.reflection.reconcileSql("Notes/note.md", "table");
  assert.equal(canonical(a.data), stable, "unchanged scoped preparation does not churn revisions");
  assert.equal(a.files.get("Unrelated/.csvzall/exports.json"), "{"); assert.equal(a.errors.length, 0);
});

test("incomplete deferred discovery retains inherited SQL until a late note arrives", async () => {
  const a = await device(null, 1000, {}, true); a.directories.add("Notes"); a.scan.complete = false;
  a.files.set(".csvzall/exports.json", JSON.stringify({ exports: [{ id: "table", input: "data.csv", output: "Notes/note.md", runOnSave: false }] }));
  await a.reflection.reconcile();
  assert.equal(JSON.parse(a.files.get(".csvzall/exports.json")!).exports.length, 1); assert.equal(a.reflection.pending, true);
  a.references.push({ note: "Notes/note.md", id: "table", legacy: false }); a.scan.complete = true;
  await a.reflection.reconcile();
  assert.equal(JSON.parse(a.files.get("Notes/.csvzall/exports.json")!).exports[0].runOnSave, false);
  assert.equal(JSON.parse(a.files.get(".csvzall/exports.json")!).exports.length, 0);
  assert.equal(a.reflection.pending, false); assert.equal(a.errors.length, 0);
});


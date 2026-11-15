import test from "node:test";
import assert from "node:assert/strict";
import { PluginDataStore } from "../src/settings/PluginDataStore.js";
import { DEFAULT_SETTINGS } from "../src/settings/settings.js";
import type { JsonObject } from "../src/exports/revisions.js";

for (const missing of [null, undefined]) {
  test(`first install initializes missing ${String(missing)} plugin data with device-local storage`, async () => {
    let disk: unknown = missing;
    let local: JsonObject = {};
    const writes: JsonObject[] = [];
    const store = new PluginDataStore({
      load: async () => disk,
      save: async value => { writes.push(structuredClone(value)); disk = structuredClone(value); },
      loadLocal: () => local,
      saveLocal: value => { local = structuredClone(value); },
    });

    const settings = await store.initialize();
    assert.deepEqual(settings, DEFAULT_SETTINGS);
    assert.deepEqual(disk, {});
    assert.deepEqual(writes, [{}]);
    assert.equal(local.csvzallExecutableMode, "bundled");
    assert.equal(local.csvzallPath, "csvzall");
    settings.openInObsidian = false;
    await store.saveSettings(settings);
    assert.deepEqual(disk, { openInObsidian: false });
    await store.initialize();
    assert.equal(writes.length, 2, "reinitialization does not rewrite unchanged shared data");
  });
}

test("an existing empty document initializes without a redundant write", async () => {
  let writes = 0;
  const store = new PluginDataStore({
    load: async () => ({}),
    save: async () => { writes++; },
    saveLocal: () => {},
  });
  assert.deepEqual(await store.initialize(), DEFAULT_SETTINGS);
  assert.equal(writes, 0);
});

test("first install preserves plugin data arriving before the migration write", async () => {
  let disk: unknown = null;
  let reads = 0;
  let writes = 0;
  const incoming = { openInObsidian: false, futureSetting: { keep: [1, 2] } };
  const store = new PluginDataStore({
    load: async () => {
      if (++reads === 3) disk = structuredClone(incoming);
      return disk;
    },
    save: async value => { writes++; disk = structuredClone(value); },
    saveLocal: () => {},
  });
  await store.initialize();
  assert.deepEqual(disk, incoming);
  assert.equal(writes, 0, "incoming valid data already supplies the durable document");
});

test("legacy device migration retains unknown and concurrently arriving shared fields", async () => {
  let disk: JsonObject = { csvzallPath: "C:/custom/csvzall.exe", unknown: { keep: true } };
  let reads = 0;
  let local: JsonObject = {};
  const store = new PluginDataStore({
    load: async () => {
      if (++reads === 3) disk = { ...disk, futureSetting: "synced", exportSyntax: "code" };
      return structuredClone(disk);
    },
    save: async value => { disk = structuredClone(value); },
    saveLocal: value => { local = structuredClone(value); },
  });
  const settings = await store.initialize();
  assert.equal(settings.csvzallPath, "C:/custom/csvzall.exe");
  assert.equal(local.csvzallPath, settings.csvzallPath);
  assert.deepEqual(disk, { unknown: { keep: true }, futureSetting: "synced", exportSyntax: "code" });
});

test("first install reports persistence failure instead of claiming initialization succeeded", async () => {
  const store = new PluginDataStore({
    load: async () => null,
    save: async () => { throw new Error("disk unavailable"); },
    saveLocal: () => {},
  });
  await assert.rejects(store.initialize(), /disk unavailable/);
});

test("first install verifies that its initial document was persisted", async () => {
  let writes = 0;
  const store = new PluginDataStore({
    load: async () => null,
    save: async () => { writes++; },
    saveLocal: () => {},
  });
  await assert.rejects(store.initialize(), /Plugin data changed while saving/);
  assert.equal(writes, 3, "missing readback retries remain bounded");
});

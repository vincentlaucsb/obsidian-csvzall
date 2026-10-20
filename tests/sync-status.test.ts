import test from "node:test";
import assert from "node:assert/strict";
import { syncDescription, syncStatus } from "../src/obsidian/syncStatus.js";

test("Sync diagnostics distinguish inactive, unknown, plugin configuration and file types", () => {
  assert.equal(syncStatus({}).state, "unknown");
  assert.equal(syncStatus({ internalPlugins: { getPluginById: () => ({ enabled: false }) } }).state, "inactive");
  const filter = { allowSpecialFiles: new Set<string>(), allowTypes: new Set(["unsupported"]), ignoreFolders: ["Private"] };
  const app = { internalPlugins: { getPluginById(id: string) { assert.equal(this, app.internalPlugins); assert.equal(id, "sync");
    return { enabled: true, instance: { filter, getStatus: () => "syncing" } }; } } };
  const state = syncStatus(app);
  assert.equal(state.pluginData, false); assert.equal(state.otherTypes, true); assert.equal(state.idle, false);
  assert.match(syncDescription(state), /Installed community plugins/);
  assert.match(syncDescription(state), /Private/);
  filter.allowSpecialFiles.add("community-plugin-data");
  assert.equal(syncStatus(app).pluginData, true);
  assert.equal(syncStatus({ internalPlugins: { getPluginById() { throw new Error("Changed API"); } } }).state, "unknown");
});

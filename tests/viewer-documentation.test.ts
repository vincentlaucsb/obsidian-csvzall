import test from "node:test";
import assert from "node:assert/strict";
import { openViewerDocumentation } from "../src/views/viewerDocumentation.js";

test("documentation requests only open the fixed SQLite page from the active frame", () => {
  const frameWindow = {} as Window;
  const opened: string[] = [];
  const open = (url: string): void => { opened.push(url); };
  const message = { source: "csvzall-viewer", type: "open-documentation", version: 1, page: "sqlite-capabilities" };
  assert.equal(openViewerDocumentation({ source: frameWindow, data: message }, frameWindow, open), true);
  assert.deepEqual(opened, ["https://vincentlaucsb.github.io/csvzall/sqlite_capabilities.html"]);
  opened.length = 0;
  for (const data of [null, "bad", { ...message, source: "other" }, { ...message, version: 2 },
    { ...message, type: "other" }, { ...message, page: "https://example.com/" }]) {
    assert.equal(openViewerDocumentation({ source: frameWindow, data }, frameWindow, open), false);
  }
  assert.equal(openViewerDocumentation({ source: {} as Window, data: message }, frameWindow, open), false);
  assert.equal(openViewerDocumentation({ source: null, data: message }, null, open), false);
  assert.deepEqual(opened, []);
});

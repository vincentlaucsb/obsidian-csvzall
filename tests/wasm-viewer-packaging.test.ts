import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("viewer packaging leaves JavaScript untouched, is repeatable, and rejects unsupported source", () => {
  const scratch = mkdtempSync(join(tmpdir(), "csvzall-packaging-"));
  const script = resolve("scripts/patch-wasm-viewer-bridge.mjs");
  const viewer = join(scratch, "wasm-viewer");
  const assets = join(viewer, "assets");
  const bundlePath = join(assets, "index-fixture.js");
  const htmlPath = join(viewer, "index.html");
  try {
    mkdirSync(assets, { recursive: true });
    const bundle = JSON.stringify([
      "csvzall-host-integration-v1", "csvzall-save-ack-v1", "csvzall-edit-revision-v1",
      "csvzall-obsidian-keyboard-lifecycle-v2", "csvzall-obsidian-viewport-resize-v2",
      "theme-ready", "data-csvzall-dialog-dismiss-v1",
    ]);
    writeFileSync(bundlePath, bundle);
    writeFileSync(join(assets, "index-fixture.css"), "body { color: black; }");
    writeFileSync(htmlPath, '<html><head>\r\n<link rel="stylesheet" href="./assets/index-fixture.css">\r\n</head><body></body></html>');
    const prepare = () => execFileSync(process.execPath, [script], { cwd: scratch, stdio: "pipe" });
    prepare();
    assert.equal(readFileSync(bundlePath, "utf8"), bundle);
    const html = readFileSync(htmlPath, "utf8");
    assert.match(html, /data-csvzall-inline-viewer-style/);
    assert.doesNotMatch(html, /\r/);
    prepare();
    assert.equal(readFileSync(htmlPath, "utf8"), html);
    assert.equal(readFileSync(bundlePath, "utf8"), bundle);
    writeFileSync(bundlePath, 'console.log("legacy bundle");');
    assert.throws(prepare, /Unsupported WASM viewer/);
    assert.equal(readFileSync(bundlePath, "utf8"), 'console.log("legacy bundle");');
    assert.equal(readFileSync(htmlPath, "utf8"), html);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

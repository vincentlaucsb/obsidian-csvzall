import { readFileSync } from "node:fs";
import { join } from "node:path";

// Required capabilities from the upstream host bridge and shared viewer.
export const requiredHostCapabilities = [
  "csvzall-host-mobile-ui-v1",
  "csvzall-csv-options-v1",
  "csvzall-shared-shell-v1",
  "csvzall-compact-layout-v1",
  "csvzall-host-integration-v1",
  "csvzall-save-ack-v1",
  "csvzall-host-save-request-v1",
  "csvzall-host-csv-autosave-v1",
  "csvzall-edit-revision-v1",
  "csvzall-obsidian-keyboard-lifecycle-v2",
  "csvzall-obsidian-viewport-resize-v2",
  "theme-ready",
  "discard-edits-dialog",
];

export function requireHostIntegration(bundle) {
  const missing = requiredHostCapabilities.filter(marker => !bundle.includes(marker));
  if (missing.length) {
    throw new Error(`Unsupported WASM viewer: missing source capabilities ${missing.join(", ")}. Rebuild a current csvzall checkout with npm run refresh:wasm-viewer -- --source-repo=<path>. Runtime bundle patching is no longer supported.`);
  }
}

export function readEmbeddedWorker(html, viewerDir) {
  if (!html.includes('name="csvzall-embedded-assets" content="v2"')) {
    throw new Error("Expected an embedded viewer build; rebuild upstream with --mode embedded.");
  }
  const link = html.match(/<link rel="csvzall-worker" href="\.\/(assets\/csv-worker-[\w-]+\.js)"/u);
  if (!link) throw new Error("Missing embedded CSV worker link.");
  const worker = readFileSync(join(viewerDir, link[1]));
  const wasm = worker.toString("utf8").match(/data:application\/wasm;base64,([A-Za-z0-9+/=]+)/);
  if (!wasm || !WebAssembly.validate(Buffer.from(wasm[1], "base64"))) {
    throw new Error("The embedded CSV worker must contain a valid WASM engine.");
  }
  return worker;
}

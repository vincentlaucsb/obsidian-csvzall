// Stable capabilities are emitted by the upstream source bridge's ready message.
export const requiredHostCapabilities = [
  "csvzall-csv-options-v1",
  "csvzall-shared-shell-v1",
  "csvzall-compact-layout-v1",
  "csvzall-host-integration-v1",
  "csvzall-save-ack-v1",
  "csvzall-host-save-request-v1",
  "csvzall-edit-revision-v1",
  "csvzall-obsidian-keyboard-lifecycle-v2",
  "csvzall-obsidian-viewport-resize-v2",
  "theme-ready",
  "data-csvzall-dialog-dismiss-v1",
];

export function requireHostIntegration(bundle) {
  const missing = requiredHostCapabilities.filter(marker => !bundle.includes(marker));
  if (missing.length) {
    throw new Error(`Unsupported WASM viewer: missing source capabilities ${missing.join(", ")}. Rebuild a current csvzall checkout with npm run refresh:wasm-viewer -- --source-repo=<path>. Runtime bundle patching is no longer supported.`);
  }
}

export function requireEmbeddedAssets(html, bundle) {
  if (!html.includes('name="csvzall-embedded-assets" content="v1"')) {
    throw new Error("Expected an embedded viewer build; rebuild upstream with --mode embedded.");
  }
  // Vite emits its worker as a string (or base64 in older releases). Verify
  // the actual engine bytes rather than accepting a marker or an empty stub.
  const inline = bundle.match(/data:application\/wasm;base64,([A-Za-z0-9+/=]+)/);
  if (inline && bundle.includes("createObjectURL") && bundle.includes("new Worker") &&
      WebAssembly.validate(Buffer.from(inline[1], "base64"))) return;
  for (const match of bundle.matchAll(/["']([A-Za-z0-9+/=]{1024,})["']/g)) {
    const worker = Buffer.from(match[1], "base64").toString("utf8");
    const wasm = worker.match(/data:application\/wasm;base64,([A-Za-z0-9+/=]+)/);
    if (wasm && WebAssembly.validate(Buffer.from(wasm[1], "base64"))) return;
  }
  throw new Error("The embedded viewer must include its worker and a valid inline WASM engine.");
}

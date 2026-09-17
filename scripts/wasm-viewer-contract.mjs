// Stable capabilities are emitted by the upstream source bridge's ready message.
export const requiredHostCapabilities = [
  "csvzall-host-integration-v1",
  "csvzall-save-ack-v1",
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

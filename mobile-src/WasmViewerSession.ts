import { embeddedWasmViewerAssets } from "./wasmViewerAssets.generated.js";
import { createEmbeddedViewerDocument } from "./EmbeddedViewerDocument.js";

let viewerDocument: ReturnType<typeof createEmbeddedViewerDocument> | null = null;

export function embeddedWasmViewerUrl(): string {
  if (!viewerDocument) {
    viewerDocument = createEmbeddedViewerDocument(embeddedWasmViewerAssets);
    console.debug("csvzall-mobile-embedded-wasm-viewer-v1: initialized the bundled viewer document");
  }
  return viewerDocument.url;
}

export function releaseEmbeddedWasmViewer(): void {
  viewerDocument?.dispose();
  viewerDocument = null;
}

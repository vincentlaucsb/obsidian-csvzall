import validateObject, { literal } from "../utils/validateObject.js";

const SQLITE_DOCUMENTATION_URL = "https://vincentlaucsb.github.io/csvzall/sqlite_capabilities.html";
const isDocumentationRequest = validateObject({
  source: literal("csvzall-viewer"),
  type: literal("open-documentation"),
  version: literal(1),
  page: literal("sqlite-capabilities"),
});

/** Open only the known documentation page requested by the active viewer frame. */
export function openViewerDocumentation(
  event: Pick<MessageEvent<unknown>, "source" | "data">,
  frameWindow: Window | null,
  open: (url: string) => void = (url) => { window.open(url, "_blank", "noopener,noreferrer"); },
): boolean {
  if (!frameWindow || event.source !== frameWindow || !isDocumentationRequest(event.data)) return false;
  open(SQLITE_DOCUMENTATION_URL);
  return true;
}

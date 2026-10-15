const SQLITE_DOCUMENTATION_URL = "https://vincentlaucsb.github.io/csvzall/sqlite_capabilities.html";

/** Open only the known documentation page requested by the active viewer frame. */
export function openViewerDocumentation(
  event: Pick<MessageEvent<unknown>, "source" | "data">,
  frameWindow: Window | null,
  open: (url: string) => void = (url) => { window.open(url, "_blank", "noopener,noreferrer"); },
): boolean {
  if (!frameWindow || event.source !== frameWindow) return false;
  const data = event.data;
  if (!data || typeof data !== "object") return false;
  const message = data as Record<string, unknown>;
  if (message.source !== "csvzall-viewer" || message.type !== "open-documentation" ||
      message.version !== 1 || message.page !== "sqlite-capabilities") return false;
  open(SQLITE_DOCUMENTATION_URL);
  return true;
}

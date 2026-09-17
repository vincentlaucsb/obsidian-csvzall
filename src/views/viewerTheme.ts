import type { Workspace } from "obsidian";

export const viewerThemeVariables = [
  "--background-primary", "--background-secondary", "--background-modifier-hover",
  "--background-modifier-border", "--text-normal", "--text-muted", "--text-faint",
  "--text-error", "--text-on-accent", "--interactive-accent", "--font-interface",
] as const;

export function viewerThemeMessage(style: Pick<CSSStyleDeclaration, "getPropertyValue">, dark: boolean) {
  const variables: Record<string, string> = {};
  for (const name of viewerThemeVariables) {
    const value = style.getPropertyValue(name).trim();
    if (value) variables[name] = value;
  }
  return { source: "obsidian-csvzall", type: "theme", version: 1, mode: dark ? "dark" : "light", variables };
}

/** A view owns this subscription; dispose it before replacing its iframe. */
export function synchronizeViewerTheme(container: HTMLElement, frame: HTMLIFrameElement, workspace: Workspace): () => void {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  if (!win) return () => {};
  let pending = 0;
  let previous = "";
  let disposed = false;

  const send = (force = false): void => {
    if (disposed || !frame.contentWindow) return;
    const message = viewerThemeMessage(win.getComputedStyle(container), doc.body.classList.contains("theme-dark"));
    const serialized = JSON.stringify(message);
    if (!force && serialized === previous) return;
    // Resource URLs on mobile can have opaque origins. Desktop HTTP viewers can
    // use an exact origin; neither message contains a file or session token.
    const url = new URL(frame.src, doc.baseURI);
    const origin = url.protocol === "http:" || url.protocol === "https:" ? url.origin : "*";
    frame.contentWindow.postMessage(message, origin);
    previous = serialized;
  };
  const schedule = (): void => {
    if (disposed || pending) return;
    pending = win.requestAnimationFrame(() => { pending = 0; send(); });
  };
  const onLoad = (): void => send(true);
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== frame.contentWindow) return;
    const data: unknown = event.data;
    if (!data || typeof data !== "object") return;
    const message = data as Record<string, unknown>;
    if (message.source === "csvzall-viewer" && message.type === "theme-ready" && message.version === 1) send(true);
  };
  const cssChanged = workspace.on("css-change", schedule);
  const observer = new MutationObserver(schedule);
  for (const element of [doc.documentElement, doc.body]) {
    observer.observe(element, { attributes: true, attributeFilter: ["class", "style"] });
  }
  frame.addEventListener("load", onLoad);
  win.addEventListener("message", onMessage);
  schedule();
  return () => {
    disposed = true;
    observer.disconnect();
    workspace.offref(cssChanged);
    frame.removeEventListener("load", onLoad);
    win.removeEventListener("message", onMessage);
    if (pending) win.cancelAnimationFrame(pending);
  };
}

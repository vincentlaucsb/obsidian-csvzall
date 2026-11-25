import type { Workspace } from "obsidian";
import validateObject, { literal } from "../utils/validateObject.js";

const isThemeReady = validateObject({
  source: literal("csvzall-viewer"), type: literal("theme-ready"), version: literal(1),
});

export const viewerThemeVariables = [
  "--background-primary", "--background-secondary", "--background-modifier-hover",
  "--background-modifier-border", "--text-normal", "--text-muted", "--text-faint",
  "--text-error", "--text-on-accent", "--interactive-accent", "--font-interface",
  "--font-text", "--font-monospace",
] as const;

const themeLengths = [
  "--font-preferred-size", "--font-text-size", "--font-ui-medium", "--font-ui-smaller",
  "--size-4-1", "--size-4-2", "--size-4-3", "--size-4-4", "--input-height",
] as const;

export function viewerThemeMessage(style: Pick<CSSStyleDeclaration, "getPropertyValue">, dark: boolean,
  resolveLength: (value: string) => string) {
  const variables: Record<string, string> = {};
  for (const name of viewerThemeVariables) {
    const value = style.getPropertyValue(name).trim();
    if (value) variables[name] = value;
  }
  for (const name of themeLengths) {
    const value = style.getPropertyValue(name).trim();
    if (!value) continue;
    const pixels = /^\d+(?:\.\d+)?px$/.test(value) ? value : resolveLength(value);
    if (pixels) variables[name] = pixels;
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
  let lengthProbe: HTMLSpanElement | undefined;

  // Themes can use em, rem and calc(). Resolve those lengths in the host window.
  const resolveLength = (value: string): string => {
    if (!lengthProbe) {
      lengthProbe = doc.createElement("span");
      lengthProbe.hidden = true;
      container.appendChild(lengthProbe);
    }
    lengthProbe.style.removeProperty("font-size");
    lengthProbe.style.fontSize = value;
    return lengthProbe.style.fontSize ? win.getComputedStyle(lengthProbe).fontSize : "";
  };

  const send = (force = false): void => {
    if (disposed || !frame.contentWindow) return;
    const message = viewerThemeMessage(win.getComputedStyle(container), doc.body.classList.contains("theme-dark"), resolveLength);
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
    if (event.source === frame.contentWindow && isThemeReady(event.data)) send(true);
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
    lengthProbe?.remove();
    workspace.offref(cssChanged);
    frame.removeEventListener("load", onLoad);
    win.removeEventListener("message", onMessage);
    if (pending) win.cancelAnimationFrame(pending);
  };
}

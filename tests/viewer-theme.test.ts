import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { viewerThemeMessage, viewerThemeVariables, synchronizeViewerTheme } from "../src/views/viewerTheme.js";

test("theme snapshots include only supported, computed, nonempty variables", () => {
  const message = viewerThemeMessage({ getPropertyValue: name => name === "--text-normal" ? " rgb(1, 2, 3) " : "" }, true);
  assert.deepEqual(message, { source: "obsidian-csvzall", type: "theme", version: 1, mode: "dark", variables: { "--text-normal": "rgb(1, 2, 3)" } });
  assert.equal(viewerThemeMessage({ getPropertyValue: () => "" }, false).mode, "light");
  const receiver = readFileSync("scripts/vendor/host-theme.mjs", "utf8");
  const receiverVariables = [...receiver.slice(receiver.indexOf("export const HOST_THEME_VARIABLES"), receiver.indexOf("export function parseHostTheme")).matchAll(/'(--[^']+)'/g)].map(match => match[1]);
  assert.deepEqual(receiverVariables, [...viewerThemeVariables]);
});

test("theme sync coalesces changes, resends on readiness/reload, uses the view window, and disposes", () => {
  let dark = false;
  let color = "#123456";
  let cssChanged = () => {};
  let mutation = () => {};
  let nextFrame: (() => void) | undefined;
  let disconnected = false;
  let unsubscribed = false;
  const messages: any[] = [];
  const listeners = new Map<string, (event: any) => void>();
  const loads = new Map<string, () => void>();
  const win = {
    getComputedStyle: () => ({ getPropertyValue: (name: string) => name === "--background-primary" ? color : "" }),
    requestAnimationFrame: (callback: () => void) => { nextFrame = callback; return 1; },
    cancelAnimationFrame: () => { nextFrame = undefined; },
    addEventListener: (type: string, callback: (event: any) => void) => listeners.set(type, callback),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const doc = { defaultView: win, body: { classList: { contains: () => dark } }, documentElement: {}, baseURI: "app://obsidian.md/" };
  const frame = {
    src: "http://127.0.0.1:1234/?token=private",
    contentWindow: { postMessage: (message: unknown, origin: string) => messages.push({ message, origin }) },
    addEventListener: (type: string, callback: () => void) => loads.set(type, callback),
    removeEventListener: (type: string) => loads.delete(type),
  };
  const workspace = { on: (_: string, callback: () => void) => { cssChanged = callback; return {}; }, offref: () => { unsubscribed = true; } };
  const originalObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = class {
    constructor(callback: () => void) { mutation = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  } as any;
  const flush = () => { const callback = nextFrame; nextFrame = undefined; callback?.(); };
  try {
    const dispose = synchronizeViewerTheme({ ownerDocument: doc } as any, frame as any, workspace as any);
    flush();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].origin, "http://127.0.0.1:1234");
    cssChanged(); mutation(); flush();
    assert.equal(messages.length, 1);
    dark = true; color = "#654321";
    cssChanged(); mutation(); flush();
    assert.equal(messages.length, 2);
    assert.equal(messages[1].message.mode, "dark");
    assert.equal(messages[1].message.variables["--background-primary"], color);
    const ready = { source: "csvzall-viewer", type: "theme-ready", version: 1 };
    listeners.get("message")?.({ source: {}, data: ready });
    assert.equal(messages.length, 2);
    listeners.get("message")?.({ source: frame.contentWindow, data: ready });
    loads.get("load")?.();
    assert.equal(messages.length, 4);
    frame.src = "capacitor://localhost/wasm-viewer/index.html";
    loads.get("load")?.();
    assert.equal(messages.at(-1).origin, "*");
    cssChanged();
    dispose();
    assert.equal(nextFrame, undefined);
    assert.equal(listeners.size, 0);
    assert.equal(loads.size, 0);
    assert.equal(disconnected && unsubscribed, true);
    cssChanged(); mutation(); flush();
    assert.equal(messages.length, 5);
  } finally {
    globalThis.MutationObserver = originalObserver;
  }
});

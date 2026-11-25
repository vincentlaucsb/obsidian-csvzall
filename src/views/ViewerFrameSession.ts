import { Notice, Platform, type App, type TFile } from "obsidian";
import { csvzallDirtyStateFromMessageEvent } from "../viewerHelpers.js";
import validateObject, { isBoolean, isNumber, isString, literal } from "../utils/validateObject.js";
import { synchronizeViewerTheme } from "./viewerTheme.js";
import { openViewerDocumentation } from "./viewerDocumentation.js";

interface FrameHost {
  app: App;
  wasmFile: TFile | null;
  sourceIsCurrent(): boolean;
  isDirty(): boolean;
  setDirty(dirty: boolean): void;
  showError(message: string): void;
  enqueueWrite(write: () => Promise<void>): void;
  insertQuery?: (sql: string, cancelled: () => boolean, signal: AbortSignal) => Promise<boolean>;
}

type WasmViewerMessage =
  | { source: "csvzall-wasm-viewer"; type: "ready" }
  | { source: "csvzall-wasm-viewer"; type: "dirty-state"; dirty: boolean }
  | {
    source: "csvzall-wasm-viewer";
    type: "save-file";
    buffer: ArrayBuffer;
    byteOffset?: number;
    byteLength?: number;
    requestId?: number;
  };

const wasmSource = literal("csvzall-wasm-viewer");
const isWasmReady = validateObject({ source: wasmSource, type: literal("ready") });
const isWasmDirty = validateObject({ source: wasmSource, type: literal("dirty-state"), dirty: isBoolean });
const isWasmSave = validateObject({
  source: wasmSource, type: literal("save-file"), buffer: value => value instanceof ArrayBuffer,
});

function wasmViewerMessageFromData(data: unknown): WasmViewerMessage | null {
  if (isWasmReady(data) || isWasmDirty(data)) return data;
  if (!isWasmSave(data)) return null;
  return {
    source: data.source, type: data.type, buffer: data.buffer,
    byteOffset: "byteOffset" in data && isNumber(data.byteOffset) ? data.byteOffset : undefined,
    byteLength: "byteLength" in data && isNumber(data.byteLength) ? data.byteLength : undefined,
    requestId: "requestId" in data && isNumber(data.requestId) ? data.requestId : undefined,
  };
}

const desktopProtocol = { source: literal("csvzall-viewer"), version: literal(1) };
const isExportReady = validateObject({ ...desktopProtocol, type: literal("note-export-ready") });
const isInsertQuery = validateObject({
  ...desktopProtocol,
  type: literal("insert-query"),
  requestId: (value): value is number => isNumber(value) && Number.isSafeInteger(value) && value > 0,
  sql: (value): value is string => isString(value) && value.length <= 1024 * 1024 && !!value.trim(),
  save: isBoolean,
});

const isSaveResponse = validateObject({
  source: value => value === "csvzall-viewer" || value === "csvzall-wasm-viewer",
  type: value => value === "save-response",
  version: value => value === 1,
  requestId: value => typeof value === "number",
  success: value => typeof value === "boolean",
  dirty: value => typeof value === "boolean",
});

export class ViewerFrameSession {
  private disposed = false;
  private wasmReady: (() => void) | null = null;
  private themeCleanup?: () => void;
  private mobileViewportCleanup?: () => void;
  private nextSaveRequestId = 0;
  private pendingSave: { requestId: number; resolve: () => void; reject: (error: Error) => void; timer: number } | null = null;
  private exportLifecycle: AbortController | null = null;
  private readonly completedExports = new Set<number>();

  constructor(readonly frame: HTMLIFrameElement, private readonly host: FrameHost) {}

  open(container: HTMLElement, url: string): void {
    const { frame, host } = this;
    window.addEventListener("message", this.onMessage);
    this.mobileViewportCleanup = this.installMobileViewportHandler(container);
    const ready = host.wasmFile ? new Promise<void>(resolve => { this.wasmReady = resolve; }) : null;
    frame.setAttr("src", url);
    this.themeCleanup = synchronizeViewerTheme(container, frame, host.app.workspace);
    if (host.wasmFile && ready) void this.postWasmFileToFrame(host.wasmFile, ready);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("message", this.onMessage);
    this.themeCleanup?.();
    this.mobileViewportCleanup?.();
    this.wasmReady?.();
    this.wasmReady = null;
    this.exportLifecycle?.abort();
    this.finishPendingSave(new Error("The file viewer closed before saving completed."));
  }

  private readonly onMessage = (event: MessageEvent): void => {
    const source = this.frame.contentWindow;
    if (this.disposed || !source || event.source !== source) return;
    if (this.handleSaveResponse(event.data) || this.handleExportMessage(event.data) ||
        openViewerDocumentation(event, source) || this.handleWasmViewerMessage(event)) return;
    const dirty = csvzallDirtyStateFromMessageEvent(event, source);
    if (dirty !== null) this.host.setDirty(dirty);
  };

  async requestSave(): Promise<void> {
    const target = this.frame.contentWindow;
    if (this.disposed || !target) throw new Error("The file viewer is unavailable. Your edits have not been discarded.");
    if (!this.host.sourceIsCurrent()) throw new Error("Restore the file's original path before saving, or discard the edits.");
    if (this.pendingSave) throw new Error("A save is already in progress.");
    await new Promise<void>((resolve, reject) => {
      const requestId = ++this.nextSaveRequestId;
      const timer = window.setTimeout(() => {
        this.pendingSave = null;
        reject(new Error("The viewer did not confirm the save. Your edits are still open; update the csvzall helper if needed and retry."));
      }, 60000);
      this.pendingSave = { requestId, resolve, reject, timer };
      try {
        target.postMessage({ source: "obsidian-csvzall", type: "save-request", version: 1, requestId }, "*");
      } catch (error) {
        this.finishPendingSave(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private finishPendingSave(error?: Error): void {
    const pending = this.pendingSave;
    if (!pending) return;
    this.pendingSave = null;
    window.clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve();
  }

  private handleSaveResponse(reply: unknown): boolean {
    if (!isSaveResponse(reply)) return false;
    if (!this.pendingSave || reply.requestId !== this.pendingSave.requestId) return true;
    if (!reply.success) {
      const message = "error" in reply && typeof reply.error === "string" ? reply.error : "Could not save the file. Your edits are still open.";
      this.finishPendingSave(new Error(message));
    } else if (reply.dirty) {
      this.host.setDirty(true);
      this.finishPendingSave(new Error("New edits arrived while saving. Save again before leaving."));
    } else {
      this.host.setDirty(false);
      this.finishPendingSave();
    }
    return true;
  }

  private handleExportMessage(message: unknown): boolean {
    const { frame } = this;
    const insert = this.host.insertQuery;
    const enabled = !!insert;
    if (isExportReady(message)) {
      frame.contentWindow?.postMessage({ source: 'obsidian-csvzall', type: 'note-export-capabilities', version: 1, enabled }, '*');
      return true;
    }
    if (!isInsertQuery(message)) return false;
    const requestId = message.requestId, sql = message.sql, save = message.save;
    if (this.exportLifecycle !== null || this.completedExports.has(requestId)) return true;
    const cancelled = () => this.disposed || !this.host.sourceIsCurrent();
    const lifecycle = new AbortController(); this.exportLifecycle = lifecycle;
    const run = async () => {
      if (!insert) throw new Error('Note exports are unavailable in this viewer.');
      if (this.host.isDirty()) {
        if (!save) throw new Error('Save the CSV before inserting its query into a note.');
        await this.requestSave();
      }
      if (cancelled()) return false;
      return insert(sql, cancelled, lifecycle.signal);
    };
    void run().then(success => {
      if (!cancelled()) frame.contentWindow?.postMessage({ source: 'obsidian-csvzall', type: 'insert-query-response', version: 1, requestId, success }, '*');
    }, (error: unknown) => {
      if (!cancelled()) frame.contentWindow?.postMessage({ source: 'obsidian-csvzall', type: 'insert-query-response', version: 1, requestId,
        success: false, error: error instanceof Error ? error.message : String(error) }, '*');
    }).finally(() => {
      this.exportLifecycle = null;
      if (!this.disposed) this.completedExports.add(requestId);
    });
    return true;
  }

  private async postWasmFileToFrame(file: TFile, ready: Promise<void>): Promise<void> {
    const { frame } = this;
    try {
      const [buffer] = await Promise.all([this.host.app.vault.readBinary(file), ready]);
      if (this.disposed || !frame.contentWindow) return;
      frame.contentWindow.postMessage({
        source: "obsidian-csvzall",
        type: "open-file",
        name: file.name,
        buffer,
        hostUi: { version: 1, mobile: Platform.isMobileApp },
      }, "*", [buffer]);
    } catch (error) {
      if (this.disposed) return;
      const message = error instanceof Error ? error.message : String(error);
      this.host.showError(`Failed to load CSV for the WASM viewer: ${message}`);
    }
  }

  private handleWasmViewerMessage(event: MessageEvent): boolean {
    const data = wasmViewerMessageFromData(event.data);
    if (!data) {
      return false;
    }

    if (data.type === "ready") {
      this.wasmReady?.();
      this.wasmReady = null;
      return true;
    }

    if (data.type === "dirty-state") {
      this.host.setDirty(data.dirty);
      return true;
    }

    if (data.type === "save-file") {
      this.host.setDirty(true);
      const file = this.host.wasmFile;
      if (file) this.host.enqueueWrite(() => this.saveWasmViewerFile(data, file));
      return true;
    }

    return false;
  }

  private async saveWasmViewerFile(data: Extract<WasmViewerMessage, { type: "save-file" }>, file: TFile): Promise<void> {
    if (this.disposed) return;

    const reply = (success: boolean, error?: string): void => {
      if (this.disposed) return;
      this.frame.contentWindow?.postMessage({source: "obsidian-csvzall", type: "save-result", requestId: data.requestId, success, error}, "*");
    };
    try {
      const byteOffset = typeof data.byteOffset === "number" ? data.byteOffset : 0;
      const byteLength = typeof data.byteLength === "number" ? data.byteLength : data.buffer.byteLength - byteOffset;
      const bytes = new Uint8Array(data.buffer, byteOffset, byteLength);
      const output = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ?
        bytes.buffer :
        bytes.slice().buffer;
      await this.host.app.vault.modifyBinary(file, output);
      reply(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply(false, message);
      if (!this.disposed) {
        this.host.setDirty(true);
        new Notice(`Failed to save CSV: ${message}. Your edits are still open; retry saving.`);
      }
    }
  }

  private installMobileViewportHandler(containerEl: HTMLElement): (() => void) | undefined {
    if (!Platform.isMobileApp) {
      return;
    }

    const frame = this.frame;
    const viewport = window.visualViewport;
    let animationFrame = 0;
    const update = (): void => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        const rect = containerEl.getBoundingClientRect();
        const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
        const visibleHeight = Math.max(240, Math.floor(viewportBottom - rect.top));
        frame.contentWindow?.postMessage({
          source: "obsidian-csvzall",
          type: "viewport-resized",
          height: visibleHeight,
        }, "*");
        try {
          frame.contentWindow?.dispatchEvent(new Event("resize"));
        } catch {
          // Cross-origin resource URLs can reject direct event dispatch; postMessage still reaches the viewer.
        }
      });
    };

    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    update();
    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }
}

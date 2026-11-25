import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";

const compiled = buildSync({entryPoints: ["src/views/CsvzallTableView.ts"], bundle: true, write: false, platform: "node", format: "cjs", external: ["obsidian"]}).outputFiles[0]!.text;
function fixture(isMobileApp = false) {
  const notices: string[] = [];
  const messages: any[] = [];
  const listeners = new Set<(event: unknown) => void>();
  let installClick = () => {};
  let renders = 0;
  class Element {
    inert = false;
    removed = false;
    ownerDocument = {defaultView: null};
    contentWindow = {postMessage: (message: unknown) => messages.push(message)};
    setAttr() {}
    blur() {}
    remove() { this.removed = true; }
    empty() { renders++; }
    addClass() {}
    prepend() {}
    addEventListener() {}
    createDiv() { return new Element(); }
    createEl(_tag: string, options?: {text?: string}) {
      const element = new Element();
      if (options?.text === "Use bundled helper") {
        Object.assign(element, {addEventListener: (_type: string, callback: () => void) => { installClick = callback; }});
      }
      return element;
    }
  }
  const exports: any = {};
  const module = {exports};
  runInNewContext(compiled, {module, exports, ArrayBuffer, Uint8Array, TextDecoder, AbortController, crypto,
    window: {setTimeout, clearTimeout, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
      addEventListener(type: string, listener: (event: unknown) => void) { if (type === "message") listeners.add(listener); },
      removeEventListener(type: string, listener: (event: unknown) => void) { if (type === "message") listeners.delete(listener); }},
    require: () => ({
      FileView: class {leaf: any; constructor(leaf: any) {this.leaf = leaf;}},
      Modal: class {}, setIcon() {}, Platform: {isMobileApp, isDesktopApp: !isMobileApp},
      Notice: class {constructor(message: string) {notices.push(message);}},
    })});
  const owner = {settings: {autosaveMode: "off"}, handleLeafClosed() {}, async openCsvInLeaf() {}, async installCsvzallFromView() {return false;}};
  const view = new module.exports.CsvzallTableView({}, owner);
  const file = {path: "a.csv", name: "a.csv", basename: "a", extension: "csv"};
  let disk = "";
  const vault = {
    getAbstractFileByPath: (path: string) => path === file.path ? file : null,
    readBinary: async () => new TextEncoder().encode(disk).buffer as ArrayBuffer,
    process: async (_file: unknown, update: (disk: string) => string) => { disk = update(disk); return disk; },
    modifyBinary: async (_file: unknown, _buffer: ArrayBuffer) => {},
  };
  view.app = {vault};
  view.file = file;
  view.containerEl = new Element();
  const mount = () => view.showWasmViewer("a", "resource://viewer", file);
  mount();
  const frame = view.frame;
  renders = 0;
  const message = (event: unknown) => { for (const listen of listeners) listen(event); };
  const send = (data: unknown, from = view.frame) => message({source: from.contentWindow, data});
  async function ready() {
    send({source: "csvzall-wasm-viewer", type: "ready"});
    await view.saveQueue;
  }
  return {view, file, frame, messages, notices, owner, vault, mount, message, send, ready,
    setDisk: (text: string) => { disk = text; }, disk: () => disk,
    install: () => installClick(), renders: () => renders};
}
function nextTurn() { return new Promise<void>(resolve => setImmediate(resolve)); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

test('desktop note exports validate the sender, save dirty edits first and reject duplicate insertions', async () => {
  const f = fixture();
  let inserts = 0;
  Object.assign(f.owner, { insertQueryIntoNote: async (file: unknown, sql: string) => { assert.equal(file, f.file); assert.equal(sql, 'SELECT 1'); inserts++; return true; } });
  f.view.showViewer("a", "http://localhost/");
  const data = { source: 'csvzall-viewer', type: 'insert-query', version: 1, requestId: 1, sql: 'SELECT 1', save: true };
  f.message({ source: {}, data }); assert.equal(inserts, 0);
  f.view.dirty = true;
  f.send(data);
  assert.equal(inserts, 0);
  const save = f.messages[0]; assert.equal(save.type, 'save-request');
  f.send({ source: 'csvzall-viewer', type: 'save-response', version: 1, requestId: save.requestId, success: true, dirty: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(inserts, 1);
  f.send(data);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(inserts, 1);
  assert.equal(f.messages[1].success, true);
});

test('failed saves prevent insertion and closing the frame aborts an open destination modal', async () => {
  const f = fixture();
  let inserts = 0, lifecycle: AbortSignal | undefined;
  const modal = deferred<boolean>();
  Object.assign(f.owner, { insertQueryIntoNote: (_file: unknown, _sql: string, _cancelled: unknown, signal: AbortSignal) => { inserts++; lifecycle = signal; return modal.promise; } });
  f.view.showViewer("a", "http://localhost/");
  f.view.dirty = true;
  const data = { source: 'csvzall-viewer', type: 'insert-query', version: 1, requestId: 1, sql: 'SELECT 1', save: true };
  f.send(data);
  f.send({ source: 'csvzall-viewer', type: 'save-response', version: 1, requestId: f.messages[0].requestId, success: false, dirty: true, error: 'Disk full' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(inserts, 0);
  f.view.dirty = false;
  f.send({ ...data, requestId: 2 });
  assert.equal(inserts, 1);
  await f.view.onClose();
  assert.equal(lifecycle!.aborted, true);
  const messages = f.messages.length;
  modal.resolve(true); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.messages.length, messages);
});

test("failed WASM save keeps the editor and unsaved edits available", async () => {
  const f = fixture();
  await f.ready(); f.messages.length = 0;
  f.view.dirty = true;
  f.vault.process = async () => {throw new Error("disk full");};
  f.send({source: "csvzall-wasm-viewer", type: "save-file", buffer: new ArrayBuffer(1), revision: 1, requestId: 7});
  await f.view.saveQueue;
  assert.equal(f.view.frame, f.frame);
  assert.equal(f.view.dirty, true);
  assert.equal(f.renders(), 0);
  assert.equal(f.messages[0].success, false);
  assert.equal(f.messages[0].requestId, 7);
  assert.equal(f.notices.length, 1);
});

test("save completion acknowledges without clearing newer dirty edits", async () => {
  const f = fixture(); const write = deferred<void>();
  await f.ready(); f.messages.length = 0;
  f.vault.process = async (_file, update) => { const next = update(""); await write.promise; return next; };
  f.send({source: "csvzall-wasm-viewer", type: "save-file", buffer: new ArrayBuffer(1), revision: 1, requestId: 8});
  await Promise.resolve();
  f.view.dirty = true;
  write.resolve(); await f.view.saveQueue;
  assert.equal(f.view.dirty, true);
  assert.equal(f.messages[0].success, true);
});

test("a replacement frame waits for an in-flight WASM write and only receives its own acknowledgment", async () => {
  const f = fixture();
  await f.ready(); f.messages.length = 0;
  const first = deferred<void>();
  const writes: number[] = [];
  f.vault.process = async (file, update) => {
    assert.equal(file, f.file);
    const output = update(f.disk());
    const value = output.charCodeAt(0);
    writes.push(value);
    if (value === 1) await first.promise;
    f.setDisk(output); return output;
  };
  const save = (value: number) => f.send({source: "csvzall-wasm-viewer", type: "save-file",
    buffer: Uint8Array.of(value).buffer, revision: 1, requestId: value});
  save(1);
  await nextTurn();
  save(2); // Waiting on the old frame when it is disposed.
  f.mount();
  const ready = f.ready();
  await nextTurn();
  assert.deepEqual(writes, [1]);
  first.resolve();
  await ready;
  save(3);
  await f.view.saveQueue;
  assert.deepEqual(writes, [1, 3]);
  assert.deepEqual(f.messages.filter(message => message.type === "save-result").map(message => message.requestId), [3]);
});

test("replacing a frame rejects its pending host save and ignores its late reply", async () => {
  const f = fixture();
  const oldSave = assert.rejects(f.view.saveBeforeLeaving(), /closed before saving/);
  f.mount();
  await oldSave;
  const newSave = f.view.saveBeforeLeaving();
  const response = {source: "csvzall-wasm-viewer", type: "save-response", version: 1,
    requestId: f.messages[1].requestId, success: true, dirty: false};
  f.view.dirty = true;
  f.send(response, f.frame);
  assert.equal(f.view.dirty, true);
  f.send(response);
  await newSave;
  assert.equal(f.view.dirty, false);
});

test("late WASM load failure cannot replace a newer viewer", async () => {
  const f = fixture(); const read = deferred<ArrayBuffer>();
  f.vault.readBinary = () => read.promise;
  f.mount();
  f.send({source: "csvzall-wasm-viewer", type: "ready"});
  await nextTurn();
  f.view.showViewer("replacement", "http://localhost/");
  read.reject(new Error("late read failed")); await nextTurn();
  assert.equal(f.renders(), 2);
  assert.equal(f.messages.length, 0);
});

test("late WASM read success cannot post an old file to a replacement frame", async () => {
  const f = fixture(); const read = deferred<ArrayBuffer>();
  f.vault.readBinary = () => read.promise;
  f.mount();
  f.send({source: "csvzall-wasm-viewer", type: "ready"});
  await nextTurn();
  f.view.showViewer("replacement", "http://localhost/");
  read.resolve(new ArrayBuffer(1)); await nextTurn();
  assert.equal(f.messages.length, 0);
});

test("Lite rejects a concurrent change at the vault write, reloads its bytes and ignores self writes", async () => {
  const f = fixture();
  const original = "\uFEFFid\tname\r\n1\tFirst\r\n";
  const external = original.replace("First", "Other");
  const edited = original.replace("First", "Local");
  f.setDisk(original);
  await f.ready();
  const save = (revision: number) => f.send({source: "csvzall-wasm-viewer", type: "save-file",
    buffer: new TextEncoder().encode(edited).buffer, revision, requestId: 6});
  const process = f.vault.process;
  f.vault.process = async (file, update) => { f.setDisk(external); return process(file, update); };
  save(1);
  await nextTurn();
  assert.equal(f.disk(), external);
  assert.equal(f.messages.find(m => m.type === "save-result").conflict, true);
  assert.equal(f.messages.at(-1).type, "csv-file-modified");
  assert.equal(f.messages.at(-1).revision, 2);
  assert.equal(new TextDecoder("utf-8", {ignoreBOM: true}).decode(f.messages.at(-1).buffer), external);
  f.vault.process = process;
  save(1);
  await nextTurn();
  assert.equal(f.disk(), external);
  save(2);
  await nextTurn();
  assert.equal(f.disk(), edited);
  assert.equal(f.messages.at(-1).revision, 3);
  f.view.session.fileModified();
  await f.view.saveQueue;
  assert.equal(f.messages.at(-1).type, "save-result");
});

test("the ready handshake and global settings changes deliver the AutoSave policy to each viewer", () => {
  for (const source of ["csvzall-viewer", "csvzall-wasm-viewer"]) {
    const f = fixture();
    if (source === "csvzall-viewer") f.view.showViewer("a", "http://localhost/");
    f.send({source, type: "csv-autosave-ready", version: 1});
    for (const mode of ["off", "on", "hidden"]) {
      f.owner.settings.autosaveMode = mode;
      f.view.updateAutosave();
      assert.equal(f.messages.at(-1).type, "csv-autosave-settings");
      assert.equal(f.messages.at(-1).enabled, mode === "on");
      assert.equal(f.messages.at(-1).visible, mode !== "hidden");
    }
  }
});

test("Lite compares original bytes before a non-UTF-8 save and preserves the output encoding", async () => {
  const f = fixture();
  let disk = Uint8Array.of(0x61, 0x0a, 0xe9, 0x0a);
  f.vault.readBinary = async () => disk.slice().buffer;
  f.vault.modifyBinary = async (_file, buffer) => { disk = new Uint8Array(buffer); };
  await f.ready();
  const save = (revision: number) => f.send({ source: "csvzall-wasm-viewer", type: "save-file",
    buffer: Uint8Array.of(0x61, 0x0a, 0xe8, 0x0a).buffer, requestId: 1, revision });
  disk[2] = 0xea;
  save(1);
  await nextTurn();
  assert.equal(disk[2], 0xea);
  assert.equal(f.messages.find(m => m.type === "save-result").conflict, true);
  save(2);
  await nextTurn();
  assert.deepEqual([...disk], [0x61, 0x0a, 0xe8, 0x0a]);
  assert.equal(f.messages.at(-1).success, true);
});

test("recovery creates a separate file and acknowledges the path without clearing local edits", async () => {
  const f = fixture();
  let persisted = "";
  Object.assign(f.vault, {create: async (path: string, value: string) => {
    persisted = value; return {path};
  }});
  f.view.dirty = true;
  f.send({source: "csvzall-wasm-viewer", type: "csv-autosave-ready", version: 1});
  f.send({source: "csvzall-wasm-viewer", type: "csv-recovery-request", version: 1, requestId: 7, edits: "[]"});
  await nextTurn();
  assert.equal(persisted, "[]");
  assert.equal(f.messages.at(-1).type, "csv-recovery-result");
  assert.equal(f.messages.at(-1).requestId, 7);
  assert.match(f.messages.at(-1).path, /^a\.csv\.edits-.+\.json$/);
  assert.equal(f.view.dirty, true);
});

test("WASM open messages carry versioned mobile UI policy without changing CSV bytes", async () => {
  for (const mobile of [false, true]) {
    const f = fixture(mobile);
    const buffer = new TextEncoder().encode("a\tb\n1\t2\n").buffer;
    f.vault.readBinary = async () => buffer;
    f.mount();
    f.send({source: "csvzall-wasm-viewer", type: "ready"});
    await nextTurn();
    assert.equal(f.messages[0].buffer, buffer);
    assert.equal(f.messages[0].hostUi.version, 1);
    assert.equal(f.messages[0].hostUi.mobile, mobile);
  }
});

test("a late file-open failure cannot replace the next pane", async () => {
  const f = fixture();
  const startup = deferred<void>();
  f.owner.openCsvInLeaf = () => startup.promise;
  const opening = f.view.onLoadFile(f.file);
  assert.equal(f.view.loading, true);
  await f.view.onUnloadFile(f.file);
  startup.reject(new Error("obsolete"));
  await opening;
  assert.equal(f.view.errorText, "");
});

test("Lite reads while the iframe starts and transfers the file once the viewer is ready", async () => {
  const f = fixture(true);
  let reads = 0;
  f.vault.readBinary = async () => { reads++; return new ArrayBuffer(4); };
  f.mount();
  const frame = f.view.frame;
  const contentWindow = frame.contentWindow;
  Object.assign(frame, {contentWindow: null}); // Obsidian has not attached the leaf yet.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1);
  assert.equal(f.messages.length, 0);
  frame.contentWindow = contentWindow;
  const event = {source: frame.contentWindow, data: {source: "csvzall-wasm-viewer", type: "ready"}};
  f.message(event);
  f.message(event);
  await nextTurn();
  assert.equal(f.messages.length, 1);
  assert.equal(reads, 1);
});

test("WASM rename preserves the loaded editor and uses the renamed file object", async () => {
  const f = fixture(); f.view.url = "resource://viewer";
  f.file.path = "folder/b.csv";
  await f.view.onRename(f.file);
  assert.equal(f.view.frame, f.frame);
  assert.equal(f.renders(), 0);
  assert.equal(f.view.wasmFile.path, "folder/b.csv");
});

test("canceling discard keeps renamed desktop editor locked and dirty", async () => {
  const f = fixture();
  f.view.dirty = true; f.frame.inert = true;
  f.view.confirmDiscardChanges = async () => false;
  let acted = false;
  await f.view.runProtectedLeafAction(() => {acted = true;});
  assert.equal(acted, false);
  assert.equal(f.view.dirty, true);
  assert.equal(f.frame.inert, true);
});

test('Save before navigation waits for the matching persisted viewer acknowledgment', async () => {
  const f = fixture(); f.view.dirty = true;
  f.view.confirmDiscardChanges = async () => { await f.view.saveBeforeLeaving(); return true; };
  let acted = false;
  const navigation = f.view.runProtectedLeafAction(() => { acted = true; });
  assert.equal(acted, false);
  const request = f.messages[0];
  const response = { source: 'csvzall-wasm-viewer', type: 'save-response', version: 1, requestId: request.requestId, success: true, dirty: false };
  f.send({ ...response, requestId: request.requestId + 1 });
  f.send({ ...response, success: "true" });
  f.send({ ...response, dirty: 0 });
  await nextTurn();
  assert.equal(acted, false);
  assert.equal(f.view.dirty, true);
  f.send(response); await navigation;
  assert.equal(acted, true); assert.equal(f.view.dirty, false);
});

test('failed saves and edits during saving retain dirty state and stop navigation', async () => {
  for (const success of [true, false]) {
    const f = fixture(); f.view.dirty = true;
    const pending = f.view.saveBeforeLeaving();
    const rejected = assert.rejects(pending, success ? /New edits/ : /disk full/);
    f.send({ source: 'csvzall-wasm-viewer', type: 'save-response', version: 1,
      requestId: f.messages[0].requestId, success, dirty: true, error: 'disk full' });
    await rejected; assert.equal(f.view.dirty, true);
  }
});

test('late confirmation cannot navigate a replacement CSV view', async () => {
  const f = fixture(); f.view.dirty = true;
  const decision = deferred<boolean>();
  f.view.confirmDiscardChanges = () => decision.promise;
  let acted = false;
  const pending = f.view.runProtectedLeafAction(() => { acted = true; });
  f.view.renderGeneration++;
  decision.resolve(true); await pending;
  assert.equal(acted, false);
});

test('navigation to a disappearing file preserves the existing edit guard', async () => {
  const f = fixture();
  f.view.dirty = true;
  f.view.confirmDiscardChanges = async () => true;
  await assert.rejects(f.view.runProtectedLeafAction(() => Promise.reject(new Error('target file disappeared'))), /target file disappeared/);
  assert.equal(f.view.dirty, true);
});

test('a rejected repair returns the current pane to a retryable state', async () => {
  const f = fixture();
  f.owner.installCsvzallFromView = async () => { throw Object.assign(new Error('plugin directory disappeared'), { code: 'ENOENT' }); };
  f.view.missingCsvzallText = 'missing';
  f.view.renderMissingCsvzall();
  f.install();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.view.loading, false);
  assert.match(f.view.missingCsvzallText, /plugin directory disappeared/);
});

for (const installed of [true, false]) {
  test(`late install ${installed ? "success" : "failure"} cannot replace a newer same-file viewer`, async () => {
    const f = fixture(); const install = deferred<boolean>();
    let opened = 0;
    f.owner.installCsvzallFromView = () => install.promise;
    f.owner.openCsvInLeaf = async () => {opened++;};
    f.view.missingCsvzallText = "missing";
    f.view.renderMissingCsvzall();
    f.install();
    f.view.renderGeneration += 2; // A → B → A, with the same TFile object.
    f.view.dirty = true;
    const renders = f.renders();
    install.resolve(installed);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(opened, 0);
    assert.equal(f.renders(), renders);
    assert.equal(f.view.dirty, true);
  });
}

test("dirty desktop rename pauses interaction while retaining edits and unlocks on restoration", async () => {
  const f = fixture();
  f.view.wasmFile = null; f.view.url = "http://localhost/"; f.view.dirty = true; f.view.desktopSourcePath = "a.csv";
  f.file.path = "folder/b.csv";
  await f.view.onRename(f.file);
  assert.equal(f.frame.inert, true);
  assert.equal(f.view.dirty, true);
  assert.equal(f.renders(), 0);
  const warning = f.view.renameWarning;
  f.file.path = "a.csv";
  await f.view.onRename(f.file);
  assert.equal(f.frame.inert, false);
  assert.equal(warning.removed, true);
  assert.equal(f.view.dirty, true);
});

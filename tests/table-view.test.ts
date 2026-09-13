import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";

const compiled = buildSync({entryPoints: ["src/views/CsvzallTableView.ts"], bundle: true, write: false, platform: "node", format: "cjs", external: ["obsidian"]}).outputFiles[0]!.text;
function fixture() {
  const notices: string[] = [];
  class Element {
    inert = false;
    removed = false;
    contentWindow = {postMessage: (message: unknown) => messages.push(message)};
    setAttr() {}
    blur() {}
    remove() { this.removed = true; }
    createDiv() { return new Element(); }
    createEl(optionsOrTag?: unknown, options?: {text?: string}) {
      return {addEventListener(_: string, callback: () => void) {
        if (options?.text === "Install csvzall") installClick = callback;
      }};
    }
  }
  let installClick = () => {};
  const messages: any[] = [];
  const exports: any = {};
  const module = {exports};
  runInNewContext(compiled, {module, exports, ArrayBuffer, Uint8Array, require: () => ({
    FileView: class {leaf: any; constructor(leaf: any) {this.leaf = leaf;}},
    Modal: class {}, Platform: {isMobileApp: false}, Notice: class {constructor(message: string) {notices.push(message);}},
  })});
  const owner = {handleLeafClosed() {}, async openCsvInLeaf() {}, async installCsvzallFromView() {return false;}};
  const view = new module.exports.CsvzallTableView({}, owner);
  const file = {path: "a.csv", name: "a.csv", basename: "a"};
  const frame = new Element();
  view.file = file; view.wasmFile = file; view.frame = frame;
  view.containerEl = {createDiv: () => new Element(), prepend() {}};
  let renders = 0;
  view.render = () => {renders++; view.renderGeneration++;};
  return {view, file, frame, messages, notices, owner, install: () => installClick(), renders: () => renders};
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

test("failed WASM save keeps the editor and unsaved edits available", async () => {
  const f = fixture();
  f.view.dirty = true;
  f.view.app = {vault: {modifyBinary: async () => {throw new Error("disk full");}}};
  await f.view.saveWasmViewerFile({buffer: new ArrayBuffer(1), requestId: 7}, f.file, f.frame);
  assert.equal(f.view.frame, f.frame);
  assert.equal(f.view.dirty, true);
  assert.equal(f.renders(), 0);
  assert.equal(f.messages[0].success, false);
  assert.equal(f.messages[0].requestId, 7);
  assert.equal(f.notices.length, 1);
});

test("save completion acknowledges without clearing newer dirty edits", async () => {
  const f = fixture(); const write = deferred<void>();
  f.view.app = {vault: {modifyBinary: () => write.promise}};
  const save = f.view.saveWasmViewerFile({buffer: new ArrayBuffer(1), requestId: 8}, f.file, f.frame);
  f.view.dirty = true;
  write.resolve(); await save;
  assert.equal(f.view.dirty, true);
  assert.equal(f.messages[0].success, true);
});

test("late WASM load failure cannot replace a newer viewer", async () => {
  const f = fixture(); const read = deferred<ArrayBuffer>();
  f.view.app = {vault: {readBinary: () => read.promise}};
  const load = f.view.postWasmFileToFrame(f.frame);
  f.view.frame = {};
  read.reject(new Error("late read failed")); await load;
  assert.equal(f.renders(), 0);
  assert.equal(f.messages.length, 0);
});

test("late WASM read success cannot post an old file to a replacement frame", async () => {
  const f = fixture(); const read = deferred<ArrayBuffer>();
  f.view.app = {vault: {readBinary: () => read.promise}};
  const load = f.view.postWasmFileToFrame(f.frame);
  f.view.frame = {};
  read.resolve(new ArrayBuffer(1)); await load;
  assert.equal(f.messages.length, 0);
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

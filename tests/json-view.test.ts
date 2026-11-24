import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { EditorState } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";

const requireModule = createRequire(import.meta.url);
const cm: typeof import("@codemirror/view") = requireModule("@codemirror/view");
const bundle = buildSync({ entryPoints: ["src/views/JsonFileView.ts"], bundle: true, write: false,
  format: "cjs", platform: "node", packages: "external" }).outputFiles[0]!.text;

function fixture() {
  const file = { name: "test.json", basename: "test", path: "notes/test.json" };
  let disk = '{"n":1}';
  const writes: string[] = [], copies: string[] = [], notices: string[] = [];
  const recovery = { value: "", select() {} };
  let save!: () => void, modify!: (file: unknown) => void;
  let atWrite = async () => {};
  let editor!: TestEditor;
  // A real EditorState drives the text and undo history without mounting DOM.
  class TestEditor {
    dom = { inert: false };
    constructor(public options: { state: EditorState }) { editor = this; }
    get state() { return this.options.state; }
    setState(state: EditorState) { this.options.state = state; }
    destroy() {}
  }
  Object.assign(TestEditor, { lineWrapping: cm.EditorView.lineWrapping, contentAttributes: cm.EditorView.contentAttributes,
    updateListener: cm.EditorView.updateListener });
  const vault = {
    read: async () => disk,
    process: async (_file: unknown, change: (text: string) => string) => {
      await atWrite(); disk = change(disk); writes.push(disk); modify(file);
    },
    create: async (_path: string, text: string) => { copies.push(text); },
    on: (_event: string, callback: typeof modify) => { modify = callback; },
  };
  class FileView {
    app = { vault };
    file = file;
    addAction(_icon: string, _title: string, callback: typeof save) { save = callback; }
    registerEvent() {}
  }
  const module = { exports: {} as any };
  runInNewContext(bundle, { module, exports: module.exports, crypto: { randomUUID: () => "test" },
    console: { warn() {}, error() {} }, require: (name: string) => {
      if (name === "obsidian") return { FileView, Notice: class { constructor(text: string) { notices.push(text); } },
        Modal: class { titleEl = { setText() {} }; contentEl = { createEl() { return recovery; } }; open() {} } };
      if (name === "@codemirror/view") return { ...cm, EditorView: TestEditor };
      return requireModule(name);
    } });
  let view: any;
  module.exports.registerJsonView({ manifest: { id: "csvzall" }, registerExtensions() {},
    registerView(_type: string, factory: () => unknown) { view = factory(); } });
  function edit(before: string, after: string) {
    const from = editor.state.doc.toString().indexOf(before);
    assert.ok(from >= 0);
    const transaction = editor.state.update({ changes: { from, to: from + before.length, insert: after } });
    editor.setState(transaction.state);
    for (const listener of editor.state.facet(cm.EditorView.updateListener)) {
      listener({ docChanged: true, state: editor.state } as ViewUpdate);
    }
  }
  return { view, file, edit, save, writes, copies, notices, vault, recovery, text: () => editor.state.doc.toString(),
    open: async () => { await view.onOpen(); await view.onLoadFile(file); },
    external: (text: string) => { disk = text; modify(file); },
    atWrite: (callback: () => Promise<void>) => { atWrite = callback; },
    settle: async () => { await new Promise(resolve => setImmediate(resolve)); } };
}

test("open, edit and revert produce zero writes; clean panes follow external changes", async () => {
  const f = fixture(); await f.open();
  assert.equal(f.text(), '{\n  "n": 1\n}');
  f.edit("1", "2"); f.edit("2", "1"); f.save(); await f.settle();
  f.external('{"n":3}'); await f.settle();
  assert.match(f.text(), /"n": 3/);
  await f.view.onUnloadFile(f.file);
  assert.deepEqual(f.writes, []);
});

test("edits made during an explicit save are flushed on close", async () => {
  const f = fixture(); await f.open();
  f.edit("1", "2");
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  f.atWrite(() => blocked); f.save(); await f.settle();
  f.edit("2", "3"); const closing = f.view.onUnloadFile(f.file);
  release(); await closing;
  assert.deepEqual(f.writes, ['{"n":2}', '{"n":3}']);
});

test("undoing edits after a remote modification reveals the latest disk text", async () => {
  const f = fixture(); await f.open();
  f.edit("1", "2"); f.external('{"new":42}'); await f.settle();
  assert.match(f.text(), /"n": 2/);
  f.edit("2", "1"); await f.settle();
  assert.match(f.text(), /"new": 42/);
  assert.deepEqual(f.writes, []);
});

test("a competing edit at the mutation boundary survives save and recovery on close", async () => {
  const f = fixture(); await f.open(); f.edit("1", "2");
  f.atWrite(async () => { f.external('{"n":4}'); });
  f.save(); await f.settle();
  assert.match(f.notices[0]!, /changed on disk/);
  assert.match(f.text(), /"n": 2/);
  await f.view.onUnloadFile(f.file);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.copies, ['{"n":2}']);
});

test("a closing pane offers selectable recovery text if the folder disappears", async () => {
  const f = fixture(); await f.open(); f.edit("1", "2");
  f.atWrite(async () => { throw new Error("Missing file"); });
  f.vault.create = async () => { throw new Error("Missing directory"); };
  await f.view.onUnloadFile(f.file);
  assert.equal(f.recovery.value, '{"n":2}');
  assert.deepEqual(f.writes, []);
});

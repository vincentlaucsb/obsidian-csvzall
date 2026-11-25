import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";

const requireModule = createRequire(import.meta.url);
const cm: typeof import("@codemirror/view") = requireModule("@codemirror/view");
const bundle = buildSync({ entryPoints: ["src/views/JsonFileView.ts"], bundle: true, write: false,
  format: "cjs", platform: "node", packages: "external" }).outputFiles[0]!.text;

function fixture(mode: "on" | "off" | "hidden" = "off") {
  const file = { name: "test.json", basename: "test", path: "notes/test.json" };
  let disk = '{"n":1}';
  const writes: string[] = [], copies: string[] = [], notices: string[] = [];
  const recovery = { value: "", select() {} };
  let modify!: (file: unknown) => void;
  let atWrite = async () => {};
  let editor!: TestEditor;
  // A real EditorState drives the text and undo history without mounting DOM.
  class TestEditor {
    dom = { inert: false };
    constructor(public options: { state: EditorState }) { editor = this; }
    get state() { return this.options.state; }
    setState(state: EditorState) { this.options.state = state; }
    dispatch(spec: TransactionSpec) {
      const transaction = this.state.update(spec);
      this.setState(transaction.state);
      for (const listener of this.state.facet(cm.EditorView.updateListener)) {
        listener({ docChanged: transaction.docChanged, state: this.state } as ViewUpdate);
      }
    }
    focus() {}
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
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const ownerDocument = {
    defaultView: {
      setTimeout(callback: () => void, delay: number) {
        assert.equal(delay, 800);
        timers.set(++nextTimer, callback);
        return nextTimer;
      },
      clearTimeout(id: number) { timers.delete(id); },
    },
    createElement: () => Object.assign(new EventTarget(), {
      append() {}, replaceChildren() {}, createSpan() { return {}; }, setAttribute() {},
    }),
  };
  class FileView {
    app = { vault };
    file = file;
    contentEl = { ownerDocument, addClass() {}, append() {} };
    registerEvent() {}
    register() {}
  }
  const module = { exports: {} as any };
  runInNewContext(bundle, { module, exports: module.exports, crypto: { randomUUID: () => "test" },
    console: { warn() {}, error() {} }, require: (name: string) => {
      if (name === "obsidian") return { FileView, setIcon() {}, Notice: class { constructor(text: string) { notices.push(text); } },
        Modal: class { titleEl = { setText() {} }; contentEl = { createEl() { return recovery; } }; open() {} } };
      if (name === "@codemirror/view") return { ...cm, EditorView: TestEditor };
      return requireModule(name);
    } });
  let view: any;
  module.exports.registerJsonView({ manifest: { id: "csvzall" }, registerExtensions() {},
    app: { workspace: { on() {} } }, registerEvent() {},
    registerView(_type: string, factory: () => unknown) { view = factory(); } }, true, () => mode);
  function edit(before: string, after: string) {
    const from = editor.state.doc.toString().indexOf(before);
    assert.ok(from >= 0);
    editor.dispatch({ changes: { from, to: from + before.length, insert: after } });
  }
  const save = () => view.toolbar.save.dispatchEvent(new Event("click"));
  const reset = () => view.toolbar.reset.dispatchEvent(new Event("click"));
  return { view, file, edit, save, reset, writes, copies, notices, vault, recovery, timers,
    policy: (next: typeof mode) => { mode = next; view.updateAutosave(); },
    tick: () => {
      assert.equal(timers.size, 1);
      const [callback] = timers.values();
      timers.clear();
      callback!();
    },
    text: () => editor.state.doc.toString(),
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

test("toolbar reset returns to the last save and reads newer vault edits without a write", async () => {
  const f = fixture(); await f.open();
  const { save, reset, filename } = f.view.toolbar;
  assert.equal(filename.textContent, f.file.name);
  assert.ok(save.disabled && reset.disabled);
  let resume!: () => void;
  const blockedRead = new Promise<void>(resolve => { resume = resolve; });
  const read = f.vault.read;
  f.vault.read = async () => { await blockedRead; return read(); };
  f.external('{"n":1}'); await f.settle();
  f.edit("1", "2");
  assert.ok(!save.disabled && !reset.disabled);
  f.save();
  assert.ok(save.disabled && reset.disabled, "save queued behind a refresh");
  f.reset(); resume(); await f.settle();
  f.edit("2", "3"); f.reset(); await f.settle();
  assert.match(f.text(), /"n": 2/);
  f.edit("2", "4"); f.external('{"other":5}'); f.reset(); await f.settle();
  assert.match(f.text(), /"other": 5/);
  assert.ok(save.disabled && reset.disabled);
  assert.deepEqual(f.writes, ['{"n":2}']);
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

test("a new JSON file stays editable while the previous file finishes recovery", async () => {
  const f = fixture(); await f.open(); f.edit("1", "2");
  f.external('{"n":3}');
  let resumeCopy!: () => void, copyStarted!: () => void;
  const started = new Promise<void>(resolve => { copyStarted = resolve; });
  const blocked = new Promise<void>(resolve => { resumeCopy = resolve; });
  f.vault.create = async (_path, text) => { copyStarted(); await blocked; f.copies.push(text); };
  const closing = f.view.onUnloadFile(f.file);
  await started;
  const next = { name: "next.json", basename: "next", path: "notes/next.json" };
  f.view.file = next;
  await f.view.onLoadFile(next);
  resumeCopy(); await closing;
  f.edit("3", "4"); f.save(); await f.settle();
  assert.deepEqual(f.copies, ['{"n":2}']);
  assert.deepEqual(f.writes, ['{"n":4}']);
});

test("Lite AutoSave debounces edits, honors the policy while queued, and checks disk inside the manual save path", async () => {
  const f = fixture("on"); await f.open();
  f.edit("1", "2");
  f.edit("2", "3");
  assert.deepEqual(f.writes, []);
  f.tick(); await f.settle();
  assert.deepEqual(f.writes, ['{"n":3}']);
  assert.equal(f.timers.size, 0);

  let releaseRead!: () => void;
  const blockedRead = new Promise<void>(resolve => { releaseRead = resolve; });
  const read = f.vault.read;
  f.vault.read = async () => { await blockedRead; return read(); };
  f.external('{"n":3}'); await f.settle();
  f.edit("3", "4"); f.tick();
  f.policy("hidden");
  releaseRead(); await f.settle();
  assert.deepEqual(f.writes, ['{"n":3}']);

  f.policy("on");
  f.atWrite(async () => { f.external('{"n":5}'); });
  f.tick(); await f.settle();
  assert.deepEqual(f.writes, ['{"n":3}']);
  assert.match(f.text(), /"n": 4/);
  assert.match(f.notices[0]!, /changed on disk/);
  assert.equal(f.timers.size, 0);
});

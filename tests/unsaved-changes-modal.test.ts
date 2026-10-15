import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';

const source = buildSync({ entryPoints: ['src/views/UnsavedChangesModal.ts'], bundle: true, write: false,
  platform: 'node', format: 'cjs', external: ['obsidian'] }).outputFiles[0]!.text;

function fixture(save: () => Promise<void>) {
  let focused: Element | null = null;
  const notices: string[] = [];
  class Element {
    children: Element[] = [];
    disabled = false;
    listeners = new Map<string, () => void>();
    constructor(public tag = '', public options: { text?: string; cls?: string; attr?: Record<string, string> } = {}) {}
    setText(text: string) { this.options.text = text; }
    empty() { this.children = []; }
    createEl(tag: string, options = {}) { const child = new Element(tag, options); this.children.push(child); return child; }
    createDiv(options = {}) { return this.createEl('div', options); }
    addEventListener(type: string, action: () => void) { this.listeners.set(type, action); }
    focus() { focused = this; }
    click() { if (!this.disabled) this.listeners.get('click')?.(); }
  }
  class Modal {
    contentEl = new Element(); titleEl = new Element();
    onOpen() {} onClose() {}
    open() { this.onOpen(); } close() { this.onClose(); }
  }
  const module = { exports: {} as any };
  runInNewContext(source, { module, exports: module.exports, Error, require: () => ({ Modal, Notice: class {
    constructor(text: string) { notices.push(text); }
  } }) });
  const modal = new module.exports.UnsavedChangesModal({}, save);
  const result = modal.confirmDiscard();
  const buttons = modal.contentEl.children.find((element: Element) => element.options.cls === 'modal-button-container').children as Element[];
  return { modal, result, notices, buttons, get focused() { return focused; }, button: (text: string) => buttons.find(button => button.options.text === text)! };
}
const settle = async () => { for (let i = 0; i < 12; ++i) await Promise.resolve(); };

test('unsaved dialog uses the native title and focuses the accent Save action', async () => {
  const f = fixture(async () => {});
  assert.equal(f.modal.titleEl.options.text, 'Unsaved changes');
  assert.ok(!f.modal.contentEl.children.some((element: { tag: string }) => element.tag === 'h2'));
  assert.equal(f.button('Save').options.cls, 'mod-cta');
  assert.equal(f.button('Save').options.attr!.autofocus, '');
  assert.equal(f.focused, f.button('Save'));
  f.button('Cancel').click(); assert.equal(await f.result, false);
});

test('Save waits for persistence; failure keeps the dialog open for retry', async () => {
  let finish!: () => void;
  let reject!: (error: Error) => void;
  const f = fixture(() => new Promise<void>((yes, no) => { finish = yes; reject = no; }));
  let completed = false; void f.result.then(() => { completed = true; });
  f.button('Save').click(); await settle();
  assert.equal(completed, false);
  assert.equal(f.button('Discard changes').disabled, true);
  reject(new Error('disk full')); await settle();
  assert.equal(completed, false);
  assert.equal(f.button('Save').disabled, false);
  assert.equal(f.notices[0], 'disk full');
  f.button('Save').click(); finish();
  assert.equal(await f.result, true);
});

test('cancel or close during saving never authorizes navigation later', async () => {
  for (const cancel of [true, false]) {
    let finish!: () => void;
    const f = fixture(() => new Promise<void>(resolve => { finish = resolve; }));
    f.button('Save').click();
    if (cancel) f.button('Cancel').click(); else f.modal.close();
    assert.equal(await f.result, false);
    finish(); await settle();
    assert.equal(await f.result, false);
  }
});

test('discard proceeds without calling save', async () => {
  const f = fixture(async () => { throw new Error('Unexpected save'); });
  f.button('Discard changes').click();
  assert.equal(await f.result, true);
});

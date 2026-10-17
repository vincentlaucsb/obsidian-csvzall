import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { findManagedTables, managedTableText } from '../src/markdown/managedTables.js';

const require = createRequire(import.meta.url);
const recipe = { version: 1 as const, id: 'tasks', source: 'Data/tasks.csv', columns: [], sql: '' };
const oldTable = managedTableText(recipe, '| title |\n| --- |\n| Old |');
class FakeFile {
  constructor(public path: string) {}
  get extension() { return this.path.split('.').pop(); }
  get basename() { return this.path.split('/').pop()!.replace(/\.[^.]+$/, ''); }
}
class FakeView {}

async function harness() {
  let formOptions: any;
  const result = await build({ entryPoints: ['src/markdown/MarkdownTableService.ts'], bundle: true,
    platform: 'node', format: 'cjs', write: false, external: ['obsidian'],
    plugins: [{ name: 'mock-modal', setup(builder) {
      builder.onResolve({ filter: /TableModal\.js$/ }, () => ({ path: 'mock-modal', external: true }));
    } }],
  });
  const module = { exports: {} as any };
  runInNewContext(result.outputFiles[0]!.text, { module, exports: module.exports, console,
    crypto: webcrypto, window: { setTimeout, clearTimeout, setInterval, clearInterval }, require(name: string) {
      if (name === 'obsidian') return { TFile: FakeFile, MarkdownView: FakeView, Notice: class {} };
      if (name === 'mock-modal') return { TableModal: class { constructor(_app: unknown, options: unknown) { formOptions = options; } open() {} } };
      return require(name);
    },
  });
  const note = new FakeFile('Reports/tasks.md');
  const extraNotes = new Map<FakeFile, string>();
  const csv = new FakeFile(recipe.source);
  let text = `My prose\n\n${oldTable}\n\nAfterwards\n`;
  let writes = 0;
  let leaves: unknown[] = [];
  let ready = () => {};
  const events = new Map<string, (...args: any[]) => void>();
  const queries: string[][] = [], errors: string[] = [];
  let query = async () => '| title |\n| --- |\n| New |\n';
  const configs = new Map<string, string>([['.csvzall/exports.json', JSON.stringify({ exports: [{ id: recipe.id, input: recipe.source, output: note.path, runOnSave: true, options: { columns: [], sql: '' } }] })]]);
  let failWrite = false;
  const adapter = {
    exists: async (path: string) => configs.has(path) || path.endsWith('.csvzall'),
    read: async (path: string) => { if (!configs.has(path)) throw new Error('File missing'); return configs.get(path)!; },
    write: async (path: string, value: string) => { if (failWrite) throw new Error('Disk full'); configs.set(path, value); },
    process: async (path: string, update: (text: string) => string) => {
      if (!configs.has(path)) throw new Error('File missing');
      const text = update(configs.get(path)!);
      if (failWrite) throw new Error('Disk full');
      configs.set(path, text);
      return text;
    },
    rename: async (old: string, path: string) => {
      if (configs.has(path)) throw new Error('Destination file already exists!');
      configs.set(path, configs.get(old)!); configs.delete(old);
    },
    remove: async (path: string) => { configs.delete(path); },
    mkdir: async () => {},
  };
  const app = { workspace: { getLeavesOfType: () => leaves, onLayoutReady: (callback: () => void) => { ready = callback; } }, vault: {
    adapter,
    read: async (file: FakeFile) => file === note ? text : extraNotes.get(file)!,
    getMarkdownFiles: () => [note, ...extraNotes.keys()],
    getFiles: () => [note, csv],
    on: (event: string, callback: (...args: any[]) => void) => { events.set(event, callback); },
    getAbstractFileByPath: (path: string) => path === note.path ? note : path === csv.path ? csv : Array.from(extraNotes.keys()).find(file => file.path === path) ?? null,
    process: async (file: FakeFile, fn: (value: string) => string) => {
      if (file !== note) { extraNotes.set(file, fn(extraNotes.get(file)!)); return; }
      const next = fn(text); if (next !== text) { ++writes; text = next; }
    },
  } };
  const service = new module.exports.MarkdownTableService(app, { getVaultRoot: () => 'vault' }, {
    captureCommand: async (args: string[]) => { queries.push(args); return await query(); },
  }, { record: async (_level: string, _message: string, detail: string) => { errors.push(detail); } });
  const settle = async () => { for (let i = 0; i < 30; ++i) await Promise.resolve(); };
  return { service, note, queries, errors, configs, adapter,
    addNote(path: string, body: string) { const file = new FakeFile(path); extraNotes.set(file, body); return { file, get text() { return extraNotes.get(file)!; } }; },
    failWrites(value = true) { failWrite = value; },
    async reindex() { await service.initialize(); }, get text() { return text; }, set text(value: string) { text = value; },
    get formOptions() { return formOptions; },
    get writes() { return writes; }, setQuery(fn: () => Promise<string>) { query = fn; },
    async start() { service.register({ register() {}, registerEvent() {} }); ready(); await settle(); },
    async event(name: string, ...args: unknown[]) { events.get(name)?.(...args); await settle(); },
    csv,
    async drain() { await service.drain(); },
    installEditor(initial: string) {
      let buffer = initial;
      let cursor = buffer.length;
      const editor = { getValue: () => buffer, getCursor: () => ({ line: 0, ch: cursor }), posToOffset: (pos: { ch: number }) => pos.ch,
        offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
        replaceRange: (replacement: string, from: { ch: number }, to = from) => { buffer = buffer.slice(0, from.ch) + replacement + buffer.slice(to.ch); },
      };
      const view = Object.assign(new FakeView(), { file: note, editor, getMode: () => 'source' });
      leaves = [{ view }];
      return { view, editor, setCursor(offset: number) { cursor = offset; }, get text() { return buffer; } };
    },
  };
}

test('CSV refresh writes a real Markdown region, preserving prose and skipping unchanged results', async () => {
  const f = await harness();
  await f.service.refresh(f.note);
  assert.match(f.text, /^My prose\n\n/);
  assert.match(f.text, /\| New \|/);
  assert.match(f.text, /Afterwards\n$/);
  assert.deepEqual(Array.from(f.queries[0]!.slice(0, 7)), ['sql', 'query', '--csv', 'Data/tasks.csv', '--format', 'markdown', '--sql']);
  assert.equal(f.writes, 1);
  await f.service.refresh(f.note);
  assert.equal(f.writes, 1);
  f.service.unload();
});

test('query failure retains the previous table and deduplicates error notices', async () => {
  const f = await harness();
  f.setQuery(async () => { throw new Error('no such column'); });
  const original = f.text;
  await f.service.refresh(f.note);
  await f.service.refresh(f.note);
  assert.equal(f.text, original);
  assert.equal(f.writes, 0);
  assert.equal(f.errors.length, 1);
  f.service.unload();
});

test('refresh adds Live Preview spacing to existing tables without accumulating blank lines', async () => {
  const f = await harness();
  const body = '| title |\n| --- |\n| Old |';
  f.text = `Before\n\n<!-- csvzall:export tasks -->\n${body}\n<!-- /csvzall:export tasks -->\n\nAfter`;
  f.setQuery(async () => body);
  await f.service.refresh(f.note);
  const formatted = `Before\n\n${managedTableText(recipe, body)}\n\nAfter`;
  assert.equal(f.text, formatted);
  assert.equal(f.writes, 1);
  await f.service.refresh(f.note);
  assert.equal(f.text, formatted);
  assert.equal(f.writes, 1);
  await f.service.detach(f.note, findManagedTables(f.text)[0]!);
  assert.equal(f.text, `Before\n\n${body}\n\nAfter`);
  f.service.unload();
});

test('edits and detach during generation prevent stale output from replacing content', async () => {
  for (const detach of [false, true]) {
    const f = await harness();
    let finish!: (value: string) => void;
    f.setQuery(() => new Promise<string>(resolve => { finish = resolve; }));
    const pending = f.service.refresh(f.note);
    while (!finish) await Promise.resolve();
    f.text = detach ? 'Keep this static table' : f.text.replace('| Old |', '| My edit |');
    const expected = f.text;
    finish('| title |\n| --- |\n| Stale |');
    await pending;
    assert.equal(f.text, expected);
    assert.equal(f.writes, 0);
    f.service.unload();
  }
});

test('unloading during generation prevents writes', async () => {
  const f = await harness();
  let finish!: (value: string) => void;
  f.setQuery(() => new Promise<string>(resolve => { finish = resolve; }));
  const pending = f.service.refresh(f.note);
  while (!finish) await Promise.resolve();
  f.service.unload();
  finish('Late output');
  await pending;
  assert.equal(f.writes, 0);
});

test('startup and CSV saves regenerate tables, while generated note saves do not loop', async () => {
  const f = await harness();
  await f.start(); await f.drain();
  assert.equal(f.queries.length, 1);
  await f.event('modify', f.note); await f.drain();
  assert.equal(f.queries.length, 1);
  await f.event('modify', f.csv); await f.event('modify', f.csv); await f.drain();
  assert.equal(f.queries.length, 2);
  f.service.unload();
});

test('open note refresh uses the editing buffer and preserves unsaved prose', async () => {
  const f = await harness();
  const editor = f.installEditor(f.text + 'Unsaved commentary');
  await f.service.refresh(f.note);
  assert.match(editor.text, /\| New \|/);
  assert.match(editor.text, /Unsaved commentary$/);
  assert.equal(f.writes, 0);
  f.service.unload();
});

test('source rename updates instructions without rewriting surrounding note content', async () => {
  const f = await harness();
  await f.start(); await f.drain();
  const oldPath = f.csv.path;
  f.csv.path = 'Data/renamed.csv';
  await f.event('rename', f.csv, oldPath);
  await f.drain();
  assert.match(f.configs.get('.csvzall/exports.json')!, /Data\/renamed.csv/);
  assert.doesNotMatch(f.text, /renamed.csv/);
  assert.match(f.text, /^My prose/);
  assert.match(f.text, /Afterwards\n$/);
  assert.equal(f.errors.length, 0);
  f.service.unload();
});

test('a new CSV save during generation discards the older result and reruns', async () => {
  const f = await harness();
  await f.start(); await f.drain();
  let finish!: (value: string) => void;
  f.setQuery(() => new Promise<string>(resolve => { finish = resolve; }));
  const pending = f.service.refresh(f.note);
  while (!finish) await Promise.resolve();
  await f.event('modify', f.csv);
  const original = f.text;
  finish('Outdated output'); await pending;
  assert.equal(f.text, original);
  f.setQuery(async () => '| title |\n| --- |\n| Latest |');
  await f.drain();
  assert.match(f.text, /Latest/);
  f.service.unload();
});

test('cancelling the dialog during a query prevents insertion', async () => {
  const f = await harness();
  f.service.open(null, f.csv);
  let finish!: (value: string) => void;
  f.setQuery(() => new Promise<string>(resolve => { finish = resolve; }));
  const cancellation = new AbortController();
  const pending = f.formOptions.submit({ source: f.csv.path, destination: 'New.md', columns: [], sql: '', autoUpdate: true }, cancellation.signal);
  while (!finish) await Promise.resolve();
  cancellation.abort(); finish('Late output');
  await assert.rejects(pending, /insertion cancelled/);
  assert.equal(f.writes, 0);
  f.service.unload();
});


function legacyText(id = recipe.id, sql = recipe.sql) {
  return `Before\n<!-- csvzall:table ${encodeURIComponent(JSON.stringify({ ...recipe, id, sql }))} -->\n| title |\n| --- |\n| Existing |\n<!-- /csvzall:table ${id} -->\nAfter`;
}

test('migration saves definitions before shortening markers and retains the existing Markdown', async () => {
  const f = await harness();
  f.configs.clear(); f.text = legacyText();
  await f.reindex();
  assert.equal(f.text, 'Before\n<!-- csvzall:export tasks -->\n| title |\n| --- |\n| Existing |\n<!-- /csvzall:export tasks -->\nAfter');
  const saved = JSON.parse(f.configs.get('.csvzall/exports.json')!);
  assert.equal(saved.exports[0].input, recipe.source);
  assert.equal(saved.exports[0].output, f.note.path);
  const original = f.text;
  await f.reindex(); assert.equal(f.text, original);
  f.service.unload();
});

test('failed config writes and malformed configuration leave inline definitions intact', async () => {
  for (const malformed of [false, true]) {
    const f = await harness(); f.text = legacyText();
    const original = f.text;
    if (malformed) f.configs.set('.csvzall/exports.json', '{ broken');
    else { f.configs.clear(); f.failWrites(); }
    await f.reindex();
    assert.equal(f.text, original); assert.equal(f.writes, 0);
    assert.equal(f.errors.length, 1);
    f.service.unload();
  }
});

test('migration handles ID collisions without replacing an existing definition', async () => {
  const f = await harness(); f.text = legacyText('tasks', 'SELECT title FROM data');
  await f.reindex();
  const saved = JSON.parse(f.configs.get('.csvzall/exports.json')!);
  assert.equal(saved.exports.length, 2); assert.equal(saved.exports[0].options.sql, '');
  assert.equal(saved.exports[1].options.sql, 'SELECT title FROM data');
  assert.notEqual(saved.exports[1].id, 'tasks');
  assert.match(f.text, new RegExp(`csvzall:export ${saved.exports[1].id} -->`));
  f.service.unload();
});

test('missing config keeps rendered tables; restoring a definition schedules a refresh', async () => {
  const f = await harness(), original = f.text;
  const saved = f.configs.get('.csvzall/exports.json')!;
  f.configs.clear(); await f.reindex(); await f.service.refresh(f.note);
  assert.equal(f.text, original); assert.equal(f.queries.length, 0);
  f.configs.set('.csvzall/exports.json', saved); await f.reindex(); await f.drain();
  assert.match(f.text, /New/);
  f.service.unload();
});

test('changing a config while a query runs discards its stale result', async () => {
  const f = await harness(); let finish!: (value: string) => void;
  f.setQuery(() => new Promise<string>(resolve => { finish = resolve; }));
  const pending = f.service.refresh(f.note);
  while (!finish) await Promise.resolve();
  const config = JSON.parse(f.configs.get('.csvzall/exports.json')!);
  config.exports[0].options.sql = 'SELECT title FROM data';
  f.configs.set('.csvzall/exports.json', JSON.stringify(config));
  const original = f.text; finish('Stale'); await pending;
  assert.equal(f.text, original);
  f.setQuery(async () => 'Latest'); await f.drain(); assert.match(f.text, /Latest/);
  f.service.unload();
});

test('runOnSave false pauses automatic updates and manual refresh remains available', async () => {
  const f = await harness();
  const config = JSON.parse(f.configs.get('.csvzall/exports.json')!);
  config.exports[0].runOnSave = false; f.configs.set('.csvzall/exports.json', JSON.stringify(config));
  await f.start(); await f.drain(); await f.event('modify', f.csv); await f.drain();
  assert.equal(f.queries.length, 0);
  await f.service.refresh(f.note); assert.match(f.text, /New/);
  f.service.unload();
});


test('a config edit between definition reads cannot be paired with an older recipe', async () => {
  const f = await harness();
  const read = f.adapter.read; let reads = 0;
  f.adapter.read = async path => {
    if (path === '.csvzall/exports.json' && ++reads === 2) {
      const config = JSON.parse(f.configs.get(path)!); config.exports[0].options.sql = 'SELECT title FROM data';
      f.configs.set(path, JSON.stringify(config));
    }
    return read(path);
  };
  const original = f.text;
  await f.service.refresh(f.note); assert.equal(f.text, original);
  await f.drain(); assert.match(f.text, /New/);
  f.service.unload();
});

test('migration preserves CRLF and table whitespace and retries safely after note edits', async () => {
  const f = await harness(); f.text = legacyText().replace(/\n/g, '\r\n').replace('| Existing |', '| Existing |  ');
  const originalBody = f.text.slice(f.text.indexOf('\r\n') + 2);
  const write = f.adapter.write; let once = true;
  f.adapter.write = async (path, text) => { if (once) { once = false; f.text = f.text.replace('Existing', 'Hand edited'); } await write(path, text); };
  await f.reindex(); assert.match(f.text, /%7B/); assert.match(f.text, /Hand edited/);
  await f.reindex();
  assert.doesNotMatch(f.text, /%7B/); assert.match(f.text, /\r\n\| Hand edited \|  \r\n/);
  assert.match(originalBody, /Existing/);
  assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.length, 1);
  f.service.unload();
});


test('moving a paused note into a different scope retains its update policy', async () => {
  const f = await harness();
  const config = JSON.parse(f.configs.get('.csvzall/exports.json')!); config.exports[0].runOnSave = false;
  f.configs.set('Reports/.csvzall/exports.json', JSON.stringify({ exports: [{ ...config.exports[0], input: '../Data/tasks.csv', output: 'tasks.md' }] }));
  f.configs.delete('.csvzall/exports.json');
  await f.start(); await f.drain(); assert.equal(f.queries.length, 0);
  const old = f.note.path; f.note.path = 'Archive/tasks.md';
  await f.event('rename', f.note, old); await f.reindex(); await f.drain();
  assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports[0].runOnSave, false);
  assert.equal(f.queries.length, 0); assert.equal(f.errors.length, 0);
  f.service.unload();
});


function valueConfig(f: Awaited<ReturnType<typeof harness>>) {
  const config = JSON.parse(f.configs.get('.csvzall/exports.json')!);
  config.exports[0].format = 'value'; config.exports[0].options.sql = 'SELECT COUNT(*) FROM data';
  f.configs.set('.csvzall/exports.json', JSON.stringify(config));
  f.text = `There are **${managedTableText({ id: 'tasks', format: 'value' }, '7')}** open tasks.`;
}

test('inline scalar refresh and detach preserve the surrounding sentence', async () => {
  const f = await harness(); valueConfig(f); f.setQuery(async () => 'count\n8\n');
  await f.service.refresh(f.note);
  assert.equal(f.text, `There are **${managedTableText({ id: 'tasks', format: 'value' }, '8')}** open tasks.`);
  assert.equal(f.queries[0]![5], 'csv'); assert.match(f.queries[0]![7]!, /LIMIT 2$/);
  await f.service.detach(f.note, findManagedTables(f.text)[0]!);
  assert.equal(f.text, 'There are **8** open tasks.');
  f.service.unload();
});

test('invalid scalar result shapes retain the previous inline value', async () => {
  for (const csv of ['n\n', 'n\n1\n2\n', 'a,b\n1,2\n']) {
    const f = await harness(); valueConfig(f); const original = f.text; f.setQuery(async () => csv);
    await f.service.refresh(f.note); assert.equal(f.text, original); assert.equal(f.errors.length, 1);
    f.service.unload();
  }
});

test('inserting a scalar writes an inline region at the cursor and stores its format', async () => {
  const f = await harness(); const editor = f.installEditor('There are  open tasks.'); editor.setCursor(10);
  f.service.open(editor.view); f.setQuery(async () => 'n\n7\n');
  await f.formOptions.submit({ source: f.csv.path, columns: [], sql: 'SELECT COUNT(*) FROM data', autoUpdate: true, format: 'value' }, new AbortController().signal);
  const region = findManagedTables(editor.text)[0]!;
  assert.equal(editor.text, `There are ${region.text} open tasks.`); assert.equal(region.body, '7');
  const definitions = JSON.parse(f.configs.get('.csvzall/exports.json')!).exports;
  assert.equal(definitions.find((entry: { id: string }) => entry.id === region.id).format, 'value');
  f.service.unload();
});

test('short table markers migrate after the config is safely converted', async () => {
  const f = await harness();
  f.configs.set('.csvzall/tables.json', JSON.stringify({ tables: [{ id: 'tasks', input: f.csv.path, options: { sql: '' } }] }));
  f.configs.delete('.csvzall/exports.json');
  f.text = 'Before\n<!-- csvzall:table tasks -->\n| old |  \n<!-- /csvzall:table tasks -->\nAfter';
  await f.reindex();
  assert.equal(f.text, 'Before\n<!-- csvzall:export tasks -->\n| old |  \n<!-- /csvzall:export tasks -->\nAfter');
  assert.ok(f.configs.has('.csvzall/exports.json')); assert.ok(f.configs.has('.csvzall/tables.json.bak'));
  f.service.unload();
});


test('legacy table migration allocates an ID in the current scope before canonical lookup', async () => {
  const f = await harness();
  f.configs.set('Reports/.csvzall/exports.json', JSON.stringify({ exports: [{ id: 'tasks', input: 'other.csv', format: 'value', options: { sql: 'SELECT 99' } }] }));
  f.configs.set('.csvzall/tables.json', JSON.stringify({ tables: [{ id: 'tasks', input: f.csv.path }] }));
  f.configs.delete('.csvzall/exports.json');
  f.text = '<!-- csvzall:table tasks -->\n| Old |\n<!-- /csvzall:table tasks -->';
  await f.reindex(); await f.service.refresh(f.note);
  const region = findManagedTables(f.text)[0]!; assert.notEqual(region.id, 'tasks');
  assert.equal(f.queries[0]![3], f.csv.path); assert.equal(f.queries[0]![5], 'markdown');
  assert.match(f.text, /New/); assert.equal(f.errors.length, 0);
  f.service.unload();
});


test('changing inline scalar format to table inserts paragraph boundaries', async () => {
  const f = await harness(); valueConfig(f);
  const config = JSON.parse(f.configs.get('.csvzall/exports.json')!); config.exports[0].format = 'table';
  f.configs.set('.csvzall/exports.json', JSON.stringify(config));
  await f.service.refresh(f.note);
  assert.match(f.text, /There are \*\*\n\n<!-- csvzall:export tasks -->\n\n\| title \|/);
  assert.match(f.text, /<!-- \/csvzall:export tasks -->\n\n\*\* open tasks\.$/);
  assert.doesNotMatch(f.text, /<span>/);
  f.service.unload();
});


test('converting an inline value to a static table retains Markdown paragraph boundaries', async () => {
  const f = await harness(); valueConfig(f);
  f.text = f.text.replace('**', '').replace('**', '');
  const buffer = f.installEditor(f.text), existing = findManagedTables(buffer.text)[0]!;
  f.service.open(buffer.view, undefined, existing);
  for (let i = 0; i < 40 && !f.formOptions; ++i) await Promise.resolve();
  await f.formOptions.submit({ source: f.csv.path, columns: [], sql: 'SELECT title FROM data', autoUpdate: false, format: 'table' }, new AbortController().signal);
  assert.equal(buffer.text, 'There are \n\n| title |\n| --- |\n| New |\n\n open tasks.');
  assert.equal(findManagedTables(buffer.text).length, 0);
  f.service.unload();
});


test('deleting file exports detaches every note copy and keeps rendered content and unrelated scopes', async () => {
  const f = await harness();
  const copy = f.addNote('Reports/copy.md', `Copy\n\n${oldTable}\nEnd`);
  f.configs.set('Other/.csvzall/exports.json', JSON.stringify({ exports: [{ id: recipe.id, input: 'other.csv' }] }));
  const unrelated = f.addNote('Other/note.md', oldTable);
  const before = f.text;
  await f.service.removeExports(recipe.source, ['.csvzall/exports.json']);
  assert.equal(findManagedTables(f.text).length, 0);
  assert.equal(findManagedTables(copy.text).length, 0);
  assert.match(f.text, /My prose\n\n\| title \|/);
  assert.match(f.text, /\| Old \|\n\nAfterwards/);
  assert.match(copy.text, /\| Old \|/);
  assert.equal(unrelated.text, oldTable);
  assert.deepEqual(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports, []);
  assert.equal(f.queries.length, 0);
  assert.notEqual(f.text, before);
  f.service.unload();
});

for (const format of ['table', 'value'] as const) {
test(`deleting one SQL ${format} detaches all its copies and preserves sibling exports and scopes`, async () => {
  const f = await harness();
  const selected = { ...recipe, format, sql: format === 'value' ? 'SELECT COUNT(*) FROM data' : '' };
  const body = format === 'value' ? '7' : '| title |\n| --- |\n| Old |';
  const region = managedTableText(selected, body);
  const sibling = managedTableText({ id: 'count', format: 'value' }, '12');
  f.configs.set('.csvzall/exports.json', JSON.stringify({ metadata: 'keep', exports: [
    { id: selected.id, input: selected.source, output: f.note.path, format, runOnSave: false, options: { sql: selected.sql } },
    { id: 'count', input: selected.source, format: 'value', runOnSave: false, options: { sql: 'SELECT 12' } },
  ] }));
  f.text = `Before\n\n${region}\n\nTotal: ${sibling}.`;
  const copy = f.addNote('Reports/copy.md', `Copy\n\n${region}\nEnd`);
  f.configs.set('Other/.csvzall/exports.json', JSON.stringify({ exports: [
    { id: selected.id, input: '../Data/tasks.csv', format, runOnSave: false },
  ] }));
  const unrelated = f.addNote('Other/note.md', region);
  const buffer = f.installEditor(`${f.text}\nUnsaved prose`);
  const saved = (await f.service.listExports([])).find((entry: any) => entry.recipe.id === selected.id);
  await f.service.removeExport(saved);
  assert.equal(buffer.text, `Before\n\n${body}\n\nTotal: ${sibling}.\nUnsaved prose`);
  assert.equal(copy.text, `Copy\n\n${body}\nEnd`);
  assert.equal(unrelated.text, region);
  assert.deepEqual(findManagedTables(buffer.text).map(table => table.id), ['count']);
  const config = JSON.parse(f.configs.get('.csvzall/exports.json')!);
  assert.equal(config.metadata, 'keep');
  assert.deepEqual(config.exports.map((entry: any) => entry.id), ['count']);
  assert.equal(f.queries.length, 0);
  f.service.unload();
});
}

test('stale SQL deletion leaves linked notes and the changed configuration intact', async () => {
  const f = await harness(), original = f.text;
  const saved = (await f.service.listExports([]))[0];
  const config = JSON.parse(f.configs.get('.csvzall/exports.json')!);
  config.exports[0].options.sql = 'SELECT 99';
  const current = JSON.stringify(config); f.configs.set('.csvzall/exports.json', current);
  await assert.rejects(f.service.removeExport(saved), /export changed/);
  assert.equal(f.text, original);
  assert.equal(f.configs.get('.csvzall/exports.json'), current);
  f.service.unload();
});

for (const individual of [false, true]) {
test(`${individual ? 'individual' : 'group'} export deletion preserves unrelated orphan references`, async () => {
  const f = await harness();
  const orphan = '<!-- csvzall:export orphan -->\n\nPrevious output\n\n<!-- /csvzall:export orphan -->';
  const legacy = '<!-- csvzall:table missing -->\n\nLegacy output\n\n<!-- /csvzall:table missing -->';
  const unrelated = f.addNote('Other/orphan.md', `${orphan}\n\n${legacy}`);
  const saved = (await f.service.listExports([]))[0];
  if (individual) await f.service.removeExport(saved);
  else await f.service.removeExports(recipe.source, ['.csvzall/exports.json']);
  assert.equal(unrelated.text, `${orphan}\n\n${legacy}`);
  assert.equal(findManagedTables(f.text).length, 0);
  assert.match(f.text, /\| Old \|/);
  assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.length, 0);
  f.service.unload();
});
}

test('a failed note detach keeps the SQL definition and can be retried', async () => {
  const f = await harness();
  const buffer = f.installEditor(f.text), original = buffer.text;
  const saved = (await f.service.listExports([]))[0];
  const replace = buffer.editor.replaceRange;
  buffer.editor.replaceRange = () => { throw new Error('Editor unavailable'); };
  await assert.rejects(f.service.removeExport(saved), /Editor unavailable/);
  assert.equal(buffer.text, original);
  assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.length, 1);
  buffer.editor.replaceRange = replace;
  await f.service.removeExport(saved);
  assert.equal(findManagedTables(buffer.text).length, 0);
  assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.length, 0);
  f.service.unload();
});

test('failed SQL definition removal keeps rendered content and allows retry', async () => {
  const f = await harness(), original = f.configs.get('.csvzall/exports.json');
  const saved = (await f.service.listExports([]))[0];
  f.failWrites();
  await assert.rejects(f.service.removeExport(saved), /Disk full/);
  assert.equal(f.configs.get('.csvzall/exports.json'), original);
  assert.equal(findManagedTables(f.text).length, 0);
  assert.match(f.text, /\| Old \|/);
  f.failWrites(false);
  await f.service.removeExport(saved);
  assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.length, 0);
  f.service.unload();
});

test('deleting a SQL export invalidates an in-flight refresh', async () => {
  const f = await harness();
  const saved = (await f.service.listExports([]))[0];
  let finish!: (value: string) => void;
  f.setQuery(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.service.refresh(f.note);
  while (!finish) await Promise.resolve();
  await f.service.removeExport(saved);
  finish('Stale output'); await pending;
  assert.equal(findManagedTables(f.text).length, 0);
  assert.match(f.text, /\| Old \|/);
  assert.doesNotMatch(f.text, /Stale output/);
  f.service.unload();
});

test('deleting exports respects unsaved buffers and invalidates a running refresh', async () => {
  const f = await harness();
  const editor = f.installEditor(`Unsaved prose\n\n${oldTable}\nLast line`);
  let finish: (value: string) => void = () => {};
  f.setQuery(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.service.refresh(f.note);
  for (let i = 0; i < 50; ++i) await Promise.resolve();
  await f.service.removeExports(recipe.source, ['.csvzall/exports.json']);
  finish('| title |\n| --- |\n| Stale |'); await pending;
  assert.match(editor.text, /^Unsaved prose/);
  assert.match(editor.text, /\| Old \|/);
  assert.doesNotMatch(editor.text, /csvzall:|Stale/);
  assert.equal(f.writes, 0);
  f.service.unload();
});

test('settings configure updates an existing export identity and preserves the pause state', async () => {
  const f = await harness();
  const config = JSON.parse(f.configs.get('.csvzall/exports.json')!);
  config.exports[0].runOnSave = false; f.configs.set('.csvzall/exports.json', JSON.stringify(config));
  const saved = (await f.service.listExports([]))[0];
  let savedCalls = 0;
  f.service.configureExport(saved, () => { savedCalls++; });
  assert.equal(f.formOptions.value.autoUpdate, false);
  await f.formOptions.submit({ ...f.formOptions.value, sql: 'SELECT title FROM data', columns: [] }, new AbortController().signal);
  const updated = JSON.parse(f.configs.get('.csvzall/exports.json')!).exports;
  assert.equal(updated.length, 1); assert.equal(updated[0].id, recipe.id);
  assert.equal(updated[0].options.sql, 'SELECT title FROM data');
  assert.equal(updated[0].runOnSave, false); assert.equal(savedCalls, 1);
  f.service.unload();
});

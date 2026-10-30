import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { findManagedTables, managedTableText } from '../src/markdown/managedTables.js';
import { fencedTableText, fencedRecipe } from '../src/markdown/fencedTables.js';

const require = createRequire(import.meta.url);
const recipe = { version: 1 as const, id: 'tasks', source: 'Data/tasks.csv', columns: [], sql: '' };
const oldTable = managedTableText(recipe, '| title |\n| --- |\n| Old |');
class FakeFile {
  constructor(public path: string) {}
  get extension() { return this.path.split('.').pop(); }
  get basename() { return this.path.split('/').pop()!.replace(/\.[^.]+$/, ''); }
}
class FakeView {}
class FakeFolder { constructor(public path: string) {} }

function fakeClock() {
  let now = 0, next = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    setTimeout(callback: () => void, delay: number) { const id = ++next; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout(id: number) { timers.delete(id); },
    async advance(delay: number) {
      const end = now + delay;
      for (;;) {
        const next = Array.from(timers).filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback();
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      now = end;
      await new Promise<void>(resolve => setImmediate(resolve));
    },
  };
}

async function harness(reflection?: any, clock?: ReturnType<typeof fakeClock>) {
  let syncing = true;
  let formOptions: any, noteLink: any, destinationOptions: any;
  const opened: Array<{ kind: unknown; file: unknown; state: unknown }> = [];
  const intervals = new Set<ReturnType<typeof setInterval>>();
  const result = await build({ entryPoints: ['src/markdown/MarkdownTableService.ts'], bundle: true,
    platform: 'node', format: 'cjs', write: false, external: ['obsidian'],
    plugins: [{ name: 'mock-modal', setup(builder) {
      builder.onResolve({ filter: /TableModal\.js$/ }, () => ({ path: 'mock-modal', external: true }));
    } }],
  });
  const module = { exports: {} as any };
  runInNewContext(result.outputFiles[0]!.text, { module, exports: module.exports, console,
    crypto: webcrypto, AbortController, window: { setTimeout: clock?.setTimeout ?? setTimeout, clearTimeout: clock?.clearTimeout ?? clearTimeout,
      setInterval(callback: () => void, delay: number) { const timer = setInterval(callback, delay); intervals.add(timer); return timer; },
      clearInterval(timer: ReturnType<typeof setInterval>) { intervals.delete(timer); clearInterval(timer); },
    }, require(name: string) {
      if (name === 'obsidian') return { TFile: FakeFile, TFolder: FakeFolder, MarkdownView: FakeView, Notice: class {} };
      if (name === 'mock-modal') return { TableModal: class { constructor(_app: unknown, options: unknown, note: unknown, destination: unknown) { formOptions = options; noteLink = note; destinationOptions = destination; } open() {} } };
      return require(name);
    },
  });
  const note = new FakeFile('Reports/tasks.md');
  const extraNotes = new Map<FakeFile, string>();
  const csv = new FakeFile(recipe.source);
  let text = `My prose\n\n${oldTable}\n\nAfterwards\n`;
  let writes = 0;
  let reads = 0;
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
  const app = { internalPlugins: { getPluginById: () => ({ enabled: true, instance: {
    getStatus: () => syncing ? 'syncing' : 'synced', filter: { allowTypes: new Set(), allowSpecialFiles: new Set() } } }) },
    workspace: { on: (event: string, callback: (...args: any[]) => void) => { events.set(event, callback); }, getLeavesOfType: () => leaves, getActiveFile: () => note,
    getLeaf: (kind: unknown) => ({ openFile: async (file: unknown, state: unknown) => { opened.push({ kind, file, state }); } }), onLayoutReady: (callback: () => void) => { ready = callback; } }, vault: {
    adapter,
    read: async (file: FakeFile) => { ++reads; return file === note ? text : extraNotes.get(file)!; },
    getAllLoadedFiles: () => [new FakeFolder('/'), new FakeFolder('Reports'), ...Array.from(extraNotes.keys(), file => new FakeFolder(file.path.split('/').slice(0, -1).join('/')))],
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
  }, { record: async (_level: string, _message: string, detail: string) => { errors.push(detail); } }, reflection);
  const settle = () => new Promise<void>(resolve => setImmediate(resolve));
  return { service, note, queries, errors, configs, adapter, syncReady() { syncing = false; },
    addNote(path: string, body: string) { const file = new FakeFile(path); extraNotes.set(file, body); return { file, get text() { return extraNotes.get(file)!; }, set text(value: string) { extraNotes.set(file, value); } }; },
    failWrites(value = true) { failWrite = value; },
    async reindex() { await service.refreshes.initialize(); }, get text() { return text; }, set text(value: string) { text = value; },
    get formOptions() { return formOptions; }, get noteLink() { return noteLink; }, opened,
    get destinationOptions() { return destinationOptions; },
    get writes() { return writes; }, get reads() { return reads; }, setQuery(fn: () => Promise<string>) { query = fn; },
    async start() { service.register({ register() {}, registerEvent() {} }); ready(); await settle(); },
    async layoutReady() { ready(); await settle(); }, get activePolls() { return intervals.size; },
    async event(name: string, ...args: unknown[]) { events.get(name)?.(...args); await settle(); },
    csv,
    async drain() { await service.refreshes.drain(); },
    installEditor(initial: string) {
      let buffer = initial;
      let cursor = buffer.length;
      const editor = { getValue: () => buffer, getCursor: () => ({ line: 0, ch: cursor }), posToOffset: (pos: { ch: number }) => pos.ch,
        offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
        replaceRange: (replacement: string, from: { ch: number }, to = from) => { buffer = buffer.slice(0, from.ch) + replacement + buffer.slice(to.ch); },
      };
      const view = Object.assign(new FakeView(), { file: note, editor, getMode: () => 'source' });
      leaves = [{ view }];
      return { view, editor, setCursor(offset: number) { cursor = offset; }, get text() { return buffer; }, set text(value: string) { buffer = value; } };
    },
  };
}

const sqlBlock = (sql: string) => `Before\n\n\`\`\`sql csvzall\n${sql}\n\`\`\`\n\n| title |\n| --- |\n| Old |`;
const validSql = 'SELECT title FROM "../Data/tasks.csv"';

for (const copies of [1, 2]) test(`generated output notifications do not rerun ${copies} open SQL block copies`, async () => {
  const clock = fakeClock(), f = await harness(undefined, clock);
  const editing = f.installEditor(Array(copies).fill(sqlBlock(validSql)).join('\n\n'));
  try {
    await f.start(); await f.drain();
    const replace = editing.editor.replaceRange;
    editing.editor.replaceRange = (...args: Parameters<typeof replace>) => {
      replace(...args);
      void f.event('editor-change', editing.editor, editing.view);
      void f.event('modify', f.note);
    };
    f.setQuery(async () => '| title |\n| --- |\n| Updated |');
    await f.event('modify', f.csv); await f.drain(); await clock.advance(2000);
    assert.equal(f.queries.length, 2); assert.equal(f.errors.length, 0);
    assert.equal((editing.text.match(/\| Updated \|/g) ?? []).length, copies);
  } finally { f.service.unload(); }
});

test('a generated closed-note save does not rerun the completed query', async () => {
  const clock = fakeClock(), f = await harness(undefined, clock);
  try {
    await f.start(); await f.drain();
    const replace = f.service.notes.replace.bind(f.service.notes);
    f.service.notes.replace = async (...args: unknown[]) => { const before = f.writes; await replace(...args); if (f.writes !== before) await f.event('modify', f.note); };
    f.setQuery(async () => '| title |\n| --- |\n| Updated |');
    await f.event('modify', f.csv); await f.drain(); await clock.advance(2000);
    assert.equal(f.queries.length, 2); assert.equal(f.errors.length, 0);
    assert.match(f.text, /\| Updated \|/);
  } finally { f.service.unload(); }
});

test('SQL typing debounces parsing, definition writes, and queries across editor, save, and poll events', async () => {
  const clock = fakeClock(), f = await harness(undefined, clock);
  const editing = f.installEditor(sqlBlock(validSql));
  try {
    await f.start(); await f.drain(); f.queries.length = 0;
    const configs = JSON.stringify(Array.from(f.configs));
    for (const prefix of ['S', 'SE', 'SEL', 'SELECT']) {
      editing.text = sqlBlock(prefix);
      await f.event('editor-change', editing.editor, editing.view);
      await clock.advance(200);
      await f.event('modify', f.note);
      await f.event('modify', f.csv);
      await f.reindex(); await f.drain();
      assert.equal((await f.service.migrationReferences()).complete, false);
      assert.equal(f.queries.length, 0); assert.equal(f.errors.length, 0);
      assert.equal(JSON.stringify(Array.from(f.configs)), configs);
      assert.match(editing.text, /\| Old \|/);
    }
    editing.text = sqlBlock(`${validSql} WHERE priority > 1`);
    await f.event('editor-change', editing.editor, editing.view);
    await clock.advance(499);
    assert.equal(f.queries.length, 0); assert.equal(f.errors.length, 0);
    await clock.advance(501);
    assert.equal(f.queries.length, 1); assert.equal(f.errors.length, 0);
    assert.match(f.queries[0]!.join(' '), /WHERE priority > 1/);
    assert.match(editing.text, /\| New \|/);
  } finally { f.service.unload(); }
});

test('typing in one note does not postpone another note export', async () => {
  const clock = fakeClock(), f = await harness(undefined, clock);
  const editing = f.installEditor(sqlBlock(validSql));
  const other = f.addNote('Reports/other.md', sqlBlock(validSql));
  try {
    await f.start(); await f.drain(); f.queries.length = 0;
    other.text = sqlBlock(`${validSql} WHERE priority > 2`);
    await f.event('modify', other.file);
    editing.text = sqlBlock('S');
    await f.event('editor-change', editing.editor, editing.view);
    await clock.advance(400);
    await f.event('editor-change', editing.editor, editing.view);
    for (let i = 0; i < 3; ++i) {
      await clock.advance(200);
      await f.event('editor-change', editing.editor, editing.view);
    }
    assert.equal(f.queries.length, 1); assert.equal(f.errors.length, 0);
    assert.match(f.queries[0]!.join(' '), /WHERE priority > 2/);
    assert.match(other.text, /\| New \|/);
    assert.match(editing.text, /\| Old \|/);
  } finally { f.service.unload(); }
});

for (const outcome of ['result', 'error']) test(`an edit supersedes an in-flight query ${outcome} and reruns after settling`, async () => {
  const clock = fakeClock(), f = await harness(undefined, clock);
  const editing = f.installEditor(sqlBlock(validSql));
  try {
    await f.start(); await f.drain();
    let finish!: () => void, started!: () => void;
    const generating = new Promise<void>(resolve => { started = resolve; });
    f.setQuery(() => new Promise<string>((resolve, reject) => {
      finish = () => outcome === 'error' ? reject(new Error('Syntax error in obsolete SQL')) : resolve('| title |\n| --- |\n| Stale |');
      started();
    }));
    await f.event('modify', f.csv);
    const pending = f.drain(); await generating;
    // Prose-only edits must also retain a queued CSV refresh when SQL is unchanged.
    editing.text = `Edited prose\n${sqlBlock(outcome === 'result' ? validSql : `${validSql} WHERE priority > 2`)}`;
    await f.event('editor-change', editing.editor, editing.view);
    finish(); await pending;
    assert.equal(f.errors.length, 0); assert.doesNotMatch(editing.text, /Stale/);
    assert.match(editing.text, /\| Old \|/);
    f.setQuery(async () => '| title |\n| --- |\n| Latest |');
    await clock.advance(1000);
    assert.equal(f.queries.length, 3); assert.equal(f.errors.length, 0);
    assert.match(editing.text, /Edited prose/); assert.match(editing.text, /\| Latest \|/);
  } finally { f.service.unload(); }
});

test('an unchanged polling index does not supersede a running query', async () => {
  const clock = fakeClock(), f = await harness(undefined, clock);
  f.installEditor(sqlBlock(validSql));
  try {
    await f.start(); await f.drain();
    let finish!: (value: string) => void, started!: () => void;
    const generating = new Promise<void>(resolve => { started = resolve; });
    f.setQuery(() => { started(); return new Promise<string>(resolve => { finish = resolve; }); });
    await f.event('modify', f.csv);
    const pending = f.drain(); await generating;
    await f.reindex(); finish('| title |\n| --- |\n| Latest |'); await pending;
    await clock.advance(1000);
    assert.equal(f.queries.length, 2); assert.equal(f.errors.length, 0);
  } finally { f.service.unload(); }
});

test('autosaving an unchanged open buffer does not supersede a running query', async () => {
  const clock = fakeClock(), f = await harness(undefined, clock);
  const editing = f.installEditor(sqlBlock(validSql));
  try {
    await f.start(); await f.drain();
    let finish!: (value: string) => void, started!: () => void;
    const generating = new Promise<void>(resolve => { started = resolve; });
    f.setQuery(() => { started(); return new Promise<string>(resolve => { finish = resolve; }); });
    await f.event('modify', f.csv);
    const pending = f.drain(); await generating;
    await f.event('modify', f.note);
    finish('| title |\n| --- |\n| Latest |'); await pending;
    await clock.advance(1500);
    assert.equal(f.queries.length, 2); assert.equal(f.errors.length, 0);
    assert.match(editing.text, /\| Latest \|/);
  } finally { f.service.unload(); }
});

test('settled invalid SQL reports once, while an explicit refresh bypasses the edit delay', async () => {
  const clock = fakeClock(), f = await harness(undefined, clock);
  const editing = f.installEditor(sqlBlock(validSql));
  try {
    await f.start(); await f.drain(); f.queries.length = 0;
    editing.text = sqlBlock('S');
    await f.event('editor-change', editing.editor, editing.view);
    await clock.advance(499); assert.equal(f.errors.length, 0);
    await clock.advance(1); assert.equal(f.errors.length, 1);
    await f.reindex(); assert.equal(f.errors.length, 1);
    assert.match(editing.text, /\| Old \|/);
    f.setQuery(async () => { throw new Error('near SE: syntax error'); });
    editing.text = sqlBlock('SE title FROM "../Data/tasks.csv"');
    await f.event('editor-change', editing.editor, editing.view);
    await clock.advance(999); assert.equal(f.queries.length, 0);
    await clock.advance(1); assert.equal(f.queries.length, 1); assert.equal(f.errors.length, 2);
    await f.reindex(); await f.drain(); assert.equal(f.errors.length, 2);
    assert.match(editing.text, /\| Old \|/);
    f.setQuery(async () => '| title |\n| --- |\n| New |');
    editing.text = sqlBlock(`${validSql} WHERE priority > 3`);
    await f.event('editor-change', editing.editor, editing.view);
    await f.service.refresh(f.note);
    assert.equal(f.queries.length, 2); assert.match(editing.text, /\| New \|/);
  } finally { f.service.unload(); }
});

test('a parse failure from an older asynchronous index is silent after another edit', async () => {
  const clock = fakeClock(), f = await harness(undefined, clock);
  const editing = f.installEditor(sqlBlock(validSql));
  try {
    await f.start(); await f.drain(); f.queries.length = 0;
    const prepare = f.service.maintenance.prepare.bind(f.service.maintenance);
    let fail!: (error: Error) => void;
    f.service.maintenance.prepare = () => new Promise((_resolve, reject) => { fail = reject; });
    await f.event('create', f.note);
    editing.text = sqlBlock(`${validSql} WHERE priority > 4`);
    await f.event('editor-change', editing.editor, editing.view);
    fail(new Error('Unclosed CSV export code block.'));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(f.errors.length, 0);
    f.service.maintenance.prepare = prepare;
    await clock.advance(1000);
    assert.equal(f.queries.length, 1); assert.equal(f.errors.length, 0);
    assert.match(editing.text, /\| New \|/);
  } finally { f.service.unload(); }
});

for (const action of ['delete', 'unload']) test(`${action} cancels pending SQL edit work`, async () => {
  const clock = fakeClock(), f = await harness(undefined, clock);
  const editing = f.installEditor(sqlBlock(validSql));
  try {
    await f.start(); await f.drain(); f.queries.length = 0;
    editing.text = sqlBlock('S');
    await f.event('editor-change', editing.editor, editing.view);
    if (action === 'delete') await f.event('delete', f.note); else f.service.unload();
    await clock.advance(2000);
    assert.equal(f.queries.length, 0); assert.equal(f.errors.length, 0);
  } finally { f.service.unload(); }
});

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

test('fenced exports persist real Markdown, preserve schema-mismatched tables and stop at prose', async () => {
  const f = await harness();
  f.text = fencedTableText(f.note.path, recipe, '| old |\n| --- |\n| Keep |') + '\n\nAfterwards';
  await f.service.refresh(f.note);
  assert.match(f.text, /\| New \|/);
  assert.match(f.text, /\| Keep \|/);
  assert.equal(f.text.includes('<!--'), false);
  const stable = f.text;
  await f.service.refresh(f.note);
  assert.equal(f.text, stable);
  f.text = fencedTableText(f.note.path, recipe, '') + '\n\nProse\n\n| old |\n| --- |\n| Keep |';
  await f.service.refresh(f.note);
  assert.match(f.text, /\| New \|\n\nProse/);
  assert.match(f.text, /\| Keep \|/);
  f.service.unload();
});

test('a handwritten SQL fence discovers its note-relative CSV and registers a named query', async () => {
  const f = await harness();
  f.text = '```sql csvzall\nSELECT title FROM "../Data/tasks.csv"\n```\n\nAfterwards';
  await f.service.refresh(f.note);
  const table = findManagedTables(f.text)[0]!;
  assert.equal(table.fence!.sql, 'SELECT title FROM "../Data/tasks.csv"');
  assert.equal(f.text.includes('-- csvzall:'), false);
  assert.match(f.text, /\| New \|/);
  assert.ok(f.queries.some(args => args.includes('--table') && args.includes('Data/tasks.csv')));
  f.service.unload();
});

test('SQL in the note is authoritative and identical blocks share one definition and one query result', async () => {
  const f = await harness();
  const block = fencedTableText(f.note.path, recipe, '| title |\n| --- |\n| Old |');
  f.text = `${block}\n\nBetween\n\n${block}\n\nAfterwards`;
  await f.service.refresh(f.note);
  assert.equal(f.queries.length, 1);
  assert.equal((f.text.match(/\| New \|/g) ?? []).length, 2);
  assert.equal(f.text.includes('-- csvzall:'), false);
  const definitions = () => JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.filter((entry: any) => entry.id.startsWith('sql-'));
  assert.equal(definitions().length, 1);
  const stable = f.configs.get('.csvzall/exports.json');
  await f.service.refresh(f.note);
  assert.equal(f.configs.get('.csvzall/exports.json'), stable);
  f.text = f.text.replace('SELECT *', 'SELECT title');
  await f.service.refresh(f.note);
  assert.equal(definitions().length, 2);
  assert.equal((f.text.match(/SELECT title/g) ?? []).length, 1);
  assert.match(f.text, /Between/); assert.match(f.text, /Afterwards/);
  f.service.unload();
});

test('a shared pause preference applies to identical blocks and manual refresh updates both', async () => {
  const f = await harness();
  const block = fencedTableText(f.note.path, recipe, '| title |\n| --- |\n| Old |');
  f.text = `${block}\n\n${block}`;
  await f.service.maintenance.prepare(f.note);
  const canonical = fencedRecipe(f.note.path, findManagedTables(f.text)[0]!.fence!.sql);
  const saved = await f.service.definitions.resolve(f.note.path, canonical.id);
  await f.service.definitions.update(saved, canonical, false, () => false);
  await f.service.refresh(f.note, undefined, true);
  assert.equal(f.queries.length, 0);
  await f.service.refresh(f.note);
  assert.equal(f.queries.length, 1);
  assert.equal((f.text.match(/\| New \|/g) ?? []).length, 2);
  f.service.unload();
});

test('explicitly deleted query definitions cannot be recreated by a delayed clean block', async () => {
  const reflection = { reconcile: async () => {}, assertReady() {}, assertSqlBinding() { throw new Error('Explicitly deleted'); }, recoverSql: async () => false };
  const f = await harness(reflection);
  f.text = fencedTableText(f.note.path, recipe, '| title |\n| --- |\n| Old |');
  const before = f.text, config = f.configs.get('.csvzall/exports.json');
  await assert.rejects(f.service.refresh(f.note), /Explicitly deleted/);
  assert.equal(f.text, before); assert.equal(f.configs.get('.csvzall/exports.json'), config);
  f.service.unload();
});

test('moving an edited clean block preserves its SQL and rebases its CSV path', async () => {
  const f = await harness();
  f.text = fencedTableText(f.note.path, recipe, '| title |\n| --- |\n| Old |');
  await f.reindex();
  f.text = f.text.replace('SELECT *', 'SELECT title');
  const old = f.note.path;
  f.note.path = 'Archive/Deep/tasks.md';
  await f.service.maintenance.renameSource(old, f.note.path);
  assert.match(f.text, /SELECT title FROM "..\/..\/Data\/tasks.csv"/);
  assert.match(f.text, /\| Old \|/);
  assert.equal(f.text.includes('-- csvzall:'), false);
  assert.equal(f.errors.length, 0);
  f.service.unload();
});

test('deleting a shared query detaches every identical occurrence without dropping its tables', async () => {
  const f = await harness();
  const block = fencedTableText(f.note.path, recipe, '| title |\n| --- |\n| Old |');
  f.text = `${block}\n\n${block}`;
  await f.service.maintenance.prepare(f.note);
  const canonical = fencedRecipe(f.note.path, findManagedTables(f.text)[0]!.fence!.sql);
  const saved = await f.service.definitions.resolve(f.note.path, canonical.id);
  await f.service.removeExport(saved);
  assert.equal(findManagedTables(f.text).length, 0);
  assert.equal((f.text.match(/\| Old \|/g) ?? []).length, 2);
  assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.some((entry: any) => entry.id === canonical.id), false);
  f.service.unload();
});

test('an open edit dialog rejects a changed duplicate sequence instead of modifying another occurrence', async () => {
  const f = await harness();
  const block = fencedTableText(f.note.path, recipe, '| title |\n| --- |\n| Old |');
  f.text = [block, block, block].join('\n\n');
  await f.service.maintenance.prepare(f.note);
  const buffer = f.installEditor(f.text);
  await f.service.editing.openModal(buffer.view, undefined, findManagedTables(buffer.text)[1]!);
  assert.ok(f.formOptions);
  buffer.editor.replaceRange('', { ch: 0 }, { ch: block.length + 2 });
  const original = buffer.text;
  await assert.rejects(f.formOptions.submit({ source: recipe.source, columns: [], sql: 'SELECT title FROM data', syntax: 'comment', autoUpdate: true }, new AbortController().signal), /note changed/);
  assert.equal(buffer.text, original);
  f.service.unload();
});

test('settings locate a surviving shared query after its original output note loses the block', async () => {
  const f = await harness();
  const block = fencedTableText(f.note.path, recipe, '| title |\n| --- |\n| Old |');
  f.text = block;
  const other = f.addNote('Reports/copy.md', block);
  await f.service.maintenance.prepare(f.note);
  const id = fencedRecipe(f.note.path, findManagedTables(block)[0]!.fence!.sql).id;
  const saved = await f.service.definitions.resolve(f.note.path, id);
  f.text = 'Original note prose';
  await f.service.editing.openConfiguredExport(saved, () => {});
  assert.equal(f.noteLink.path, other.file.path);
  await f.formOptions.submit({ source: recipe.source, columns: [], sql: 'SELECT title FROM data', format: 'table', syntax: 'code', autoUpdate: false }, new AbortController().signal);
  assert.match(other.text, /SELECT title/);
  await f.service.refresh(other.file);
  assert.match(other.text, /\| New \|/);
  assert.equal(f.text, 'Original note prose');
  f.service.unload();
});

test('CSV rename preserves unknown fields when the shared query key changes', async () => {
  const f = await harness();
  f.text = fencedTableText(f.note.path, recipe, '| title |\n| --- |\n| Old |');
  await f.reindex();
  const config = JSON.parse(f.configs.get('.csvzall/exports.json')!);
  const entry = config.exports.find((entry: any) => entry.id.startsWith('sql-'));
  entry.custom = { retained: true }; entry.options.futureSetting = 42; entry.runOnSave = false;
  f.configs.set('.csvzall/exports.json', JSON.stringify(config));
  await f.reindex();
  const old = f.csv.path; f.csv.path = 'Data/renamed.csv';
  await f.service.maintenance.renameSource(old, f.csv.path);
  await f.service.pruneDeadExports();
  const currentId = fencedRecipe(f.note.path, findManagedTables(f.text)[0]!.fence!.sql).id;
  const current = JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.find((entry: any) => entry.id === currentId);
  assert.deepEqual(current.custom, { retained: true }); assert.equal(current.options.futureSetting, 42);
  assert.equal(current.runOnSave, false);
  f.service.unload();
});

test('old development metadata is removed while retaining paused preferences and ordinary SQL comments', async () => {
  const f = await harness();
  const config = JSON.parse(f.configs.get('.csvzall/exports.json')!); config.exports[0].runOnSave = false;
  f.configs.set('.csvzall/exports.json', JSON.stringify(config));
  const metadata = JSON.stringify({ version: 1, id: recipe.id, source: '../Data/tasks.csv', base: '0'.repeat(64) });
  f.text = '```sql csvzall\n-- csvzall:export ' + metadata + '\n-- My query\nSELECT * FROM data\n```\n\n| title |\n| --- |\n| Old |';
  await f.service.refresh(f.note, undefined, true);
  assert.equal(f.text.includes('-- csvzall:'), false); assert.match(f.text, /-- My query/);
  assert.match(f.text, /FROM "..\/Data\/tasks.csv"/); assert.match(f.text, /\| Old \|/);
  const currentId = fencedRecipe(f.note.path, findManagedTables(f.text)[0]!.fence!.sql).id;
  assert.equal((await f.service.definitions.resolve(f.note.path, currentId)).runOnSave, false);
  assert.equal(f.queries.length, 0);
  f.service.unload();
});

test('code-to-comment conversion preserves unknown fields in the new definition', async () => {
  const f = await harness();
  f.text = fencedTableText(f.note.path, recipe, '| title |\n| --- |\n| Old |');
  await f.service.maintenance.prepare(f.note);
  const config = JSON.parse(f.configs.get('.csvzall/exports.json')!);
  const current = config.exports.find((entry: any) => entry.id.startsWith('sql-'));
  current.future = 123; current.options.extension = { keep: true };
  f.configs.set('.csvzall/exports.json', JSON.stringify(config));
  const buffer = f.installEditor(f.text);
  await f.service.editing.openModal(buffer.view, undefined, findManagedTables(buffer.text)[0]!);
  await f.formOptions.submit({ source: recipe.source, columns: [], sql: 'SELECT * FROM data', format: 'table', syntax: 'comment', autoUpdate: false }, new AbortController().signal);
  const id = findManagedTables(buffer.text)[0]!.id;
  const converted = JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.find((entry: any) => entry.id === id);
  assert.equal(converted.future, 123); assert.deepEqual(converted.options.extension, { keep: true });
  assert.equal(converted.csvzallDefaultPreferences, undefined);
  f.service.unload();
});

test('inherited legacy pause policy cannot bypass a clean query tombstone', async () => {
  const reflection = { reconcile: async () => {}, assertReady() {}, assertSqlBinding(_note: string, id: string) { if (id.startsWith('sql-')) throw new Error('Explicitly deleted'); }, recoverSql: async () => false };
  const f = await harness(reflection);
  const metadata = JSON.stringify({ version: 1, id: recipe.id, source: '../Data/tasks.csv', base: '0'.repeat(64) });
  f.text = '```sql csvzall\n-- csvzall:export ' + metadata + '\nSELECT * FROM data\n```';
  const before = f.text, saved = f.configs.get('.csvzall/exports.json');
  await assert.rejects(f.service.maintenance.prepare(f.note), /Explicitly deleted/);
  assert.equal(f.text, before); assert.equal(f.configs.get('.csvzall/exports.json'), saved);
  f.service.unload();
});

test('syntax conversion retains pause state and manual refresh with clean query identity', async () => {
  const f = await harness();
  const buffer = f.installEditor(f.text);
  const existing = findManagedTables(buffer.text)[0]!;
  f.service.open(buffer.view, undefined, existing);
  for (let i = 0; i < 40 && !f.formOptions; ++i) await Promise.resolve();
  await f.formOptions.submit({ source: recipe.source, columns: [], sql: '', format: 'table', syntax: 'code', autoUpdate: false }, new AbortController().signal);
  assert.equal(buffer.text.includes('-- csvzall:'), false);
  assert.equal(findManagedTables(buffer.text)[0]!.marker, 'fence');
  assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.find((entry: any) => entry.id.startsWith('sql-')).runOnSave, false);
  f.setQuery(async () => '| title |\n| --- |\n| Manual |');
  await f.service.refresh(f.note, undefined, true);
  assert.equal(buffer.text.includes('Manual'), false);
  await f.service.refresh(f.note);
  assert.equal(buffer.text.includes('Manual'), true);
  await f.service.detach(f.note, findManagedTables(buffer.text)[0]!);
  assert.equal(findManagedTables(buffer.text).length, 0);
  assert.equal(buffer.text.includes('Manual'), true);
  f.service.unload();
});

test('viewer insertion appends to a selected existing note and preserves the SQL LIMIT', async () => {
  const f = await harness();
  Object.defineProperty(f.csv, 'stat', { value: { mtime: 1, size: 20 } });
  const pending = f.service.insertQueryIntoNote(f.csv, 'SELECT title FROM data LIMIT 3', () => false);
  const original = f.text;
  await f.formOptions.submit({ source: f.csv.path, destination: f.note.path, columns: [], sql: 'SELECT title FROM data LIMIT 3', syntax: 'code', autoUpdate: false }, new AbortController().signal);
  f.destinationOptions.closed();
  assert.equal(await pending, true);
  assert.ok(f.text.startsWith(original));
  assert.equal(findManagedTables(f.text).length, 2);
  assert.match(f.text, /LIMIT 3/);
  assert.ok(f.queries[0]!.some(arg => arg.includes('LIMIT 3')));
  f.service.unload();
});

test('viewer insertion preserves note content when cancelled or stale at any write boundary', async () => {
  for (const syntax of ['comment', 'code']) for (const stage of ['render', 'definition', 'note']) for (const change of ['cancel', 'CSV', 'destination']) {
    const f = await harness();
    const stat = { mtime: 1, size: 20 }, cancellation = new AbortController();
    Object.defineProperty(f.csv, 'stat', { value: stat });
    const interrupt = () => {
      if (change === 'cancel') cancellation.abort();
      else if (change === 'CSV') ++stat.mtime;
      else f.note.path = 'Reports/renamed.md';
    };
    if (stage === 'render') f.setQuery(async () => { interrupt(); return '| title |\n| --- |\n| New |'; });
    if (stage === 'definition') {
      const save = f.service.definitions.save.bind(f.service.definitions);
      f.service.definitions.save = async (...args: unknown[]) => { const recipe = await save(...args); interrupt(); return recipe; };
    }
    if (stage === 'note') {
      const processNote = f.service.app.vault.process.bind(f.service.app.vault);
      f.service.app.vault.process = async (...args: unknown[]) => { interrupt(); return processNote(...args); };
    }
    const pending = f.service.insertQueryIntoNote(f.csv, 'SELECT title FROM data', () => false);
    const before = f.text, destination = f.note.path;
    await assert.rejects(f.formOptions.submit({ source: f.csv.path, destination, columns: [], sql: 'SELECT title FROM data', syntax, autoUpdate: false }, cancellation.signal),
      change === 'cancel' ? /insertion cancelled/ : /CSV or destination changed/, `${syntax}/${stage}/${change}`);
    assert.equal(f.text, before); assert.equal(f.opened.length, 0); assert.equal(f.service.maintenance.pendingWrites, 0);
    f.destinationOptions.closed(); assert.equal(await pending, false);
    f.service.unload();
  }
});

test('viewer insertion stays committed if follow-up work fails and retry does not append twice', async () => {
  const f = await harness();
  Object.defineProperty(f.csv, 'stat', { value: { mtime: 1, size: 20 } });
  f.service.editing.preferences = { syntax: () => 'comment', saveSyntax: async () => { throw new Error('Preferences unavailable'); } };
  const pending = f.service.insertQueryIntoNote(f.csv, 'SELECT title FROM data', () => false);
  const value = { source: f.csv.path, destination: f.note.path, columns: [], sql: 'SELECT title FROM data', syntax: 'comment', autoUpdate: false };
  const signal = new AbortController().signal;
  await assert.rejects(f.formOptions.submit(value, signal), /Preferences unavailable/);
  const committed = f.text;
  assert.equal(findManagedTables(committed).length, 2);
  await f.formOptions.submit(value, signal);
  assert.equal(f.text, committed); assert.equal(f.service.maintenance.pendingWrites, 0);
  f.destinationOptions.closed(); assert.equal(await pending, true);
  f.service.unload();
});

test('direct-folder SQL execution never falls back to an ancestor and new saves stay beside the note', async () => {
  const reflection = { usesDirectFolders: true, reconcile: async () => {}, edited: async () => {}, assertReady() {}, assertSqlBinding() {}, recoverSql: async () => false };
  const f = await harness(reflection);
  const before = f.text;
  await f.service.refresh(f.note);
  assert.equal(f.queries.length, 0); assert.equal(f.text, before);
  await f.service.definitions.save(f.note.path, recipe);
  const saved = JSON.parse(f.configs.get('Reports/.csvzall/exports.json')!).exports[0];
  assert.equal(saved.input, '../Data/tasks.csv'); assert.equal(saved.output, 'tasks.md');
  await f.service.refresh(f.note); assert.equal(f.queries.length, 1);
  f.service.unload();
});

test('migration scanning reports incomplete notes without hiding valid note references', async () => {
  const f = await harness(); f.addNote('Other/incomplete.md', '<!-- csvzall:export unfinished -->');
  const scan = await f.service.migrationReferences();
  assert.equal(scan.complete, false); assert.equal(scan.references.length, 1);
  assert.equal(scan.references[0].note, f.note.path); assert.equal(f.errors.length, 1);
  f.service.unload();
});

test('unchanged closed notes are read once across repeated reference scans and indexing', async () => {
  const f = await harness();
  const stat = { mtime: 1, size: f.text.length };
  Object.defineProperty(f.note, 'stat', { value: stat });
  const first = await f.service.migrationReferences();
  const reads = f.reads;
  assert.equal(reads, 1);
  assert.equal((await f.service.migrationReferences()).references.length, first.references.length);
  await f.reindex();
  assert.equal(f.reads, reads);
  stat.mtime++;
  await f.service.migrationReferences();
  assert.equal(f.reads, reads + 1);
  f.service.unload();
});

test('same-size note events invalidate reference caches and malformed edits remain incomplete', async () => {
  const clock = fakeClock(), f = await harness(undefined, clock);
  Object.defineProperty(f.note, 'stat', { value: { mtime: 1, size: f.text.length } });
  f.service.register({ register() {}, registerEvent() {} });
  await f.service.migrationReferences();
  const reads = f.reads;
  f.text = f.text.split('tasks').join('other');
  await f.event('modify', f.note);
  assert.equal((await f.service.migrationReferences()).complete, false);
  await clock.advance(500);
  const changed = await f.service.migrationReferences();
  assert.equal(changed.references[0].id, 'other');
  assert.ok(f.reads > reads);
  f.text = '<!-- csvzall:export broken -->';
  await f.event('modify', f.note);
  assert.equal((await f.service.migrationReferences()).complete, false);
  f.text = oldTable;
  await f.event('modify', f.note);
  await clock.advance(500);
  assert.equal((await f.service.migrationReferences()).references[0].id, 'tasks');
  f.service.unload();
});

test('reference caches never hide unsaved open-editor markers', async () => {
  const f = await harness();
  Object.defineProperty(f.note, 'stat', { value: { mtime: 1, size: f.text.length } });
  await f.service.migrationReferences();
  const reads = f.reads;
  const editing = f.installEditor(f.text.split('tasks').join('draft'));
  const scan = await f.service.migrationReferences();
  assert.equal(scan.references[0].id, 'draft');
  assert.equal(f.reads, reads);
  editing.editor.replaceRange('<!-- csvzall:export incomplete -->', { ch: 0 });
  assert.equal((await f.service.migrationReferences()).complete, false);
  f.service.unload();
});

test('query failure retains the previous table and deduplicates error notices', async () => {
  const f = await harness();
  f.setQuery(async () => { throw new Error('no such column'); });
  const original = f.text;
  await f.service.refresh(f.note, undefined, true);
  await f.service.refresh(f.note, undefined, true);
  assert.equal(f.text, original);
  assert.equal(f.writes, 0);
  assert.equal(f.errors.length, 1);
  f.service.unload();
});

test('SQL cleanup waits while older readable note content is still syncing', async () => {
  const f = await harness({ pending: false, reconcile: async () => {}, edited: async () => {} });
  f.text = 'An older note version without its export marker';
  await f.service.pruneDeadExports();
  assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.length, 1);
  f.syncReady(); await f.service.pruneDeadExports();
  assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.length, 0);
  f.service.unload();
});

test('alternating background SQL errors remain suppressed across successful refreshes', async () => {
  const f = await harness();
  for (const message of ['missing A', 'missing B', 'missing A', 'missing B']) {
    f.setQuery(async () => { throw new Error(message); }); await f.service.refresh(f.note, undefined, true);
  }
  assert.equal(f.errors.length, 2);
  f.setQuery(async () => '| title |\n| --- |\n| Success |'); await f.service.refresh(f.note, undefined, true);
  f.setQuery(async () => { throw new Error('missing A'); }); await f.service.refresh(f.note, undefined, true);
  assert.equal(f.errors.length, 2);
  await f.service.refresh(f.note); assert.equal(f.errors.length, 3, 'manual retry remains visible');
  f.service.unload();
});

test('SQL never replaces content if its scope becomes blocked during generation', async () => {
  let blocked = false;
  const f = await harness({ reconcile: async () => {}, edited: async () => {}, assertSqlBinding() {},
    assertReady() { if (blocked) throw new Error('Scope became unavailable'); } });
  const original = f.text;
  f.setQuery(async () => { blocked = true; return '| title |\n| --- |\n| Stale |'; });
  await f.service.refresh(f.note, undefined, true);
  assert.equal(f.text, original); assert.equal(f.writes, 0);
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
  const clock = fakeClock(), f = await harness(undefined, clock);
  await f.start(); await f.drain();
  assert.equal(f.queries.length, 1);
  await f.event('modify', f.note); await clock.advance(500); await f.drain();
  assert.equal(f.queries.length, 1);
  await f.event('modify', f.csv); await f.event('modify', f.csv); await f.drain();
  assert.equal(f.queries.length, 2);
  f.service.unload();
});

test('unload before layout readiness prevents late polling and export work', async () => {
  const f = await harness();
  try {
    f.service.register({ register() {}, registerEvent() {} });
    f.service.unload();
    await f.layoutReady(); await f.service.refreshAfterSync(); await f.service.refresh(f.note);
    assert.equal(f.activePolls, 0); assert.equal(f.reads, 0); assert.equal(f.queries.length, 0); assert.equal(f.writes, 0);
  } finally { f.service.unload(); }
});

test('stopping the refresh worker during generation is terminal after its pending work finishes', async () => {
  const f = await harness();
  try {
    await f.start(); await f.drain();
    const before = f.text;
    let finish!: (value: string) => void, started!: () => void;
    const generating = new Promise<void>(resolve => { started = resolve; });
    f.setQuery(() => { started(); return new Promise<string>(resolve => { finish = resolve; }); });
    f.service.refreshes.sourceChanged(f.csv.path);
    const drain = f.drain(); await generating;
    f.service.refreshes.stop(); finish('| title |\n| --- |\n| Late |'); await drain;
    await f.event('modify', f.csv); await f.drain(); await f.reindex();
    assert.equal(f.text, before); assert.equal(f.queries.length, 2); assert.equal(f.activePolls, 0);
  } finally { f.service.unload(); }
});

test('a background index scan and an explicit refresh can progress independently', async () => {
  let finish!: () => void, started!: () => void, calls = 0;
  const scanning = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const reflection = { reconcile: async () => { if (++calls === 1) { started(); await gate; } }, assertReady() {}, assertSqlBinding() {}, recoverSql: async () => false };
  const f = await harness(reflection);
  try {
    const scan = f.reindex(); await scanning;
    await f.service.refresh(f.note);
    assert.equal(f.queries.length, 1); assert.match(f.text, /\| New \|/);
    finish(); await scan;
  } finally { f.service.unload(); }
});

test('maintenance cleanup waits for all overlapping writes and releases a failed write', async () => {
  const f = await harness();
  try {
    f.text = 'No remaining exports';
    let finishFirst!: () => void, finishSecond!: () => void;
    const first = f.service.maintenance.withWrite(() => new Promise<void>(resolve => { finishFirst = resolve; }));
    const second = f.service.maintenance.withWrite(async () => {
      await new Promise<void>(resolve => { finishSecond = resolve; }); throw new Error('Write failed');
    });
    await f.service.pruneDeadExports(); assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.length, 1);
    finishFirst(); await first;
    await f.service.pruneDeadExports(); assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.length, 1);
    finishSecond(); await assert.rejects(second, /Write failed/);
    await f.service.pruneDeadExports(); assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.length, 0);
  } finally { f.service.unload(); }
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
  f.addNote('Reports/original.md', oldTable);
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


test('converting an inline value to a paused table retains Markdown paragraph boundaries and manual refresh', async () => {
  const f = await harness(); valueConfig(f);
  f.text = f.text.replace('**', '').replace('**', '');
  const buffer = f.installEditor(f.text), existing = findManagedTables(buffer.text)[0]!;
  f.service.open(buffer.view, undefined, existing);
  for (let i = 0; i < 40 && !f.formOptions; ++i) await Promise.resolve();
  await f.formOptions.submit({ source: f.csv.path, columns: [], sql: 'SELECT title FROM data', autoUpdate: false, format: 'table' }, new AbortController().signal);
  assert.equal(buffer.text, `There are \n\n${managedTableText({ ...recipe, format: 'table' }, '| title |\n| --- |\n| New |')}\n\n open tasks.`);
  assert.equal(findManagedTables(buffer.text).length, 1);
  assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports[0].runOnSave, false);
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
  for (let i = 0; i < 40 && !f.formOptions; ++i) await Promise.resolve();
  assert.equal(f.formOptions.value.autoUpdate, false);
  await f.formOptions.submit({ ...f.formOptions.value, sql: 'SELECT title FROM data', columns: [] }, new AbortController().signal);
  const updated = JSON.parse(f.configs.get('.csvzall/exports.json')!).exports;
  assert.equal(updated.length, 1); assert.equal(updated[0].id, recipe.id);
  assert.equal(updated[0].options.sql, 'SELECT title FROM data');
  assert.equal(updated[0].runOnSave, false); assert.equal(savedCalls, 1);
  f.service.unload();
});

test('settings configure links a SQL export to its note and opens it at the marker line', async () => {
  const f = await harness();
  const saved = (await f.service.listExports([]))[0];
  f.service.configureExport(saved, () => {});
  for (let i = 0; i < 40 && !f.formOptions; ++i) await Promise.resolve();
  assert.equal(f.noteLink.path, 'Reports/tasks.md');
  assert.equal(f.noteLink.exists, true);
  await f.noteLink.open();
  assert.equal(f.opened.length, 1);
  assert.equal(f.opened[0]!.kind, 'tab');
  assert.equal(f.opened[0]!.file, f.note);
  assert.equal(JSON.stringify(f.opened[0]!.state), JSON.stringify({ active: true, eState: { line: 2 } }));
  f.service.unload();
});

test('legacy exports without an output note are shown as unlinked without scanning the vault', async () => {
  const f = await harness();
  f.configs.set('.csvzall/exports.json', JSON.stringify({ exports: [{ id: recipe.id, input: recipe.source, options: { columns: [], sql: '' } }] }));
  const saved = (await f.service.listExports([]))[0];
  f.service.configureExport(saved, () => {});
  for (let i = 0; i < 40 && !f.formOptions; ++i) await Promise.resolve();
  assert.equal(f.noteLink.path, undefined);
  assert.equal(f.noteLink.exists, false);
  await assert.rejects(f.noteLink.open(), /not linked to a note/);
  assert.equal(f.opened.length, 0);
  f.service.unload();
});

for (const format of ['table', 'value']) {
  test(`removing SQL ${format} markers prunes definitions after unsaved editing settles`, async () => {
    const clock = fakeClock(), f = await harness(undefined, clock);
    const config = JSON.parse(f.configs.get('.csvzall/exports.json')!);
    config.exports[0].format = format; config.exports[0].runOnSave = false;
    f.configs.set('.csvzall/exports.json', JSON.stringify(config));
    f.text = managedTableText({ ...recipe, format: format as 'table' | 'value' }, 'old');
    const editing = f.installEditor(f.text);
    await f.start();
    editing.editor.replaceRange('Kept prose', { line: 0, ch: 0 } as any, { line: 0, ch: editing.text.length } as any);
    await f.event('editor-change', editing.editor, editing.view);
    await f.service.pruneDeadExports();
    assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.length, 1);
    await clock.advance(500);
    assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.length, 0);
    assert.equal(editing.text, 'Kept prose');
    assert.ok(f.text.includes('csvzall:export'), 'disk text can still contain the old marker');
    f.service.unload();
  });
}

test('startup/list pruning keeps copied, unlinked and malformed exports safe', async () => {
  const f = await harness();
  let changes = 0;
  const unsubscribe = f.service.onExportsChanged(() => { ++changes; });
  f.addNote('Reports/copy.md', oldTable);
  f.text = 'Original removed';
  await f.service.pruneDeadExports();
  assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.length, 1);
  const config = JSON.parse(f.configs.get('.csvzall/exports.json')!);
  config.exports.push({ id: 'unlinked', input: recipe.source });
  config.exports.push({ id: 'dead', input: recipe.source, output: 'Deleted.md' });
  f.configs.set('.csvzall/exports.json', JSON.stringify(config));
  f.text = '<!-- csvzall:export broken -->incomplete edit';
  await f.service.pruneDeadExports();
  assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.length, 3);
  f.text = 'Original removed';
  const entries = await f.service.listExports(['Reports']);
  assert.deepEqual(Array.from(entries, (entry: any) => entry.recipe.id), ['tasks', 'unlinked']);
  assert.equal(changes, 1);
  unsubscribe();
  f.service.unload();
});

test('pruning rechecks live edits and preserves concurrent configuration changes', async () => {
  const f = await harness();
  f.text = 'removed';
  const write = f.adapter.write;
  f.adapter.write = async (path, text) => {
    if (path.includes('.exports-')) {
      f.text = oldTable;
      await f.event('modify', f.note);
    }
    await write(path, text);
  };
  await f.start();
  await f.service.pruneDeadExports();
  assert.equal(JSON.parse(f.configs.get('.csvzall/exports.json')!).exports.length, 1);
  f.service.unload();
});

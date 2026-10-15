import test from 'node:test';
import assert from 'node:assert/strict';
import type { DataAdapter } from 'obsidian';
import { ExportDefinitions } from '../src/markdown/ExportDefinitions.js';

const recipe = { version: 1 as const, id: 'tasks', source: 'Data/tasks.csv', columns: [], sql: '' };

function fixture() {
  const files = new Map<string, string>();
  let stopped = false;
  const adapter = {
    exists: async (path: string) => files.has(path) || path.endsWith('.csvzall'),
    read: async (path: string) => { if (!files.has(path)) throw new Error('Missing file'); return files.get(path)!; },
    write: async (path: string, text: string) => { files.set(path, text); },
    rename: async (old: string, path: string) => { files.set(path, files.get(old)!); files.delete(old); },
    remove: async (path: string) => { files.delete(path); },
    mkdir: async () => {},
  };
  const definitions = new ExportDefinitions(adapter as unknown as DataAdapter, () => stopped);
  return { definitions, files, adapter, stop() { stopped = true; } };
}

test('definitions round-trip nested paths, queries and unknown config fields', async () => {
  const f = fixture();
  const path = 'Project/.csvzall/exports.json';
  f.files.set(path, JSON.stringify({ description: 'Preserve me', exports: [] }));
  await f.definitions.save('Project/Reports/tasks.md', { ...recipe, sql: "SELECT '--> ' FROM data" });
  const saved = JSON.parse(f.files.get(path)!);
  assert.equal(saved.description, 'Preserve me');
  assert.equal(saved.exports[0].input, '../Data/tasks.csv');
  assert.equal(saved.exports[0].output, 'Reports/tasks.md');
  assert.deepEqual((await f.definitions.resolve('Project/Reports/tasks.md', 'tasks')).recipe, { ...recipe, format: 'table', sql: "SELECT '--> ' FROM data" });
  assert.equal(Array.from(f.files.keys()).length, 1);
});

test('nearest matching definition wins and absent IDs fall back to ancestor config', async () => {
  const f = fixture();
  await f.definitions.save('Reports/tasks.md', recipe);
  f.files.set('Project/.csvzall/exports.json', JSON.stringify({ exports: [{ id: 'local', input: 'local.csv' }] }));
  assert.equal((await f.definitions.resolve('Project/note.md', 'tasks')).recipe.source, 'Data/tasks.csv');
  assert.equal((await f.definitions.resolve('Project/note.md', 'local')).recipe.source, 'Project/local.csv');
  await f.definitions.save('Project/note.md', { ...recipe, source: 'Project/tasks.csv' });
  assert.equal((await f.definitions.resolve('Project/note.md', 'tasks')).recipe.source, 'Project/tasks.csv');
  assert.equal((await f.definitions.resolve('Reports/tasks.md', 'tasks')).recipe.source, 'Data/tasks.csv');
});

test('concurrent definition saves retain both definitions', async () => {
  const f = fixture();
  await Promise.all([
    f.definitions.save('one.md', recipe),
    f.definitions.save('two.md', { ...recipe, id: 'other' }),
  ]);
  assert.deepEqual(JSON.parse(f.files.get('.csvzall/exports.json')!).exports.map((entry: { id: string }) => entry.id), ['tasks', 'other']);
});

test('invalid config cannot be overwritten; paths cannot leave the vault', async () => {
  for (const config of ['{', JSON.stringify({ exports: [{ id: 'tasks', input: '../outside.csv' }] }),
    JSON.stringify({ exports: [{ id: 'tasks', input: 'data.csv' }, { id: 'tasks', input: 'other.csv' }] })]) {
    const f = fixture(); f.files.set('.csvzall/exports.json', config);
    await assert.rejects(f.definitions.save('note.md', recipe));
    assert.equal(f.files.get('.csvzall/exports.json'), config);
  }
});

test('intervening external config edits are preserved and staged files are cleaned up', async () => {
  const f = fixture();
  const originalWrite = f.adapter.write;
  f.adapter.write = async (path, text) => { await originalWrite(path, text); f.files.set('.csvzall/exports.json', '{"exports":[],"external":true}'); };
  await assert.rejects(f.definitions.save('note.md', recipe), /changed while saving/);
  assert.equal(f.files.get('.csvzall/exports.json'), '{"exports":[],"external":true}');
  assert.equal(f.files.size, 1);
});

test('folder moves preserve external references in moved config and update root references', async () => {
  const f = fixture();
  await f.definitions.save('Project/note.md', { ...recipe, source: 'Project/data.csv' });
  f.files.set('Archive/Project/.csvzall/exports.json', JSON.stringify({ exports: [{ id: 'external', input: '../Data/tasks.csv', output: 'note.md' }] }));
  await f.definitions.rename(['Archive/Project/note.md'], 'Project', 'Archive/Project');
  assert.equal((await f.definitions.resolve('Archive/Project/note.md', 'tasks')).recipe.source, 'Archive/Project/data.csv');
  assert.equal((await f.definitions.resolve('Archive/Project/note.md', 'external')).recipe.source, 'Data/tasks.csv');
});

test('cancel and unload during staged writes leave the destination untouched', async () => {
  for (const unload of [true, false]) {
    const f = fixture(); let cancelled = false;
    const write = f.adapter.write;
    f.adapter.write = async (path, text) => { await write(path, text); if (unload) f.stop(); else cancelled = true; };
    await assert.rejects(f.definitions.save('note.md', recipe, () => cancelled), /cancelled/);
    assert.equal(f.files.size, 0);
  }
});


test('moving a deeply nested config outward validates original paths before rebasing', async () => {
  const f = fixture();
  f.files.set('C/.csvzall/exports.json', JSON.stringify({ exports: [{ id: 'tasks', input: '../../Data/tasks.csv', output: 'note.md' }] }));
  await f.definitions.rename(['C/note.md'], 'A/B', 'C');
  const result = await f.definitions.resolve('C/note.md', 'tasks');
  assert.equal(result.recipe.source, 'Data/tasks.csv');
  assert.equal(JSON.parse(f.files.get('C/.csvzall/exports.json')!).exports[0].input, '../Data/tasks.csv');
});


test('tables.json migrates every definition, preserves metadata and retains an exact backup', async () => {
  const f = fixture();
  const original = JSON.stringify({ description: 'Old config', tables: [
    { id: 'tasks', input: 'Data/tasks.csv', runOnSave: false, options: { sql: 'SELECT title FROM data', custom: 1 }, custom: 'preserved' },
    { id: 'unused', input: 'Data/other.csv' },
  ] });
  f.files.set('.csvzall/tables.json', original);
  const result = await f.definitions.resolve('note.md', 'tasks', true);
  assert.equal(result.recipe.format, 'table'); assert.equal(result.runOnSave, false);
  assert.equal(f.files.has('.csvzall/tables.json'), false);
  assert.equal(f.files.get('.csvzall/tables.json.bak'), original);
  const saved = JSON.parse(f.files.get('.csvzall/exports.json')!);
  assert.equal(saved.description, 'Old config'); assert.equal(saved.exports.length, 2);
  assert.equal(saved.exports[0].custom, 'preserved'); assert.equal(saved.exports[0].options.custom, 1);
  assert.equal(saved.tables, undefined);
});

test('migration collisions retain both definitions and bind legacy markers to the migrated table', async () => {
  const f = fixture();
  await f.definitions.save('note.md', { ...recipe, format: 'value', sql: 'SELECT COUNT(*) FROM data' });
  f.files.set('.csvzall/tables.json', JSON.stringify({ tables: [{ id: 'tasks', input: 'Data/old.csv' }] }));
  const migrated = await f.definitions.resolve('note.md', 'tasks', true);
  assert.notEqual(migrated.recipe.id, 'tasks'); assert.equal(migrated.recipe.source, 'Data/old.csv');
  assert.equal((await f.definitions.resolve('note.md', 'tasks')).recipe.format, 'value');
  assert.equal((await f.definitions.resolve('note.md', 'tasks', true)).recipe.id, migrated.recipe.id);
  assert.equal(JSON.parse(f.files.get('.csvzall/exports.json')!).exports.length, 2);
});

test('a failed migration never archives the only valid tables configuration', async () => {
  const f = fixture();
  const original = '{"tables":[{"id":"tasks","input":"Data/tasks.csv"}]}';
  f.files.set('.csvzall/tables.json', original);
  f.adapter.write = async () => { throw new Error('Disk full'); };
  await assert.rejects(f.definitions.resolve('note.md', 'tasks', true), /Disk full/);
  assert.equal(f.files.get('.csvzall/tables.json'), original);
  assert.equal(f.files.has('.csvzall/exports.json'), false);
});


test('new nested exports cannot shadow a legacy table binding in an ancestor config', async () => {
  for (const format of ['value', 'table'] as const) {
    const f = fixture();
    f.files.set('Project/.csvzall/exports.json', JSON.stringify({ exports: [{ id: 'tasks', input: 'other.csv', format }] }));
    f.files.set('.csvzall/tables.json', JSON.stringify({ tables: [{ id: 'tasks', input: 'Data/tasks.csv' }] }));
    assert.equal((await f.definitions.resolve('Project/note.md', 'tasks', true)).recipe.source, 'Data/tasks.csv');
    assert.equal((await f.definitions.resolve('Project/note.md', 'tasks')).recipe.source, 'Project/other.csv');
  }
});


test('migration retries preserve both recipes and bind old markers to the latest legacy edit', async () => {
  const f = fixture();
  const legacy = (sql: string) => JSON.stringify({ tables: [{ id: 'tasks', input: 'Data/tasks.csv', options: { sql } }] });
  f.files.set('.csvzall/tables.json', legacy('SELECT 1'));
  const rename = f.adapter.rename; let once = true;
  f.adapter.rename = async (old, path) => {
    await rename(old, path);
    if (once && path === '.csvzall/exports.json') { once = false; f.files.set('.csvzall/tables.json', legacy('SELECT 2')); }
  };
  await assert.rejects(f.definitions.resolve('note.md', 'tasks', true), /changed during migration/);
  const retry = await f.definitions.resolve('note.md', 'tasks', true);
  assert.equal(retry.recipe.sql, 'SELECT 2'); assert.notEqual(retry.recipe.id, 'tasks');
  assert.equal((await f.definitions.resolve('note.md', 'tasks')).recipe.sql, 'SELECT 1');
  assert.equal(f.files.get('.csvzall/tables.json.bak'), legacy('SELECT 2'));
  assert.equal(JSON.parse(f.files.get('.csvzall/exports.json')!).exports.length, 2);
});

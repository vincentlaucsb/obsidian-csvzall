import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

class Folder {
  children: Array<Folder | File> = [];
  constructor(public path: string) {}
}
class File {
  extension = 'md';
  constructor(public path: string) {}
}

test('incremental reference discovery caches completed notes and retries only affected edits', async () => {
  const result = await build({ entryPoints: ['src/markdown/ExportMaintenanceService.ts'], bundle: true,
    platform: 'node', format: 'cjs', write: false, external: ['obsidian'] });
  const module = { exports: {} as any };
  runInNewContext(result.outputFiles[0]!.text, { module, exports: module.exports,
    require: () => ({ TFile: File, TFolder: Folder }), console });
  const root = new Folder('');
  const files = Array.from({ length: 100 }, (_, index) => new File(`note-${index}.md`));
  root.children.push(...files);
  const live = new Map(files.map(file => [file.path, file]));
  const reads = new Map<File, number>();
  const editing = new Set<File>();
  let revision = 0, race = false;
  const errors: unknown[] = [];
  let lists = 0, removed = 0;
  const saved: unknown[] = [];
  const service = new module.exports.ExportMaintenanceService({ internalPlugins: { getPluginById: () => ({ enabled: false }) }, vault: {
    getRoot: () => root, getAbstractFileByPath: (path: string) => live.get(path),
    getMarkdownFiles: () => { throw new Error('unbounded note scan'); },
  } }, {
    get revision() { return revision; },
    tablesFor: async (file: File) => {
      reads.set(file, (reads.get(file) ?? 0) + 1);
      if (race) { revision++; race = false; }
      return [{ marker: 'export', id: file.path }];
    },
  }, {}, {
    list: async () => { lists++; return saved; },
    find: async (_note: string, id: string) => ({ configPath: '.csvzall/exports.json', recipe: { id } }),
    removeExport: async () => { removed++; },
  }, { isEditing: (file: File) => editing.has(file) },
  async (_file: File, error: unknown) => { errors.push(error); }, new AbortController().signal,
  { incrementalDiscovery: true, knownConfigPaths: () => saved.length ? ['.csvzall/exports.json'] : [], assertSqlBinding: () => {} });
  let scan = await service.migrationReferences();
  assert.equal(scan.complete, false);
  assert.ok(reads.size <= 16);
  while (!scan.complete) {
    const before = [...reads.values()].reduce((sum, count) => sum + count, 0);
    scan = await service.migrationReferences();
    assert.ok([...reads.values()].reduce((sum, count) => sum + count, 0) - before <= 16);
  }
  assert.equal(scan.references.length, 100);
  await service.pruneDeadExports();
  assert.equal(lists, 1);
  await service.pruneDeadExports();
  assert.equal(lists, 1, 'completed empty cleanup does not repeat config probes');
  saved.push({ configPath: '.csvzall/exports.json', output: files[0]!.path, recipe: { id: 'stale', source: 'data.csv' } });
  service.invalidatePruning();
  await service.pruneDeadExports();
  assert.equal(removed, 1, 'newly reflected configuration invalidates completed empty cleanup');
  assert.equal([...reads.values()].every(count => count === 1), true);
  assert.equal((await service.migrationReferences()).references, scan.references, 'reuse completed reference array');
  const changed = files[45]!;
  revision++;
  service.invalidateReferences(changed);
  editing.add(changed);
  assert.equal((await service.migrationReferences()).complete, false, 'editing never proves references absent');
  editing.delete(changed);
  race = true;
  assert.equal((await service.migrationReferences()).complete, false, 'concurrent note change retries affected snapshot');
  assert.equal((await service.migrationReferences()).complete, true);
  assert.equal(reads.get(changed), 3);
  assert.equal(files.filter(file => file !== changed).every(file => reads.get(file) === 1), true);
  live.delete(changed.path); revision++; service.invalidateReferences(changed);
  scan = await service.migrationReferences();
  assert.equal(scan.complete, true);
  assert.equal(scan.references.length, 99);
  assert.deepEqual(errors, []);
});

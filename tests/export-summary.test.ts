import test from 'node:test';
import assert from 'node:assert/strict';
import { countExports, exportCountsText, exportSummaryText } from '../src/settings/exportSummary.js';
import type { ExportEntry } from '../src/settings/ExportSettingsService.js';

const chart = (type: string) => ({ kind: 'chart', chart: { definition: { type } } }) as unknown as ExportEntry;
const table = { kind: 'table' } as unknown as ExportEntry;

test('export summaries count files, charts and table exports', () => {
  const files = [{ entries: [chart('bar'), chart('line'), table] }, { entries: [chart('markdown-table')] }, { entries: [chart('heatmap')] }];
  assert.deepEqual(countExports(files), { files: 3, charts: 3, tables: 2 });
  assert.equal(exportSummaryText(files), '3 files · 3 charts, 2 table or value exports');
  assert.equal(exportSummaryText([{ entries: [table] }]), '1 file · 1 table or value export');
  assert.equal(exportCountsText({ charts: 1, tables: 0 }), '1 chart');
});

test('an empty export list has a friendly summary', () => {
  assert.equal(exportSummaryText([]), 'No exports yet.');
  assert.equal(exportSummaryText([{ entries: [] }]), 'No exports yet.');
});
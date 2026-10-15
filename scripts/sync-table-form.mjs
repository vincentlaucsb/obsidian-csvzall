import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../csvzall/src/viewer/modules/table-form.mjs', import.meta.url));
const target = fileURLToPath(new URL('../src/markdown/table-form.mjs', import.meta.url));
const canonical = readFileSync(source, 'utf8').replace(/\r\n?/g, '\n');
if (process.argv.includes('--check')) {
  if (canonical !== readFileSync(target, 'utf8')) throw new Error('Shared table form differs from upstream; run node scripts/sync-table-form.mjs.');
} else {
  writeFileSync(target, canonical);
}

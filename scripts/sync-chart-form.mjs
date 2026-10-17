import { readFileSync, writeFileSync } from 'node:fs';

for (const name of ['chart-form', 'markdown']) {
  const source = new URL(`../../csvzall/src/viewer/modules/${name}.mjs`, import.meta.url);
  const target = new URL(`../src/charts/${name}.mjs`, import.meta.url);
  const canonical = readFileSync(source, 'utf8').replace(/\r\n?/g, '\n')
    .replace("'./table-form.mjs'", "'../markdown/table-form.mjs'");
  if (process.argv.includes('--check')) {
    if (canonical !== readFileSync(target, 'utf8')) throw new Error('Shared chart form differs from upstream; run node scripts/sync-chart-form.mjs.');
  } else writeFileSync(target, canonical);
}

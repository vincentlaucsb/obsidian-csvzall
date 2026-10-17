import { HtmlRenderer, Parser } from 'commonmark';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { csvHeader, findManagedTables, managedTableText, replaceManagedTable, scalarMarkdown, validateSource, type TableRecipe } from '../src/markdown/managedTables.js';

const recipe: TableRecipe = { version: 1, id: 'tasks', source: 'Data/tasks.csv', columns: [], sql: '' };
const markdown = '| title |\n| --- |\n| Buy milk |';

test('Windows helper line endings are normalized before saving a generated region', () => {
  assert.equal(managedTableText(recipe, markdown.replace(/\n/g, '\r\n')), managedTableText(recipe, markdown));
});

test('generated tables have blank lines inside both markers for Live Preview', () => {
  assert.equal(managedTableText(recipe, markdown), `<!-- csvzall:export tasks -->\n\n${markdown}\n\n<!-- /csvzall:export tasks -->`);
});

test('old and new table spacing yields the same body when detaching', () => {
  for (const newline of ['\n', '\r\n']) for (const count of [1, 2]) {
    const body = markdown.replace(/\n/g, newline);
    const text = `<!-- csvzall:export tasks -->${newline.repeat(count)}${body}${newline.repeat(count)}<!-- /csvzall:export tasks -->`;
    assert.equal(findManagedTables(text)[0]!.body, body);
  }
});

test('inline value exports retain their compact markers', () => {
  assert.equal(managedTableText({ id: 'count', format: 'value' }, '7'), '<span><!-- csvzall:export count -->7<!-- /csvzall:export count --></span>');
});

test('managed tables preserve surrounding prose and identify independent regions', () => {
  const first = managedTableText(recipe, markdown);
  const second = managedTableText({ id: 'other' }, markdown);
  const note = `# My tasks\n\n${first}\n\nMy thoughts\n\n${second}\n`;
  const tables = findManagedTables(note);
  assert.equal(tables.length, 2);
  assert.equal(tables[1]!.id, 'other');
  assert.equal(first.split('\n')[0], '<!-- csvzall:export tasks -->');
  assert.equal(tables[0]!.recipe, undefined);
  assert.equal(replaceManagedTable(note, tables[0]!, 'updated'), `# My tasks\n\nupdated\n\nMy thoughts\n\n${second}\n`);
  assert.equal(note.slice(tables[0]!.from, tables[0]!.to), first);
});

test('markers in fenced examples are ignored and malformed markers cannot swallow prose', () => {
  const block = managedTableText(recipe, markdown);
  assert.equal(findManagedTables(`\`\`\`markdown\n${block}\n\`\`\`\n`).length, 0);
  assert.equal(findManagedTables(`~~~~\n${block}\n~~~~\n${block}`).length, 1);
  assert.throws(() => findManagedTables(block + '\n' + block), /Duplicate/);
  assert.throws(() => findManagedTables(block.replace('/csvzall:export tasks', '/csvzall:export wrong')), /Mismatched/);
  assert.throws(() => findManagedTables(block.split('\n').slice(0, -1).join('\n')), /Unclosed/);
  assert.throws(() => findManagedTables(block.replace(markdown, block)), /Nested/);
});

test('refresh refuses a region edited, removed, or detached while a query runs', () => {
  const block = managedTableText(recipe, markdown);
  const table = findManagedTables(block)[0]!;
  for (const changed of [block.replace('Buy milk', 'Hand edited'), '', markdown]) {
    assert.throws(() => replaceManagedTable(changed, table, 'new output'), /changed while refreshing/);
  }
  assert.equal(replaceManagedTable(`New prose\n${block}`, table, 'updated'), 'New prose\nupdated');
});

test('recipes reject external paths, unsupported versions, and invalid types', () => {
  for (const path of ['../data.csv', 'C:/data.csv', '/data.csv', 'a/../data.csv', 'a//data.csv', 'note.md']) assert.throws(() => validateSource(path));
  assert.equal(validateSource('Data\\tasks.CSV'), 'Data/tasks.CSV');
  for (const value of [{ ...recipe, version: 2 }, { ...recipe, columns: [2] }, { ...recipe, sql: null }]) {
    const block = `<!-- csvzall:table ${encodeURIComponent(JSON.stringify(value))} -->\n${markdown}\n<!-- /csvzall:table tasks -->`;
    assert.throws(() => findManagedTables(block));
  }
});

test('CSV column discovery preserves commas, quotes, BOM, and multiline headers', () => {
  assert.deepEqual(csvHeader('\uFEFF"a,b","say ""hello""","multi\nline"\r\n'), ['a,b', 'say "hello"', 'multi\nline']);
});

test('both hosts use the packaged shared form; desktop bundle retains static Node imports', () => {
  const bundle = readFileSync('main.js', 'utf8');
  assert.match(bundle, /Insert from CSV/);
  assert.match(bundle, /csvzall:export/);
  assert.match(bundle, /Click a column to insert it/);
  assert.match(bundle, /setRangeText/);
  assert.match(bundle, /require\(["']string_decoder["']\)/);
  assert.doesNotMatch(bundle, /import\(["'](?:node:)?string_decoder["']\)/);
  const upstream = '../csvzall/src/viewer/modules/table-form.mjs';
  if (existsSync(upstream)) assert.equal(readFileSync(upstream, 'utf8').replace(/\r\n?/g, '\n'), readFileSync('src/markdown/table-form.mjs', 'utf8'), 'Run node scripts/sync-table-form.mjs after changing the shared form.');
});


test('legacy inline recipes remain readable for migration', () => {
  const inline = `<!-- csvzall:table ${encodeURIComponent(JSON.stringify(recipe))} -->\n${markdown}\n<!-- /csvzall:table tasks -->`;
  const table = findManagedTables(inline)[0]!;
  assert.equal(table.id, 'tasks');
  assert.deepEqual(table.recipe, { ...recipe, format: 'table' });
});

test('inline exports preserve surrounding sentences, formatting and independent values', () => {
  const block = managedTableText({ id: 'count', format: 'value' }, '7');
  const note = `There are **${block}** open tasks. Total: ${managedTableText({ id: 'total', format: 'value' }, '20')}.`;
  const regions = findManagedTables(note);
  assert.equal(regions.length, 2);
  assert.equal(regions[0]!.body, '7');
  assert.equal(replaceManagedTable(note, regions[0]!, managedTableText({ id: 'count', format: 'value' }, '8')), note.replace('-->7<!--', '-->8<!--'));
  assert.throws(() => replaceManagedTable(note.replace('-->7<!--', '-->9<!--'), regions[0]!, 'stale'), /changed while refreshing/);
});

test('inline code spans, fenced and indented code examples stay inert', () => {
  const value = managedTableText({ id: 'count', format: 'value' }, '7');
  for (const example of [`\`${value}\``, `\`\`example \` ${value}\`\``, `~~~md\n${value}\n~~~`, `    ${value}`]) {
    assert.equal(findManagedTables(example).length, 0);
  }
  assert.equal(findManagedTables(`An unmatched backtick \` then ${value}`).length, 1);
  assert.throws(() => findManagedTables(value.replace('/csvzall:export count', '/csvzall:export wrong')), /Mismatched/);
});

test('scalar CSV conversion keeps precise values and escapes Markdown, HTML and comment delimiters', () => {
  assert.equal(scalarMarkdown('value\r\n9007199254740993\r\n'), '9007199254740993');
  assert.equal(scalarMarkdown('value\n"a,b"\n'), 'a\\,b');
  assert.equal(scalarMarkdown('value\n"say ""hello""\nnext"\n'), 'say \\"hello\\" next');
  assert.equal(scalarMarkdown('value\n"<b>*hi* &amp; <!-- /csvzall:export x -->"\n'), '\\<b\\>\\*hi\\* \\&amp\\; \\<\\!\\-\\- \\/csvzall\\:export x \\-\\-\\>');
  assert.equal(scalarMarkdown('value\n\n'), '');
  for (const csv of ['value\n', 'value\n1\n2\n', 'a,b\n1,2\n', 'value\n"unclosed']) assert.throws(() => scalarMarkdown(csv));
});

test('scalar exports collapse every C0 and DEL run while preserving Unicode', () => {
  for (const code of [...Array.from({ length: 32 }, (_, index) => index), 127]) {
    const char = String.fromCharCode(code);
    assert.equal(scalarMarkdown(`value\n"a${char}${char}b"\n`), 'a b', `control ${code}`);
  }
  assert.equal(scalarMarkdown('value\n"é 日本語 😀"\n'), 'é 日本語 😀');
});


test('code fences in quotes and list containers cannot become live exports', () => {
  const value = managedTableText({ id: 'count', format: 'value' }, '7');
  for (const example of [`> ~~~md\n> ${value}\n> ~~~`, `1. ~~~md\n   ${value}\n   ~~~`, `> 1. ~~~md\n>    ${value}\n>    ~~~`]) {
    assert.equal(findManagedTables(example).length, 0);
    assert.equal(findManagedTables(`${example}\n\n${value}`).length, 1);
  }
});

test('standalone and sentence-start scalar strings render as literal text in standard Markdown', () => {
  const escaped = scalarMarkdown('v\n"*hi* &amp; <b>"\n');
  const value = managedTableText({ id: 'literal', format: 'value' }, escaped);
  for (const note of [value, `${value} is the label.`, `The label is **${value}**.`]) {
    const html = new HtmlRenderer().render(new Parser().parse(note));
    assert.match(html, /<p>/); assert.match(html, /\*hi\* &amp;amp; &lt;b&gt;/);
    assert.doesNotMatch(html, /<em>|<b>|\\/);
    const region = findManagedTables(note)[0]!;
    assert.equal(region.text, value);
    assert.equal(replaceManagedTable(note, region, value), note);
  }
});


test('distributed desktop bundle includes licenses for its Markdown parser dependencies', () => {
  const bundle = readFileSync('main.js', 'utf8'), notices = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8');
  assert.ok(bundle.includes(notices));
  assert.match(notices, /John MacFarlane/); assert.match(notices, /Redistributions in binary form/);
  assert.match(notices, /mdurl/); assert.match(notices, /Mathias Bynens/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { findManagedTables, replaceManagedTable } from '../src/markdown/managedTables.js';
import { fencedTableText, matchingTableHeaders, fencedRecipe } from '../src/markdown/fencedTables.js';
import { csvSqlReferences, rebaseSqlSource, resolveCsvSource, nameSqlSource } from '../src/markdown/sqlSources.js';

const recipe = { version: 1 as const, id: 'test', source: 'Data/a.csv', sql: 'SELECT * FROM data', columns: [] };
const output = '| name | count |\n| --- | --- |\n| Ada | 1 |';

test('both code fence forms bind only the immediate table across whitespace', () => {
  for (const info of ['csvzall', 'sql csvzall']) {
    const code = '```' + info + '\nSELECT * FROM "../Data/a.csv"\n```';
    const text = code + '\n\t\n' + output + '\n\nProse\n' + output;
    const tables = findManagedTables(text);
    assert.equal(tables.length, 1);
    assert.equal(tables[0]!.body, output);
    assert.equal(text.slice(tables[0]!.to), '\n\nProse\n' + output);
    assert.equal(findManagedTables(code + '\n\nA paragraph\n\n' + output)[0]!.body, '');
    assert.equal(findManagedTables(code + '\n# Heading\n' + output)[0]!.body, '');
  }
});

test('ordinary SQL, longer-fence examples and container examples stay inert; incomplete exports fail safely', () => {
  assert.equal(findManagedTables('```sql\nSELECT 1\n```').length, 0);
  assert.equal(findManagedTables('````markdown\n```csvzall\nSELECT 1\n```\n````').length, 0);
  assert.equal(findManagedTables('> ```csvzall\n> SELECT 1\n> ```').length, 0);
  assert.throws(() => findManagedTables('```csvzall\nSELECT 1'), /Unclosed/);
});

test('clean SQL blocks allow identical occurrences and preserve concurrent output edits', () => {
  const text = fencedTableText('Reports/note.md', recipe, output);
  const table = findManagedTables(text)[0]!;
  assert.equal(table.fence!.sql, 'SELECT * FROM "../Data/a.csv"');
  assert.equal(table.body, output);
  assert.equal(text.includes('<!--'), false);
  assert.equal(text.includes('-- csvzall:'), false);
  assert.equal(findManagedTables(text + '\n\n' + text).length, 2);
  assert.throws(() => replaceManagedTable(text.replace('Ada', 'Edited'), table, 'new'), /changed/);
  assert.throws(() => replaceManagedTable(text.replace('SELECT *', 'SELECT count'), table, 'new'), /changed/);
});

test('query identity uses SQL and resolved source; identical text in different folders can mean different CSVs', () => {
  const first = fencedRecipe('Reports/note.md', 'SELECT * FROM "../Data/a.csv"');
  assert.equal(first.id, fencedRecipe('Other/note.md', 'SELECT * FROM "../Data/a.csv"').id);
  assert.equal(first.id, fencedRecipe('note.md', 'SELECT * FROM "Data/a.csv"').id);
  assert.notEqual(first.id, fencedRecipe('Other/note.md', 'SELECT count(*) FROM "../Data/a.csv"').id);
  assert.notEqual(fencedRecipe('One/note.md', 'SELECT * FROM "a.csv"').id, fencedRecipe('Two/note.md', 'SELECT * FROM "a.csv"').id);
});

test('explicit actions reject reordered identical blocks while normal refresh tolerates unrelated prose edits', () => {
  const block = fencedTableText('Reports/note.md', recipe, output);
  const text = `# One\n\n${block}\n\n# Two\n\n${block}\n`;
  const expected = findManagedTables(text)[1]!;
  const reordered = `# One\n\n# Two\n\n${block}\n\n${block}\n`;
  assert.throws(() => replaceManagedTable(reordered, expected, 'Changed', true), /note changed/);
  assert.ok(replaceManagedTable(text.replace('# One', '# Changed prose'), expected, 'Refreshed').includes('Refreshed'));
});

test('portable viewer SQL preserves explicit aliases, data qualifiers, strings and CSV-named CTE references', () => {
  assert.equal(nameSqlSource('SELECT data.title FROM data WHERE title <> \'data\'', 'a.csv'), 'SELECT data.title FROM "a.csv" AS "data" WHERE title <> \'data\'');
  assert.equal(nameSqlSource('SELECT d.title FROM data AS d', 'a.csv'), 'SELECT d.title FROM "a.csv" AS d');
  assert.equal(nameSqlSource('WITH "summary.csv" AS (SELECT * FROM data) SELECT * FROM "summary.csv"', 'a.csv'), 'WITH "summary.csv" AS (SELECT * FROM "a.csv") SELECT * FROM "summary.csv"');
  assert.equal(rebaseSqlSource('SELECT "a.csv".title FROM "a.csv"', '../a.csv'), 'SELECT "a.csv".title FROM "../a.csv" AS "a.csv"');
  assert.equal(nameSqlSource('SELECT a.title, b.title FROM data a, data b', 'a.csv'), 'SELECT a.title, b.title FROM "a.csv" a, "a.csv" b');
  assert.equal(nameSqlSource('SELECT main.data.title FROM main.data', 'a.csv'), 'SELECT main.data.title FROM main."a.csv" AS "data"');
  assert.equal(nameSqlSource('WITH data AS (SELECT 1 AS title) SELECT title FROM main.data', 'a.csv'), 'WITH data AS (SELECT 1 AS title) SELECT title FROM main."a.csv"');
  const nested = 'SELECT "a.csv".title, (SELECT "a.csv".title FROM (SELECT 1 AS title) AS "a.csv") FROM "a.csv"';
  assert.equal(rebaseSqlSource(nested, '../a.csv'), nested.replace('FROM "a.csv"', 'FROM "../a.csv" AS "a.csv"'));
  assert.throws(() => nameSqlSource('SELECT 1', 'a.csv'), /need a CSV source/);
});

test('adjacent table headers preserve escaping, order, alignment and empty results', () => {
  const a = '| a\\|b | c\\\\d |\n| --- | --- |';
  assert.equal(matchingTableHeaders(a, '| a\\|b | c\\\\d |\n| :---: | ---: |\n| x | y |'), true);
  assert.equal(matchingTableHeaders(output, '| count | name |\n| --- | --- |'), false);
  assert.equal(matchingTableHeaders(output, '| name | other |\n| --- | --- |'), false);
  const code = fencedTableText('Reports/note.md', recipe, a);
  assert.equal(findManagedTables(code)[0]!.body, a);
});

test('SQL filename detection does not rewrite strings, comments, aliases or CTE names', () => {
  const sql = `WITH data AS (SELECT 'FROM "fake.csv"' AS value) SELECT * FROM "../Data/a.csv" AS d -- FROM "ignored.csv"`;
  assert.equal(csvSqlReferences(sql)[0]!.name, '../Data/a.csv');
  assert.equal(rebaseSqlSource(sql, '../Moved/a.csv'), sql.replace('FROM "../Data/a.csv"', 'FROM "../Moved/a.csv"'));
  assert.equal(csvSqlReferences("SELECT 'data' FROM data").length, 0);
  assert.equal(resolveCsvSource('Reports/note.md', '../Data/é.csv'), 'Data/é.csv');
  assert.throws(() => resolveCsvSource('note.md', '../outside.csv'), /leaves/);
  assert.throws(() => csvSqlReferences('SELECT * FROM "a.csv" JOIN "b.csv"'), /one CSV/);
});

test('CSV-named CTEs stay intact with recursive, materialized and nested scopes', () => {
  const cte = 'WITH "summary.csv" AS (SELECT * FROM data) SELECT * FROM "SUMMARY.csv"';
  assert.deepEqual(csvSqlReferences(cte), []);
  assert.equal(rebaseSqlSource(cte, '../Data/tasks.csv'), cte);
  const recursive = 'WITH RECURSIVE "summary.csv"(n) AS NOT MATERIALIZED (SELECT 1 UNION ALL SELECT n + 1 FROM "summary.csv" WHERE n < 3), "other.tsv" AS (SELECT * FROM "summary.csv") SELECT * FROM "other.tsv"';
  assert.deepEqual(csvSqlReferences(recursive), []);
  const nested = 'SELECT * FROM (WITH "a.csv" AS (SELECT * FROM data) SELECT * FROM "a.csv") JOIN "a.csv"';
  assert.equal(csvSqlReferences(nested).length, 1);
  assert.equal(rebaseSqlSource(nested, 'b.csv'), nested.replace('JOIN "a.csv"', 'JOIN "b.csv"'));
  assert.equal(csvSqlReferences('WITH "a.csv" AS (SELECT * FROM data) SELECT * FROM "a.csv"; SELECT * FROM "a.csv"').length, 1);
});

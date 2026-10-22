import { createHash } from 'crypto';
import { Parser } from 'commonmark';
import type { ManagedTable, TableRecipe } from './managedTables.js';
import { csvSqlReferences, relativeCsvSource, rebaseSqlSource, resolveCsvSource, nameSqlSource } from './sqlSources.js';

export interface ExportFence { sql: string; code: string; snapshot: string; legacy?: { id: string; source: string } }

function cells(line: string): string[] | null {
  if (!line.includes('|')) return null;
  const result: string[] = []; let value = '', escaped = false;
  for (const char of line.trim()) {
    if (escaped) { value += `\\${char}`; escaped = false; }
    else if (char === '\\') escaped = true;
    else if (char === '|') { result.push(value.trim()); value = ''; }
    else value += char;
  }
  result.push((value + (escaped ? '\\' : '')).trim());
  if (!result[0]) result.shift();
  if (!result[result.length - 1]) result.pop();
  return result.length ? result : null;
}

function header(text: string): string[] | null {
  const lines = text.split(/\r?\n/), names = cells(lines[0] ?? ''), divider = cells(lines[1] ?? '');
  return names && divider && names.length === divider.length && divider.every(cell => /^:?-{3,}:?$/.test(cell)) ? names : null;
}

export function matchingTableHeaders(left: string, right: string): boolean {
  const a = header(left), b = header(right);
  return !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
}

function adjacentTable(text: string, from: number): { body: string; to: number } {
  const whitespace = /^[ \t\r\n]*/.exec(text.slice(from))![0];
  const start = from + whitespace.length;
  const lines = text.slice(start).split('\n');
  if (!header(lines.slice(0, 2).join('\n'))) return { body: '', to: from };
  let count = 2;
  while (count < lines.length && lines[count]!.trim() && !/^(?: {0,3}(?:#{1,6}\s|>|`{3,}|~{3,}|[-+*]\s|\d+[.)]\s))/.test(lines[count]!) && cells(lines[count]!)) ++count;
  const body = lines.slice(0, count).join('\n').replace(/\r$/, '');
  return { body, to: start + body.length };
}

export function exportSql(recipe: Pick<TableRecipe, 'sql' | 'columns'>): string {
  return recipe.sql.trim() || `SELECT ${recipe.columns.length ? recipe.columns.map(name => `"${name.replace(/"/g, '""')}"`).join(', ') : '*'} FROM data`;
}

export function fencedRecipe(note: string, sql: string): TableRecipe {
  const filename = csvSqlReferences(sql)[0]?.name;
  if (!filename) throw new Error('Use a quoted note-relative CSV filename after FROM or JOIN in the SQL code block.');
  const source = resolveCsvSource(note, filename);
  const canonicalSql = rebaseSqlSource(sql.replace(/\r\n?/g, '\n').trim(), source);
  const id = `sql-${createHash('sha256').update(JSON.stringify([source, canonicalSql])).digest('hex')}`;
  return { version: 1, id, source, sql: canonicalSql, columns: [], format: 'table' };
}

export function fencedTableText(note: string, recipe: TableRecipe, markdown: string): string {
  const sql = nameSqlSource(exportSql(recipe), relativeCsvSource(note, recipe.source));
  // Choose a fence longer than any run in SQL, keeping embedded examples inert.
  const ticks = '`'.repeat(Math.max(3, ...Array.from(sql.matchAll(/`+/g), match => match[0].length + 1)));
  return `${ticks}sql csvzall\n${sql}\n${ticks}${markdown ? `\n\n${markdown.trimEnd()}` : ''}`;
}

export function findFencedTables(text: string): ManagedTable[] {
  const tables: ManagedTable[] = [], starts = [0];
  for (let i = 0; i < text.length; ++i) if (text[i] === '\n') starts.push(i + 1);
  const walker = new Parser().parse(text).walker(); let event;
  while ((event = walker.next())) {
    const node = event.node;
    if (!event.entering || node.type !== 'code_block' || node.parent?.type !== 'document' || !/^(?:csvzall|sql\s+csvzall)$/.test(node.info?.trim() ?? '')) continue;
    const [[first], [last]] = node.sourcepos;
    const from = starts[first - 1]!, to = (starts[last] ?? text.length);
    const code = text.slice(from, to).replace(/\r?\n$/, '');
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(code);
    const closing = code.split(/\r?\n/).pop() ?? '';
    if (!opening || !(new RegExp(`^ {0,3}${opening[1]![0]}{${opening[1]!.length},}[ \\t]*$`)).test(closing) || first === last) throw new Error('Unclosed CSV export code block.');
    const literal = (node.literal ?? '').replace(/\r\n?/g, '\n');
    const metadata = /^-- csvzall:export (.+)\n/.exec(literal);
    let legacy: ExportFence['legacy'];
    if (metadata) {
      const value: unknown = JSON.parse(metadata[1]!);
      if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 ||
        !('id' in value) || typeof value.id !== 'string' || !/^[\w-]+$/.test(value.id) ||
        !('source' in value) || typeof value.source !== 'string' ||
        !('base' in value) || typeof value.base !== 'string' || !/^[a-f0-9]{64}$/.test(value.base)) throw new Error('Invalid CSV export code block metadata.');
      legacy = { id: value.id, source: value.source };
    }
    const sql = literal.slice(metadata?.[0].length ?? 0).trim();
    if (!sql) throw new Error('Enter a SQLite query in the CSV export code block.');
    const end = from + code.length, output = adjacentTable(text, end);
    // Occurrence order is only a transient replacement address, never a saved identity.
    tables.push({ id: `@fence-${tables.length}`, marker: 'fence', fence: { sql, legacy, code, snapshot: text }, from, to: output.to,
      text: text.slice(from, output.to), body: output.body });
  }
  return tables;
}

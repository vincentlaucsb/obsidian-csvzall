import { Parser } from 'commonmark';

export type ExportFormat = 'table' | 'value';
export interface TableRecipe {
  version: 1;
  id: string;
  source: string;
  columns: string[];
  sql: string;
  format?: ExportFormat;
}

export interface ManagedTable {
  id: string;
  marker: 'table' | 'export';
  recipe?: TableRecipe;
  from: number;
  to: number;
  text: string;
  body: string;
}

export function validateSource(source: string): string {
  const path = source.replace(/\\/g, '/');
  if (!path || path.startsWith('/') || path.includes(':') || path.split('/').some(part => !part || part === '.' || part === '..') || !/\.csv$/i.test(path)) {
    throw new Error('Choose a CSV file inside the vault.');
  }
  return path;
}

function parseRecipe(encoded: string): TableRecipe {
  const value: unknown = JSON.parse(decodeURIComponent(encoded));
  if (!value || typeof value !== 'object') throw new Error('Invalid CSV table instructions.');
  const recipe = value as Partial<TableRecipe>;
  if (recipe.version !== 1 || typeof recipe.id !== 'string' || !/^[\w-]+$/.test(recipe.id) ||
    typeof recipe.source !== 'string' || typeof recipe.sql !== 'string' ||
    !Array.isArray(recipe.columns) || !recipe.columns.every((name: unknown) => typeof name === 'string')) {
    throw new Error('Invalid or unsupported CSV table instructions.');
  }
  validateSource(recipe.source);
  return { ...recipe as TableRecipe, format: 'table' };
}

export function managedTableText(recipe: Pick<TableRecipe, 'id' | 'format'>, markdown: string): string {
  const body = recipe.format === 'value' ? markdown : `\n${markdown.replace(/\r\n?/g, '\n').trimEnd()}\n`;
  const text = `<!-- csvzall:export ${recipe.id} -->${body}<!-- /csvzall:export ${recipe.id} -->`;
  // A comment at line start is a Markdown HTML block. A standard inline span
  // keeps scalar escaping active even at the start of a paragraph or new note.
  return recipe.format === 'value' ? `<span>${text}</span>` : text;
}

function escaped(text: string, offset: number): boolean {
  let count = 0;
  while (offset > 0 && text[--offset] === '\\') ++count;
  return count % 2 === 1;
}

/** Code examples must remain inert, including code spans inside prose. */
function codeMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);
  const starts = [0];
  for (let i = 0; i < text.length; ++i) if (text[i] === '\n') starts.push(i + 1);
  const walker = new Parser().parse(text).walker();
  let event;
  while ((event = walker.next())) {
    if (!event.entering || event.node.type !== 'code_block') continue;
    const [[first], [last]] = event.node.sourcepos;
    mask.fill(1, starts[first - 1] ?? 0, starts[last] ?? text.length);
  }
  const runs = Array.from(text.matchAll(/`+/g));
  for (let i = 0; i < runs.length; ++i) {
    const start = runs[i]!;
    if (mask[start.index] || escaped(text, start.index)) continue;
    for (let j = i + 1; j < runs.length; ++j) {
      const end = runs[j]!;
      if (mask[end.index] || /\n[ \t]*\r?\n/.test(text.slice(start.index, end.index))) break;
      if (end[0].length !== start[0].length) continue;
      mask.fill(1, start.index, end.index + end[0].length); i = j; break;
    }
  }
  return mask;
}

export function findManagedTables(text: string): ManagedTable[] {
  const tables: ManagedTable[] = [], ids = new Set<string>(), mask = codeMask(text);
  let pending: { id: string; marker: 'table' | 'export'; recipe?: TableRecipe; from: number; bodyFrom: number } | null = null;
  for (const comment of text.matchAll(/<!--[\s\S]*?-->/g)) {
    if (mask[comment.index]) continue;
    const match = /^<!-- (\/?)csvzall:(table|export) (\S+) -->$/.exec(comment[0]);
    if (!match) continue;
    const marker = match[2] as 'table' | 'export';
    const lineStart = text.lastIndexOf('\n', comment.index - 1) + 1;
    const lineEnd = text.indexOf('\n', comment.index + comment[0].length);
    const wholeLine = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd).replace(/\r$/, '') === comment[0];
    if (marker === 'table' && !wholeLine) continue;
    if (!match[1]) {
      if (pending) throw new Error('Nested CSV export markers.');
      const recipe = marker === 'table' && !/^[\w-]+$/.test(match[3]!) ? parseRecipe(match[3]!) : undefined;
      const id = recipe?.id ?? match[3]!;
      if (!/^[\w-]+$/.test(id)) throw new Error('Invalid CSV export id.');
      pending = { id, marker, recipe, from: comment.index, bodyFrom: comment.index + comment[0].length };
    } else {
      if (!pending || pending.id !== match[3] || pending.marker !== marker) throw new Error('Mismatched CSV export markers.');
      if (ids.has(pending.id)) throw new Error('Duplicate CSV export id.');
      ids.add(pending.id);
      let from = pending.from, to = comment.index + comment[0].length;
      if (text.slice(from - 6, from) === '<span>' && text.slice(to, to + 7) === '</span>') { from -= 6; to += 7; }
      let body = text.slice(pending.bodyFrom, comment.index);
      if (/^\r?\n/.test(body) && /\r?\n$/.test(body)) body = body.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
      tables.push({ id: pending.id, marker, recipe: pending.recipe, from, to, text: text.slice(from, to), body });
      pending = null;
    }
  }
  if (pending) throw new Error('Unclosed CSV export marker.');
  return tables;
}

export function replaceManagedTable(text: string, expected: ManagedTable, replacement: string): string {
  const current = findManagedTables(text).find(table => table.id === expected.id);
  if (!current || current.text !== expected.text) throw new Error('The export changed while refreshing. Refresh it again.');
  return text.slice(0, current.from) + replacement + text.slice(current.to);
}

export function shortenManagedTable(table: ManagedTable, id: string): string {
  return table.text.replace(/^(<span>)?<!-- csvzall:(?:table|export) \S+ -->/, `$1<!-- csvzall:export ${id} -->`)
    .replace(/<!-- \/csvzall:(?:table|export) [\w-]+ -->(<\/span>)?$/, `<!-- /csvzall:export ${id} -->$1`);
}

export function tableBody(table: ManagedTable): string { return table.body; }

/** Preserve exact CSV cell strings (including large integers) without JSON number conversion. */
export function scalarMarkdown(csv: string): string {
  const rows: string[][] = [], row: string[] = [];
  let value = '', quoted = false, closed = false, started = false;
  const input = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; ++i) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { value += '"'; ++i; } else { quoted = false; closed = true; }
      } else value += char;
      started = true;
    } else if (char === ',' || char === '\r' || char === '\n') {
      row.push(value); value = ''; closed = false; started = char === ',';
      if (char !== ',') { rows.push(row.splice(0)); if (char === '\r' && input[i + 1] === '\n') ++i; }
    } else if (char === '"' && !value && !closed) { quoted = true; started = true; }
    else {
      if (closed || char === '"') throw new Error('Invalid CSV result.');
      value += char; started = true;
    }
  }
  if (quoted) throw new Error('Incomplete CSV result.');
  if (started || row.length) { row.push(value); rows.push(row); }
  if (rows.length !== 2 || rows.some(values => values.length !== 1)) throw new Error('A value export must return exactly one row and one column. The previous value has been kept.');
  return Array.from(rows[1]![0]!.replace(/[\r\n\t\x00-\x1f\x7f]+/g, ' '), char => {
    const code = char.charCodeAt(0);
    return ((code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126)) ? `\\${char}` : char;
  }).join('');
}

export function csvHeader(text: string): string[] {
  const columns: string[] = [];
  let value = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; ++i) {
    const char = input[i]!;
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { value += '"'; ++i; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n' || char === '\r')) {
      columns.push(value); value = '';
      if (char !== ',') return columns;
    } else value += char;
  }
  if (quoted) throw new Error('Incomplete CSV header.');
  return [...columns, value];
}

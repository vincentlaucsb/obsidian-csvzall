import { parentVaultPath, relativeVaultPath, resolveVaultRelativePath } from '../utils/paths.js';

export interface SqlCsvReference { name: string; from: number; to: number; alias?: boolean; qualifiers?: Array<{ from: number; to: number }> }

/** Locate quoted CSV table identifiers without interpreting strings or comments. */
function sourceReferences(sql: string): SqlCsvReference[] {
  const tokens: Array<{ value: string; from: number; to: number; quoted: boolean }> = [];
  for (let i = 0; i < sql.length;) {
    const from = i, char = sql[i]!;
    if (/\s/.test(char)) { ++i; continue; }
    if (sql.slice(i, i + 2) === '--') { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end; continue; }
    if (sql.slice(i, i + 2) === '/*') { const end = sql.indexOf('*/', i + 2); if (end < 0) throw new Error('Unclosed SQL comment.'); i = end + 2; continue; }
    if ('"\'`['.includes(char)) {
      const end = char === '[' ? ']' : char;
      let value = '', closed = false; ++i;
      while (i < sql.length) {
        if (sql[i] === end) {
          if (sql[i + 1] === end && end !== ']') { value += end; i += 2; continue; }
          ++i; closed = true; break;
        }
        value += sql[i++]!;
      }
      if (!closed) throw new Error('Unclosed SQL quote.');
      tokens.push({ value, from, to: i, quoted: true });
    } else {
      const word = /^[\p{L}\p{N}_$]+/u.exec(sql.slice(i));
      i += word?.[0].length ?? 1;
      tokens.push({ value: sql.slice(from, i), from, to: i, quoted: false });
    }
  }
  // WITH names shadow physical tables inside their statement, including nested
  // subqueries. Keep each declaration's scope so an inner CTE cannot hide a real
  // source used by the enclosing query.
  const scopes: Array<{ from: number; to: number; names: Set<string> }> = [];
  const closes = new Map<number, number>();
  const stack: number[] = [];
  for (let i = 0; i < tokens.length; ++i) {
    const token = tokens[i]!;
    if (token.quoted) continue;
    if (token.value === '(') stack.push(i);
    if (token.value === ')') { const open = stack.pop(); if (open !== undefined) closes.set(open, i); }
  }
  const keyword = (index: number, value: string) => !tokens[index]?.quoted && tokens[index]?.value.toUpperCase() === value;
  for (let i = 0; i < tokens.length; ++i) {
    if (!keyword(i, 'WITH')) continue;
    const enclosing = [...closes].filter(([open, close]) => open < i && close > i).sort((a, b) => b[0] - a[0])[0];
    let end = enclosing?.[1] ?? tokens.length;
    for (let j = i + 1; j < end; ++j) {
      if (keyword(j, ';')) { end = j; break; }
      if (keyword(j, '(')) j = closes.get(j) ?? j;
    }
    const names = new Set<string>();
    let at = i + 1;
    if (keyword(at, 'RECURSIVE')) ++at;
    while (at < end) {
      const name = tokens[at++];
      if (!name) break;
      if (keyword(at, '(')) at = (closes.get(at) ?? end) + 1;
      if (!keyword(at++, 'AS')) break;
      if (keyword(at, 'NOT')) ++at;
      if (keyword(at, 'MATERIALIZED')) ++at;
      if (!keyword(at, '(') || !closes.has(at)) break;
      names.add(name.value.toLowerCase());
      at = closes.get(at)! + 1;
      if (!keyword(at, ',')) break;
      ++at;
    }
    if (names.size) scopes.push({ from: i, to: end, names });
  }
  const references: SqlCsvReference[] = [];
  const fromClause = new Map<number, boolean>();
  let depth = 0;
  for (let i = 1; i < tokens.length; ++i) {
    const previous = tokens[i - 1]!;
    if (!previous.quoted) {
      if (previous.value === '(') ++depth;
      else if (previous.value === ')') { fromClause.delete(depth); --depth; }
      else if (/^FROM$/i.test(previous.value)) fromClause.set(depth, true);
      else if (/^(?:WHERE|GROUP|HAVING|WINDOW|ORDER|LIMIT|UNION|INTERSECT|EXCEPT|;)$/i.test(previous.value)) fromClause.set(depth, false);
    }
    const tableFactor = !previous.quoted && (/^(?:FROM|JOIN)$/i.test(previous.value) || previous.value === ',' && fromClause.get(depth));
    const at = tableFactor && keyword(i + 1, '.') ? i + 2 : i;
    const token = tokens[at];
    if (tableFactor && token && (token.value.toLowerCase() === 'data' || token.quoted && /\.(?:csv|tsv)$/i.test(token.value))) {
      if (at === i && scopes.some(scope => scope.from < i && i < scope.to && scope.names.has(token.value.toLowerCase()))) continue;
      const next = tokens[at + 1];
      const alias = !!next && (next.quoted || /^[\p{L}_]/u.test(next.value) && !/^(?:WHERE|JOIN|LEFT|RIGHT|FULL|INNER|OUTER|CROSS|NATURAL|ON|USING|GROUP|HAVING|WINDOW|ORDER|LIMIT|UNION|INTERSECT|EXCEPT|INDEXED|NOT)$/i.test(next.value));
      const qualifiers = alias ? [] : tokens.filter((candidate, at) => candidate.value.toLowerCase() === token.value.toLowerCase() && keyword(at + 1, '.') &&
        !scopes.some(scope => scope.from < at && at < scope.to && scope.names.has(candidate.value.toLowerCase()))).map(candidate => ({ from: candidate.from, to: candidate.to }));
      references.push({ name: token.value, from: token.from, to: token.to, alias, qualifiers });
    }
  }
  return references;
}

export function csvSqlReferences(sql: string): SqlCsvReference[] {
  const references = sourceReferences(sql).filter(item => /\.(?:csv|tsv)$/i.test(item.name));
  if (new Set(references.map(item => item.name)).size > 1) throw new Error('A CSV export currently supports one CSV source.');
  return references;
}

export function relativeCsvSource(note: string, source: string): string {
  return relativeVaultPath(parentVaultPath(note), source);
}

export function resolveCsvSource(note: string, source: string): string {
  if (!source || /^[\\/]/.test(source) || source.includes(':')) throw new Error('CSV paths must be relative to the note and inside the vault.');
  const path = resolveVaultRelativePath(parentVaultPath(note), source);
  if (path === null) throw new Error('CSV path leaves the vault.');
  if (!/\.(?:csv|tsv)$/i.test(path)) throw new Error('Choose a CSV or TSV file inside the vault.');
  return path;
}

export function rebaseSqlSource(sql: string, reference: string): string {
  return rewriteSources(sql, csvSqlReferences(sql), reference);
}

function rewriteSources(sql: string, references: SqlCsvReference[], reference: string): string {
  const quoted = `"${reference.replace(/"/g, '""')}"`;
  const edits = new Map<number, { from: number; to: number; text: string }>();
  for (const item of references) {
    // Preserve the original implicit table name as an alias when qualified
    // columns use it. Qualifiers in nested queries can belong to unrelated
    // aliases, so changing their token text would be unsafe.
    const alias = !item.alias && item.qualifiers?.length ? ` AS "${item.name.replace(/"/g, '""')}"` : '';
    edits.set(item.from, { ...item, text: quoted + alias });
  }
  for (const item of [...edits.values()].sort((left, right) => right.from - left.from)) sql = sql.slice(0, item.from) + item.text + sql.slice(item.to);
  return sql;
}

/** Make the viewer's implicit data table explicit in a portable SQL block. */
export function nameSqlSource(sql: string, reference: string): string {
  csvSqlReferences(sql); // Reject ambiguous physical CSV sources before rewriting.
  const references = sourceReferences(sql);
  if (!references.length) throw new Error('SQL code block exports need a CSV source after FROM or JOIN.');
  return rewriteSources(sql, references, reference);
}

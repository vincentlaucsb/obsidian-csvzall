function markdownCell(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([|`*_\[\]])/g, '\\$1')
    .replace(/\r?\n/g, '<br>')
    .replace(/\r/g, '');
}

export function rowsToMarkdownTable(columns, rows) {
  const safeColumns = Array.isArray(columns) ? columns : [];
  const safeRows = Array.isArray(rows) ? rows : [];
  const header = `| ${safeColumns.map(markdownCell).join(' | ')} |`;
  const divider = `| ${safeColumns.map(() => '---').join(' | ')} |`;
  const body = safeRows.map((row) => {
    const values = safeColumns.map((column, index) => markdownCell(row?.[Array.isArray(row) ? index : column] ?? ''));
    return `| ${values.join(' | ')} |`;
  });
  return [header, divider, ...body].join('\n');
}

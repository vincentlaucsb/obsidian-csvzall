// Shared, framework-free CSV table form. Hosts own dialogs, IO and destinations.
function quoteColumn(name) { return `"${name.replace(/"/g, '""')}"`; }

function stripTerminator(sql) {
  let quote = '', comment = '', terminator = -1;
  for (let i = 0; i < sql.length; ++i) {
    const char = sql[i], next = sql[i + 1];
    if (comment === 'line') { if (char === '\n') comment = ''; continue; }
    if (comment === 'block') { if (char === '*' && next === '/') { comment = ''; ++i; } continue; }
    if (quote) {
      if (char === quote) {
        if (next === quote && quote !== ']') ++i;
        else quote = '';
      }
      continue;
    }
    if (char === '-' && next === '-') { comment = 'line'; ++i; continue; }
    if (char === '/' && next === '*') { comment = 'block'; ++i; continue; }
    if (/\s/.test(char)) continue;
    terminator = char === ';' ? i : -1;
    if (char === "'" || char === '"' || char === '`' || char === '[') quote = char === '[' ? ']' : char;
  }
  return terminator < 0 ? sql : sql.slice(0, terminator) + sql.slice(terminator + 1);
}

export function tableQuery(value, limit) {
  const sql = stripTerminator(value.sql?.trim() || '') ||
    `SELECT ${value.columns?.length ? value.columns.map(column => `data.${quoteColumn(column)}`).join(', ') : '*'} FROM data`;
  // A subquery accepts SELECT/CTE results, never a write statement or SQL script.
  return `SELECT * FROM (\n${sql}\n) AS csvzall_table${limit === undefined ? '' : ` LIMIT ${limit}`}`;
}

export function mountTableForm(root, options) {
  const doc = root.ownerDocument;
  root.classList.add('csvzall-table-form');
  const listeners = [];
  let disposed = false, revision = 0, sourceRevision = 0, busy = false;
  const controller = new AbortController();
  const on = (node, type, handler) => { node.addEventListener(type, handler); listeners.push(() => node.removeEventListener(type, handler)); };
  const el = (tag, parent = root, text) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    parent.appendChild(node);
    return node;
  };
  const field = (title, tag = 'input') => {
    const label = el('label');
    el('span', label, title);
    return el(tag, label);
  };
  const style = el('style');
  style.textContent = `
    .csvzall-table-form { display:flex; flex-direction:column; gap:12px; min-width:0; }
    .csvzall-table-form > label { display:flex; flex-direction:column; gap:6px; }
    .csvzall-table-form label:has(> input[type=checkbox]), .csvzall-table-columns label { display:flex; flex-direction:row; align-items:center; gap:8px; }
    .csvzall-table-form input[type=text], .csvzall-table-form input[type=search], .csvzall-table-form textarea, .csvzall-table-form select { width:100%; box-sizing:border-box; }
    .csvzall-table-columns { display:flex; flex-wrap:wrap; gap:8px 16px; max-height:160px; overflow:auto; }
    .csvzall-query-picker { display:flex; flex-direction:column; gap:8px; min-width:0; }
    .csvzall-query-picker > label { display:flex; flex-direction:column; gap:6px; }
    .csvzall-query-columns { display:flex; flex-wrap:wrap; gap:8px; max-height:160px; overflow:auto; }
    .csvzall-query-columns button { max-width:100%; white-space:normal; overflow-wrap:anywhere; height:auto; }
    .csvzall-table-form p { margin:0; }
    .csvzall-table-form [role=alert] { color:var(--text-error, inherit); }
    .csvzall-table-preview { overflow:auto; max-height:240px; white-space:pre; padding:10px; }
    .csvzall-table-actions { display:flex; gap:8px; justify-content:flex-end; }
    .csvzall-table-form [hidden] { display:none !important; }
  `;
  const source = field('CSV source');
  source.type = 'text';
  source.value = options.value?.source || '';
  source.parentElement.hidden = options.showSource === false;
  if (options.sources) {
    const list = el('datalist');
    list.id = `csvzall-sources-${Math.random().toString(36).slice(2)}`;
    source.setAttribute('list', list.id);
    options.sources.forEach(path => { const option = el('option', list); option.value = path; });
  }
  const destination = field('New note path');
  destination.type = 'text';
  destination.value = options.value?.destination || '';
  destination.parentElement.hidden = !options.showDestination;
  const format = field('Insert as', 'select');
  for (const [value, title] of [['table', 'Table'], ['value', 'Value']]) {
    const option = el('option', format, title); option.value = value;
  }
  format.parentElement.hidden = !options.showFormat;
  const mode = field('Include', 'select');
  for (const [value, title] of [['all', 'Entire CSV'], ['columns', 'Selected columns'], ['sql', 'SQLite query']]) {
    const option = el('option', mode, title); option.value = value;
  }
  const columnGroup = el('fieldset');
  el('legend', columnGroup, 'Columns');
  const columns = el('div', columnGroup);
  columns.className = 'csvzall-table-columns';
  const query = field('SQLite query', 'textarea');
  query.rows = 5;
  query.placeholder = 'SELECT * FROM data';
  const queryPicker = el('fieldset'); queryPicker.className = 'csvzall-query-picker';
  const queryLegend = el('legend', queryPicker, 'Columns');
  el('p', queryPicker, 'Click a column to insert it. An empty query starts a SELECT from data.');
  const searchLabel = el('label', queryPicker);
  el('span', searchLabel, 'Find a column');
  const columnSearch = el('input', searchLabel); columnSearch.type = 'search';
  const queryColumns = el('div', queryPicker); queryColumns.className = 'csvzall-query-columns';
  const columnStatus = el('p', queryPicker); columnStatus.setAttribute('role', 'status');
  const expandColumns = el('button', queryPicker); expandColumns.type = 'button';
  let columnsExpanded = false;
  const help = el('p', root, 'Query the CSV as table data. Preview shows up to 20 rows.');
  const autoLabel = el('label');
  const auto = el('input', autoLabel); auto.type = 'checkbox';
  el('span', autoLabel, 'Keep updated when CSV changes');
  autoLabel.hidden = options.showAutoUpdate === false;
  const ownership = el('p', root, 'Changes made directly to an automatically updated table may be replaced.');
  ownership.hidden = options.showAutoUpdate === false;
  const error = el('p'); error.setAttribute('role', 'alert'); error.hidden = true;
  const preview = el('pre'); preview.hidden = true;
  preview.className = 'csvzall-table-preview';
  preview.setAttribute('aria-label', 'Markdown preview');
  const actions = el('div'); actions.className = 'csvzall-table-actions';
  const previewButton = el('button', actions, 'Preview'); previewButton.type = 'button';
  const submit = options.submit ? el('button', actions, options.submitLabel || 'Insert table') : null;
  if (submit) submit.type = 'button';
  let availableColumns = options.columns || [];
  let loadedSource = source.value;
  let pendingSelection = [];
  const checks = () => Array.from(columns.querySelectorAll('input'));
  function renderQueryColumns() {
    queryColumns.replaceChildren();
    queryLegend.textContent = `Columns (${availableColumns.length})`;
    searchLabel.hidden = !columnsExpanded;
    const search = columnSearch.value.toLocaleLowerCase();
    const visible = columnsExpanded ? availableColumns.filter(name => name.toLocaleLowerCase().includes(search)) : availableColumns.slice(0, 6);
    visible.forEach(name => {
      const button = el('button', queryColumns, name); button.type = 'button'; button.value = name;
      button.disabled = query.disabled;
      button.title = `Insert ${quoteColumn(name)}`;
    });
    columnStatus.hidden = visible.length > 0;
    columnStatus.textContent = availableColumns.length ? 'No matching columns.' : 'No columns available.';
    expandColumns.hidden = availableColumns.length <= 6;
    expandColumns.textContent = columnsExpanded ? 'Show fewer columns' : `Show all ${availableColumns.length} columns`;
    expandColumns.setAttribute('aria-expanded', String(columnsExpanded));
  }
  function renderColumns(selected) {
    columns.replaceChildren();
    availableColumns.forEach(name => {
      const label = el('label', columns);
      const check = el('input', label); check.type = 'checkbox'; check.value = name;
      check.checked = selected.includes(name);
      el('span', label, name);
    });
    renderQueryColumns();
  }
  function changed() {
    ++revision;
    preview.hidden = true; error.hidden = true;
    columnGroup.hidden = mode.value !== 'columns';
    query.parentElement.hidden = mode.value !== 'sql';
    queryPicker.hidden = mode.value !== 'sql';
    ownership.hidden = options.showAutoUpdate === false || !auto.checked;
    ownership.textContent = 'Changes made directly to automatically updated content may be replaced.';
    help.textContent = format.value === 'value' ? 'Return exactly one row and one column. Line breaks become spaces; text is escaped for Markdown.' : 'Query the CSV as table data. Preview shows up to 20 rows.';
    options.onChange?.();
  }
  function setValue(value = {}) {
    source.value = value.source || source.value;
    destination.value = value.destination || '';
    query.value = value.sql || '';
    format.value = options.showFormat && value.format === 'value' ? 'value' : 'table';
    mode.value = value.sql ? 'sql' : value.columns?.length ? 'columns' : 'all';
    auto.checked = value.autoUpdate !== false;
    pendingSelection = value.columns || [];
    renderColumns(pendingSelection);
    changed();
  }
  function getValue() {
    const selected = checks().filter(check => check.checked).map(check => check.value);
    if (mode.value === 'columns' && !selected.length) throw new Error('Select at least one column.');
    if (mode.value === 'sql' && !query.value.trim()) throw new Error('Enter a SQLite query.');
    return { format: format.value, source: source.value.trim(), destination: destination.value.trim(),
      columns: mode.value === 'columns' ? selected : [],
      sql: mode.value === 'sql' ? query.value.trim() : '', autoUpdate: auto.checked };
  }
  function showError(cause) { error.textContent = cause instanceof Error ? cause.message : String(cause); error.hidden = false; }
  async function run(action) {
    if (busy || disposed) return;
    busy = true; previewButton.disabled = true; if (submit) submit.disabled = true;
    const controls = action === 'submit' ? ['input', 'select', 'textarea', 'button'].flatMap(tag => Array.from(root.querySelectorAll(tag))) : [];
    controls.forEach(control => { control.disabled = true; });
    const current = revision;
    try {
      const value = getValue();
      if (action === 'submit') await options.submit(value, controller.signal);
      else {
        const text = await options.preview(value);
        if (!disposed && current === revision) { preview.textContent = text; preview.hidden = false; }
      }
    } catch (cause) { if (!disposed && current === revision) showError(cause); }
    finally { busy = false; if (!disposed) { controls.forEach(control => { control.disabled = false; }); previewButton.disabled = false; if (submit) submit.disabled = false; if (action === 'submit') renderQueryColumns(); } }
  }
  on(root, 'input', changed);
  on(root, 'change', changed);
  on(queryColumns, 'click', event => {
    const button = event.target.closest('button');
    if (!button || button.parentElement !== queryColumns || query.disabled || disposed) return;
    const quoted = quoteColumn(button.value);
    if (!query.value.trim()) {
      query.value = `SELECT ${quoted} FROM data`;
      query.setSelectionRange(query.value.length, query.value.length);
    } else {
      query.setRangeText(quoted, query.selectionStart, query.selectionEnd, 'end');
    }
    query.focus();
    query.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  });
  on(expandColumns, 'click', () => {
    columnsExpanded = !columnsExpanded;
    columnSearch.value = '';
    renderQueryColumns();
  });
  on(columnSearch, 'input', event => { event.stopPropagation(); renderQueryColumns(); });
  on(columnSearch, 'change', event => event.stopPropagation());
  on(columnSearch, 'keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
  on(source, 'change', () => {
    if (!options.loadColumns) return;
    const current = ++sourceRevision;
    const selected = source.value === loadedSource ? (availableColumns.length ? checks().filter(check => check.checked).map(check => check.value) : pendingSelection) : [];
    loadedSource = source.value;
    availableColumns = []; columnsExpanded = false; columnSearch.value = ''; renderColumns([]);
    void options.loadColumns(source.value.trim()).then(names => {
      if (!disposed && current === sourceRevision) { availableColumns = names; renderColumns(selected); }
    }).catch(cause => { if (!disposed && current === sourceRevision) showError(cause); });
  });
  on(previewButton, 'click', () => void run('preview'));
  if (submit) on(submit, 'click', () => void run('submit'));
  setValue(options.value);
  if (source.value && options.loadColumns) source.dispatchEvent(new doc.defaultView.Event('change'));
  return { getValue, setValue, setColumns(names, selected = []) { availableColumns = names; pendingSelection = selected; columnsExpanded = false; columnSearch.value = ''; renderColumns(selected); },
    dispose() { disposed = true; controller.abort(); ++sourceRevision; listeners.forEach(remove => remove()); root.replaceChildren(); } };
}

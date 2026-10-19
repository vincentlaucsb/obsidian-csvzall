import { mountTableForm, tableQuery } from '../markdown/table-form.mjs';
import { rowsToMarkdownTable } from './markdown.mjs';

function slugify(value) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'chart';
}

function stripCsvExtension(value) {
  return value.replace(/\.[^.]+$/, '');
}

function populateColumnSelect(select, columns, { optional = false, preferred = '' } = {}) {
  select.textContent = '';
  if (optional) {
    const empty = select.ownerDocument.createElement('option');
    empty.value = '';
    empty.textContent = 'None';
    select.append(empty);
  }
  columns.forEach((column) => {
    const option = select.ownerDocument.createElement('option');
    option.value = column;
    option.textContent = column;
    select.append(option);
  });
  if (preferred && columns.includes(preferred)) {
    select.value = preferred;
  } else if (!optional && columns.length > 0) {
    select.value = columns[0];
  }
}

function guessColumn(columns, patterns) {
  const lowered = columns.map((column) => column.toLowerCase());
  for (const pattern of patterns) {
    const index = lowered.findIndex((column) => column === pattern || column.includes(pattern));
    if (index >= 0) {
      return columns[index];
    }
  }
  return '';
}

/** Shared chart options controller. Hosts own IO and the surrounding dialog. */
export function mountChartForm(root, options) {
  const doc = root.ownerDocument;
  const { schema, fetchJson, postJson } = options;
  let disposed = false, busy = false;
  const listeners = [];
  const on = (node, type, handler) => {
    node.addEventListener(type, handler);
    listeners.push(() => node.removeEventListener(type, handler));
  };
  const chartForm = root.querySelector('#heatmap-chart-form');
  const chartList = root.querySelector('#chart-list');
  const newChartButton = root.querySelector('#new-chart');
  const generateChartButton = root.querySelector('#generate-chart');
  const chartFormTitle = root.querySelector('#chart-form-title');
  const chartType = root.querySelector('#chart-type');
  const chartId = root.querySelector('#chart-id');
  const chartTitleField = root.querySelector('#chart-title-field');
  const chartTitle = root.querySelector('#chart-title');
  const chartColumnGrid = root.querySelector('#chart-column-grid');
  const chartPrimaryColumnLabel = root.querySelector('#chart-primary-column-label');
  const chartValueColumnLabel = root.querySelector('#chart-value-column-label');
  const chartValueColumn2Label = root.querySelector('#chart-value-column-2-label');
  const chartValueColumn2Field = root.querySelector('#chart-value-column-2-field');
  const chartLabelColumnLabel = root.querySelector('#chart-label-column-label');
  const chartDateColumn = root.querySelector('#chart-date-column');
  const chartValueColumn = root.querySelector('#chart-value-column');
  const chartValueColumn2 = root.querySelector('#chart-value-column-2');
  const chartLabelColumn = root.querySelector('#chart-label-column');
  const chartLayoutSection = root.querySelector('#chart-layout-section');
  const chartRangeSection = root.querySelector('#chart-range-section');
  const chartRangeFixed = root.querySelector('#chart-range-fixed');
  const chartRangeRolling = root.querySelector('#chart-range-rolling');
  const chartFixedRange = root.querySelector('#chart-fixed-range');
  const chartRollingRange = root.querySelector('#chart-rolling-range');
  const chartOrientation = root.querySelector('#chart-orientation');
  const chartPresentationField = root.querySelector('#chart-presentation-field');
  const chartPresentation = root.querySelector('#chart-presentation');
  const chartColorSchemeField = root.querySelector('#chart-color-scheme-field');
  const chartColorScheme = root.querySelector('#chart-color-scheme');
  const chartMarkdownTableSection = root.querySelector('#chart-markdown-table-section');
  const chartTableRoot = root.querySelector('#chart-table-form');
  const tableForm = mountTableForm(chartTableRoot, {
    showSource: false,
    showAutoUpdate: false,
    columns: schema.columns,
    preview: options.previewTable ?? (async (value) => {
      const result = await postJson('/api/sql-query', { sql: tableQuery(value, 20) });
      return rowsToMarkdownTable(result.columns, result.rows);
    }),
  });
  const chartStart = root.querySelector('#chart-start');
  const chartEnd = root.querySelector('#chart-end');
  const chartLookbackCount = root.querySelector('#chart-lookback-count');
  const chartLookbackUnit = root.querySelector('#chart-lookback-unit');
  const chartOutput = root.querySelector('#chart-output');
  const chartRunOnSave = root.querySelector('#chart-run-on-save');
  const chartError = root.querySelector('#chart-error');
  const cancelChart = root.querySelector('#cancel-chart');
  const previewChartButton = root.querySelector('#preview-chart');
  const previewPanel = root.querySelector('#chart-preview');
  let previewRevision = 0;
  const clearPreview = () => { ++previewRevision; previewPanel.hidden = true; previewPanel.replaceChildren(); previewPanel.parentElement.classList.remove('chart-has-preview'); };
  on(chartForm, 'input', clearPreview);
  on(chartForm, 'change', clearPreview);
  options.decorateButton?.(newChartButton, 'plus', 'New');
  options.decorateButton?.(cancelChart, 'x', 'Cancel');
  options.decorateButton?.(generateChartButton, 'chart-bar', 'Create chart');
  options.decorateButton?.(chartForm.querySelector('button[type="submit"]'), 'device-floppy', 'Save chart');
  const baseName = stripCsvExtension(schema.file);
  const baseSlug = slugify(baseName);
  const guessedDateColumn = () => guessColumn(schema.columns, ['date', 'day', 'attendance_date']);
  const guessedValueColumn = () => guessColumn(schema.columns, ['count', 'value', 'total']);
  const guessedLabelColumn = () => guessColumn(schema.columns, ['content', 'label', 'note', 'description']);
  let currentCharts = [];
  let selectedChartId = '';
  populateColumnSelect(chartDateColumn, schema.columns, { preferred: guessedDateColumn() });
  populateColumnSelect(chartValueColumn, schema.columns, { optional: true, preferred: guessedValueColumn() });
  populateColumnSelect(chartValueColumn2, schema.columns, { optional: true });
  populateColumnSelect(chartLabelColumn, schema.columns, { optional: true, preferred: guessedLabelColumn() });

  const chartValidationFields = [
    chartType,
    chartId,
    chartDateColumn,
    chartValueColumn,
    chartValueColumn2,
    chartLabelColumn,
    chartOrientation,
    chartPresentation,
    chartColorScheme,
    chartTableRoot,
    chartStart,
    chartEnd,
    chartLookbackCount,
    chartOutput,
  ];
  const clearChartFieldErrors = () => {
    chartValidationFields.forEach((field) => {
      field.removeAttribute('aria-invalid');
      field.removeAttribute('title');
    });
  };
  const chartFieldsForError = (message) => {
    if (message.includes('chart id is required')) return [chartId];
    if (message.includes('chart not found')) return [chartId];
    if (message.includes('unknown chart type')) return [chartType];
    if (message.includes('output path')) return [chartOutput];
    if (message.includes('heatmap: date column')) return [chartDateColumn];
    if (message.includes('orientation')) return [chartOrientation];
    if (message.includes('start and end dates')) return [chartStart, chartEnd];
    if (message.includes('lookback cannot be combined')) return [chartStart, chartLookbackCount];
    if (message.includes('lookback')) return [chartLookbackCount];
    if (message.includes('bar: label column')) return [chartDateColumn];
    if (message.includes('bar: value column')) return [chartValueColumn];
    if (message.includes('presentation')) return [chartPresentation];
    if (message.includes('colorScheme')) return [chartColorScheme];
    if (message.includes('line: x column')) return [chartDateColumn];
    if (message.includes('line: y column')) return [chartValueColumn];
    if (message.includes('series column cannot be combined')) {
      return [chartLabelColumn, chartValueColumn, chartValueColumn2];
    }
    if (message.includes('markdown-table') || message.includes('no such column')) return [chartTableRoot];
    return [];
  };
  const markChartFieldsForError = (message) => {
    const fields = chartFieldsForError(message);
    fields.forEach((field) => {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('title', message);
    });
    fields[0]?.focus({ preventScroll: true });
  };
  const showChartError = (message, { markFields = false } = {}) => {
    if (disposed) return;
    chartError.textContent = message;
    chartError.hidden = false;
    if (markFields) {
      clearChartFieldErrors();
      markChartFieldsForError(message);
    }
  };
  const clearChartError = () => {
    chartError.textContent = '';
    chartError.hidden = true;
    clearChartFieldErrors();
  };
  chartValidationFields.forEach((field) => {
    const clearFieldError = () => {
      field.removeAttribute('aria-invalid');
      field.removeAttribute('title');
    };
    on(field, 'input', clearFieldError);
    on(field, 'change', clearFieldError);
  });

  const chartTypeTitle = (type) => {
    if (type === 'bar') return 'Bar';
    if (type === 'line') return 'Line';
    if (type === 'markdown-table') return 'Markdown Table';
    return 'Heatmap';
  };

  const defaultChartValues = (type = chartType.value || 'heatmap') => {
    const markdown = type === 'markdown-table';
    return {
      type,
      id: `${baseSlug}-${type}`,
      title: markdown ? '' : baseName,
      date: guessedDateColumn(),
      value: guessedValueColumn(),
      value2: '',
      label: guessedLabelColumn(),
      orientation: 'months-horizontal',
      presentation: 'stacked',
      colorScheme: 'sequential',
      start: '',
      end: '',
      lookback: markdown ? '' : '1y',
      output: markdown ? `charts/${baseSlug}_${type}.md` : `charts/${baseSlug}_${type}.svg`,
      columns: markdown ? schema.columns : [],
      sql: '',
      runOnSave: true,
    };
  };

  const parseLookback = (lookback) => {
    const match = String(lookback || '').trim().match(/^(\d+)\s*(d|day|days|y|year|years)?$/i);
    if (!match) {
      return { count: '1', unit: 'y' };
    }
    const unit = (match[2] || 'd').toLowerCase().startsWith('y') ? 'y' : 'd';
    return { count: match[1], unit };
  };

  const currentLookback = () => `${chartLookbackCount.value.trim()}${chartLookbackUnit.value}`;

  const setRangeMode = (mode) => {
    const rolling = mode === 'rolling';
    chartRangeFixed.checked = !rolling;
    chartRangeRolling.checked = rolling;
    chartFixedRange.hidden = rolling;
    chartRollingRange.hidden = !rolling;
  };

  const setChartType = (type) => {
    chartType.value = type;
    chartFormTitle.textContent = chartTypeTitle(type);
    const markdown = type === 'markdown-table';
    chartTitleField.hidden = markdown;
    chartColumnGrid.hidden = markdown;
    chartMarkdownTableSection.hidden = !markdown;
    chartLayoutSection.hidden = type !== 'heatmap';
    chartRangeSection.hidden = type !== 'heatmap';
    chartPresentationField.hidden = type !== 'bar';
    chartColorSchemeField.hidden = true;
    chartLabelColumn.closest('label').hidden = type === 'bar';
    if (markdown) {
      return;
    }
    chartValueColumnLabel.textContent = type === 'heatmap' ? 'Weight column' : 'Value column';
    chartValueColumn2Label.textContent = type === 'heatmap' ? 'Weight column 2' : 'Value column 2';
    chartValueColumn2Field.hidden = false;
    if (type === 'heatmap') {
      chartPrimaryColumnLabel.textContent = 'Date column';
      chartLabelColumnLabel.textContent = 'Label column';
    } else if (type === 'bar') {
      chartPrimaryColumnLabel.textContent = 'Label column';
      chartLabelColumnLabel.textContent = 'Unused';
      if (!chartValueColumn.value) chartValueColumn.value = guessedValueColumn() || schema.columns[0] || '';
    } else {
      chartPrimaryColumnLabel.textContent = 'X column';
      chartLabelColumnLabel.textContent = 'Series column';
      if (!chartValueColumn.value) chartValueColumn.value = guessedValueColumn() || schema.columns[0] || '';
    }
  };

  const optionValues = (options, scalarKey) => {
    const explicit = Array.isArray(options?.values)
      ? options.values.map((value) => typeof value === 'string' ? value : value?.column).filter(Boolean)
      : [];
    if (explicit.length > 0) return explicit;
    const scalar = options?.[scalarKey] ?? '';
    return scalar ? [scalar] : [];
  };

  const selectedValueColumns = () => {
    return [chartValueColumn.value, chartValueColumn2.value].filter(Boolean);
  };

  const updateColorSchemeVisibility = () => {
    const supportsColorScheme = chartType.value === 'bar' || chartType.value === 'line';
    chartColorSchemeField.hidden = !supportsColorScheme || selectedValueColumns().length <= 1;
  };

  const refreshChartColumnOptions = (values = {}) => {
    populateColumnSelect(chartDateColumn, schema.columns, { preferred: values.date ?? guessedDateColumn() });
    populateColumnSelect(chartValueColumn, schema.columns, { optional: true, preferred: values.value ?? guessedValueColumn() });
    populateColumnSelect(chartValueColumn2, schema.columns, { optional: true, preferred: values.value2 ?? '' });
    populateColumnSelect(chartLabelColumn, schema.columns, { optional: true, preferred: values.label ?? guessedLabelColumn() });
    tableForm.setColumns(schema.columns, values.columns ?? []);
  };

  const applyChartValues = (values) => {
    clearPreview();
    refreshChartColumnOptions(values);
    setChartType(values.type ?? 'heatmap');
    chartId.value = values.id ?? '';
    chartTitle.value = values.title ?? '';
    chartDateColumn.value = values.date ?? '';
    chartValueColumn.value = values.value ?? '';
    chartValueColumn2.value = values.value2 ?? '';
    updateColorSchemeVisibility();
    chartLabelColumn.value = values.label ?? '';
    chartOrientation.value = values.orientation ?? 'months-horizontal';
    chartPresentation.value = values.presentation ?? 'stacked';
    chartColorScheme.value = values.colorScheme ?? 'sequential';
    tableForm.setValue({ columns: values.columns ?? [], sql: values.sql ?? '' });
    chartStart.value = values.start ?? '';
    chartEnd.value = values.end ?? '';
    const lookback = values.lookback ?? '';
    const parsedLookback = parseLookback(lookback);
    chartLookbackCount.value = parsedLookback.count;
    chartLookbackUnit.value = parsedLookback.unit;
    setRangeMode(lookback ? 'rolling' : 'fixed');
    chartOutput.value = values.output ?? '';
    chartRunOnSave.checked = values.runOnSave !== false;
    selectedChartId = chartId.value;
    generateChartButton.disabled = !currentCharts.some((chart) => chart.id === selectedChartId);
  };

  const valuesFromChart = (chart) => {
    const type = chart.type || 'heatmap';
    return {
      type,
      id: chart.id,
      title: chart.options?.title ?? '',
      date: chart.options?.date ?? chart.options?.label ?? chart.options?.x ?? '',
      value: optionValues(chart.options, type === 'line' ? 'y' : 'value')[0] ?? '',
      value2: optionValues(chart.options, type === 'line' ? 'y' : 'value')[1] ?? '',
      label: chart.options?.label ?? chart.options?.series ?? '',
      orientation: chart.options?.orientation ?? 'months-horizontal',
      presentation: chart.options?.presentation ?? 'stacked',
      colorScheme: chart.options?.colorScheme ?? 'sequential',
      columns: Array.isArray(chart.options?.columns) ? chart.options.columns : [],
      sql: chart.options?.sql ?? '',
      start: chart.options?.start ?? '',
      end: chart.options?.end ?? '',
      lookback: chart.options?.lookback ?? '',
      output: chart.output ?? '',
      runOnSave: chart.runOnSave === true,
    };
  };

  const renderChartList = () => {
    chartList.replaceChildren();
    if (currentCharts.length === 0) {
      const empty = doc.createElement('p');
      empty.className = 'chart-list-empty';
      empty.textContent = 'No charts yet. Choose a chart type and save one.';
      chartList.append(empty);
      return;
    }
    currentCharts.forEach((chart) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'chart-list-item';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(chart.id === selectedChartId));
      const title = doc.createElement('strong');
      title.textContent = chart.options?.title || chart.id;
      const detail = doc.createElement('span');
      detail.textContent = `${chart.type || 'chart'} · ${chart.output || 'No output path'}`;
      button.append(title, detail);
      button.addEventListener('click', () => {
        selectedChartId = chart.id;
        applyChartValues(valuesFromChart(chart));
        clearChartError();
        renderChartList();
      });
      chartList.append(button);
    });
  };

  const loadChartList = async () => {
    const result = await fetchJson('/api/chart-config');
    if (disposed) return;
    currentCharts = Array.isArray(result.charts) ? result.charts : [];
    if (!currentCharts.some((chart) => chart.id === selectedChartId)) {
      selectedChartId = currentCharts[0]?.id ?? '';
    }
    if (selectedChartId) {
      const selected = currentCharts.find((chart) => chart.id === selectedChartId);
      if (selected) {
        applyChartValues(valuesFromChart(selected));
      }
    } else {
      applyChartValues(defaultChartValues('heatmap'));
    }
    renderChartList();
  };

  const useNewChartDefaults = () => {
    applyChartValues(defaultChartValues(chartType.value || 'heatmap'));
    selectedChartId = '';
    generateChartButton.disabled = true;
    clearChartError();
    renderChartList();
    chartId.focus();
  };

  const open = async () => {
    clearPreview();
    clearChartError();
    await loadChartList();
    if (!disposed) chartDateColumn.focus();
  };

  on(newChartButton, 'click', useNewChartDefaults);
  on(chartType, 'change', () => {
    applyChartValues(defaultChartValues(chartType.value));
    selectedChartId = '';
    generateChartButton.disabled = true;
    clearChartError();
    renderChartList();
  });
  on(chartRangeFixed, 'change', () => setRangeMode('fixed'));
  on(chartRangeRolling, 'change', () => setRangeMode('rolling'));
  on(chartValueColumn, 'change', updateColorSchemeVisibility);
  on(chartValueColumn2, 'change', updateColorSchemeVisibility);
  on(cancelChart, 'click', () => {
    options.close?.('cancel');
  });
  on(generateChartButton, 'click', async () => {
    if (busy || disposed) return;
    busy = true; generateChartButton.disabled = true;
    const id = chartId.value.trim();
    try {
      const result = await postJson('/api/chart-config/generate', { id });
      if (disposed) return;
      options.status?.(`Generated chart ${result.id}.`);
      clearChartError();
    } catch (error) {
      showChartError(error instanceof Error ? error.message : 'Chart generation failed', { markFields: true });
    } finally { busy = false; if (!disposed) generateChartButton.disabled = false; }
  });
  const getPayload = () => {
    const valueColumns = selectedValueColumns();
    const multiValues = valueColumns.length > 1 ? valueColumns : [];
    let markdown = { columns: [], sql: '' };
    try {
      if (chartType.value === 'markdown-table') markdown = tableForm.getValue();
    } catch (error) {
      throw new Error(error.message);
    }
    return {
      type: chartType.value,
      id: chartId.value.trim(),
      title: chartTitle.value.trim(),
      date: chartType.value === 'heatmap' ? chartDateColumn.value : '',
      value: chartType.value !== 'line' && valueColumns.length <= 1 ? (valueColumns[0] ?? '') : '',
      values: multiValues,
      label: chartType.value === 'heatmap'
        ? chartLabelColumn.value
        : (chartType.value === 'bar' ? chartDateColumn.value : ''),
      x: chartType.value === 'line' ? chartDateColumn.value : '',
      y: chartType.value === 'line' && valueColumns.length <= 1 ? (valueColumns[0] ?? '') : '',
      series: chartType.value === 'line' && valueColumns.length <= 1 ? chartLabelColumn.value : '',
      orientation: chartType.value === 'heatmap' ? chartOrientation.value : '',
      presentation: chartType.value === 'bar' ? chartPresentation.value : '',
      colorScheme: (chartType.value === 'bar' || chartType.value === 'line') ? chartColorScheme.value : '',
      columns: markdown.columns,
      sql: markdown.sql,
      start: chartRangeRolling.checked ? '' : chartStart.value,
      end: chartRangeRolling.checked ? '' : chartEnd.value,
      lookback: chartType.value === 'heatmap' && chartRangeRolling.checked ? currentLookback() : '',
      output: chartOutput.value.trim(),
      runOnSave: chartRunOnSave.checked,
    };
  };
  on(previewChartButton, 'click', async () => {
    if (busy || disposed) return;
    clearPreview();
    const revision = previewRevision;
    busy = true; previewChartButton.disabled = true;
    try {
      const payload = getPayload();
      const result = options.previewChart
        ? await options.previewChart(payload)
        : await postJson('/api/chart-config/preview', payload);
      if (disposed || revision !== previewRevision) return;
      const node = doc.createElement(result.svg ? 'img' : 'pre');
      if (result.svg) { node.alt = 'Chart preview'; node.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`; }
      else node.textContent = result.markdown ?? '';
      previewPanel.replaceChildren(node); previewPanel.hidden = false;
      previewPanel.parentElement.classList.add('chart-has-preview');
      clearChartError();
    } catch (error) {
      if (!disposed && revision === previewRevision) showChartError(error instanceof Error ? error.message : 'Chart preview failed');
    } finally { busy = false; if (!disposed) previewChartButton.disabled = false; }
  });
  on(chartForm, 'submit', async (event) => {
    event.preventDefault();
    if (busy || disposed) return;
    let payload;
    try { payload = getPayload(); }
    catch (error) { showChartError(error.message); return; }
    busy = true;
    const submitButton = chartForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      const result = await postJson('/api/chart-config/heatmap', payload);
      if (disposed) return;
      selectedChartId = result.id;
      await loadChartList();
      clearChartError();
      options.status?.(result.generated
        ? `Saved and generated chart ${result.id}.`
        : `Saved chart ${result.id}.`);
      options.close?.('saved');
    } catch (error) {
      showChartError(error instanceof Error ? error.message : 'Chart save failed', { markFields: true });
    } finally { busy = false; if (!disposed) submitButton.disabled = false; }
  });


  if (options.existingOnly) {
    newChartButton.hidden = true;
    chartType.disabled = true;
    chartId.disabled = true;
  }
  return {
    open,
    dispose() {
      disposed = true;
      ++previewRevision;
      tableForm.dispose();
      for (const remove of listeners) remove();
    },
  };
}

/** Build the same controls for hosts that do not provide viewer HTML. */
export function createChartForm(root) {
  const tree = [["form",{"id":"heatmap-chart-form","class":"dialog-form","novalidate":null},[["div",{"class":"chart-dialog-layout"},[["aside",{"class":"chart-list-pane"},[["div",{"class":"chart-list-header"},[["h2",{},["Charts"]],["button",{"id":"new-chart","type":"button"},["New"]]]],["div",{"id":"chart-list","class":"chart-list","role":"listbox","aria-label":"Charts for this CSV"},[]]]],["section",{"class":"chart-form-pane"},[["h2",{"id":"chart-form-title"},["Heatmap"]],["label",{},[["span",{},["Chart type"]],["select",{"id":"chart-type"},[["option",{"value":"heatmap"},["Heatmap"]],["option",{"value":"bar"},["Bar"]],["option",{"value":"line"},["Line"]],["option",{"value":"markdown-table"},["Markdown Table"]]]]]],["label",{},[["span",{},["Chart id"]],["input",{"id":"chart-id","type":"text","autocomplete":"off"},[]]]],["label",{"id":"chart-title-field"},[["span",{},["Title"]],["input",{"id":"chart-title","type":"text","autocomplete":"off"},[]]]],["div",{"id":"chart-column-grid","class":"dialog-grid"},[["label",{},[["span",{"id":"chart-primary-column-label"},["Date column"]],["select",{"id":"chart-date-column"},[]]]],["label",{},[["span",{"id":"chart-value-column-label"},["Weight column"]],["select",{"id":"chart-value-column"},[]]]],["label",{"id":"chart-value-column-2-field"},[["span",{"id":"chart-value-column-2-label"},["Weight column 2"]],["select",{"id":"chart-value-column-2"},[]]]],["label",{},[["span",{"id":"chart-label-column-label"},["Label column"]],["select",{"id":"chart-label-column"},[]]]]]],["fieldset",{"id":"chart-markdown-table-section","class":"chart-range","hidden":null},[["legend",{},["Markdown table"]],["div",{"id":"chart-table-form"},[]]]],["fieldset",{"id":"chart-layout-section","class":"chart-range"},[["legend",{},["Layout"]],["label",{},[["span",{},["Orientation"]],["select",{"id":"chart-orientation"},[["option",{"value":"months-horizontal"},["Months across"]],["option",{"value":"months-vertical"},["Months down"]]]]]]]],["fieldset",{"id":"chart-range-section","class":"chart-range"},[["legend",{},["Range"]],["label",{"class":"toggle-row"},[["input",{"id":"chart-range-fixed","type":"radio","name":"chart-range-mode","value":"fixed","checked":null},[]],["span",{},["Fixed dates"]]]],["label",{"class":"toggle-row"},[["input",{"id":"chart-range-rolling","type":"radio","name":"chart-range-mode","value":"rolling"},[]],["span",{},["Rolling"]]]],["div",{"id":"chart-fixed-range","class":"dialog-grid"},[["label",{},[["span",{},["Start"]],["input",{"id":"chart-start","type":"date"},[]]]],["label",{},[["span",{},["End"]],["input",{"id":"chart-end","type":"date"},[]]]]]],["div",{"id":"chart-rolling-range","class":"dialog-grid","hidden":null},[["label",{},[["span",{},["Look back"]],["input",{"id":"chart-lookback-count","type":"number","min":"1","step":"1","value":"1"},[]]]],["label",{},[["span",{},["Unit"]],["select",{"id":"chart-lookback-unit"},[["option",{"value":"y"},["Years"]],["option",{"value":"d"},["Days"]]]]]]]]]],["label",{"id":"chart-presentation-field"},[["span",{},["Presentation"]],["select",{"id":"chart-presentation"},[["option",{"value":"stacked"},["Stacked"]],["option",{"value":"grouped"},["Grouped"]]]]]],["label",{"id":"chart-color-scheme-field"},[["span",{},["Color scheme"]],["select",{"id":"chart-color-scheme"},[["option",{"value":"sequential"},["Sequential"]],["option",{"value":"diverging"},["Diverging"]]]]]],["label",{},[["span",{},["Output path"]],["input",{"id":"chart-output","type":"text","autocomplete":"off"},[]]]],["label",{"class":"toggle-row"},[["input",{"id":"chart-run-on-save","type":"checkbox","checked":null},[]],["span",{},["Run on save"]]]]]]]],["aside",{"id":"chart-preview","class":"chart-preview","aria-label":"Chart preview","aria-live":"polite","hidden":null},[]],["p",{"id":"chart-error","class":"dialog-error","hidden":null},[]],["div",{"class":"dialog-actions"},[["button",{"id":"cancel-chart","type":"button"},["Cancel"]],["button",{"id":"preview-chart","type":"button"},["Preview"]],["button",{"id":"generate-chart","type":"button"},["Create chart"]],["button",{"type":"submit"},["Save chart"]]]]]]];
  const append = (parent, items) => {
    for (const item of items) {
      if (typeof item === 'string') { parent.append(root.ownerDocument.createTextNode(item)); continue; }
      const [tag, attributes, children] = item;
      const node = root.ownerDocument.createElement(tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value ?? '');
      parent.append(node);
      append(node, children);
    }
  };
  append(root, tree);
  root.querySelector('#chart-form-title').parentElement.parentElement.append(root.querySelector('#chart-preview'));
}

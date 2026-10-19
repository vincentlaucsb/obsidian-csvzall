import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChartForm, mountChartForm } from '../src/charts/chart-form.mjs';

class Element {
  constructor(tag, doc) {
    this.tag = tag; this.ownerDocument = doc; this.children = []; this.listeners = new Map();
    this.classList = { add() {}, remove() {} }; this.value = ''; this.textContent = ''; this.checked = false;
  }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  appendChild(child) { if (child.parentElement) child.parentElement.children = child.parentElement.children.filter(node => node !== child); child.parentElement = this; this.children.push(child); return child; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this[key] = value; }
  removeAttribute(key) { delete this[key]; }
  addEventListener(type, handler) { this.listeners.set(type, [...(this.listeners.get(type) || []), handler]); }
  removeEventListener(type, handler) { this.listeners.set(type, this.listeners.get(type).filter(fn => fn !== handler)); }
  dispatchEvent(event) { this.listeners.get(event.type)?.forEach(fn => fn(event)); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  matches(selector) { return selector.startsWith('#') ? this.id === selector.slice(1) : selector === 'button[type="submit"]' ? this.tag === 'button' && this.type === 'submit' : this.tag === selector; }
  closest(tag) { return this.tag === tag ? this : this.parentElement?.closest(tag); }
  focus() {}
}
function fixture(overrides = {}) {
  const doc = { createElement(tag) { return new Element(tag, this); }, createTextNode(text) { const node = this.createElement('text'); node.textContent = text; return node; }, defaultView: { Event: class { constructor(type) { this.type = type; } } } };
  const root = doc.createElement('div');
  createChartForm(root);
  const requests = [], closes = [];
  const definition = { id: 'sales', type: 'bar', input: 'sales.csv', output: 'sales.svg', runOnSave: false,
    options: { label: 'name', values: [{ column: 'amount' }, { column: 'count' }], presentation: 'grouped', colorScheme: 'diverging' } };
  const form = mountChartForm(root, { schema: { file: 'sales.csv', columns: ['name', 'amount', 'count'] },
    fetchJson: async () => ({ charts: [definition] }),
    postJson: async (path, body) => { requests.push({ path, body }); return { id: body.id, generated: true }; },
    close: value => closes.push(value), ...overrides });
  const field = id => root.querySelector('#' + id);
  const fire = async (node, type) => { for (const fn of node.listeners.get(type) ?? []) await fn({ type, preventDefault() {} }); };
  return { root, form, requests, closes, field, fire };
}

test('shared chart controls match the normal dialog and submit existing options', async () => {
  const f = fixture({ existingOnly: true });
  await f.form.open();
  assert.equal(f.field('chart-id').value, 'sales');
  assert.equal(f.field('chart-run-on-save').checked, false);
  assert.equal(f.field('chart-value-column-2').value, 'count');
  assert.equal(f.field('new-chart').hidden, true);
  assert.equal(f.field('chart-type').disabled, true);
  await f.fire(f.field('heatmap-chart-form'), 'submit');
  assert.equal(f.requests[0].path, '/api/chart-config/heatmap');
  assert.deepEqual(f.requests[0].body.values, ['amount', 'count']);
  assert.equal(f.requests[0].body.presentation, 'grouped');
  assert.equal(f.requests[0].body.runOnSave, false);
  assert.deepEqual(f.closes, ['saved']);

});

test('shared chart save failures keep the options open and duplicate submits are ignored', async () => {
  let finish, calls = 0;
  const f = fixture({ postJson: () => { calls++; return new Promise((resolve, reject) => { finish = reject; }); } });
  await f.form.open();
  const pending = f.fire(f.field('heatmap-chart-form'), 'submit');
  await f.fire(f.field('heatmap-chart-form'), 'submit');
  assert.equal(calls, 1);
  finish(new Error('Invalid column')); await pending;
  assert.deepEqual(f.closes, []); assert.equal(f.field('chart-error').hidden, false);
  assert.equal(f.field('chart-error').textContent, 'Invalid column');
});

test('closing chart options during save prevents late success and removes listeners', async () => {
  let finish;
  const f = fixture({ postJson: () => new Promise(resolve => { finish = resolve; }) });
  await f.form.open();
  const pending = f.fire(f.field('heatmap-chart-form'), 'submit');
  f.form.dispose(); finish({ id: 'sales' }); await pending;
  assert.deepEqual(f.closes, []);
  assert.equal(f.field('heatmap-chart-form').listeners.get('submit').length, 0);
});


test('Preview follows Cancel and renders only current values on click without saving', async () => {
  const previews = [];
  const f = fixture({ previewChart: async payload => { previews.push(payload); return { svg: '<svg>new title</svg>' }; } });
  await f.form.open();
  const actions = f.field('cancel-chart').parentElement.children;
  assert.equal(actions[actions.indexOf(f.field('cancel-chart')) + 1], f.field('preview-chart'));
  assert.equal(previews.length, 0);
  f.field('chart-title').value = 'Unsaved title';
  await f.fire(f.field('heatmap-chart-form'), 'input');
  assert.equal(previews.length, 0);
  await f.fire(f.field('preview-chart'), 'click');
  assert.equal(previews[0].title, 'Unsaved title');
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.closes, []);
  assert.equal(f.field('chart-preview').hidden, false);
  assert.equal(f.field('chart-preview').children[0].tag, 'img');
  await f.fire(f.field('heatmap-chart-form'), 'change');
  assert.equal(previews.length, 1);
  assert.equal(f.field('chart-preview').hidden, true);
});

test('preview uses the read-only endpoint, rejects duplicates and ignores stale or closed results', async () => {
  for (const action of ['edit', 'close']) {
    let finish;
    const f = fixture({ postJson: async (path, body) => {
      assert.equal(path, '/api/chart-config/preview'); assert.equal(body.id, 'sales');
      return await new Promise(resolve => { finish = resolve; });
    } });
    await f.form.open();
    const pending = f.fire(f.field('preview-chart'), 'click');
    assert.equal(f.field('preview-chart').disabled, true);
    await f.fire(f.field('preview-chart'), 'click');
    if (action === 'edit') await f.fire(f.field('heatmap-chart-form'), 'input');
    else f.form.dispose();
    finish({ svg: '<svg/>' }); await pending;
    assert.equal(f.field('chart-preview').hidden, true);
    assert.deepEqual(f.closes, []);
  }
});

test('preview failures keep the chart form open and allow retry', async () => {
  let calls = 0;
  const f = fixture({ previewChart: async () => { if (++calls === 1) throw new Error('Bad column'); return { markdown: '| data |' }; } });
  await f.form.open();
  await f.fire(f.field('preview-chart'), 'click');
  assert.equal(f.field('chart-error').textContent, 'Bad column');
  assert.equal(f.field('preview-chart').disabled, false);
  await f.fire(f.field('preview-chart'), 'click');
  assert.equal(f.field('chart-preview').children[0].textContent, '| data |');
  assert.equal(f.field('chart-error').hidden, true);
});

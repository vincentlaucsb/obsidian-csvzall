import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import type { FileExports } from "../src/settings/ExportSettingsService.js";
import type { Setting } from "obsidian";
import { addExportActions } from "../src/settings/exportActions.js";

const compiled = buildSync({ entryPoints: ["src/settings/ExportModals.ts"], bundle: true, write: false,
  platform: "node", format: "cjs", external: ["obsidian"] }).outputFiles[0]!.text;

class Element {
  text = "";
  children: Element[] = [];
  rows: Row[] = [];
  setText(text: string) { this.text = text; }
  createEl(_tag: string, options: { text?: string } = {}) {
    const child = new Element(); child.text = options.text ?? ""; this.children.push(child); return child;
  }
  empty() { this.children = []; this.rows = []; }
}
class Button {
  label = "";
  disabled = false;
  warning = false;
  click: () => void | Promise<void> = () => {};
  setButtonText(label: string) { this.label = label; return this; }
  setDestructive() { this.warning = true; return this; }
  setDisabled(disabled: boolean) { this.disabled = disabled; return this; }
  onClick(click: typeof this.click) { this.click = click; return this; }
}
class Row {
  name = "";
  description = "";
  buttons: Button[] = [];
  constructor(parent: Element) { parent.rows.push(this); }
  setName(name: string) { this.name = name; return this; }
  setDesc(description: string) { this.description = description; return this; }
  addButton(setup: (button: Button) => void) { const button = new Button(); this.buttons.push(button); setup(button); return this; }
}

const file: FileExports = { source: "Data/sales.csv", missing: false, entries: [
  { kind: "chart", chart: { source: "Data/sales.csv", configPath: "Project/.csvzall/charts.json",
    definition: { id: "sales", type: "bar", input: "../Data/sales.csv", output: "sales.svg" } } },
  { kind: "table", table: { configPath: "Project/.csvzall/exports.json", runOnSave: true,
    recipe: { version: 1, id: "table", source: "Data/sales.csv", columns: [], sql: "", format: "table" } } },
  { kind: "table", table: { configPath: "Project/.csvzall/exports.json", runOnSave: false,
    recipe: { version: 1, id: "count", source: "Data/sales.csv", columns: [], sql: "SELECT COUNT(*) FROM data", format: "value" } } },
] };

function fixture() {
  const opened: BaseModal[] = [], notices: string[] = [];
  class BaseModal {
    titleEl = new Element();
    contentEl = new Element();
    closed = false;
    constructor(public app: unknown) {}
    open() { opened.push(this); this.onOpen(); }
    close() { this.closed = true; this.onClose(); }
    onOpen() {}
    onClose() {}
  }
  const module = { exports: {} as any };
  runInNewContext(compiled, { module, exports: module.exports, Error, require: () => ({ Modal: BaseModal, Setting: Row,
    Notice: class { constructor(message: string) { notices.push(message); } } }) });
  return { modals: module.exports, opened, notices };
}

test("export action callbacks preserve their receiver", async () => {
  const row = new Row(new Element());
  const actions = {
    calls: [] as string[],
    configure() { this.calls.push("configure"); },
    remove() { this.calls.push("remove"); },
  };
  addExportActions(row as unknown as Setting, actions);
  await row.buttons[0]!.click();
  await row.buttons[1]!.click();
  assert.deepEqual(actions.calls, ["configure", "remove"]);
});

for (const [index, label] of ["chart", "SQL table", "SQL value"].entries()) {
test(`Configure offers ${label} deletion with confirmation and preserves the picker on cancel`, async () => {
  const f = fixture();
  let configured: unknown, deleted: unknown;
  const picker = new f.modals.ChooseExportModal({}, file, (entry: unknown) => { configured = entry; },
    async (entry: unknown) => { deleted = entry; });
  picker.open();
  const rows: Row[] = picker.contentEl.rows;
  assert.equal(picker.titleEl.text, "Export options");
  for (const row of rows) assert.deepEqual(row.buttons.map(button => button.label), ["Configure", "Delete"]);
  assert.equal(rows[index]!.buttons[1]!.warning, true);
  await rows[index]!.buttons[1]!.click();
  const confirmation = f.opened[1]!;
  assert.equal(confirmation.titleEl.text, "Delete export configuration?");
  const entry = file.entries[index]!;
  const id = entry.kind === "chart" ? entry.chart.definition.id : entry.table.recipe.id;
  assert.ok(confirmation.contentEl.children[0]!.text.includes(`"${id}"`));
  assert.match(confirmation.contentEl.children[0]!.text, /Data\/sales.csv.*Project\/\.csvzall\/(?:charts|exports).json/);
  assert.match(confirmation.contentEl.children[0]!.text, /CSV and generated content will be kept/);
  assert.equal(deleted, undefined);
  await confirmation.contentEl.rows[0]!.buttons[0]!.click();
  assert.equal(confirmation.closed, true);
  assert.equal(picker.closed, false);
  assert.equal(deleted, undefined);
  await rows[index]!.buttons[0]!.click();
  assert.equal(configured, file.entries[index]);
  assert.equal(picker.closed, true);
});

test(`confirmed ${label} deletion runs once and closes the picker only after saving`, async () => {
  const f = fixture();
  let finish!: () => void, calls = 0;
  const picker = new f.modals.ChooseExportModal({}, file, () => {}, async (entry: unknown) => {
    assert.equal(entry, file.entries[index]);
    calls++;
    await new Promise<void>(resolve => { finish = resolve; });
  });
  picker.open();
  await picker.contentEl.rows[index].buttons[1].click();
  const confirmation = f.opened[1]!, buttons = confirmation.contentEl.rows[0]!.buttons;
  const pending = buttons[1]!.click();
  assert.equal(buttons[1]!.disabled, true);
  await buttons[1]!.click();
  await buttons[0]!.click();
  assert.equal(calls, 1);
  assert.equal(picker.closed, false);
  assert.equal(confirmation.closed, false);
  finish(); await pending;
  assert.equal(confirmation.closed, true);
  assert.equal(picker.closed, true);
});

test(`failed ${label} deletion keeps the dialog open and permits retry`, async () => {
  const f = fixture();
  let calls = 0;
  const picker = new f.modals.ChooseExportModal({}, file, () => {}, async () => {
    if (++calls === 1) throw new Error("Disk full");
  });
  picker.open();
  await picker.contentEl.rows[index].buttons[1].click();
  const confirmation = f.opened[1]!, button = confirmation.contentEl.rows[0]!.buttons[1]!;
  await button.click();
  assert.deepEqual(f.notices, ["Disk full"]);
  assert.equal(confirmation.closed, false);
  assert.equal(picker.closed, false);
  assert.equal(button.disabled, false);
  await button.click();
  assert.equal(calls, 2);
  assert.equal(confirmation.closed, true);
  assert.equal(picker.closed, true);
});
}

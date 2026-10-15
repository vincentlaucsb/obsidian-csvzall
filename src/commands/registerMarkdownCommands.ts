import { MarkdownView, Notice, TFile, type Editor, type Plugin } from 'obsidian';
import type { MarkdownTableService } from '../markdown/MarkdownTableService.js';

export function registerMarkdownCommands(plugin: Plugin, tables: MarkdownTableService): void {
  const run = (work: Promise<void>) => { void work.catch((error: unknown) => new Notice(error instanceof Error ? error.message : String(error))); };
  plugin.addCommand({
    id: 'insert-table-from-csv', name: 'Insert from CSV',
    editorCallback: (_editor, context) => { if (context instanceof MarkdownView) tables.open(context); },
  });
  const actions: Array<{ id: string; name: string; run: (editor: Editor, view: MarkdownView) => void }> = [
    { id: 'edit-csv-table', name: 'Edit CSV export source or query', run: (editor, view) => tables.open(view, undefined, tables.currentTable(editor)) },
    { id: 'refresh-csv-table', name: 'Refresh CSV export', run: (editor, view) => { if (view.file) run(tables.refresh(view.file, tables.currentTable(editor)?.id)); } },
    { id: 'open-csv-table-source', name: 'Open CSV export source', run: (editor, view) => { const table = tables.currentTable(editor); if (table && view.file) run(tables.openSource(view.file, table)); } },
    { id: 'detach-csv-table', name: 'Stop automatic CSV export updates', run: (editor, view) => { const table = tables.currentTable(editor); if (table && view.file) run(tables.detach(view.file, table)); } },
  ];
  for (const action of actions) {
    plugin.addCommand({ id: action.id, name: action.name, editorCheckCallback: (checking, editor, context) => {
      if (!(context instanceof MarkdownView) || !tables.currentTable(editor)) return false;
      if (!checking) action.run(editor, context);
      return true;
    } });
  }
  plugin.registerEvent(plugin.app.workspace.on('editor-menu', (menu, editor, context) => {
    if (!(context instanceof MarkdownView)) return;
    menu.addItem(item => item.setTitle('Insert from CSV').setIcon('table').onClick(() => tables.open(context)));
    if (tables.currentTable(editor)) for (const action of actions) menu.addItem(item => item.setTitle(action.name).onClick(() => action.run(editor, context)));
  }));
  plugin.registerEvent(plugin.app.workspace.on('file-menu', (menu, file) => {
    if (file instanceof TFile && file.extension.toLowerCase() === 'csv') {
      menu.addItem(item => item.setTitle('Export to Markdown note').setIcon('table').onClick(() => tables.open(null, file)));
    }
  }));
}

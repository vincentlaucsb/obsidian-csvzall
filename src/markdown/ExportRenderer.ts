import { TFile, type App } from 'obsidian';
import type { ObsidianFilesystem } from '../obsidian/filesystem.js';
import type { CsvzallProcessService } from '../process/CsvzallProcessService.js';
import { csvHeader, scalarMarkdown, validateSource } from './managedTables.js';
import { tableQuery, type TableValue } from './table-form.mjs';
import { csvSqlReferences } from './sqlSources.js';

/** Executes queries and converts helper output without owning note or queue state. */
export class ExportRenderer {
  constructor(private readonly app: App, private readonly filesystem: ObsidianFilesystem,
    private readonly processService: CsvzallProcessService, private readonly signal: AbortSignal) {}

  sourceFile(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(validateSource(path));
    if (!(file instanceof TFile)) throw new Error(`CSV source not found: ${path}. The previous table has been kept.`);
    return file;
  }

  async render(value: Pick<TableValue, 'source' | 'columns' | 'sql' | 'format'>, limit?: number, validate?: () => void): Promise<string> {
    if (this.signal.aborted) throw new Error('Plugin unloaded.');
    const source = this.sourceFile(value.source);
    const root = this.filesystem.getVaultRoot();
    if (!root) throw new Error('Export generation requires a local desktop vault.');
    const tableName = csvSqlReferences(value.sql)[0]?.name;
    const markdown = await this.processService.captureCommand([
      'sql', 'query', '--csv', source.path, ...(tableName ? ['--table', tableName] : []), '--format', value.format === 'value' ? 'csv' : 'markdown', '--sql', tableQuery(value, value.format === 'value' ? 2 : limit),
    ], root, validate);
    return value.format === 'value' ? scalarMarkdown(markdown) : markdown.replace(/\r\n?/g, '\n');
  }

  async loadColumns(source: string): Promise<string[]> {
    if (this.signal.aborted) throw new Error('Plugin unloaded.');
    const root = this.filesystem.getVaultRoot();
    if (!root) throw new Error('Export generation requires a local desktop vault.');
    return csvHeader(await this.processService.captureCommand(['sql', 'query', '--csv', this.sourceFile(source).path,
      '--format', 'csv', '--sql', 'SELECT * FROM data LIMIT 0'], root));
  }
}

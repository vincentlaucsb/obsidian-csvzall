import type { DataAdapter } from 'obsidian';
import { validateSource, type TableRecipe } from './managedTables.js';
import type { DeleteReason } from '../exports/revisions.js';
import { ancestorConfigPaths, configPathForFolder, configRoot, directConfig, relativeReference } from '../exports/paths.js';
import { parentVaultPath, resolveVaultRelativePath } from '../utils/paths.js';

export const EXPORT_CONFIG_PATH = configPathForFolder('', 'exports');

interface TableDefinition {
  format?: 'table' | 'value';
  legacyTableId?: string;
  id: string;
  input: string;
  output?: string;
  runOnSave?: boolean;
  options?: { columns?: string[]; sql?: string; [key: string]: unknown };
  [key: string]: unknown;
}
interface TableConfig { exports: TableDefinition[]; [key: string]: unknown }
export interface ResolvedExport {
  configPath: string;
  recipe: TableRecipe;
  runOnSave: boolean;
  output?: string;
}
export interface SavedExport extends ResolvedExport { output?: string }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function sameLegacy(left: TableDefinition, right: TableDefinition): boolean {
  const normalized = (entry: TableDefinition) => ({ ...entry, id: undefined, legacyTableId: undefined,
    format: entry.format ?? 'table', runOnSave: entry.runOnSave !== false,
    options: { ...entry.options, columns: entry.options?.columns ?? [], sql: entry.options?.sql ?? '' } });
  return canonical(normalized(left)) === canonical(normalized(right));
}

function resolvePath(configPath: string, input: string): string {
  if (!input || input.includes(':') || /^[\\/]/.test(input)) throw new Error('Table paths must be relative to the configuration folder.');
  const resolved = resolveVaultRelativePath(configRoot(configPath), input);
  if (resolved === null) throw new Error('Table path leaves the vault.');
  return resolved;
}

export function parseExportDefinitions(text: string, path: string): TableConfig {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || !('exports' in value) || !Array.isArray(value.exports)) throw new Error(`Invalid exports array in ${path}.`);
  const ids = new Set<string>(), legacyIds = new Set<string>();
  for (const item of value.exports as unknown[]) {
    if (!item || typeof item !== 'object') throw new Error(`Invalid table definition in ${path}.`);
    const entry = item as Partial<TableDefinition>;
    if (typeof entry.id !== 'string' || !/^[\w-]+$/.test(entry.id) || ids.has(entry.id) || typeof entry.input !== 'string' ||
      (entry.format !== undefined && entry.format !== 'table' && entry.format !== 'value') ||
      (entry.legacyTableId !== undefined && (typeof entry.legacyTableId !== 'string' || !/^[\w-]+$/.test(entry.legacyTableId))) ||
      (entry.output !== undefined && typeof entry.output !== 'string') ||
      (entry.runOnSave !== undefined && typeof entry.runOnSave !== 'boolean')) throw new Error(`Invalid or duplicate table definition in ${path}.`);
    ids.add(entry.id);
    if (entry.legacyTableId !== undefined) {
      if (legacyIds.has(entry.legacyTableId)) throw new Error(`Invalid or duplicate legacy table binding in ${path}.`);
      legacyIds.add(entry.legacyTableId);
    }
    validateSource(resolvePath(path, entry.input));
    if (entry.output !== undefined && !/\.md$/i.test(resolvePath(path, entry.output))) throw new Error(`Invalid table output in ${path}.`);
    const options = entry.options;
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options) ||
      (options.sql !== undefined && typeof options.sql !== 'string') ||
      (options.columns !== undefined && (!Array.isArray(options.columns) || !options.columns.every((column: unknown) => typeof column === 'string'))))) {
      throw new Error(`Invalid table options in ${path}.`);
    }
  }
  return value as TableConfig;
}
const parseConfig = parseExportDefinitions;

/** Definitions are scoped like charts: paths start at the folder containing .csvzall. */
export class ExportDefinitions {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly adapter: DataAdapter, private readonly stopped: () => boolean,
    private readonly changed?: (path: string, reason?: DeleteReason) => Promise<void>,
    private readonly localOnly = false) {}

  async list(folders: string[]): Promise<SavedExport[]> {
    const result: SavedExport[] = [];
    for (const folder of new Set(['', ...folders])) {
      const path = configPathForFolder(folder, 'exports');
      await this.migrate(path);
      const saved = await this.read(path);
      for (const entry of saved?.config.exports ?? []) result.push({ configPath: path,
        runOnSave: entry.runOnSave !== false, output: entry.output === undefined ? undefined : resolvePath(path, entry.output),
        recipe: { version: 1, id: entry.id, source: validateSource(resolvePath(path, entry.input)),
          columns: entry.options?.columns ?? [], sql: entry.options?.sql ?? '', format: entry.format ?? 'table' } });
    }
    return result;
  }

  async removeSource(source: string, paths: string[]): Promise<void> {
    for (const path of new Set(paths)) await this.mutate(path, config => {
      config.exports = config.exports.filter(entry => resolvePath(path, entry.input) !== source);
    });
  }

  private currentEntry(config: TableConfig, saved: SavedExport): TableDefinition {
    const entry = config.exports.find(candidate => candidate.id === saved.recipe.id);
    if (!entry || validateSource(resolvePath(saved.configPath, entry.input)) !== saved.recipe.source ||
      JSON.stringify(entry.options?.columns ?? []) !== JSON.stringify(saved.recipe.columns) ||
      (entry.options?.sql ?? '') !== saved.recipe.sql || (entry.format ?? 'table') !== (saved.recipe.format ?? 'table') ||
      (entry.runOnSave !== false) !== saved.runOnSave ||
      (entry.output === undefined ? undefined : resolvePath(saved.configPath, entry.output)) !== saved.output) {
      throw new Error('The export changed. Reopen Configure and try again.');
    }
    return entry;
  }

  /** Validate before detaching notes, then check again inside the final mutation. */
  async checkCurrent(saved: SavedExport): Promise<void> {
    const current = await this.read(saved.configPath);
    this.currentEntry(current?.config ?? { exports: [] }, saved);
  }

  removeExport(saved: SavedExport, cancelled: () => boolean = () => false, reason: DeleteReason = 'explicit'): Promise<void> {
    return this.mutate(saved.configPath, config => {
      const entry = this.currentEntry(config, saved);
      config.exports = config.exports.filter(candidate => candidate !== entry);
    }, cancelled, saved.configPath, reason);
  }

  update(saved: SavedExport, recipe: TableRecipe, runOnSave: boolean, cancelled: () => boolean): Promise<void> {
    return this.mutate(saved.configPath, config => {
      const entry = this.currentEntry(config, saved);
      if (entry.csvzallDefaultPreferences !== true && saved.recipe.source === recipe.source && saved.recipe.sql === recipe.sql &&
        JSON.stringify(saved.recipe.columns) === JSON.stringify(recipe.columns) &&
        (saved.recipe.format ?? 'table') === (recipe.format ?? 'table') && saved.runOnSave === runOnSave) return;
      delete entry.csvzallDefaultPreferences;
      entry.input = relativeReference(saved.configPath, recipe.source);
      entry.options = { ...entry.options, columns: recipe.columns, sql: recipe.sql };
      entry.format = recipe.format ?? 'table';
      entry.runOnSave = runOnSave;
    }, cancelled);
  }

  private candidates(note: string): string[] {
    return this.localOnly ? [directConfig(note, 'exports')] : ancestorConfigPaths(note, 'exports');
  }

  private async read(path: string, context = path): Promise<{ text: string; config: TableConfig } | null> {
    if (!await this.adapter.exists(path)) return null;
    const text = await this.adapter.read(path);
    return { text, config: parseConfig(text, context) };
  }

  async find(note: string, id: string, legacy = false): Promise<ResolvedExport | undefined> {
    let fallback: ResolvedExport | undefined;
    for (const configPath of this.candidates(note)) {
      await this.migrate(configPath);
      const saved = await this.read(configPath);
      const mapped = legacy ? saved?.config.exports.find(table => table.legacyTableId === id) : undefined;
      const entry = mapped ?? saved?.config.exports.find(table => table.id === id);
      if (entry) {
        const resolved: ResolvedExport = { configPath, runOnSave: entry.runOnSave !== false, output: entry.output === undefined ? undefined : resolvePath(configPath, entry.output),
          recipe: { version: 1, id: entry.id, format: entry.format ?? 'table', source: validateSource(resolvePath(configPath, entry.input)), columns: entry.options?.columns ?? [], sql: entry.options?.sql ?? '' } };
        if (!legacy || mapped) return resolved;
        // An unrelated new export cannot shadow an ancestor's legacy table.
        if (!fallback && resolved.recipe.format === 'table') fallback = resolved;
      }
    }
    return fallback;
  }

  async resolve(note: string, id: string, legacy = false): Promise<ResolvedExport> {
    const resolved = await this.find(note, id, legacy);
    if (resolved) return resolved;
    throw new Error(`Table ${id} is missing from exports.json. The previous table has been kept.`);
  }

  async snapshot(note: string): Promise<string> {
    const values: Array<string | null> = [];
    for (const path of this.candidates(note)) {
      await this.migrate(path);
      values.push(await this.adapter.exists(path) ? await this.adapter.read(path) : null);
    }
    return JSON.stringify(values);
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const operation = this.writes.catch(() => {}).then(work);
    this.writes = operation;
    return operation;
  }

  /** Stage and verify before replacing an existing configuration. */
  private async commit(path: string, saved: string | null, config: TableConfig, cancelled: () => boolean = () => false, context = path, reason: DeleteReason = 'explicit'): Promise<void> {
    const text = `${JSON.stringify(config, null, 2)}\n`;
    parseConfig(text, context);
    if (text === saved) return;
    if (this.stopped() || cancelled()) throw new Error('Export update cancelled.');
    const folder = parentVaultPath(path);
    if (!await this.adapter.exists(folder)) await this.adapter.mkdir(folder);
    const temporary = `${folder}/.exports-${crypto.randomUUID()}.json`;
    try {
      await this.adapter.write(temporary, text);
      if (await this.adapter.read(temporary) !== text) throw new Error('Could not verify the saved export definition.');
      const current = await this.adapter.exists(path) ? await this.adapter.read(path) : null;
      if (current !== saved) throw new Error(`${path} changed while saving. Please try again.`);
      if (this.stopped() || cancelled()) throw new Error('Export update cancelled.');
      if (saved === null) await this.adapter.rename(temporary, path);
      else {
        // Obsidian's rename rejects existing destinations. Check and replace
        // existing contents atomically so edits made while waiting are kept.
        await this.adapter.process(path, current => {
          if (current !== saved) throw new Error(`${path} changed while saving. Please try again.`);
          if (this.stopped() || cancelled()) throw new Error('Export update cancelled.');
          return text;
        });
      }
      if (await this.adapter.read(path) !== text) throw new Error('Could not verify exports.json.');
      await this.changed?.(path, reason);
    } finally {
      if (await this.adapter.exists(temporary)) await this.adapter.remove(temporary);
    }
  }

  private mutate(path: string, update: (config: TableConfig) => void, cancelled: () => boolean = () => false, previousPath = path, reason: DeleteReason = 'explicit'): Promise<void> {
    return this.enqueue(async () => {
      if (this.stopped() || cancelled()) throw new Error('Export update cancelled.');
      const saved = await this.read(path, previousPath), config = saved?.config ?? { exports: [] };
      update(config);
      await this.commit(path, saved?.text ?? null, config, cancelled, path, reason);
    });
  }

  private legacyPath(path: string): string { return path.replace(/exports\.json$/, 'tables.json'); }

  migrateFolder(folder: string): Promise<void> { return this.migrate(configPathForFolder(folder === '/' ? '' : folder, 'exports')); }

  /** Keep the original tables.json as a backup, after the merged exports file is verified. */
  private async migrate(path: string, context = path): Promise<void> {
    const legacyPath = this.legacyPath(path);
    if (!await this.adapter.exists(legacyPath)) return;
    await this.enqueue(async () => {
      if (!await this.adapter.exists(legacyPath)) return;
      if (this.stopped()) throw new Error('Export update cancelled.');
      const original = await this.adapter.read(legacyPath);
      const raw: unknown = JSON.parse(original);
      if (!raw || typeof raw !== 'object' || !('tables' in raw) || !Array.isArray(raw.tables)) throw new Error(`Invalid tables array in ${legacyPath}.`);
      const { tables, ...metadata } = raw;
      const legacy = parseConfig(JSON.stringify({ ...metadata, exports: tables }), context);
      const saved = await this.read(path, context);
      const config: TableConfig = { ...legacy, ...saved?.config, exports: [...saved?.config.exports ?? []] };
      for (const entry of legacy.exports) {
        const mapped = config.exports.find(candidate => candidate.legacyTableId === entry.id);
        if (mapped && sameLegacy(mapped, entry)) continue;
        // A previous commit may have succeeded before the legacy file changed.
        // Keep that export for existing canonical markers, but bind old markers
        // to a separate definition containing the latest legacy instructions.
        if (mapped) delete mapped.legacyTableId;
        const current = config.exports.find(candidate => candidate.id === entry.id);
        const same = current && sameLegacy(current, entry);
        if (same && current && current.legacyTableId === undefined) {
          Object.assign(current, { ...entry, ...current, options: { ...entry.options, ...current.options }, legacyTableId: entry.id });
          continue;
        }
        config.exports.push({ ...entry, format: 'table', legacyTableId: entry.id, ...(current ? { id: crypto.randomUUID() } : {}) });
      }
      await this.commit(path, saved?.text ?? null, config, undefined, context);
      if (await this.adapter.read(legacyPath) !== original) throw new Error(`${legacyPath} changed during migration. Please try again.`);
      if (this.stopped()) throw new Error('Export update cancelled.');
      const backup = await this.adapter.exists(`${legacyPath}.bak`) ? `${legacyPath}.${crypto.randomUUID()}.bak` : `${legacyPath}.bak`;
      await this.adapter.rename(legacyPath, backup);
    });
  }

  async scope(note: string): Promise<string> {
    let configPath = this.localOnly ? this.candidates(note)[0]! : EXPORT_CONFIG_PATH;
    for (const candidate of this.candidates(note)) if (await this.adapter.exists(candidate) || await this.adapter.exists(this.legacyPath(candidate))) { configPath = candidate; break; }
    return configPath;
  }

  async save(note: string, recipe: TableRecipe, cancelled?: () => boolean, runOnSave = true, bootstrap = false, inherit?: ResolvedExport): Promise<TableRecipe> {
    const configPath = await this.scope(note);
    await this.migrate(configPath);
    const inherited = inherit && inherit.configPath !== configPath ? (await this.read(inherit.configPath))?.config.exports.find(entry => entry.id === inherit.recipe.id) : undefined;
    let result = recipe;
    await this.mutate(configPath, config => {
      const matching = config.exports.find(entry => entry.id === recipe.id);
      if (matching) {
        const same = (entry: TableDefinition) => validateSource(resolvePath(configPath, entry.input)) === recipe.source &&
          JSON.stringify(entry.options?.columns ?? []) === JSON.stringify(recipe.columns) && (entry.options?.sql ?? '') === recipe.sql && (entry.format ?? 'table') === (recipe.format ?? 'table') && (entry.runOnSave !== false) === runOnSave;
        if (same(matching)) return;
        const previous = config.exports.find(entry => same(entry) && entry.output !== undefined && resolvePath(configPath, entry.output) === note);
        if (previous) { result = { ...recipe, id: previous.id }; return; }
        result = { ...recipe, id: crypto.randomUUID() };
      }
      const template = inherited ?? (inherit ? config.exports.find(entry => entry.id === inherit.recipe.id) : undefined);
      const entry: TableDefinition = { ...template, id: result.id, format: result.format ?? 'table', input: relativeReference(configPath, result.source), output: relativeReference(configPath, note),
        runOnSave, options: { ...template?.options, columns: result.columns, sql: result.sql } };
      delete entry.csvzallDefaultPreferences;
      if (bootstrap && (!template || template.csvzallDefaultPreferences === true) && runOnSave) entry.csvzallDefaultPreferences = true;
      config.exports.push(entry);
    }, cancelled);
    return result;
  }

  async rename(notes: string[], oldPath: string, newPath: string): Promise<void> {
    const paths = new Set(notes.flatMap(note => this.candidates(note)));
    for (const path of paths) {
      const previousConfig = path.startsWith(`${newPath}/`) ? oldPath + path.slice(newPath.length) : path;
      await this.migrate(path, previousConfig);
      if (!await this.adapter.exists(path)) continue;
      await this.mutate(path, config => {
        for (const entry of config.exports) for (const key of ['input', 'output'] as const) {
          if (entry[key] === undefined) continue;
          // A config moved with its enclosing folder still contains paths relative
          // to its former location, including references outside that folder.
          const resolved = resolvePath(previousConfig, entry[key]);
          const renamed = resolved === oldPath || resolved.startsWith(`${oldPath}/`) ? newPath + resolved.slice(oldPath.length) : resolved;
          entry[key] = relativeReference(path, renamed);
        }
      }, undefined, previousConfig);
    }
  }
}

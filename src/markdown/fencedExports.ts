import type { ManagedTable, TableRecipe } from './managedTables.js';
import type { ExportDefinitions, ResolvedExport } from './ExportDefinitions.js';
import type { ExportReflection } from '../exports/ExportReflection.js';
import { exportSql, fencedRecipe } from './fencedTables.js';
import { nameSqlSource, relativeCsvSource } from './sqlSources.js';

export function canonicalFenceRecipe(note: string, recipe: TableRecipe): TableRecipe {
  return fencedRecipe(note, nameSqlSource(exportSql(recipe), relativeCsvSource(note, recipe.source)));
}

/** Queries, rather than block occurrences, own saved preferences in each scope. */
export async function resolveFencedExport(note: string, recipe: TableRecipe, definitions: ExportDefinitions,
  reflection?: ExportReflection, options: { autoUpdate?: boolean; explicit?: boolean; inherit?: ResolvedExport; cancelled?: () => boolean } = {}): Promise<ResolvedExport> {
  const { autoUpdate, explicit = false, inherit, cancelled = () => false } = options;
  const configPath = await definitions.scope(note);
  reflection?.assertReady(configPath);
  const check = () => { reflection?.assertReady(configPath); reflection?.assertSqlBinding(note, recipe.id, configPath); };
  if (!explicit) {
    try { check(); }
    catch (error) { if (!await reflection?.recoverSql(note, recipe.id)) throw error; check(); }
  }
  const current = await definitions.find(note, recipe.id);
  if (current && canonicalFenceRecipe(note, current.recipe).id !== recipe.id) throw new Error('The saved SQL export does not match this query. The previous table has been kept.');
  if (!current) await definitions.save(note, recipe, cancelled, autoUpdate ?? true, !explicit, inherit);
  else if (explicit && autoUpdate !== undefined) await definitions.update(current, recipe, autoUpdate, cancelled);
  return definitions.resolve(note, recipe.id);
}

export function fenceRecipe(note: string, table: ManagedTable): TableRecipe {
  if (!table.fence) throw new Error('Expected a SQL code block.');
  const sql = table.fence.legacy ? nameSqlSource(table.fence.sql, table.fence.legacy.source) : table.fence.sql;
  return fencedRecipe(note, sql);
}

export function exportDefinitionId(note: string, table: ManagedTable): string {
  return table.fence ? fenceRecipe(note, table).id : table.id;
}

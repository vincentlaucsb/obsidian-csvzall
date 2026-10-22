import { managedTableText, type ManagedTable, type TableRecipe } from './managedTables.js';
import { fencedTableText, matchingTableHeaders } from './fencedTables.js';

export function exportRegionText(table: ManagedTable, recipe: TableRecipe, markdown: string, note: string, syntax: 'comment' | 'code' = table.fence ? 'code' : 'comment'): string {
  const text = syntax === 'code' && recipe.format !== 'value' ? fencedTableText(note, recipe, markdown) : managedTableText(recipe, markdown);
  const previous = table.fence && recipe.format !== 'value' && table.body && !matchingTableHeaders(table.body, markdown) ? `\n\n${table.body}` : '';
  if (table.fence || syntax === 'code') return text + previous;
  // Converting an inline value to a table needs paragraph boundaries.
  return recipe.format !== 'value' && !/^<!-- csvzall:(?:table|export) \S+ -->\r?\n/.test(table.text) ? `\n\n${text}\n\n` : text;
}

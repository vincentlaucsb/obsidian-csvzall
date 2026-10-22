import { normalizeVaultPath } from "../utils/paths.js";
import { configPathForFolder } from "../exports/paths.js";

type ConfigAdapter = { exists(path: string): Promise<boolean> };

/** Check hidden configuration folders beside indexed vault folders without
 * traversing every directory on disk on each refresh. */
export async function findChartConfigPaths(adapter: ConfigAdapter, folders: Iterable<string>): Promise<string[]> {
  const configs: string[] = [];
  for (const folder of new Set(["", ...Array.from(folders, folder => normalizeVaultPath(folder))])) {
    const configPath = configPathForFolder(folder, "charts");
    if (await adapter.exists(configPath)) configs.push(configPath);
  }
  return configs.sort((left, right) => left.localeCompare(right));
}

import { object } from "../exports/revisions.js";

export interface SyncStatus { state: "active" | "inactive" | "unknown"; pluginData?: boolean; otherTypes?: boolean; idle?: boolean; excludedFolders: string[] }
function registry(value: unknown): value is { getPluginById(id: string): unknown } { return object(value) && typeof value.getPluginById === "function"; }
function set(value: unknown): value is { has(key: string): unknown } { return object(value) && typeof value.has === "function"; }
function status(value: unknown): value is { getStatus(): unknown } { return object(value) && typeof value.getStatus === "function"; }
function boolean(value: unknown): boolean | undefined { return typeof value === "boolean" ? value : undefined; }

/** Optional private inspection; never access credentials or modify Sync. */
export function syncStatus(app: unknown): SyncStatus {
  const unknown: SyncStatus = { state: "unknown", excludedFolders: [] };
  try {
    if (!object(app) || !registry(app.internalPlugins)) return unknown;
    const plugin = app.internalPlugins.getPluginById("sync");
    if (!object(plugin)) return unknown;
    if (plugin.enabled === false) return { state: "inactive", excludedFolders: [] };
    if (plugin.enabled !== true || !object(plugin.instance) || !object(plugin.instance.filter)) return unknown;
    const filter = plugin.instance.filter;
    return { state: "active", pluginData: set(filter.allowSpecialFiles) ? boolean(filter.allowSpecialFiles.has("community-plugin-data")) : undefined,
      otherTypes: set(filter.allowTypes) ? boolean(filter.allowTypes.has("unsupported")) : undefined,
      idle: status(plugin.instance) ? plugin.instance.getStatus() === "synced" : undefined,
      excludedFolders: Array.isArray(filter.ignoreFolders) ? filter.ignoreFolders.filter((path): path is string => typeof path === "string") : [] };
  } catch { return unknown; }
}

export function syncDescription(value: SyncStatus): string {
  if (value.state === "inactive") return "Obsidian Sync is disabled. Export configurations are reflected locally; another sync service must include plugin data and CSV/TSV sources.";
  if (value.state === "unknown") return "Could not inspect Obsidian Sync. Check Installed community plugins for export configurations, and Sync all other types for CSV/TSV sources, under Settings → Sync on each device.";
  const plugin = value.pluginData === true ? "Export configuration syncing is enabled." : value.pluginData === false ? "Warning: export configuration syncing is disabled. Enable Installed community plugins under Settings → Sync → Vault configuration sync." : "Could not determine export configuration syncing.";
  const sources = value.otherTypes === true ? "CSV/TSV file syncing is enabled." : value.otherTypes === false ? "Warning: CSV/TSV syncing is disabled. Enable Sync all other types under Selective sync." : "Could not determine CSV/TSV file syncing.";
  return `${plugin} ${sources}${value.excludedFolders.length ? ` Excluded folders may hide sources or outputs: ${value.excludedFolders.join(", ")}.` : ""}`;
}

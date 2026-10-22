import { createHash } from "crypto";
import { parseChartDefinitions } from "../charts/ChartDefinitions.js";
import { parseExportDefinitions } from "../markdown/ExportDefinitions.js";
import { configRoot } from "./paths.js";
import { isCanonicalVaultPath, resolveVaultRelativePath } from "../utils/paths.js";

export const REVISION_PREFIX = "csvzallExportRevision:";
export const SYNC_SCHEMA = 2;
export type JsonObject = Record<string, unknown>;
export type DeleteReason = "explicit" | "entry-removed" | "stale-sql" | "relocated";
export interface ExportIdentity { path: string; id: string }
export interface Revision {
  version: 1;
  path: string;
  id: string;
  clockMs: number;
  counter: number;
  origin: string;
  value: JsonObject | null;
  reason?: DeleteReason;
  relocatedFrom?: ExportIdentity;
  relocatedTo?: ExportIdentity[];
  relocationValue?: JsonObject;
}

export function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function configPath(path: string): boolean {
  return isCanonicalVaultPath(path) &&
    /^(?:.*\/)?\.csvzall\/(?:charts|exports)\.json$/.test(path);
}

export function identity(value: Pick<Revision, "path" | "id">): string { return JSON.stringify([value.path, value.id]); }
export function revisionKey(value: Revision): string { return REVISION_PREFIX + digest(value); }

export function readRevisions(data: JsonObject): Map<string, Revision> {
  const result = new Map<string, Revision>();
  if (data.csvzallExportSync !== undefined && (!object(data.csvzallExportSync) || typeof data.csvzallExportSync.version !== "number" || ![1, SYNC_SCHEMA].includes(data.csvzallExportSync.version))) {
    throw new Error("Unsupported export Sync schema. Update the plugin before editing exports.");
  }
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith(REVISION_PREFIX)) continue;
    if (!object(value) || value.version !== 1 || typeof value.path !== "string" || !configPath(value.path) ||
      typeof value.id !== "string" || typeof value.origin !== "string" || !value.origin ||
      !Number.isSafeInteger(value.clockMs) || Number(value.clockMs) < 0 || !Number.isSafeInteger(value.counter) || Number(value.counter) < 0 ||
      !(value.value === null || object(value.value)) ||
      (value.reason !== undefined && !["explicit", "entry-removed", "stale-sql", "relocated"].includes(String(value.reason)))) {
      throw new Error("Invalid reflected export revision. The previous configurations have been kept.");
    }
    const revision = value as unknown as Revision;
    const validIdentity = (item: unknown): item is ExportIdentity => object(item) && typeof item.path === "string" && configPath(item.path) && typeof item.id === "string" && item.id.startsWith("entry:");
    if ((revision.relocatedFrom !== undefined && !validIdentity(revision.relocatedFrom)) ||
        (revision.relocatedTo !== undefined && (!Array.isArray(revision.relocatedTo) || !revision.relocatedTo.every(validIdentity))) ||
        (revision.relocationValue !== undefined && !object(revision.relocationValue))) throw new Error("Invalid export relocation history.");
    if (revision.id !== "document" && !revision.id.startsWith("entry:")) throw new Error("Invalid export identity.");
    if (revision.value && revision.id.startsWith("entry:") && revision.value.id !== revision.id.slice(6)) throw new Error("Export identity does not match its definition.");
    if (key !== revisionKey(revision)) throw new Error("Export revision checksum does not match its content.");
    result.set(key, revision);
  }
  return result;
}

export function compare(left: Revision, right: Revision): number {
  return left.clockMs - right.clockMs || left.counter - right.counter ||
    (left.origin < right.origin ? -1 : left.origin > right.origin ? 1 : 0) ||
    (revisionKey(left) < revisionKey(right) ? -1 : revisionKey(left) > revisionKey(right) ? 1 : 0);
}

export function winners(revisions: Iterable<Revision>): Map<string, Revision> {
  const result = new Map<string, Revision>();
  for (const revision of revisions) {
    const key = identity(revision), previous = result.get(key);
    if (!previous || compare(revision, previous) > 0) result.set(key, revision);
  }
  return result;
}

/** Metadata is a separate entity; actual IDs have an entry: prefix. */
export function parseDocument(text: string, path: string): Map<string, JsonObject> {
  if (!configPath(path)) throw new Error("Export configuration path leaves the vault.");
  if (path.endsWith("charts.json")) parseChartDefinitions(text, path);
  else parseExportDefinitions(text, path);
  const document: unknown = JSON.parse(text);
  const field = path.endsWith("charts.json") ? "charts" : "exports";
  if (!object(document) || !Array.isArray(document[field])) throw new Error(`Invalid ${field} array in ${path}.`);
  const entries = new Map<string, JsonObject>();
  const order: string[] = [];
  for (const entry of document[field] as unknown[]) {
    if (!object(entry) || typeof entry.id !== "string" || !entry.id || typeof entry.input !== "string" ||
      (field === "charts" && typeof entry.type !== "string") || entries.has(`entry:${entry.id}`)) {
      throw new Error(`Invalid or duplicate export in ${path}.`);
    }
    // Preserve arbitrary options, but never materialize references outside this vault.
    for (const name of ["input", "output"]) {
      const reference = entry[name];
      if (reference === undefined) continue;
      if (typeof reference !== "string" || reference.includes(":") || /^[\\/]/.test(reference)) throw new Error(`Invalid ${name} path in ${path}.`);
      if (resolveVaultRelativePath(configRoot(path), reference) === null) throw new Error(`Export path leaves the vault: ${path}.`);
    }
    entries.set(`entry:${entry.id}`, entry);
    order.push(entry.id);
  }
  const metadata = { ...document };
  delete metadata[field];
  entries.set("document", { metadata, order });
  return entries;
}

export function documentText(path: string, records: Iterable<Revision>): string {
  const live = [...records].filter(record => record.path === path && record.value !== null);
  const metadata = live.find(record => record.id === "document")?.value;
  const entries = new Map(live.filter(record => record.id.startsWith("entry:")).map(record => [record.id.slice(6), record.value]));
  const order: string[] = Array.isArray(metadata?.order) ? metadata.order.filter((id): id is string => typeof id === "string") : [];
  const ids = [...new Set([...order.filter(id => entries.has(id)), ...[...entries.keys()].sort()])];
  const field = path.endsWith("charts.json") ? "charts" : "exports";
  const result = { ...(object(metadata?.metadata) ? metadata.metadata : {}), [field]: ids.map(id => entries.get(id)) };
  const text = JSON.stringify(result, null, 2) + "\n";
  parseDocument(text, path);
  return text;
}

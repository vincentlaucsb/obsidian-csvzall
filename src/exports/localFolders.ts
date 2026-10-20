import { canonical, compare, digest, identity, revisionKey, winners, type ExportIdentity, type JsonObject, type Revision } from "./revisions.js";

export interface ExportReference { note: string; id: string; legacy: boolean }
export interface ReferenceScan { references: ExportReference[]; complete: boolean }
const lexical = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
export function directConfig(file: string, kind: "charts" | "exports"): string {
  const parent = file.split("/").slice(0, -1).join("/");
  return `${parent ? parent + "/" : ""}.csvzall/${kind}.json`;
}
export function absoluteReference(config: string, reference: string): string {
  const parts = config.split("/").slice(0, -2);
  if (!reference || reference.includes(":") || /^[\\/]/.test(reference)) throw new Error(`Invalid export path in ${config}.`);
  for (const part of reference.replace(/\\/g, "/").split("/")) {
    if (part === "..") { if (!parts.length) throw new Error("Export path leaves the vault."); parts.pop(); }
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}
function relative(config: string, absolute: string): string {
  const root = config.split("/").slice(0, -2), parts = absolute.split("/");
  while (root.length && parts.length && root[0] === parts[0]) { root.shift(); parts.shift(); }
  return [...root.map(() => ".."), ...parts].join("/");
}
export function rebase(value: JsonObject, from: string, to: string): JsonObject {
  const result = { ...value };
  for (const field of ["input", "output"]) if (typeof value[field] === "string") result[field] = relative(to, absoluteReference(from, value[field]));
  return result;
}
export function historicalValue(record: Revision, history: Revision[]): Revision | undefined {
  if (record.reason === "relocated" && record.relocationValue) return { ...record, value: record.relocationValue };
  return record.value ? record : history.filter(item => identity(item) === identity(record) && item.value).sort((a, b) => compare(b, a))[0];
}
function descends(record: Revision, source: Revision, history: Revision[]): boolean {
  const queue = [identity(record)], seen = new Set<string>();
  while (queue.length) {
    const key = queue.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const candidate of history) if (identity(candidate) === key && candidate.relocatedFrom) {
      if (identity(candidate.relocatedFrom) === identity(source)) return true;
      queue.push(identity(candidate.relocatedFrom));
    }
  }
  return false;
}

/** Ancestor resolution exists only to import old bindings, never at execution. */
export function inheritedReference(reference: ExportReference, reduced: Map<string, Revision>, history: Revision[]): Revision | undefined {
  const parts = reference.note.split("/").slice(0, -1);
  let fallback: Revision | undefined;
  while (true) {
    const path = `${parts.length ? parts.join("/") + "/" : ""}.csvzall/exports.json`;
    const exact = reduced.get(identity({ path, id: `entry:${reference.id}` }));
    const candidates = [...reduced.values()].filter(item => item.path === path && item.id.startsWith("entry:") && (item.value || item.reason === "relocated"));
    const mapped = reference.legacy ? candidates.map(item => historicalValue(item, history)).find(item => item?.value?.legacyTableId === reference.id) : undefined;
    if (!mapped && exact && !exact.value && exact.reason !== "relocated") return fallback;
    const match = mapped ?? (exact ? historicalValue(exact, history) : undefined);
    if (match) {
      const placeholder = reduced.get(identity(match));
      if (placeholder?.reason === "relocated" && !placeholder.value) {
        const moved = [...reduced.values()].filter(record => record.value && descends(record, placeholder, history) &&
          typeof record.value.output === "string" && absoluteReference(record.path, record.value.output) === reference.note &&
          (reference.legacy ? record.value.legacyTableId === reference.id : record.id === `entry:${reference.id}`)).sort((a, b) => compare(b, a))[0];
        if (moved) return moved;
      }
      if (!reference.legacy || mapped) return match;
      fallback ??= match;
    }
    if (!parts.length) return fallback;
    parts.pop();
  }
}

/** Append deterministic relocation records without changing semantic edit time. */
export function localizeRecords(records: Map<string, Revision>, references: ExportReference[], sqlComplete = true): void {
  const history = [...records.values()], frozen = winners(history);
  const owners = new Map<string, Map<string, string>>();
  const preferred = new Map<string, string>();
  const legacyPreferred = new Map<string, string>();
  for (const reference of references) {
    const source = inheritedReference(reference, frozen, history);
    if (!source) continue;
    const targets = owners.get(identity(source)) ?? new Map<string, string>();
    const path = directConfig(reference.note, "exports");
    const previous = targets.get(path);
    if (!previous || reference.note < previous) targets.set(path, reference.note);
    owners.set(identity(source), targets);
    preferred.set(identity({ path, id: source.id }), identity(source));
    if (reference.legacy) legacyPreferred.set(identity({ path, id: reference.id }), identity(source));
  }
  const sources = [...frozen.values()].filter(record => record.id.startsWith("entry:") && (record.value || record.reason === "relocated"))
    .sort((a, b) => lexical(a.path, b.path) || lexical(a.id, b.id));
  // Notes may arrive after their configs. Reserve legacy aliases using the same
  // nearest-scope precedence as the original lookup, before publishing any copy.
  const aliasClaims = new Map<string, { source: string; depth: number }>();
  for (const source of sources) {
    if (!source.path.endsWith("exports.json")) continue;
    const original = historicalValue(source, history);
    const alias = original?.value?.legacyTableId;
    if (!original?.value || typeof alias !== "string") continue;
    const targets = new Set(owners.get(identity(source))?.keys());
    if (typeof original.value.output === "string") targets.add(directConfig(absoluteReference(source.path, original.value.output), "exports"));
    if (!targets.size) targets.add(directConfig(absoluteReference(source.path, String(original.value.input)), "exports"));
    const scope = source.path.split("/").slice(0, -2).join("/");
    for (const path of targets) {
      const key = identity({ path, id: alias });
      if (legacyPreferred.has(key)) continue;
      const target = path.split("/").slice(0, -2).join("/");
      const depth = !scope ? 0 : target === scope || target.startsWith(`${scope}/`) ? scope.split("/").length : -1;
      const previous = aliasClaims.get(key), sourceKey = identity(source);
      if (!previous || depth > previous.depth || (depth === previous.depth && lexical(sourceKey, previous.source) < 0)) aliasClaims.set(key, { source: sourceKey, depth });
    }
  }
  for (const [key, claim] of aliasClaims) legacyPreferred.set(key, claim.source);
  const current = new Map(frozen);
  const add = (record: Revision) => {
    const key = revisionKey(record);
    records.set(key, record);
    const previous = current.get(identity(record));
    if (!previous || compare(record, previous) > 0) current.set(identity(record), record);
  };
  for (const source of sources) {
    const original = historicalValue(source, history);
    if (!original?.value) continue;
    const kind = source.path.endsWith("charts.json") ? "charts" : "exports";
    if (kind === "exports" && !sqlComplete) continue;
    // Chart owners are determined by the CSV, so live descendants handle moves;
    // historical charts cannot acquire a new note owner as SQL exports can.
    if (kind === "charts" && !source.value) continue;
    const targets = new Map(owners.get(identity(source)));
    if (kind === "charts") targets.set(directConfig(absoluteReference(source.path, String(original.value.input)), kind), "");
    else if (typeof original.value.output === "string") {
      const note = absoluteReference(source.path, original.value.output);
      targets.set(directConfig(note, kind), targets.get(directConfig(note, kind)) ?? note);
    }
    if (!targets.size) targets.set(directConfig(absoluteReference(source.path, String(original.value.input)), kind), "");
    const destinations: ExportIdentity[] = [...source.relocatedTo ?? []];
    for (const [path, note] of targets) {
      if (path === source.path) {
        if (!source.value && owners.get(identity(source))?.has(path)) {
          const value = { ...original.value, output: relative(path, note) };
          const restored: Revision = { ...original, value, counter: Math.max(original.counter, source.counter) + 1 };
          delete restored.reason; delete restored.relocatedTo; delete restored.relocationValue;
          add(restored);
        }
        continue;
      }
      if (!source.value && [...frozen.values()].some(record => record.value && descends(record, source, history) &&
          typeof record.value.output === "string" && directConfig(absoluteReference(record.path, record.value.output), "exports") === path)) continue;
      let id = source.id;
      const origin = kind === "charts" ? source.relocatedFrom ?? history.find(item => identity(item) === identity(source) && item.relocatedFrom)?.relocatedFrom ?? source : source;
      const belongs = (candidate: ExportIdentity) => [...records.values()].some(item => identity(item) === identity(candidate) && item.relocatedFrom && identity(item.relocatedFrom) === identity(origin));
      const occupied = current.get(identity({ path, id }));
      const reserved = preferred.get(identity({ path, id }));
      const returning = occupied?.reason === "relocated" && !occupied.value && descends(source, occupied, history);
      if ((reserved && reserved !== identity(source)) || (occupied && !belongs({ path, id }) && !returning)) id = `${source.id}-${digest(identity(source)).slice(0, 16)}`;
      const target = { path, id };
      const collision = current.get(identity(target));
      if (collision && !belongs(target) && id !== source.id) throw new Error(`Export ID collision while localizing ${source.path}. Originals have been kept.`);
      if (!destinations.some(item => identity(item) === identity(target))) destinations.push(target);
      // A historical relocation supplies only previously unseen late owners.
      // Never restore a deliberate destination deletion or overwrite its edits.
      if (!source.value && collision) continue;
      const value = rebase(original.value, source.path, path);
      value.id = id.slice(6);
      if (id !== source.id && reserved && reserved !== identity(source)) delete value.legacyTableId;
      if (typeof value.legacyTableId === "string") {
        const owner = legacyPreferred.get(identity({ path, id: value.legacyTableId }));
        if (owner && owner !== identity(source)) delete value.legacyTableId;
      }
      if (kind === "exports" && note && (typeof value.output !== "string" || directConfig(absoluteReference(path, value.output), kind) !== path)) value.output = relative(path, note);
      const moved: Revision = { ...original, path, id, value, relocatedFrom: { path: origin.path, id: origin.id } };
      if (returning && collision?.clockMs === moved.clockMs) moved.counter = Math.max(moved.counter, collision.counter + 1);
      delete moved.relocatedTo; delete moved.reason;
      delete moved.relocationValue;
      if (!collision || (compare(moved, collision) > 0 && canonical(collision.value) !== canonical(value))) add(moved);
      const sourceDocument = frozen.get(identity({ path: source.path, id: "document" }));
      const document = current.get(identity({ path, id: "document" }));
      const sourceMeta = sourceDocument?.value?.metadata;
      const targetMeta = document?.value?.metadata;
      const metadata = { ...(sourceMeta && typeof sourceMeta === "object" ? sourceMeta : {}), ...(targetMeta && typeof targetMeta === "object" ? targetMeta : {}) };
      const order: string[] = Array.isArray(document?.value?.order) ? document.value.order.filter((item: unknown): item is string => typeof item === "string") : [];
      const payload = { metadata, order: [...new Set([...order, id.slice(6)])] };
      if (canonical(document?.value) !== canonical(payload)) add({ ...original, path, id: "document", value: payload,
        clockMs: Math.max(original.clockMs, document?.clockMs ?? 0), counter: Math.max(original.counter, document?.counter ?? 0) + 1 });
    }
    if (targets.has(source.path) || !destinations.length) continue;
    destinations.sort((a, b) => lexical(identity(a), identity(b)));
    if (source.reason === "relocated" && canonical(source.relocatedTo) === canonical(destinations)) continue;
    add({ ...original, value: null, reason: "relocated", relocatedTo: destinations, counter: Math.max(original.counter, source.counter) + 1 });
  }
}

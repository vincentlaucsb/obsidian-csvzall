import type { DataAdapter } from "obsidian";
import type { PluginDataStore } from "../settings/PluginDataStore.js";
import {
  canonical, compare, configPath, documentText, identity, object, parseDocument, readRevisions,
  revisionKey, winners, SYNC_SCHEMA, type DeleteReason, type JsonObject, type Revision,
} from "./revisions.js";
import { historicalValue, localizeRecords, type ExportReference, type ReferenceScan } from "./localFolders.js";
import { absoluteReference, ancestorConfigPaths, configPathForFolder, configRoot, directConfig, relativeReference } from "./paths.js";
import { parentVaultPath } from "../utils/paths.js";
import { ExportDefinitions } from "../markdown/ExportDefinitions.js";

interface Baseline { text: string; mtime: number; scope?: string }
interface Journal { version: 1; origin: string; records: JsonObject; files: Record<string, Baseline>; backups: Record<string, string>; renames: Array<{ from: string; to: string }> }
export interface ReflectionOptions {
  adapter: DataAdapter;
  store: PluginDataStore;
  localDirectory: string;
  folders(): string[];
  report(error: unknown): void;
  changed(): void;
  now?: () => number;
  directFolders?: boolean;
  references?(): Promise<ExportReference[] | ReferenceScan>;
}

/** Owns reflection only; CLI JSON stays the local execution format. */
export class ExportReflection {
  private readonly state: Journal = { version: 1, origin: crypto.randomUUID(), records: {}, files: {}, backups: {}, renames: [] };
  private readonly edits = new Map<string, DeleteReason>();
  private readonly blocked = new Set<string>();
  private running: Promise<void> | null = null;
  private scopedRun = false;
  private stopped = false;
  private initialized = false;
  private localizationPending = false;

  constructor(private readonly options: ReflectionOptions) {}
  stop(): void { this.stopped = true; }
  get pending(): boolean { return this.running !== null || this.blocked.size > 0 || this.state.renames.length > 0 || this.localizationPending; }
  get usesDirectFolders(): boolean { return this.options.directFolders === true; }

  async initialize(): Promise<void> {
    const path = `${this.options.localDirectory}/state.json`;
    if (await this.options.adapter.exists(path)) {
      const saved: unknown = JSON.parse(await this.options.adapter.read(path));
      if (!object(saved) || saved.version !== 1 || typeof saved.origin !== "string" || !object(saved.records) || !object(saved.files) || !object(saved.backups)) {
        throw new Error("Invalid local export Sync journal. The existing journal has been kept.");
      }
      readRevisions(saved.records);
      if (saved.renames !== undefined && (!Array.isArray(saved.renames) || saved.renames.some((move: unknown) => !object(move) || typeof move.from !== "string" || typeof move.to !== "string"))) throw new Error("Invalid pending export moves.");
      for (const [path, baseline] of Object.entries(saved.files)) {
        if (!configPath(path) || !object(baseline) || typeof baseline.text !== "string" || typeof baseline.mtime !== "number") throw new Error("Invalid local export baseline.");
        if (baseline.scope !== undefined && (typeof baseline.scope !== "string" || !configPath(baseline.scope))) throw new Error("Invalid moved export baseline.");
        parseDocument(baseline.text, baseline.scope ?? path);
      }
      Object.assign(this.state, saved);
    }
    this.initialized = true;
    await this.reconcile();
  }

  /** Called after a verified plugin mutation, before its next consumer runs. */
  async edited(path: string, reason: DeleteReason = "explicit"): Promise<void> {
    this.edits.set(path, reason);
    if (this.running) await this.running;
    await this.reconcile();
  }

  reconcile(): Promise<void> {
    if (this.stopped || !this.initialized) return Promise.resolve();
    // A global poll arriving during viewer preparation still needs to inspect SQL
    // and other folders after the scoped work completes.
    if (this.running) return this.scopedRun ? this.running.then(() => this.reconcile()) : this.running;
    return this.startRun();
  }

  private startRun(paths?: Set<string>): Promise<void> {
    this.scopedRun = paths !== undefined;
    this.running = this.run(paths).finally(() => { this.running = null; this.scopedRun = false; });
    return this.running;
  }

  private async waitForIdle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async reconcileCharts(source: string): Promise<void> {
    if (this.running) await this.waitForIdle();
    if (this.stopped || !this.initialized) return;
    // Pending moves must finish in their original scopes before a viewer opens.
    if (this.state.renames.length) await this.reconcile();
    if (this.running) await this.waitForIdle();
    if (this.stopped) return;
    const paths = new Set(ancestorConfigPaths(source, "charts"));
    await this.startRun(paths);
  }

  private async journal(): Promise<void> {
    if (this.stopped) throw new Error("Export reflection stopped.");
    const { adapter, localDirectory } = this.options;
    if (!await adapter.exists(localDirectory)) await adapter.mkdir(localDirectory);
    const text = JSON.stringify(this.state) + "\n";
    if (await adapter.exists(`${localDirectory}/state.json`) && await adapter.read(`${localDirectory}/state.json`) === text) return;
    const temporary = `${localDirectory}/state-${crypto.randomUUID()}.json`;
    try {
      await adapter.write(temporary, text);
      if (await adapter.read(temporary) !== text) throw new Error("Could not verify export Sync journal.");
      if (this.stopped) return;
      const path = `${localDirectory}/state.json`;
      if (await adapter.exists(path)) await adapter.process(path, () => text);
      else await adapter.rename(temporary, path);
      if (await adapter.read(path) !== text) throw new Error("Could not persist export Sync journal.");
    } finally { if (await adapter.exists(temporary)) await adapter.remove(temporary); }
  }

  private revision(path: string, id: string, value: JsonObject | null, time: number, pluginEdit: boolean, reason?: DeleteReason): Revision {
    const revisions = [...readRevisions(this.state.records).values()];
    const scoped = revisions.filter(record => record.path === path && record.id === id);
    const previous = scoped.sort((a, b) => compare(b, a))[0];
    const bootstrap = value?.csvzallDefaultPreferences === true && value.runOnSave !== false ||
      value === null && reason === 'stale-sql' && previous?.value?.csvzallDefaultPreferences === true;
    if (bootstrap) return { version: 1, path, id, value, clockMs: 0,
      counter: Math.max(-1, ...scoped.filter(record => record.clockMs === 0).map(record => record.counter)) + 1,
      origin: this.state.origin, ...(value === null ? { reason: reason ?? 'entry-removed' } : {}) };
    const newest = revisions.sort((a, b) => compare(b, a))[0];
    const clockMs = pluginEdit ? Math.max(time, newest?.clockMs ?? 0) : time;
    return { version: 1, path, id, value, clockMs, counter: pluginEdit && newest?.clockMs === clockMs ? newest.counter + 1 : 0,
      origin: this.state.origin, ...(value === null ? { reason: reason ?? "entry-removed" } : {}) };
  }

  private async run(chartPaths?: Set<string>): Promise<void> {
    const { adapter, store } = this.options;
    if (!chartPaths) this.blocked.clear();
    const pending = [];
    for (const move of this.state.renames) if (!await this.applyRename(move.from, move.to)) pending.push(move);
    this.state.renames = pending;
    const incoming = await store.read();
    for (const [key, revision] of readRevisions(incoming)) this.state.records[key] = revision;
    const history = [...readRevisions(this.state.records).values()];
    const currentWinners = winners(history);
    let references: ExportReference[] = [], sqlComplete = true;
    if (this.usesDirectFolders && !chartPaths) {
      try {
        const scan = await this.options.references?.() ?? [];
        references = Array.isArray(scan) ? scan : scan.references;
        sqlComplete = Array.isArray(scan) || scan.complete;
      } catch (error) { sqlComplete = false; this.options.report(error); }
    }
    if (!chartPaths) this.localizationPending = !sqlComplete;
    const paths = chartPaths ?? new Set([...Object.keys(this.state.files), ...[...currentWinners.values()].map(record => record.path)]);
    for (const reference of references) paths.add(directConfig(reference.note, "exports"));
    for (const folder of chartPaths ? [] : new Set(["", ...this.options.folders()])) {
      const configFolder = folder === "/" ? "" : folder;
      paths.add(configPathForFolder(configFolder, "charts")); paths.add(configPathForFolder(configFolder, "exports"));
      if (this.usesDirectFolders) {
        try { await new ExportDefinitions(adapter, () => this.stopped).migrateFolder(folder); }
        catch (error) { this.blocked.add(configPathForFolder(configFolder, "exports")); this.options.report(error); }
      }
    }
    const snapshots = new Map<string, string | null>();
    for (const path of paths) {
      if (this.stopped) return;
      if (chartPaths) {
        this.blocked.delete(path);
        // Read destination bytes before localization so offline edits and ID
        // collisions are resolved against real files, including delayed Sync.
        for (const record of currentWinners.values()) {
          if (record.path !== path) continue;
          const value = historicalValue(record, history)?.value;
          if (typeof value?.input === "string") paths.add(directConfig(absoluteReference(path, value.input), "charts"));
          if (record.relocatedFrom) paths.add(record.relocatedFrom.path);
          for (const target of record.relocatedTo ?? []) paths.add(target.path);
        }
      }
      try {
        const text = await adapter.exists(path) ? await adapter.read(path) : null;
        snapshots.set(path, text);
        if (text === null) continue; // Absence is never a deletion instruction.
        const stat = await adapter.stat(path);
        if (await adapter.read(path) !== text) throw new Error(`${path} is still being written. Reflection will retry.`);
        const previous = this.state.files[path];
        // A renamed file still has old-scope bytes until its first verified
        // materialization. applyRename has already imported them in that scope.
        if (previous?.scope && previous.text === text) continue;
        const entries = parseDocument(text, path);
        if (this.usesDirectFolders) for (const [id, entry] of entries) {
          if (!id.startsWith("entry:")) continue;
          const kind = path.endsWith("charts.json") ? "charts" : "exports";
          const reference = kind === "exports" && typeof entry.output === "string" ? entry.output : entry.input;
          if (typeof reference === "string") paths.add(directConfig(absoluteReference(path, reference), kind));
        }
        const baseline = previous ? parseDocument(previous.text, previous.scope ?? path) : undefined;
        const reason = this.edits.get(path);
        const timestamp = Math.max(0, Math.floor(reason ? (this.options.now?.() ?? Date.now()) : stat?.mtime ?? 0));
        for (const id of new Set([...entries.keys(), ...baseline?.keys() ?? []])) {
          const value = entries.get(id) ?? null;
          // External JSON/CLI edits preserve unknown fields. A changed entry is
          // an actual choice even if its old provisional flag was kept.
          if (value?.csvzallDefaultPreferences === true && (value.runOnSave === false ||
            baseline?.get(id)?.csvzallDefaultPreferences === true && canonical(baseline.get(id)) !== canonical(value))) delete value.csvzallDefaultPreferences;
          if (baseline && canonical(baseline.get(id) ?? null) === canonical(value)) continue;
          const existing = currentWinners.get(identity({ path, id }));
          if (existing && canonical(existing.value) === canonical(value)) continue;
          // Reconstructed file mtimes are not edit times. After journal loss,
          // recognize any previously reflected payload instead of resurrecting it.
          if (!baseline && !reason && [...readRevisions(this.state.records).values()].some(record => record.path === path && record.id === id && canonical(record.value) === canonical(value))) continue;
          const revision = this.revision(path, id, value, timestamp, reason !== undefined, reason);
          this.state.records[revisionKey(revision)] = revision;
        }
        this.state.backups[path] ??= text;
      } catch (error) { this.blocked.add(path); this.options.report(error); }
    }
    if (this.stopped) return;
    const localize = (): number => {
      const records = readRevisions(this.state.records);
      const selected = chartPaths ? new Map([...records].filter(([, record]) => chartPaths.has(record.path))) : records;
      localizeRecords(selected, references, chartPaths ? false : sqlComplete);
      for (const [key, record] of selected) { this.state.records[key] = record; records.set(key, record); }
      return records.size;
    };
    if (this.usesDirectFolders) {
      localize();
    }
    // Pending edits must survive a crash or a Sync overwrite before materialization.
    await this.journal();
    if (Object.keys(this.state.records).length) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const persisted = await store.patch({ csvzallExportSync: { version: this.usesDirectFolders ? SYNC_SCHEMA : 1 }, ...this.state.records });
        for (const [key, revision] of readRevisions(persisted)) this.state.records[key] = revision;
        if (!this.usesDirectFolders) break;
        const count = Object.keys(this.state.records).length;
        if (count === localize()) break;
        await this.journal();
        if (attempt === 2) throw new Error("Export configurations are still arriving. Localization will retry.");
      }
    }
    const reduced = winners([...readRevisions(this.state.records).values()].filter(record => !chartPaths || chartPaths.has(record.path)));
    const staged = new Map(reduced);
    const retired = [...reduced.values()].filter(record => record.reason === "relocated" && !record.value);
    // Preserve inherited bytes until all direct destinations are verified. This
    // first pass also handles migrations whose source/destination paths cycle.
    for (const record of retired) {
      if (this.blocked.has(record.path)) continue;
      const snapshot = snapshots.get(record.path);
      if (!snapshot || !parseDocument(snapshot, record.path).has(record.id)) continue;
      const original = historicalValue(record, [...readRevisions(this.state.records).values()]);
      if (original) staged.set(identity(record), original);
    }
    let changed = false;
    for (const path of new Set([...staged.values()].map(record => record.path))) changed = await this.materialize(path, staged, snapshots) || changed;
    await this.journal();
    for (const path of new Set(retired.map(record => record.path))) {
      const moves = retired.filter(record => record.path === path);
      let ready = true;
      for (const target of moves.flatMap(record => record.relocatedTo ?? [])) {
        if (this.blocked.has(target.path)) { ready = false; break; }
        const expected = reduced.get(identity(target))?.value ?? null;
        try {
          const actual = await adapter.exists(target.path) ? parseDocument(await adapter.read(target.path), target.path).get(target.id) ?? null : null;
          if (canonical(expected) !== canonical(actual)) ready = false;
        } catch { ready = false; }
      }
      if (ready) changed = await this.materialize(path, reduced, snapshots) || changed;
    }
    await this.journal();
    if (changed && !this.stopped) this.options.changed();
  }

  private async materialize(path: string, reduced: Map<string, Revision>, snapshots: Map<string, string | null>): Promise<boolean> {
      if (this.stopped || this.blocked.has(path)) return false;
      const { adapter } = this.options;
      try {
      const snapshot = snapshots.get(path) ?? null;
      // A moved config's metadata and entries are all tombstoned. Do not create
      // an empty old config that could shadow ancestor definitions later.
      if (snapshot === null && ![...reduced.values()].some(record => record.path === path && record.value !== null)) return false;
      const text = documentText(path, reduced.values());
      // Keep original bytes for semantically identical documents.
      const same = snapshot !== null && !this.state.files[path]?.scope && canonical([...parseDocument(snapshot, path)]) === canonical([...parseDocument(text, path)]);
      if (!same) {
        const parent = configRoot(path);
        if (parent && !await adapter.exists(parent)) { this.blocked.add(path); return false; }
        const folder = parentVaultPath(path);
        if (!await adapter.exists(folder)) await adapter.mkdir(folder);
        const temporary = `${folder}/.reflect-${crypto.randomUUID()}.json`;
        try {
          await adapter.write(temporary, text);
          if (await adapter.read(temporary) !== text) throw new Error(`Could not verify ${path}.`);
          const current = await adapter.exists(path) ? await adapter.read(path) : null;
          if (current !== snapshot) throw new Error(`${path} changed during reflection; retrying preserves the external edit.`);
          if (this.stopped) return false;
          if (snapshot === null) await adapter.rename(temporary, path);
          else await adapter.process(path, current => {
            if (this.stopped || current !== snapshot) throw new Error(`${path} changed during reflection.`);
            return text;
          });
          if (await adapter.read(path) !== text) throw new Error(`Could not verify reflected ${path}.`);
        } finally { if (await adapter.exists(temporary)) await adapter.remove(temporary); }
      }
      const finalText = same ? snapshot : text;
      this.state.files[path] = { text: finalText, mtime: (await adapter.stat(path))?.mtime ?? 0 };
      snapshots.set(path, finalText);
      this.edits.delete(path);
      return !same;
      } catch (error) { this.blocked.add(path); this.options.report(error); return false; }
  }

  assertReady(path: string): void {
    if (this.blocked.has(path)) throw new Error(`Export configuration is not ready: ${path}. The previous output has been kept.`);
  }

  /** A vault rename is explicit evidence: move scoped identities, never resurrect old scopes. */
  async renamed(oldPath: string, newPath: string): Promise<void> {
    if (this.running) await this.running;
    this.state.renames.push({ from: oldPath, to: newPath });
    await this.journal();
    await this.reconcile();
  }

  private async applyRename(oldPath: string, newPath: string): Promise<boolean> {
    let complete = true;
    for (const [key, revision] of readRevisions(await this.options.store.read())) this.state.records[key] = revision;
    // Capture bytes that changed between polls BEFORE assigning new identities.
    // Moved files still contain references relative to their original scope.
    const paths = new Set([...Object.keys(this.state.files), ...[...readRevisions(this.state.records).values()].map(record => record.path)]);
    for (const folder of this.options.folders()) {
      const previous = folder === newPath || folder.startsWith(`${newPath}/`) ? oldPath + folder.slice(newPath.length) : folder;
      if (previous && previous !== "/" && !previous.startsWith(".")) {
        paths.add(configPathForFolder(previous, "charts")); paths.add(configPathForFolder(previous, "exports"));
      }
    }
    for (const path of paths) {
      const actual = path.startsWith(`${oldPath}/`) ? newPath + path.slice(oldPath.length) : path;
      try {
      const reflected = winners(readRevisions(this.state.records).values());
      const baselineAtTarget = this.state.files[actual];
      if (actual !== path && reflected.get(identity({ path, id: "document" }))?.value === null && baselineAtTarget && !baselineAtTarget.scope) continue;
      if (actual === path && baselineAtTarget?.scope) continue; // handled through the original identity above
      if (!await this.options.adapter.exists(actual)) continue;
      const text = await this.options.adapter.read(actual);
      const mtime = Math.max(0, Math.floor((await this.options.adapter.stat(actual))?.mtime ?? 0));
      if (await this.options.adapter.read(actual) !== text) throw new Error(`${actual} changed while handling rename. Retry the export update.`);
      const values = parseDocument(text, path);
      const previous = this.state.files[path];
      const baseline = previous ? parseDocument(previous.text, previous.scope ?? path) : undefined;
      const reduced = winners(readRevisions(this.state.records).values());
      for (const id of new Set([...values.keys(), ...baseline?.keys() ?? []])) {
        const value = values.get(id) ?? null;
        if (baseline && canonical(baseline.get(id) ?? null) === canonical(value)) continue;
        if (canonical(reduced.get(identity({ path, id }))?.value) === canonical(value)) continue;
        const imported = this.revision(path, id, value, mtime, false);
        this.state.records[revisionKey(imported)] = imported;
      }
      this.state.backups[path] ??= text;
      if (actual !== path) this.state.files[actual] = { text, mtime, scope: path };
      } catch (error) { complete = false; this.blocked.add(actual); this.options.report(error); }
    }
    const records = winners(readRevisions(this.state.records).values());
    const time = this.options.now?.() ?? Date.now();
    for (const record of records.values()) {
      const originalValue = record.value ?? (record.reason === "relocated" ? historicalValue(record, [...readRevisions(this.state.records).values()])?.value : undefined);
      if (!originalValue) continue;
      const path = record.path.startsWith(`${oldPath}/`) ? newPath + record.path.slice(oldPath.length) : record.path;
      if (this.blocked.has(record.path) || this.blocked.has(path)) continue;
      if (!configPath(path)) continue;
      const value = { ...originalValue };
      for (const field of ["input", "output"]) {
        const reference = value[field];
        if (typeof reference !== "string") continue;
        const base = configRoot(record.path);
        const parts = base ? base.split("/") : [];
        for (const part of reference.replace(/\\/g, "/").split("/")) {
          if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part);
        }
        const absolute = parts.join("/");
        const renamed = absolute === oldPath || absolute.startsWith(`${oldPath}/`) ? newPath + absolute.slice(oldPath.length) : absolute;
        value[field] = relativeReference(path, renamed);
      }
      if (!record.value) {
        const destinations = record.relocatedTo?.map(target => ({ ...target, path: target.path.startsWith(`${oldPath}/`) ? newPath + target.path.slice(oldPath.length) : target.path }));
        if (canonical(destinations) !== canonical(record.relocatedTo) || canonical(value) !== canonical(originalValue)) {
          const renamed: Revision = { ...this.revision(record.path, record.id, null, time, true, "relocated"), relocatedTo: destinations, relocationValue: value };
          this.state.records[revisionKey(renamed)] = renamed;
        }
        continue;
      }
      if (path === record.path && canonical(value) === canonical(record.value)) continue;
      if (path !== record.path) {
        const removed = this.revision(record.path, record.id, null, time, true, "explicit");
        this.state.records[revisionKey(removed)] = removed;
        if (!this.state.files[path] && await this.options.adapter.exists(path)) {
          this.state.files[path] = { text: await this.options.adapter.read(path), mtime: (await this.options.adapter.stat(path))?.mtime ?? 0, scope: record.path };
        }
      }
      const moved = this.revision(path, record.id, value, time, true);
      const lineage = record.relocatedFrom ?? [...readRevisions(this.state.records).values()].find(item => identity(item) === identity(record) && item.relocatedFrom)?.relocatedFrom;
      if (lineage) moved.relocatedFrom = lineage;
      this.state.records[revisionKey(moved)] = moved;
    }
    return complete;
  }

  assertSqlBinding(note: string, id: string, resolvedPath: string): void {
    if (this.usesDirectFolders && resolvedPath !== directConfig(note, "exports")) throw new Error("SQL exports must use their note folder's configuration.");
    const all = winners(readRevisions(this.state.records).values());
    for (const path of this.usesDirectFolders ? [directConfig(note, "exports")] : ancestorConfigPaths(note, "exports")) {
      const record = all.get(identity({ path, id: `entry:${id}` }));
      if (record) {
        if (!record.value || path !== resolvedPath) throw new Error(`SQL export ${id} is unavailable in its scope. The previous content has been kept.`);
        this.assertReady(path);
        return;
      }
    }
  }

  /** A valid late note can recover automatic cleanup, never an explicit deletion. */
  async recoverSql(note: string, id: string): Promise<boolean> {
    await this.reconcile();
    const all = [...readRevisions(this.state.records).values()];
    for (const path of this.usesDirectFolders ? [directConfig(note, "exports")] : ancestorConfigPaths(note, "exports")) {
      const key = identity({ path, id: `entry:${id}` });
      const winner = winners(all).get(key);
      if (winner?.value) return false;
      if (winner?.value === null) {
        if (winner.reason !== "stale-sql") return false;
        const previous = all.filter(record => identity(record) === key && record.value !== null).sort((a, b) => compare(b, a))[0];
        if (!previous?.value) return false;
        const restored = this.revision(path, previous.id, previous.value, this.options.now?.() ?? Date.now(), true);
        this.state.records[revisionKey(restored)] = restored;
        await this.journal();
        await this.reconcile();
        return true;
      }
    }
    return false;
  }

  /** Prevent native chart actions from selecting a parent config. */
  async prepareViewer(source: string): Promise<void> {
    if (!this.usesDirectFolders) return;
    await this.reconcileCharts(source);
    const path = directConfig(source, "charts"), { adapter } = this.options;
    this.assertReady(path);
    if (await adapter.exists(path)) { parseDocument(await adapter.read(path), path); return; }
    const folder = parentVaultPath(path);
    if (!await adapter.exists(folder)) await adapter.mkdir(folder);
    const temporary = `${folder}/.direct-${crypto.randomUUID()}.json`, text = '{"charts":[]}\n';
    try {
      await adapter.write(temporary, text);
      if (await adapter.read(temporary) !== text) throw new Error("Could not verify direct chart configuration.");
      if (this.stopped) throw new Error("Export reflection stopped.");
      if (!await adapter.exists(path)) await adapter.rename(temporary, path);
      parseDocument(await adapter.read(path), path);
    } finally { if (await adapter.exists(temporary)) await adapter.remove(temporary); }
    this.edits.set(path, "explicit");
    await this.reconcileCharts(source);
  }
}

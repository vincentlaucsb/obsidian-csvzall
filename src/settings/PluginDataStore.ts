import { canonical, object, readRevisions, type JsonObject } from "../exports/revisions.js";
import { normalizeSettings, type CsvzallPluginSettings } from "./settings.js";
import { hasErrorCode } from "../utils/errors.js";

export interface PluginDataAccess {
  load(): Promise<unknown>; save(value: JsonObject): Promise<void>;
  loadLocal?(): unknown; saveLocal?(value: JsonObject): void;
  directoryAvailable?(): Promise<boolean>;
}
const DEVICE_KEYS = new Set(["csvzallPath", "csvzallExecutableMode", "installedCsvzallVersion", "installedCsvzallAssetName", "csvzallLastUpdateCheckAt"]);

function containsFields(document: JsonObject, fields: JsonObject): boolean {
  return Object.entries(fields).every(([key, value]) =>
    Object.prototype.hasOwnProperty.call(document, key) && canonical(document[key]) === canonical(value));
}

/** All data.json writes pass here, preserving other fields and incoming revisions. */
export class PluginDataStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly retained: JsonObject = {};
  private baseline: JsonObject = {};
  private deviceMigration?: CsvzallPluginSettings;

  constructor(private readonly access: PluginDataAccess) {}

  private run<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(action);
    this.queue = next;
    return next;
  }

  private async load(): Promise<JsonObject> {
    const data = await this.readDisk() ?? {};
    this.retain(data);
    return { ...data, ...this.retained };
  }

  private retain(data: JsonObject): void {
    for (const [key, revision] of readRevisions(data)) this.retained[key] = revision;
  }

  private async readDisk(): Promise<JsonObject | null> {
    let data: unknown;
    try { data = await this.access.load(); }
    catch (error) {
      if (hasErrorCode(error, "ENOENT")) return null;
      throw error;
    }
    if (data === null || data === undefined) return null;
    if (!object(data)) throw new Error("Invalid plugin data; the existing file has been kept.");
    return data;
  }

  read(): Promise<JsonObject> { return this.run(() => this.load()); }

  async initialize(): Promise<CsvzallPluginSettings> {
    const document = await this.read(), local = this.access.loadLocal?.();
    const settings = normalizeSettings({ ...document, ...(object(local) ? local : {}) });
    // Complete the legacy migration before the first reflection publication.
    if (this.access.saveLocal) {
      this.deviceMigration = settings;
      try { await this.persist({}, document); }
      catch (error) {
        if (!hasErrorCode(error, "ENOENT") && await this.access.directoryAvailable?.() !== false) throw error;
        console.warn("Could not initialize csvzall plugin data; the next save will retry", error);
      }
    }
    this.baseline = JSON.parse(JSON.stringify(settings)) as JsonObject;
    return settings;
  }

  private deviceSettings(settings: CsvzallPluginSettings): JsonObject {
    const local: JsonObject = {};
    for (const key of DEVICE_KEYS) local[key] = Reflect.get(settings, key);
    return local;
  }

  patch(patch: JsonObject): Promise<JsonObject> { return this.persist(patch); }

  private persist(patch: JsonObject, latest: JsonObject = {}): Promise<JsonObject> {
    return this.run(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const first = await this.readDisk();
        latest = first ?? latest;
        this.retain(latest);
        // An unchanged reflection is already durable in this freshly read file.
        // retain() verified the content-addressed revisions, including their keys.
        if (first && !this.deviceMigration &&
          (!this.access.saveLocal || [...DEVICE_KEYS].every(key => first[key] === undefined)) &&
          Object.keys(this.retained).every(key => first[key] !== undefined) &&
          containsFields(first, patch)) return first;
        const disk = await this.readDisk();
        // Merge the most recent settings too; Sync may have run since load().
        latest = disk ?? latest;
        this.retain(latest);
        const merged = { ...latest, ...this.retained, ...patch };
        const revisions = readRevisions(merged);
        const migration = this.deviceMigration;
        if (migration && [...DEVICE_KEYS].some(key => Object.prototype.hasOwnProperty.call(latest, key))) {
          const local = this.access.loadLocal?.();
          const migrated = this.deviceSettings(normalizeSettings({ ...latest, ...(object(local) ? local : {}) }));
          this.access.saveLocal?.(migrated);
          Object.assign(migration, migrated);
        }
        if (this.access.saveLocal) for (const key of DEVICE_KEYS) delete merged[key];
        // A missing document still needs a durable first write, even for an empty patch.
        if (disk === null || canonical(merged) !== canonical(disk)) await this.access.save(merged);
        // Keep revisions durable in memory even if Sync replaces the file during save.
        for (const [key, revision] of revisions) this.retained[key] = revision;
        const verified = await this.readDisk();
        if (verified) {
          latest = verified;
          this.retain(verified);
          const deviceKeysRemoved = !this.access.saveLocal || [...DEVICE_KEYS].every(key => !Object.prototype.hasOwnProperty.call(verified, key));
          if (deviceKeysRemoved && containsFields(verified, { ...this.retained, ...patch })) {
            // Without a source document, publish defaults only after a durable first write.
            if (migration) {
              this.access.saveLocal?.(this.deviceSettings(migration));
              this.deviceMigration = undefined;
            }
            return verified;
          }
        }
      }
      throw new Error("Plugin data changed while saving. The update will be retried.");
    });
  }

  saveSettings(settings: CsvzallPluginSettings): Promise<void> {
    const previous = this.baseline;
    const snapshot = JSON.parse(JSON.stringify(settings)) as JsonObject;
    const patch: JsonObject = {};
    if (!this.deviceMigration || previous.csvzallExecutableMode !== settings.csvzallExecutableMode ||
        settings.csvzallExecutableMode === "custom" && previous.csvzallPath !== settings.csvzallPath) {
      this.access.saveLocal?.(this.deviceSettings(settings));
    }
    for (const [key, value] of Object.entries(snapshot)) if (!DEVICE_KEYS.has(key) && canonical(value) !== canonical(this.baseline[key])) patch[key] = value;
    // Capture queued UI changes now; a later call must not repeat old fields over remote data.
    this.baseline = snapshot;
    return this.patch(patch).then(() => {}, (error: unknown) => {
      for (const key of Object.keys(patch)) if (canonical(this.baseline[key]) === canonical(snapshot[key])) this.baseline[key] = previous[key];
      throw error;
    });
  }

  async externalSettings(settings: CsvzallPluginSettings): Promise<void> {
    const loaded = normalizeSettings(await this.read());
    for (const [key, value] of Object.entries(loaded)) {
      if (DEVICE_KEYS.has(key)) continue;
      if (canonical(Reflect.get(settings, key)) === canonical(this.baseline[key])) Reflect.set(settings, key, value);
    }
    this.baseline = JSON.parse(JSON.stringify({ ...loaded, ...Object.fromEntries([...DEVICE_KEYS].map(key => [key, Reflect.get(settings, key)])) })) as JsonObject;
  }
}

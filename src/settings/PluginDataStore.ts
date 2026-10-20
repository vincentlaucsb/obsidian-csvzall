import { canonical, object, readRevisions, type JsonObject } from "../exports/revisions.js";
import { normalizeSettings, type CsvzallPluginSettings } from "./settings.js";

export interface PluginDataAccess {
  load(): Promise<unknown>; save(value: JsonObject): Promise<void>;
  loadLocal?(): unknown; saveLocal?(value: JsonObject): void;
}
const DEVICE_KEYS = new Set(["csvzallPath", "csvzallExecutableMode", "installedCsvzallVersion", "installedCsvzallAssetName", "csvzallLastUpdateCheckAt"]);

/** All data.json writes pass here, preserving other fields and incoming revisions. */
export class PluginDataStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly retained: JsonObject = {};
  private baseline: JsonObject = {};

  constructor(private readonly access: PluginDataAccess) {}

  private run<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(action);
    this.queue = next;
    return next;
  }

  private async load(): Promise<JsonObject> {
    const loaded = await this.access.load();
    if (loaded !== null && loaded !== undefined && !object(loaded)) throw new Error("Invalid plugin data; the existing file has been kept.");
    const data = object(loaded) ? loaded : {};
    for (const [key, revision] of readRevisions(data)) this.retained[key] = revision;
    return { ...data, ...this.retained };
  }

  read(): Promise<JsonObject> { return this.run(() => this.load()); }

  async initialize(): Promise<CsvzallPluginSettings> {
    const document = await this.read(), local = this.access.loadLocal?.();
    const settings = normalizeSettings({ ...document, ...(object(local) ? local : {}) });
    this.saveDeviceSettings(settings);
    // Complete the legacy migration before the first reflection publication.
    if (this.access.saveLocal) await this.patch({});
    this.baseline = JSON.parse(JSON.stringify(settings)) as JsonObject;
    return settings;
  }

  private saveDeviceSettings(settings: CsvzallPluginSettings): void {
    const local: JsonObject = {};
    for (const key of DEVICE_KEYS) local[key] = Reflect.get(settings, key);
    this.access.saveLocal?.(local);
  }

  patch(patch: JsonObject): Promise<JsonObject> {
    return this.run(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const data = await this.load(), next = { ...data, ...patch };
        readRevisions(next);
        const disk = await this.access.load();
        if (disk !== null && disk !== undefined && !object(disk)) throw new Error("Invalid plugin data; the existing file has been kept.");
        // Merge the most recent settings too; Sync may have run since load().
        const latest = object(disk) ? disk : {};
        for (const [key, revision] of readRevisions(latest)) this.retained[key] = revision;
        const merged = { ...latest, ...this.retained, ...patch };
        if (this.access.saveLocal) for (const key of DEVICE_KEYS) delete merged[key];
        if (canonical(merged) !== canonical(latest)) await this.access.save(merged);
        // Keep revisions durable in memory even if Sync replaces the file during save.
        for (const [key, revision] of readRevisions(next)) this.retained[key] = revision;
        const verified = await this.access.load();
        if (object(verified)) for (const [key, revision] of readRevisions(verified)) this.retained[key] = revision;
        if (object(verified) && Object.entries({ ...this.retained, ...patch }).every(([key, value]) => canonical(verified[key]) === canonical(value))) return verified;
      }
      throw new Error("Plugin data changed while saving. The update will be retried.");
    });
  }

  saveSettings(settings: CsvzallPluginSettings): Promise<void> {
    const previous = this.baseline;
    const snapshot = JSON.parse(JSON.stringify(settings)) as JsonObject;
    const patch: JsonObject = {};
    this.saveDeviceSettings(settings);
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

export const MAX_EVENT_LOG_ENTRIES = 100;

export interface CsvzallEventLogEntry {
  timestamp: string;
  level: "info" | "error";
  message: string;
  detail?: string;
}

export interface CsvzallPluginSettings {
  csvzallPath: string;
  installedCsvzallVersion: string;
  installedCsvzallAssetName: string;
  csvzallLastUpdateCheckAt: string;
  openInObsidian: boolean;
  startupTimeoutMs: number;
  eventLog: CsvzallEventLogEntry[];
}

export const DEFAULT_SETTINGS: CsvzallPluginSettings = {
  csvzallPath: "csvzall",
  installedCsvzallVersion: "",
  installedCsvzallAssetName: "",
  csvzallLastUpdateCheckAt: "",
  openInObsidian: true,
  startupTimeoutMs: 10000,
  eventLog: [],
};

export function normalizeSettings(data: unknown): CsvzallPluginSettings {
  const candidate = data && typeof data === "object" ? data as Partial<CsvzallPluginSettings> : {};
  return {
    ...DEFAULT_SETTINGS,
    csvzallPath: typeof candidate.csvzallPath === "string" && candidate.csvzallPath.trim() ?
      candidate.csvzallPath : DEFAULT_SETTINGS.csvzallPath,
    openInObsidian: typeof candidate.openInObsidian === "boolean" ?
      candidate.openInObsidian : DEFAULT_SETTINGS.openInObsidian,
    startupTimeoutMs: typeof candidate.startupTimeoutMs === "number" &&
      Number.isFinite(candidate.startupTimeoutMs) && candidate.startupTimeoutMs > 0 &&
      candidate.startupTimeoutMs <= 2147483647 ? candidate.startupTimeoutMs : DEFAULT_SETTINGS.startupTimeoutMs,
    installedCsvzallVersion: typeof candidate.installedCsvzallVersion === "string" ?
      candidate.installedCsvzallVersion :
      DEFAULT_SETTINGS.installedCsvzallVersion,
    installedCsvzallAssetName: typeof candidate.installedCsvzallAssetName === "string" ?
      candidate.installedCsvzallAssetName :
      DEFAULT_SETTINGS.installedCsvzallAssetName,
    csvzallLastUpdateCheckAt: typeof candidate.csvzallLastUpdateCheckAt === "string" ?
      candidate.csvzallLastUpdateCheckAt :
      DEFAULT_SETTINGS.csvzallLastUpdateCheckAt,
    eventLog: Array.isArray(candidate.eventLog) ? candidate.eventLog
      .filter((entry): entry is CsvzallEventLogEntry => !!entry && typeof entry === "object" &&
        typeof entry.timestamp === "string" && (entry.level === "info" || entry.level === "error") &&
        typeof entry.message === "string" && (entry.detail === undefined || typeof entry.detail === "string"))
      .slice(0, MAX_EVENT_LOG_ENTRIES) : [],
  };
}

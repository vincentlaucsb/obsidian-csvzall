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
  csvzallLastUpdateCheckAt: string;
  openInObsidian: boolean;
  startupTimeoutMs: number;
  eventLog: CsvzallEventLogEntry[];
}

export const DEFAULT_SETTINGS: CsvzallPluginSettings = {
  csvzallPath: "csvzall",
  installedCsvzallVersion: "",
  csvzallLastUpdateCheckAt: "",
  openInObsidian: true,
  startupTimeoutMs: 10000,
  eventLog: [],
};

export function normalizeSettings(data: unknown): CsvzallPluginSettings {
  const candidate = data && typeof data === "object" ? data as Partial<CsvzallPluginSettings> : {};
  return {
    ...DEFAULT_SETTINGS,
    ...candidate,
    installedCsvzallVersion: typeof candidate.installedCsvzallVersion === "string" ?
      candidate.installedCsvzallVersion :
      DEFAULT_SETTINGS.installedCsvzallVersion,
    csvzallLastUpdateCheckAt: typeof candidate.csvzallLastUpdateCheckAt === "string" ?
      candidate.csvzallLastUpdateCheckAt :
      DEFAULT_SETTINGS.csvzallLastUpdateCheckAt,
    eventLog: Array.isArray(candidate.eventLog) ? candidate.eventLog : [],
  };
}

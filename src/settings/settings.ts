export const MAX_EVENT_LOG_ENTRIES = 100;

export interface CsvzallEventLogEntry {
  timestamp: string;
  level: "info" | "error";
  message: string;
  detail?: string;
}

export interface CsvzallPluginSettings {
  csvzallPath: string;
  openInObsidian: boolean;
  startupTimeoutMs: number;
  eventLog: CsvzallEventLogEntry[];
}

export const DEFAULT_SETTINGS: CsvzallPluginSettings = {
  csvzallPath: "csvzall",
  openInObsidian: true,
  startupTimeoutMs: 10000,
  eventLog: [],
};

export function normalizeSettings(data: unknown): CsvzallPluginSettings {
  const candidate = data && typeof data === "object" ? data as Partial<CsvzallPluginSettings> : {};
  return {
    ...DEFAULT_SETTINGS,
    ...candidate,
    eventLog: Array.isArray(candidate.eventLog) ? candidate.eventLog : [],
  };
}

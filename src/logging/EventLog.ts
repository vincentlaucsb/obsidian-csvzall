import type { CsvzallEventLogEntry, CsvzallPluginSettings } from "../settings/settings.js";
import { MAX_EVENT_LOG_ENTRIES } from "../settings/settings.js";

export class EventLog {
  private saveFailed = false;

  constructor(
    private readonly getSettings: () => CsvzallPluginSettings,
    private readonly saveSettings: () => Promise<void>,
  ) {}

  async clear(): Promise<void> {
    const settings = this.getSettings();
    const previous = settings.eventLog;
    const empty: CsvzallEventLogEntry[] = [];
    settings.eventLog = empty;
    try { await this.saveSettings(); }
    catch (error) {
      if (settings.eventLog === empty) settings.eventLog = previous;
      throw error;
    }
  }

  async record(
    level: CsvzallEventLogEntry["level"],
    message: string,
    detail?: string,
  ): Promise<void> {
    const settings = this.getSettings();
    settings.eventLog = [
      {
        timestamp: new Date().toISOString(),
        level,
        message,
        detail,
      },
      ...settings.eventLog,
    ].slice(0, MAX_EVENT_LOG_ENTRIES);
    try {
      await this.saveSettings();
      this.saveFailed = false;
    } catch (error) {
      // The in-memory log and the caller's original result survive an unavailable data.json.
      if (!this.saveFailed) console.warn("Could not save the csvzall event log", error);
      this.saveFailed = true;
    }
  }
}

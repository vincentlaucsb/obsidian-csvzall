import type { CsvzallEventLogEntry, CsvzallPluginSettings } from "../settings/settings.js";
import { MAX_EVENT_LOG_ENTRIES } from "../settings/settings.js";

export class EventLog {
  constructor(
    private readonly getSettings: () => CsvzallPluginSettings,
    private readonly saveSettings: () => Promise<void>,
  ) {}

  async clear(): Promise<void> {
    this.getSettings().eventLog = [];
    await this.saveSettings();
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
    await this.saveSettings();
  }
}

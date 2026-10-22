import { Notice, type TFile } from 'obsidian';
import type { EventLog } from '../logging/EventLog.js';
import { SessionErrors } from '../logging/SessionErrors.js';

export type ExportReporter = (file: TFile | null, error: unknown, automatic?: boolean) => Promise<void>;

export function createExportReporter(eventLog: EventLog, signal: AbortSignal): ExportReporter {
  const errors = new SessionErrors();
  return async (file, error, automatic = true) => {
    if (signal.aborted) return;
    const message = error instanceof Error ? error.message : String(error);
    const key = file?.path ?? 'tables';
    const first = errors.first(key, message);
    if (automatic && !first) return;
    new Notice(`Could not update CSV export${file ? ` in ${file.path}` : ''}: ${message}`);
    await eventLog.record('error', 'Could not update CSV export', `${key}: ${message}`);
  };
}

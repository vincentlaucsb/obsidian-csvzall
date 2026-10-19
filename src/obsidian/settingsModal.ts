import type { App } from "obsidian";

interface SettingsModal { open(): void; close(): void; openTabById(id: string): void }

/**
 * Obsidian has no public API for the settings modal. Read it defensively and
 * check every member before calling it, so a missing or changed private API is
 * a no-op instead of an error.
 */
function settingsModal(app: App): Partial<SettingsModal> | undefined {
  const setting = (app as unknown as { setting?: unknown }).setting;
  return setting && typeof setting === "object" ? setting : undefined;
}

export function openPluginSettings(app: App, pluginId: string): void {
  const setting = settingsModal(app);
  if (typeof setting?.open === "function") setting.open();
  if (typeof setting?.openTabById === "function") setting.openTabById(pluginId);
}

export function closeSettings(app: App): void {
  const setting = settingsModal(app);
  if (typeof setting?.close === "function") setting.close();
}

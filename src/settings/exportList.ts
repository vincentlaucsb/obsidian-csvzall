import { Notice, Setting } from "obsidian";
import type { ExportSettingsService, FileExports } from "./ExportSettingsService.js";
import { addExportActions } from "./exportActions.js";
import { countExports, exportCountsText } from "./exportSummary.js";

export type ExportListService = Pick<ExportSettingsService, "list" | "configure" | "confirmDelete"> & Partial<Pick<ExportSettingsService, "onChanged">>;

/**
 * Load saved exports into `container`, showing loading and error states.
 * `isCurrent` lets callers drop results that arrive after a refresh or close.
 */
export function loadExports(container: HTMLElement, exports: Pick<ExportListService, "list">, isCurrent: () => boolean,
  render: (files: FileExports[]) => void, retry?: () => void): void {
  const status = container.createDiv({ text: "Loading exports..." });
  void exports.list().then(files => {
    if (!isCurrent()) return;
    status.remove();
    render(files);
  }).catch((error: unknown) => {
    if (!isCurrent()) return;
    status.setText(`Could not load exports: ${error instanceof Error ? error.message : String(error)}`);
    if (retry) new Setting(container).addButton(button => button.setButtonText("Retry").onClick(retry));
  });
}

/** One row per CSV file with Configure and Delete actions. `refresh` runs after either action saves. */
export function renderExportRows(container: HTMLElement, files: readonly FileExports[], exports: ExportListService,
  refresh: () => void): void {
  if (files.length === 0) container.createDiv({ text: "No exports yet." });
  for (const file of files) {
    const counts = exportCountsText(countExports([file]));
    addExportActions(new Setting(container).setName(file.source).setDesc(`${counts}${file.missing ? " · CSV missing" : ""}`), {
      configureDisabled: file.missing,
      configure: () => {
        try { exports.configure(file, refresh); }
        catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
      },
      remove: () => { exports.confirmDelete(file, refresh); },
    });
  }
}

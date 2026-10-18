import type { ExportEntry, FileExports } from "./ExportSettingsService.js";

export interface ExportCounts { files: number; charts: number; tables: number }

/** Markdown-table chart definitions produce note content, so they count as table exports. */
function isChart(entry: ExportEntry): boolean {
  return entry.kind === "chart" && entry.chart.definition.type !== "markdown-table";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function countExports(files: readonly Pick<FileExports, "entries">[]): ExportCounts {
  let charts = 0, tables = 0;
  for (const file of files) for (const entry of file.entries) {
    if (isChart(entry)) charts++;
    else tables++;
  }
  return { files: files.length, charts, tables };
}

/** Chart and table counts, for example "2 charts, 1 table or value export". */
export function exportCountsText(counts: Pick<ExportCounts, "charts" | "tables">): string {
  return [counts.charts ? plural(counts.charts, "chart") : "",
    counts.tables ? plural(counts.tables, "table or value export") : ""].filter(Boolean).join(", ");
}

/** One-line overview such as "3 files · 5 charts, 2 table or value exports". */
export function exportSummaryText(files: readonly Pick<FileExports, "entries">[]): string {
  const counts = countExports(files);
  if (counts.charts + counts.tables === 0) return "No exports yet.";
  return `${plural(counts.files, "file")} · ${exportCountsText(counts)}`;
}

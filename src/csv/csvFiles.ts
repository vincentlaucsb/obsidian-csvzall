import type { TFile } from "obsidian";
import { joinVaultPath, normalizeVaultPath } from "../utils/paths.js";

export const CSV_EXTENSIONS = ["csv", "tsv"];

export function isCsv(file: TFile): boolean {
  return CSV_EXTENSIONS.includes(file.extension.toLowerCase());
}

export function nextCsvPath(folder: string, exists: (path: string) => boolean): string {
  const normalized = normalizeVaultPath(folder);
  for (let index = 0; index < 10000; index += 1) {
    const name = index === 0 ? "Untitled.csv" : `Untitled ${index}.csv`;
    const path = joinVaultPath(normalized, name);
    if (!exists(path)) return path;
  }
  throw new Error("Could not find an available Untitled CSV filename.");
}

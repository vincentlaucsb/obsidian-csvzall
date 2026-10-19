import { TFile } from "obsidian";

export const CSV_EXTENSIONS = ["csv", "tsv"];

export function isCsv(file: TFile): boolean {
  return CSV_EXTENSIONS.includes(file.extension.toLowerCase());
}

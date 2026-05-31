import { TFile } from "obsidian";

export function isCsv(file: TFile): boolean {
  return file.extension.toLowerCase() === "csv";
}

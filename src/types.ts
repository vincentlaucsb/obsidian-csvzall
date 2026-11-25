import type { CsvzallProcess } from "./process/CsvzallProcess.js";

export interface CsvzallServerHandle {
  filePath: string;
  process: CsvzallProcess;
  url: string;
}

export interface ConfiguredChart {
  id: string;
  type: string;
  input: string;
  output: string;
  configPath: string;
  runOnSave: boolean;
}

import type { ChildProcessWithoutNullStreams } from "child_process";

export interface CsvzallServerHandle {
  filePath: string;
  process: ChildProcessWithoutNullStreams;
  url: string;
  stopping: boolean;
}

export interface ConfiguredChart {
  id: string;
  type: string;
  input: string;
  output: string;
  configPath: string;
  runOnSave: boolean;
}

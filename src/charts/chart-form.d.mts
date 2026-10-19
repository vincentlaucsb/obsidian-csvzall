export interface ChartDefinition {
  id: string;
  type: string;
  input: string;
  output?: string;
  runOnSave?: boolean;
  options?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface ChartFormPayload {
  type: string; id: string; title: string; output: string; runOnSave: boolean;
  date: string; value: string; values: string[]; label: string; x: string; y: string; series: string;
  orientation: string; presentation: string; colorScheme: string;
  columns: string[]; sql: string; start: string; end: string; lookback: string;
}
export function createChartForm(root: HTMLElement): void;
export function mountChartForm(root: HTMLElement, options: {
  schema: { file: string; columns: string[] };
  existingOnly?: boolean;
  previewTable?: (value: { columns: string[]; sql: string }) => Promise<string>;
  previewChart?: (value: ChartFormPayload) => Promise<{ svg?: string; markdown?: string }>;
  fetchJson: (path: string) => Promise<{ charts: ChartDefinition[] }>;
  postJson: (path: string, body: ChartFormPayload | { id: string } | { sql: string }) => Promise<{
    id?: string; generated?: boolean; columns?: string[]; rows?: unknown[][]; svg?: string; markdown?: string;
  }>;
  close?: (result: string) => void;
  status?: (message: string) => void;
}): { open(): Promise<void>; dispose(): void };

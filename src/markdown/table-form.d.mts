export interface TableValue {
  format?: 'table' | 'value';
  syntax?: 'comment' | 'code';
  source: string;
  destination: string;
  columns: string[];
  sql: string;
  autoUpdate: boolean;
}
export interface TableFormOptions {
  value?: Partial<TableValue>;
  sources?: string[];
  columns?: string[];
  showSource?: boolean;
  showFormat?: boolean;
  showSyntax?: boolean;
  showDestination?: boolean;
  showAutoUpdate?: boolean;
  submitLabel?: string;
  loadColumns?: (source: string) => Promise<string[]>;
  preview: (value: TableValue) => Promise<string>;
  submit?: (value: TableValue, signal: AbortSignal) => Promise<void>;
  onChange?: () => void;
}
export function tableQuery(value: Pick<TableValue, 'sql' | 'columns'>, limit?: number): string;
export function mountTableForm(root: HTMLElement, options: TableFormOptions): {
  getValue(): TableValue;
  setValue(value: Partial<TableValue>): void;
  setColumns(names: string[], selected?: string[]): void;
  dispose(): void;
};

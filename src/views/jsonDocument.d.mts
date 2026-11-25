export class JsonDocument {
  constructor(source: string);
  readonly display: string;
  readonly indent: string;
  serialize(display: string): string;
}

import type { TFile, Vault } from "obsidian";

export class CsvSourceConflict extends Error {
  constructor() { super("The file changed on disk. Your edits are still open."); }
}

function sameBytes(left: ArrayBuffer, right: ArrayBuffer): boolean {
  if (left.byteLength !== right.byteLength) return false;
  const a = new Uint8Array(left), b = new Uint8Array(right);
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

// Multiple panes can edit the same file. Obsidian provides an atomic text
// operation, but binary writes need ordering across our panes as well.
const writes = new WeakMap<TFile, Promise<void>>();

export class WasmCsvSource {
  private bytes: ArrayBuffer | null = null;
  revision = 0;

  constructor(private readonly vault: Vault, private readonly file: TFile) {}

  async read(): Promise<ArrayBuffer | null> {
    const bytes = await this.vault.readBinary(this.file);
    if (this.bytes && sameBytes(this.bytes, bytes)) return null;
    // postMessage transfers the original allocation to the viewer.
    this.bytes = bytes.slice(0);
    this.revision++;
    return bytes;
  }

  async save(revision: number | undefined, output: ArrayBuffer, current: () => boolean): Promise<void> {
    const write = (writes.get(this.file) ?? Promise.resolve()).then(async () => {
      const baseline = this.bytes;
      if (!baseline || revision !== this.revision) throw new CsvSourceConflict();
      const verify = () => {
        if (!current()) throw new Error("The file viewer closed or changed before saving.");
        if (revision !== this.revision || this.vault.getAbstractFileByPath(this.file.path) !== this.file) {
          throw new CsvSourceConflict();
        }
      };
      verify();
      const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
      let text: { before: string; after: string } | undefined;
      try {
        text = { before: decoder.decode(baseline), after: decoder.decode(output) };
      } catch { /* A CSV with non-UTF-8 bytes must retain its original encoding. */ }
      if (text) {
        const { before, after } = text;
        await this.vault.process(this.file, disk => {
          verify();
          if (disk !== before) throw new CsvSourceConflict();
          return after;
        });
      } else {
        // Preserve non-UTF-8 CSV bytes through the binary API. Its read and
        // write are separate operations, unlike Vault.process for UTF-8.
        const disk = await this.vault.readBinary(this.file);
        verify();
        if (!sameBytes(disk, baseline)) throw new CsvSourceConflict();
        await this.vault.modifyBinary(this.file, output);
      }
      this.bytes = output;
      this.revision++;
    });
    const settled = write.catch(() => {});
    writes.set(this.file, settled);
    try { await write; }
    finally { if (writes.get(this.file) === settled) writes.delete(this.file); }
  }
}

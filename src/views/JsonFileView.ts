import { registerJsonExtension } from "./registerJsonExtension.js";
import { EditorState, type Text } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { tags } from "@lezer/highlight";
import { FileView, Modal, Notice, type Plugin, type TFile, type WorkspaceLeaf } from "obsidian";
import { JsonDocument } from "./jsonDocument.mjs";

const highlighting = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--code-property)" },
  { tag: tags.string, color: "var(--code-string)" },
  { tag: tags.number, color: "var(--code-value)" },
  { tag: [tags.bool, tags.null], color: "var(--code-keyword)" },
]);

interface OpenJson {
  file: TFile;
  format: JsonDocument;
  source: string;
  editor: EditorView;
  saved: Text;
  refreshNeeded: boolean;
}

class JsonFileView extends FileView {
  private current: OpenJson | null = null;
  private pending: Promise<void> = Promise.resolve();
  private loadGeneration = 0;

  constructor(leaf: WorkspaceLeaf, private readonly type: string) {
    super(leaf);
    this.addAction("save", "Save JSON", () => this.requestSave());
  }

  getViewType(): string { return this.type; }
  getIcon(): string { return "braces"; }
  getDisplayText(): string { return this.file?.name ?? "JSON"; }
  canAcceptExtension(extension: string): boolean { return extension.toLowerCase() === "json"; }

  protected async onOpen(): Promise<void> {
    this.registerEvent(this.app.vault.on("modify", file => {
      if (this.file !== file) return;
      void this.enqueue(async () => {
        const current = this.current;
        if (current?.file === file) await this.refresh(current);
      }).catch(reportError);
    }));
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    const operation = this.pending.then(action);
    this.pending = operation.catch(() => {});
    return operation;
  }

  private state(format: JsonDocument): EditorState {
    return EditorState.create({
      doc: format.display,
      extensions: [
        json(), syntaxHighlighting(highlighting), lineNumbers(), history(),
        keymap.of([{ key: "Mod-s", run: () => { this.requestSave(); return true; } }, ...historyKeymap, ...defaultKeymap]),
        EditorView.lineWrapping, indentUnit.of(format.indent),
        EditorView.contentAttributes.of({ "aria-label": "JSON editor", spellcheck: "false" }),
        EditorView.updateListener.of(update => {
          const current = this.current;
          if (current?.refreshNeeded && update.docChanged && update.state.doc.eq(current.saved)) {
            void this.enqueue(() => this.refresh(current)).catch(reportError);
          }
        }),
      ],
    });
  }

  async onLoadFile(file: TFile): Promise<void> {
    const generation = ++this.loadGeneration;
    await this.enqueue(async () => {
      const source = await this.app.vault.read(file);
      if (generation !== this.loadGeneration) return;
      const format = new JsonDocument(source);
      const state = this.state(format);
      const editor = new EditorView({ state, parent: this.contentEl });
      this.current = { file, source, format, editor, saved: state.doc, refreshNeeded: false };
    });
  }

  private async refresh(current: OpenJson): Promise<void> {
    if (this.current !== current) return;
    current.refreshNeeded = true;
    if (!current.editor.state.doc.eq(current.saved)) return;
    const source = await this.app.vault.read(current.file);
    if (this.current !== current || !current.editor.state.doc.eq(current.saved)) return;
    current.refreshNeeded = false;
    if (source === current.source) return;
    const format = new JsonDocument(source);
    const state = this.state(format);
    current.editor.setState(state);
    Object.assign(current, { source, format, saved: state.doc });
  }

  private requestSave(): void {
    const current = this.current;
    if (current) void this.enqueue(() => this.saveDocument(current)).catch(reportError);
  }

  private async saveDocument(current: OpenJson): Promise<void> {
    const doc = current.editor.state.doc;
    if (doc.eq(current.saved)) return;
    const next = current.format.serialize(doc.toString());
    if (next !== current.source) {
      await this.app.vault.process(current.file, disk => {
        if (disk !== current.source) throw new Error("The JSON file changed on disk. Copy your edits or close the tab to save a recovery copy.");
        return next;
      });
    }
    current.source = next;
    current.saved = doc;
  }

  async onUnloadFile(file: TFile): Promise<void> {
    this.loadGeneration++;
    const current = this.current;
    if (!current || file !== current.file) return;
    current.editor.dom.inert = true;
    try {
      await this.enqueue(() => this.saveDocument(current));
    } catch (error) {
      const text = current.format.serialize(current.editor.state.doc.toString());
      try {
        const path = file.path.slice(0, -file.name.length) + file.basename + " (recovered " + crypto.randomUUID() + ").json";
        await this.app.vault.create(path, text);
        new Notice(`Could not save ${file.path}. Your edits were saved to ${path}.`);
        console.warn("JSON saved to a recovery copy", error);
      } catch (recoveryError) {
        // Obsidian may already have detached the closing view. Keep the text
        // available even when the source's entire folder has disappeared.
        const modal = new Modal(this.app);
        modal.titleEl.setText("Recover JSON edits");
        modal.contentEl.createEl("p", { text: `Could not save a recovery copy for ${file.path}. Copy your edits before closing this dialog.` });
        const field = modal.contentEl.createEl("textarea", { attr: { "aria-label": "Unsaved JSON", rows: "12", readonly: "" } });
        field.value = text;
        modal.open();
        field.select();
        console.error("JSON recovery copy failed", error, recoveryError);
      }
    }
    current.editor.destroy();
    if (this.current === current) this.current = null;
  }
}

function reportError(error: unknown): void {
  new Notice(error instanceof Error ? error.message : String(error));
}

export function registerJsonView(plugin: Plugin): void {
  const type = plugin.manifest.id + "-json";
  plugin.registerView(type, leaf => new JsonFileView(leaf, type));
  registerJsonExtension(plugin, type);
}

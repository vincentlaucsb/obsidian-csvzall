import { Modal, Notice, Setting, type App } from "obsidian";
import { createChartForm, mountChartForm } from "../charts/chart-form.mjs";
import type { SavedChart, ChartDefinitions } from "../charts/ChartDefinitions.js";
import type { MarkdownTableService } from "../markdown/MarkdownTableService.js";
import type { CsvzallProcessService } from "../process/CsvzallProcessService.js";
import type { ExportEntry, FileExports } from "./ExportSettingsService.js";
import { addExportActions } from "./exportActions.js";

function exportDetails(entry: ExportEntry) {
  return entry.kind === "chart" ? { id: entry.chart.definition.id, path: entry.chart.configPath,
    source: entry.chart.source, type: entry.chart.definition.type } :
    { id: entry.table.recipe.id, path: entry.table.configPath, source: entry.table.recipe.source, type: entry.table.recipe.format ?? "table" };
}

export class ChartOptionsModal extends Modal {
  private form: ReturnType<typeof mountChartForm> | null = null;
  private closed = false;

  constructor(app: App, private readonly chart: SavedChart, private readonly definitions: ChartDefinitions,
    private readonly tables: MarkdownTableService, private readonly process: CsvzallProcessService,
    private readonly vaultRoot: string, private readonly onSaved: () => void) { super(app); }

  onOpen(): void {
    this.titleEl.setText("Chart options");
    this.modalEl.addClass("csvzall-chart-options-modal");
    this.contentEl.createEl("p", { text: this.chart.source });
    void this.load().catch((error: unknown) => {
      if (!this.closed) this.contentEl.createEl("p", { text: error instanceof Error ? error.message : String(error) });
    });
  }

  private async load(): Promise<void> {
    const columns = await this.tables.loadColumns(this.chart.source);
    if (this.closed) return;
    const root = this.contentEl.createDiv();
    createChartForm(root);
    root.querySelector('button[type="submit"]')?.classList.add("mod-cta");
    this.form = mountChartForm(root, {
      schema: { file: this.chart.source, columns }, existingOnly: true,
      previewTable: value => this.tables.render({ ...value, source: this.chart.source, format: "table" }, 20),
      fetchJson: async () => ({ charts: [this.chart.definition] }),
      postJson: async (path, body) => {
        if (this.closed) throw new Error("Chart options closed.");
        if (path === "/api/chart-config/heatmap" && "type" in body) {
          await this.definitions.update(this.chart, body, async temporary => {
            await this.process.captureCommand(["charts", "run", this.chart.definition.id, "--validate", "--config", temporary], this.vaultRoot);
            if (this.closed) throw new Error("Chart update cancelled.");
          });
          this.chart.definition = (await this.definitions.list([this.chart.configPath]))
            .find(entry => entry.definition.id === this.chart.definition.id)!.definition;
          this.onSaved();
        }
        await this.process.runCommand(["charts", "run", this.chart.definition.id, "--config", this.chart.configPath], this.vaultRoot, "chart");
        return { id: this.chart.definition.id, generated: true };
      },
      close: () => this.close(),
      status: message => { new Notice(message); },
    });
    await this.form.open();
  }

  onClose(): void { this.closed = true; this.form?.dispose(); this.contentEl.empty(); }
}

export class ChooseExportModal extends Modal {
  constructor(app: App, private readonly file: FileExports, private readonly configure: (entry: ExportEntry) => void,
    private readonly deleteExport: (entry: ExportEntry) => Promise<void>) { super(app); }
  onOpen(): void {
    this.titleEl.setText("Export options");
    this.contentEl.createEl("p", { text: this.file.source });
    for (const entry of this.file.entries) {
      const details = exportDetails(entry);
      addExportActions(new Setting(this.contentEl).setName(details.id).setDesc(`${details.type} · ${details.path}`), {
        configure: () => { this.close(); this.configure(entry); },
        remove: () => {
          new DeleteExportModal(this.app, entry, async () => {
            await this.deleteExport(entry);
            this.close();
          }).open();
        },
      });
    }
  }
  onClose(): void { this.contentEl.empty(); }
}

class DeleteConfigurationModal extends Modal {
  private pending = false;
  constructor(app: App, private readonly title: string, private readonly description: string,
    private readonly remove: () => Promise<void>) { super(app); }
  onOpen(): void {
    this.titleEl.setText(this.title);
    this.contentEl.createEl("p", { text: this.description });
    const actions = new Setting(this.contentEl);
    actions.addButton(button => button.setButtonText("Cancel").onClick(() => { if (!this.pending) this.close(); }));
    actions.addButton(button => button.setButtonText("Delete").setWarning().onClick(async () => {
      if (this.pending) return;
      this.pending = true; button.setDisabled(true);
      try { await this.remove(); this.close(); }
      catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
      finally { this.pending = false; button.setDisabled(false); }
    }));
  }
  onClose(): void { this.contentEl.empty(); }
}

export class DeleteExportModal extends DeleteConfigurationModal {
  constructor(app: App, entry: ExportEntry, remove: () => Promise<void>) {
    const details = exportDetails(entry);
    super(app, "Delete export configuration?",
      `Remove export "${details.id}" for ${details.source} from ${details.path}? The CSV and generated content will be kept.${entry.kind === "table" ? " Linked note exports will become ordinary Markdown." : ""}`, remove);
  }
}

export class DeleteExportsModal extends DeleteConfigurationModal {
  constructor(app: App, file: FileExports, remove: () => Promise<void>) {
    super(app, "Delete export configurations?",
      `Remove all ${file.entries.length} export configurations for ${file.source}? The CSV and generated content will be kept. Linked note exports will become ordinary Markdown.`, remove);
  }
}

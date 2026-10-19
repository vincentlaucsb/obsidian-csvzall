import { ItemView, Setting, type App, type WorkspaceLeaf } from "obsidian";
import { loadExports, renderExportRows, type ExportListService } from "../settings/exportList.js";
import { exportSummaryText } from "../settings/exportSummary.js";
import { VIEW_TYPE_CSVZALL_EXPORTS } from "./viewTypes.js";

/**
 * Lists saved chart and note exports. Configurations live in `.csvzall/` dot
 * folders, which do not raise vault events, so the list refreshes after its own
 * actions, whenever this tab becomes active, from its Refresh button, and after automatic pruning.
 */
export class CsvzallExportsView extends ItemView {
  private revision = 0;

  constructor(leaf: WorkspaceLeaf, private readonly exports: ExportListService) { super(leaf); }

  getViewType(): string { return VIEW_TYPE_CSVZALL_EXPORTS; }
  getDisplayText(): string { return "csvzall exports"; }
  getIcon(): string { return "list"; }

  async onOpen(): Promise<void> {
    if (this.exports.onChanged) this.register(this.exports.onChanged(() => this.refresh()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", leaf => { if (leaf === this.leaf) this.refresh(); }));
    this.refresh();
  }

  async onClose(): Promise<void> {
    this.revision++;
    this.contentEl.empty();
  }

  refresh(): void {
    const revision = ++this.revision;
    const isCurrent = () => this.revision === revision;
    const root = this.contentEl;
    root.empty();
    root.addClass("csvzall-exports-view");
    const header = new Setting(root).setName("Exports").setHeading()
      .addButton(button => button.setButtonText("Refresh").onClick(() => this.refresh()));
    const list = root.createDiv({ cls: "csvzall-settings-exports" });
    loadExports(list, this.exports, isCurrent, files => {
      header.setDesc(`${exportSummaryText(files)} Includes paused exports.`);
      renderExportRows(list, files, this.exports, () => { if (isCurrent()) this.refresh(); });
    }, () => this.refresh());
  }
}

/** Reveal the exports tab, reusing an open one. */
export async function openExportsView(app: App): Promise<void> {
  const existing = app.workspace.getLeavesOfType(VIEW_TYPE_CSVZALL_EXPORTS)[0];
  const leaf = existing ?? app.workspace.getLeaf("tab");
  if (!existing) await leaf.setViewState({ type: VIEW_TYPE_CSVZALL_EXPORTS, active: true });
  await app.workspace.revealLeaf(leaf);
  app.workspace.setActiveLeaf(leaf, { focus: true });
  if (existing && leaf.view instanceof CsvzallExportsView) leaf.view.refresh();
}

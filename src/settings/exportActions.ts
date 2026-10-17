import type { Setting } from "obsidian";

/** Use the same actions for CSV groups, charts, SQL tables and inline values. */
export function addExportActions(row: Setting, actions: {
  configure(): void;
  remove(): void;
  configureDisabled?: boolean;
}): Setting {
  return row
    .addButton(button => button.setButtonText("Configure").setDisabled(actions.configureDisabled ?? false).onClick(actions.configure))
    .addButton(button => button.setButtonText("Delete").setWarning().onClick(actions.remove));
}

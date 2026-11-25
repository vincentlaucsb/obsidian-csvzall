// Runtime source mirrored from csvzall/src/viewer/modules/editor-toolbar.mjs.
export function createEditorToolbar(doc: Document, decorate: (
  button: HTMLButtonElement, icon: "restore" | "device-floppy", label: string,
) => void, filenameTag?: "h1" | "span"): {
  header: HTMLElement; meta: HTMLDivElement; filename: HTMLElement;
  actions: HTMLDivElement; edits: HTMLDivElement; reset: HTMLButtonElement; save: HTMLButtonElement;
};

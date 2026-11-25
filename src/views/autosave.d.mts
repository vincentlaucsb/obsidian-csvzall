// Runtime source mirrored from csvzall/src/viewer/modules/autosave.mjs.
interface Control {
  control: HTMLLabelElement;
  input: HTMLInputElement;
  value: HTMLSpanElement;
}
interface Policy {
  enabled: boolean;
  visible: boolean;
}
export function createAutosaveControl(doc: Document): Control;
export function createAutosave(control: Control, options: {
  win: Window;
  canSave(): boolean;
  save(): Promise<void>;
}): {
  readonly enabled: boolean;
  setPolicy(policy: Policy): void;
  schedule(): void;
  cancel(): void;
  edited(): void;
  failed(): void;
  dispose(): void;
};

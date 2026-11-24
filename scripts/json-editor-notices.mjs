import { readFileSync } from "node:fs";

// Obsidian supplies the CodeMirror core. Both plugins bundle the JSON language
// and its generated Lezer grammar, which each carry their own MIT notice.
export const jsonEditorNotices = ["@codemirror/lang-json", "@lezer/json"].map(name => {
  const license = new URL(`../node_modules/${name}/LICENSE`, import.meta.url);
  return `${name}\n${readFileSync(license, "utf8").trim()}`;
}).join("\n\n");

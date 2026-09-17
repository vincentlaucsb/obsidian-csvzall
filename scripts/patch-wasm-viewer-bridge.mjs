// Packaging only: runtime behavior belongs in csvzall source, never minified patches.
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireHostIntegration } from "./wasm-viewer-contract.mjs";

const viewerDir = "wasm-viewer";
const assetsDir = join(viewerDir, "assets");
const indexPath = join(viewerDir, "index.html");
const bundleName = readdirSync(assetsDir).find(name => /^index-.*\.js$/.test(name));
const stylesheetName = readdirSync(assetsDir).find(name => /^index-.*\.css$/.test(name));
if (!bundleName) throw new Error("Missing WASM viewer JavaScript bundle");
const bundlePath = join(assetsDir, bundleName);
const stylesheetPath = stylesheetName ? join(assetsDir, stylesheetName) : null;
requireHostIntegration(readFileSync(bundlePath, "utf8"));
writeFileSync(indexPath, readFileSync(indexPath, "utf8").replace(/\r\n?/g, "\n"));
const compactStyleId = "csvzall-obsidian-host-compact-v1";
const compactStyle = `
.csvzall-obsidian-host .topbar,
body[data-host-mode] .topbar {
  align-items: stretch;
  gap: .35rem;
  padding: .35rem .5rem;
}
.csvzall-obsidian-host .topbar h1,
body[data-host-mode] .topbar h1 {
  display: none;
}
.csvzall-obsidian-host .topbar p,
body[data-host-mode] .topbar p {
  display: none;
  margin: 0;
  overflow: hidden;
  font-size: .78rem;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csvzall-obsidian-host .actions,
body[data-host-mode] .actions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: .35rem;
}
.csvzall-obsidian-host button,
.csvzall-obsidian-host .file-picker span,
body[data-host-mode] button,
body[data-host-mode] .file-picker span {
  min-height: 32px;
  padding: .3rem .45rem;
  font-size: .8rem;
}
.csvzall-obsidian-host footer,
body[data-host-mode] footer {
  min-height: 1rem;
  padding: .2rem .5rem;
  font-size: .75rem;
}
html.csvzall-obsidian-host,
html.csvzall-obsidian-host body {
  height: 100%;
  min-height: 100%;
  overflow: hidden;
}
body[data-host-mode] {
  height: 100vh;
  min-height: 100vh;
  overflow: hidden;
}
body[data-host-mode] main {
  min-height: 0;
}
body[data-host-mode] #grid {
  height: 100%;
}
`.replace(/\s+/g, " ").trim();
const inlineStyleAttr = "data-csvzall-inline-viewer-style";

function readPackagedStylesheet() {
  if (stylesheetPath) {
    return readFileSync(stylesheetPath, "utf8");
  }
  const html = readFileSync(indexPath, "utf8");
  const match = html.match(new RegExp(`<style ${inlineStyleAttr}>\\n?([\\s\\S]*?)\\n?</style>`));
  if (match?.[1]) {
    return match[1];
  }
  throw new Error("WASM viewer bridge patch failed: missing index stylesheet bundle");
}

function writeInlineStylesheet(css) {
  let html = readFileSync(indexPath, "utf8");
  const inlineStyle = `<style ${inlineStyleAttr}>\n${css}\n</style>`;
  if (stylesheetName) {
    const linkPattern = new RegExp(`\\n?\\s*<link[^>]+href=["']\\./assets/${stylesheetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`);
    html = html.replace(linkPattern, `\n  ${inlineStyle}`);
  } else if (html.includes(`<style ${inlineStyleAttr}>`)) {
    html = html.replace(new RegExp(`<style ${inlineStyleAttr}>[\\s\\S]*?</style>`), inlineStyle);
  } else {
    html = html.replace("</head>", `  ${inlineStyle}\n</head>`);
  }
  writeFileSync(indexPath, html);
  if (stylesheetPath) {
    rmSync(stylesheetPath, { force: true });
  }
}

function patchCompactStylesheet() {
  let css = readPackagedStylesheet();
  if (css.includes(compactStyleId)) {
    css = css.replace(/\/\* csvzall-obsidian-host-compact-v1 \*\/[\s\S]*$/u, `/* ${compactStyleId} */\n${compactStyle}\n`);
    writeInlineStylesheet(css);
    return true;
  }
  css = `${css}\n/* ${compactStyleId} */\n${compactStyle}\n`;
  writeInlineStylesheet(css);
  return true;
}


patchCompactStylesheet();
console.log("Prepared WASM viewer styles; compiled JavaScript left unchanged.");

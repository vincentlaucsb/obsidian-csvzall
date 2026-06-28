import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const viewerDir = "wasm-viewer";
const indexPath = join(viewerDir, "index.html");
const assetsDir = join(viewerDir, "assets");
const metadataPath = join(viewerDir, "csvzall-wasm-viewer.json");

function fail(message) {
  throw new Error(`WASM viewer asset check failed: ${message}`);
}

function requireFile(path) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    fail(`missing file: ${path}`);
  }
}

function requireDirectory(path) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    fail(`missing directory: ${path}`);
  }
}

requireFile(indexPath);
requireDirectory(assetsDir);
requireFile(metadataPath);

const assets = readdirSync(assetsDir);
const hasJavaScript = assets.some((name) => name.endsWith(".js"));
const hasStylesheet = assets.some((name) => name.endsWith(".css"));
const wasmAssets = assets.filter((name) => name.endsWith(".wasm"));

if (!hasJavaScript) {
  fail("assets directory does not contain a JavaScript bundle");
}
if (!hasStylesheet) {
  fail("assets directory does not contain a stylesheet bundle");
}
if (wasmAssets.length !== 1) {
  fail(`expected exactly one .wasm file, found ${wasmAssets.length}`);
}

const indexHtml = readFileSync(indexPath, "utf8");
if (!indexHtml.includes("./assets/")) {
  fail("index.html does not reference relative ./assets/ paths");
}
if (/(?:src|href)=["']https?:\/\//i.test(indexHtml)) {
  fail("index.html should not depend on remote src/href runtime assets");
}

const assetReferences = Array.from(indexHtml.matchAll(/(?:src|href)=["']\.\/assets\/([^"']+)["']/gi))
  .map((match) => match[1])
  .filter(Boolean);
if (assetReferences.length === 0) {
  fail("index.html does not reference any concrete ./assets/ files");
}
for (const assetReference of assetReferences) {
  if (!assets.includes(assetReference)) {
    fail(`index.html references missing asset: ${assetReference}`);
  }
}

const indexBundleName = assets.find((name) => /^index-.*\.js$/.test(name));
if (!indexBundleName) {
  fail("assets directory does not contain an index JavaScript bundle");
}
const stylesheetBundleName = assets.find((name) => /^index-.*\.css$/.test(name));
if (!stylesheetBundleName) {
  fail("assets directory does not contain an index stylesheet bundle");
}

const indexBundle = readFileSync(join(assetsDir, indexBundleName), "utf8");
for (const marker of ["obsidian-csvzall", "csvzall-wasm-viewer", "open-file", "save-file"]) {
  if (!indexBundle.includes(marker)) {
    fail(`index bundle is missing Obsidian bridge marker: ${marker}`);
  }
}
const stylesheetBundle = readFileSync(join(assetsDir, stylesheetBundleName), "utf8");
if (!indexBundle.includes("csvzall-obsidian-host-compact-v1") && !stylesheetBundle.includes("csvzall-obsidian-host-compact-v1")) {
  fail("packaged viewer is missing compact Obsidian host styles");
}
if (!stylesheetBundle.includes("body[data-host-mode] .topbar p") || !stylesheetBundle.includes("display: none")) {
  fail("packaged viewer should hide the standalone status line in Obsidian host mode");
}
if (!indexBundle.includes("checkboxes:!1") || !indexBundle.includes("headerCheckbox:!1")) {
  fail("packaged viewer should disable AG Grid selection checkboxes");
}
if (!indexBundle.includes("csvzall-obsidian-mobile-behavior-v1") || !indexBundle.includes("visualViewport")) {
  fail("packaged viewer is missing Android keyboard viewport handling");
}
if (!indexBundle.includes("csvzall-obsidian-viewport-resize-v2") || !indexBundle.includes("viewport-resized")) {
  fail("packaged viewer is missing parent viewport resize handling");
}
if (indexBundle.includes("csvzall-obsidian-keyboard-focus-v1") || indexBundle.includes("csvzallSetKeyboardOpen")) {
  fail("packaged viewer should not use focus-driven keyboard layout handling");
}
if (indexBundle.includes("csvzall-obsidian-keyboard-lifecycle-v1") || indexBundle.includes("csvzallApplyKeyboardOpen")) {
  fail("packaged viewer should not use the legacy keyboard layout toggle");
}
if (!indexBundle.includes("csvzall-obsidian-keyboard-lifecycle-v2") || !indexBundle.includes("onCellEditingStarted")) {
  fail("packaged viewer is missing AG Grid edit lifecycle keyboard handling");
}
if (stylesheetBundle.includes("body[data-host-mode][data-keyboard-open]")) {
  fail("packaged viewer should not reflow host layout while AG Grid is editing");
}
if (!stylesheetBundle.includes("body[data-host-mode] { height: 100vh; min-height: 100vh")) {
  fail("packaged viewer should give the hosted grid a concrete iframe-local height");
}

const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
for (const field of ["sourceRepo", "sourceCommit", "sourcePath", "syncedAt"]) {
  if (typeof metadata[field] !== "string" || metadata[field].length === 0) {
    fail(`metadata is missing ${field}`);
  }
}

console.log(`WASM viewer assets OK (${wasmAssets[0]}).`);

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const distDir = ".mobile-dist";
const requiredFiles = [
  "AGENTS.md",
  "LICENSE",
  "README.md",
  "main.js",
  "manifest.json",
  "styles.css",
  "versions.json",
  ".github/workflows/release.yml",
  ".github/workflows/validate.yml",
];

function fail(message) {
  throw new Error(`Mobile distribution check failed: ${message}`);
}

for (const file of requiredFiles) {
  const path = join(distDir, file);
  if (!existsSync(path) || !statSync(path).isFile()) {
    fail(`missing ${file}`);
  }
}

const manifest = JSON.parse(readFileSync(join(distDir, "manifest.json"), "utf8"));
const sourceManifest = JSON.parse(readFileSync("mobile-src/manifest.json", "utf8"));
const versions = JSON.parse(readFileSync(join(distDir, "versions.json"), "utf8"));
const main = readFileSync(join(distDir, "main.js"), "utf8");
const releaseWorkflow = readFileSync(join(distDir, ".github/workflows/release.yml"), "utf8");

if (manifest.id !== "csvzall-mobile") {
  fail(`unexpected manifest id: ${manifest.id}`);
}
if (manifest.name !== "csvzall Mobile") {
  fail(`unexpected manifest name: ${manifest.name}`);
}
if (manifest.version !== sourceManifest.version) {
  fail(`manifest version ${manifest.version} does not match mobile source version ${sourceManifest.version}`);
}
if (manifest.isDesktopOnly !== false) {
  fail("manifest must set isDesktopOnly=false");
}
if (versions[manifest.version] !== manifest.minAppVersion) {
  fail(`versions.json is missing ${manifest.version}`);
}

const bannedPatterns = [
  /require\(["'](?:node:)?(?:child_process|crypto|electron|fs|fs\/promises|http|https|os|path|zlib)["']\)/,
  /\bchild_process\b/,
  /\bfs\/promises\b/,
  /\bnode:/,
  /csvzall-plugin\.zip/,
];
for (const pattern of bannedPatterns) {
  if (pattern.test(main)) {
    fail(`main.js contains a desktop-only or desktop-release marker: ${pattern}`);
  }
}

for (const marker of [
  "csvzall-mobile-embedded-wasm-viewer-v1",
  "csvzall-wasm-viewer",
  "wasm-viewer/index.html",
  "csvzall-mobile-view",
  "isMobileApp",
]) {
  if (!main.includes(marker)) {
    fail(`main.js is missing marker: ${marker}`);
  }
}

if (!releaseWorkflow.includes("assets=(manifest.json main.js styles.css)")) {
  fail("release workflow must publish only the standard Obsidian assets");
}
if (/assets=\([^)]*(wasm-viewer|csvzall-plugin\.zip)/.test(releaseWorkflow)) {
  fail("release workflow should not publish extra WASM files; they are embedded in main.js");
}

console.log(`csvzall Mobile distribution OK (${manifest.version}).`);

import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// An explicit allowlist prevents local state or private notes entering builds.
export const mobileDemoFiles = [
  ".gitignore", "Start here.md", "Productivity Tracker.csv", "Tasks.csv",
  "CSV edge cases.csv", "Projects/Project tasks.csv",
];

// Check every ancestor so copying never follows a vault or plugin junction.
export function assertOrdinaryPath(path, directory = false) {
  const parent = dirname(path);
  if (parent !== path) assertOrdinaryPath(parent, true);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat && (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()))) {
    throw new Error(`Refusing to follow or replace a non-ordinary path: ${path}`);
  }
}

const ordinaryPath = assertOrdinaryPath;

export function setupMobileDemoVault({ dist, template, vault }) {
  dist = resolve(dist);
  template = resolve(template);
  vault = resolve(vault);
  if (vault === parse(vault).root) throw new Error("The demo vault cannot be a filesystem root.");
  ordinaryPath(vault, true);
  const plugin = join(vault, ".obsidian", "plugins", "csvzall-mobile");
  ordinaryPath(plugin, true);
  const artifacts = ["main.js", "manifest.json", "styles.css"];
  for (const file of artifacts) {
    ordinaryPath(join(dist, file));
    if (!existsSync(join(dist, file))) throw new Error(`Missing mobile build: ${file}; run npm run build:mobile.`);
    ordinaryPath(join(plugin, file));
  }
  const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
  if (manifest.id !== "csvzall-mobile" || manifest.isDesktopOnly !== false) {
    throw new Error("Expected a mobile distribution, not a desktop plugin build.");
  }
  const enabledPath = join(vault, ".obsidian", "community-plugins.json");
  const appPath = join(vault, ".obsidian", "app.json");
  for (const path of [enabledPath, appPath, join(plugin, "data.json")]) ordinaryPath(path);
  const enabled = existsSync(enabledPath) ? JSON.parse(readFileSync(enabledPath, "utf8")) : [];
  if (!Array.isArray(enabled) || !enabled.every(id => typeof id === "string")) {
    throw new Error("community-plugins.json must contain an array of plugin IDs.");
  }
  const app = existsSync(appPath) ? JSON.parse(readFileSync(appPath, "utf8")) : {};
  if (!app || Array.isArray(app) || typeof app !== "object") {
    throw new Error("app.json must contain an object.");
  }
  // Collect and validate all fixture destinations before changing anything.
  const fixtures = mobileDemoFiles.map(file => {
    const from = join(template, file), to = join(vault, file);
    ordinaryPath(from);
    if (!existsSync(from)) throw new Error(`Missing demo fixture: ${from}`);
    ordinaryPath(to);
    return [from, to];
  });
  mkdirSync(plugin, { recursive: true });
  for (const [from, to] of fixtures) {
    if (existsSync(to)) continue; // Keep edits, extra fixtures, and device state.
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
  for (const file of artifacts) copyFileSync(join(dist, file), join(plugin, file));
  if (!enabled.includes(manifest.id)) {
    writeFileSync(enabledPath, JSON.stringify([...enabled, manifest.id], null, 2) + "\n");
  }
  // CSVs must remain discoverable before the mobile handler loads (and on desktop).
  // Keep an explicit user choice and all other vault preferences on refresh.
  if (app.showUnsupportedFiles === undefined) {
    writeFileSync(appPath, JSON.stringify({ ...app, showUnsupportedFiles: true }, null, 2) + "\n");
  }
  console.log(`Mobile demo vault ready: ${vault} (csvzall Lite ${manifest.version}).`);
  console.log("Open this vault in desktop Obsidian, enable csvzall Lite, and open Start here.md. For device testing, copy the entire vault including .obsidian.");
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const root = resolve(dirname(scriptPath), "..");
  const sourceCheckout = existsSync(join(root, "scripts", "build-mobile.mjs"));
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--vault")) {
    throw new Error("Usage: node scripts/setup-mobile-demo-vault.mjs [--vault <directory>]");
  }
  setupMobileDemoVault({
    dist: sourceCheckout ? join(root, ".mobile-dist") : root,
    template: join(root, sourceCheckout ? "mobile-demo-vault" : "demo-vault"),
    vault: args.length ? args[1] : sourceCheckout
      ? resolve(root, "..", "obsidian-csvzall-mobile", "demo-vault") : join(root, "demo-vault"),
  });
}

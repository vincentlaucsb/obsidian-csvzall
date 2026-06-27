import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const defaultSource = resolve(repoRoot, "..", "csvzall", "src", "viewer_wasm", "web", "dist");
const outputDir = resolve(repoRoot, "wasm-viewer");

function optionValue(name) {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((candidate) => candidate.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function runGit(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function fail(message) {
  throw new Error(`WASM viewer sync failed: ${message}`);
}

function requireFile(path) {
  if (!existsSync(path)) {
    fail(`missing required file: ${path}`);
  }
}

const sourceArg = optionValue("--source");
const sourceDir = sourceArg ? resolve(repoRoot, sourceArg) : defaultSource;
const sourceRepoRoot = resolve(sourceDir, "..", "..", "..", "..");

if (!isAbsolute(sourceDir)) {
  fail("source directory must resolve to an absolute path");
}
if (!existsSync(sourceDir)) {
  fail(`source dist directory does not exist: ${sourceDir}`);
}

requireFile(resolve(sourceDir, "index.html"));
requireFile(resolve(sourceDir, "assets"));

if (!outputDir.startsWith(repoRoot) || basename(outputDir) !== "wasm-viewer") {
  fail(`refusing to replace unexpected output directory: ${outputDir}`);
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
cpSync(sourceDir, outputDir, {
  recursive: true,
  force: true,
  errorOnExist: false,
});

const metadata = {
  sourceRepo: "vincentlaucsb/csvzall",
  sourceCommit: runGit(["rev-parse", "HEAD"], sourceRepoRoot) || "unknown",
  sourceRef: runGit(["rev-parse", "--abbrev-ref", "HEAD"], sourceRepoRoot) || "unknown",
  sourcePath: "src/viewer_wasm/web/dist",
  sourceDist: sourceDir,
  syncedAt: new Date().toISOString(),
};

writeFileSync(
  resolve(outputDir, "csvzall-wasm-viewer.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
);

const indexHtml = readFileSync(resolve(outputDir, "index.html"), "utf8");
if (!indexHtml.includes("./assets/")) {
  fail("synced index.html does not reference relative ./assets/ paths");
}

console.log(`Synced WASM viewer assets from ${sourceDir}`);

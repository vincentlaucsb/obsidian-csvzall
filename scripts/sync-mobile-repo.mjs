import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const distDir = resolve(repoRoot, ".mobile-dist");
const defaultTarget = resolve(repoRoot, "..", "obsidian-csvzall-mobile");

function optionValue(name) {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((candidate) => candidate.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function fail(message) {
  throw new Error(`Mobile repo sync failed: ${message}`);
}

function runNodeScript(scriptName) {
  execFileSync(process.execPath, [resolve(scriptDir, scriptName)], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

function emptyTargetExceptGit(targetDir) {
  for (const entry of readdirSync(targetDir)) {
    if (entry === ".git") {
      continue;
    }
    rmSync(resolve(targetDir, entry), { recursive: true, force: true });
  }
}

const targetDir = resolve(repoRoot, optionValue("--target") ?? defaultTarget);
if (basename(targetDir) !== "obsidian-csvzall-mobile") {
  fail(`refusing to sync to unexpected directory: ${targetDir}`);
}

runNodeScript("build-mobile.mjs");
runNodeScript("check-mobile-dist.mjs");

mkdirSync(targetDir, { recursive: true });
if (!statSync(targetDir).isDirectory()) {
  fail(`target is not a directory: ${targetDir}`);
}

emptyTargetExceptGit(targetDir);
cpSync(distDir, targetDir, {
  recursive: true,
  force: true,
  errorOnExist: false,
});

if (!existsSync(resolve(targetDir, ".git"))) {
  execFileSync("git", ["init", "-b", "main"], {
    cwd: targetDir,
    stdio: "inherit",
  });
}

console.log(`Synced csvzall Mobile distribution to ${targetDir}.`);

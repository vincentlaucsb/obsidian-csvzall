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
import { assertOrdinaryPath, setupMobileDemoVault } from "./setup-mobile-demo-vault.mjs";

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

function clearGeneratedTargets(targetDir) {
  // Replace only generated paths; retain unrelated local files and vault state.
  const entries = readdirSync(distDir).filter(entry => entry !== "demo-vault");
  assertOrdinaryPath(targetDir, true);
  assertOrdinaryPath(resolve(targetDir, "demo-vault"), true);
  for (const entry of entries) {
    const target = resolve(targetDir, entry);
    if (dirname(target) !== targetDir) fail(`target escapes the checkout: ${target}`);
    assertOrdinaryPath(target, statSync(resolve(distDir, entry)).isDirectory());
  }
  for (const entry of entries) rmSync(resolve(targetDir, entry), { recursive: true, force: true });
}

const targetDir = resolve(repoRoot, optionValue("--target") ?? defaultTarget);
if (basename(targetDir) !== "obsidian-csvzall-mobile") {
  fail(`refusing to sync to unexpected directory: ${targetDir}`);
}

runNodeScript("build-mobile.mjs");
runNodeScript("check-mobile-dist.mjs");

assertOrdinaryPath(targetDir, true);
mkdirSync(targetDir, { recursive: true });
if (!statSync(targetDir).isDirectory()) {
  fail(`target is not a directory: ${targetDir}`);
}

clearGeneratedTargets(targetDir);
cpSync(distDir, targetDir, {
  recursive: true,
  force: true,
  errorOnExist: false,
  // The setup helper seeds missing fixtures without overwriting test edits.
  filter: source => source !== resolve(distDir, "demo-vault"),
});
setupMobileDemoVault({
  dist: targetDir,
  template: resolve(distDir, "demo-vault"),
  vault: resolve(targetDir, "demo-vault"),
});

if (!existsSync(resolve(targetDir, ".git"))) {
  execFileSync("git", ["init", "-b", "main"], {
    cwd: targetDir,
    stdio: "inherit",
  });
}

console.log(`Synced csvzall Lite distribution to ${targetDir}.`);

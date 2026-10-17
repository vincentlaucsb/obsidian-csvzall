import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveFileInfo } from "./check-line-endings.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const parent = resolve(root, ".test-build");
mkdirSync(parent, { recursive: true });
const archive = mkdtempSync(resolve(parent, "source-archive-"));
try {
  // Git also knows about tracked-but-ignored files and local/global excludes.
  // Those machine-local exclusions must not leak scratch files into this copy.
  const files = existsSync(resolve(root, ".git")) ? execFileSync("git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).split("\0").filter(Boolean) : archiveFileInfo(root).files;
  for (const file of new Set(files)) {
    const stat = lstatSync(resolve(root, file), { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink()) continue;
    const destination = resolve(archive, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(resolve(root, file), destination);
  }
  if (!process.env.npm_execpath) throw new Error("Run this check with npm run check:source-archive.");
  for (const args of [["ci", "--no-audit", "--no-fund"], ["run", "build"]]) {
    execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: archive, stdio: "inherit", windowsHide: true,
    });
  }
  console.log("Source archive build passed after npm ci, without .git or inherited node_modules.");
} finally {
  rmSync(archive, { recursive: true, force: true });
}

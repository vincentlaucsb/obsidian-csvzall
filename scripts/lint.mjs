import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLineEndings } from "./check-line-endings.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..");

export function runTypeSafetyChecks() {
  checkLineEndings();
  for (const [tool, args] of [
    ["typescript/bin/tsc", ["--noEmit", "--skipLibCheck", "-p", "tsconfig.lint.json"]],
    ["eslint/bin/eslint.js", ["src", "mobile-src", "--max-warnings", "0"]],
  ]) {
    execFileSync(process.execPath, [resolve(repoRoot, "node_modules", tool), ...args], {
      cwd: repoRoot,
      stdio: "inherit",
      windowsHide: true,
    });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  runTypeSafetyChecks();
}

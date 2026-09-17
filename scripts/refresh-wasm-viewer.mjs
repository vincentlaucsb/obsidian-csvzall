import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.some(arg => !arg.startsWith("--source-repo=")) || args.length > 1) {
  throw new Error("Usage: npm run refresh:wasm-viewer -- --source-repo=<csvzall checkout>");
}
const source = resolve(root, args[0]?.slice("--source-repo=".length) || "../csvzall");
console.log(`Refreshing WASM viewer from ${source}`);
const web = resolve(source, "src/viewer_wasm/web");
const npmCli = process.env.npm_execpath;
if (!npmCli || !existsSync(npmCli)) throw new Error("Run this workflow through npm run refresh:wasm-viewer.");
for (const file of ["package.json", "node_modules/vite/bin/vite.js"]) {
  if (!existsSync(resolve(web, file))) throw new Error(`Missing ${file} in ${web}; install upstream web dependencies with npm install first.`);
}
for (const file of ["csvzall_viewer_wasm.js", "csvzall_viewer_wasm.wasm"]) {
  if (!existsSync(resolve(source, "out/build/wasm", file))) {
    throw new Error(`Missing upstream WASM core ${file}. Build the core first; see docs/wasm-viewer-refresh.md.`);
  }
}
function run(file, args, cwd = root) {
  execFileSync(process.execPath, [file, ...args], { cwd, stdio: "inherit", windowsHide: true });
}
run(npmCli, ["test"], web);
run(npmCli, ["run", "build"], web);
run(resolve(root, "scripts/sync-wasm-viewer.mjs"), [`--source=${resolve(web, "dist")}`]);
run(resolve(root, "scripts/patch-wasm-viewer-bridge.mjs"), []);
run(resolve(root, "scripts/check-wasm-viewer.mjs"), []);
run(npmCli, ["test"]);
console.log("WASM viewer refreshed and desktop/mobile checks passed. Review generated assets before committing.");

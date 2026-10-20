import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { smokeNativeHelper } from "./build-native-helper.mjs";
import { runTypeSafetyChecks } from "./lint.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [helperArgument, outputArgument, ...extra] = process.argv.slice(2);
if (!helperArgument || extra.length || process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Windows x64 only. Usage: node scripts/build-windows-sync-test.mjs <development csvzall.exe> [new output directory]");
}
const helper = resolve(helperArgument);
const output = resolve(outputArgument || join(root, ".test-build", `windows-sync-test-${Date.now()}`));
if (existsSync(output)) throw new Error("Use a new output directory; existing files are never replaced.");
const binary = readFileSync(helper);
const pe = binary.length >= 64 ? binary.readUInt32LE(0x3c) : -1;
if (binary.toString("ascii", 0, 2) !== "MZ" || pe < 0 || pe + 6 > binary.length ||
    binary.toString("ascii", pe, pe + 4) !== "PE\0\0" || binary.readUInt16LE(pe + 4) !== 0x8664) throw new Error("Expected a Windows x64 executable.");
const version = execFileSync(helper, ["--version"], { encoding: "utf8", windowsHide: true }).trim().match(/\b\d+\.\d+\.\d+\b/)?.[0];
if (version !== "0.8.0") throw new Error("This test bundle requires the preserved 0.8.0 baseline plus the Obsidian-mode patch.");
runTypeSafetyChecks();
mkdirSync(output, { recursive: true });
const work = mkdtempSync(join(output, ".verify-"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
try {
  // Freeze the input before executing or packaging it: a concurrent native
  // rebuild must not change the bytes named by the development identity.
  const frozenHelper = join(work, "csvzall.exe");
  writeFileSync(frozenHelper, binary);
  await smokeNativeHelper(frozenHelper, version, work);
  const archive = join(work, `csvzall-${version}-obsidian-windows-x64.zip`);
  execFileSync(process.env.NATIVE_HELPER_PYTHON || "python", [join(root, "scripts/package-native-helper.py"), "pack", archive, frozenHelper], { windowsHide: true });
  const archiveBytes = readFileSync(archive);
  const asset = { assetName: `csvzall-${version}-obsidian-windows-x64.zip`, sha256: hash(archiveBytes), base64: archiveBytes.toString("base64") };
  const helperPlugin = { name: "windows-sync-test-helper", setup(builder) {
    builder.onResolve({ filter: /bundledBinaries\.generated\.js$/ }, () => ({ path: "windows-sync-test-helper", namespace: "test-helper" }));
    builder.onLoad({ filter: /.*/, namespace: "test-helper" }, () => ({ contents:
      `export const BUNDLED_CSVZALL_VERSION=${JSON.stringify(version)};export const BUNDLED_CSVZALL_ASSETS=${JSON.stringify({ "win32-x64": asset })};`, loader: "js" }));
  } };
  const external = ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules];
  const notices = ["THIRD_PARTY_NOTICES.md", "native-binaries/THIRD_PARTY_NOTICES.md"].map(file => readFileSync(join(root, file), "utf8")).join("\n\n");
  await build({ absWorkingDir: root, entryPoints: ["src/main.ts"], bundle: true, format: "cjs", target: "es2018", minify: true,
    outfile: join(output, "main.js"), external, plugins: [helperPlugin],
    banner: { js: `/* CSVZALL_WINDOWS_SYNC_TEST_BUILD: development only; not a release. */\n/*!\n${notices}\n*/` } });
  if (!readFileSync(join(output, "main.js"), "utf8").includes(asset.base64)) throw new Error("Development bundle does not contain the verified helper.");

  // Exercise the ordinary bundled installer and wired process service, using the
  // exact embedded payload. No custom executable preference participates here.
  const harness = await build({ absWorkingDir: root, stdin: { contents:
    'export {InstallerService} from "./src/installer/InstallerService.ts";export {CsvzallProcessService} from "./src/process/CsvzallProcessService.ts";',
    resolveDir: root }, bundle: true, format: "cjs", platform: "node", write: false, external,
    plugins: [helperPlugin, { name: "test-view", setup(builder) {
      builder.onResolve({ filter: /views\/CsvzallTableView\.js$/ }, () => ({ path: "mock-view", external: true }));
    } }] });
  const module = { exports: {} }, nodeRequire = createRequire(import.meta.url);
  runInNewContext(harness.outputFiles[0].text, { module, exports: module.exports, console, Buffer, URL, process,
    window: { setTimeout, clearTimeout }, require(name) {
      if (name === "obsidian") return { Notice: class {}, Platform: { isDesktopApp: true } };
      if (name === "mock-view") return { CsvzallTableView: class {} };
      return nodeRequire(name);
    } });
  const settings = { csvzallExecutableMode: "bundled", csvzallPath: "", startupTimeoutMs: 30000 };
  const events = { record: async () => {} };
  const installer = new module.exports.InstallerService(() => settings, async () => {}, events, { getPluginDataDir: () => join(work, "plugin") });
  if (!await installer.ensureBundledCsvzall() || settings.csvzallExecutableMode !== "bundled") throw new Error("Default bundled installation failed.");
  const service = new module.exports.CsvzallProcessService(() => settings, events, () => installer.getExecutablePath(), async () => {});
  try {
    const server = await service.startViewer(join(work, "smoke data.csv"));
    const closed = new Promise(resolve => server.process.once("close", resolve));
    service.unload();
    await closed;
  } finally { service.unload(); }

  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  manifest.csvzallDevelopmentBuild = "Windows x64 Sync test; direct-folder configs; not a release";
  writeFileSync(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  copyFileSync(join(root, "styles.css"), join(output, "styles.css"));
  const patchPath = join(root, ".test-build/native-sync-development/obsidian-mode.patch");
  const identity = { kind: "windows-sync-test", platform: "win32-x64", helperVersion: version,
    declaredSourceBaseline: "e5267ae97f465d7b0a2a37bc98baf7eb4a50af3f", sourceIdentityVerified: false,
    declaredSourcePatchSha256: existsSync(patchPath) ? hash(readFileSync(patchPath)) : null,
    archiveSha256: asset.sha256, executableSha256: hash(binary), bundleSha256: hash(readFileSync(join(output, "main.js"))),
    verified: ["host-mode acknowledgment", "CSV save without automatic charts", "explicit chart generation", "bundled installer and process service"] };
  writeFileSync(join(output, "development-identity.json"), JSON.stringify(identity, null, 2) + "\n");
  writeFileSync(join(output, "README.txt"), "Windows x64 development test only; not a release.\n\nCopy main.js, manifest.json and styles.css into the vault's active configuration folder under plugins/csvzall, preserving data.json. Reload the plugin on each test device. Select Use bundled helper if this device previously used a custom executable. The compatible helper is embedded; no separate executable copy or path is needed.\n\nThis build automatically migrates inherited configurations into folders serving only their direct CSVs and export notes. Earlier test builds cannot read the new export Sync schema; update and reload every test device.\n\nOther platforms are intentionally not included. Production pins and archives remain unchanged.\n");
  const files = ["main.js", "manifest.json", "styles.css", "development-identity.json", "README.txt"];
  writeFileSync(join(output, "SHA256SUMS"), files.map(file => `${hash(readFileSync(join(output, file)))}  ${file}\n`).join(""));
  const zip = output + ".zip";
  if (existsSync(zip)) throw new Error("Refusing to replace an existing ZIP.");
  execFileSync(process.env.NATIVE_HELPER_PYTHON || "python", ["-c",
    "import pathlib,sys,zipfile; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],'x',compression=zipfile.ZIP_DEFLATED); [z.write(p/n,n) for n in sys.argv[3:]]; z.close()",
    output, zip, ...files, "SHA256SUMS"], { windowsHide: true });
  console.log(`Verified Windows-only bundled test plugin: ${output}\nTransfer package: ${zip}`);
} finally {
  if (dirname(work) !== output) throw new Error("Unexpected development verification directory.");
  rmSync(work, { recursive: true, force: true });
}

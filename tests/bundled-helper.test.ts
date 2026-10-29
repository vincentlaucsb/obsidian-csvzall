import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BUNDLED_CSVZALL_ASSETS, BUNDLED_CSVZALL_VERSION } from "../src/installer/bundledPayloads.generated.js";
import { bundledCsvzallAsset, installBundledCsvzall } from "../src/installer/bundledInstall.js";
import { normalizeSettings } from "../src/settings/settings.js";
import { extractViewerUrl } from "../src/viewerHelpers.js";
import { readFileSync } from "node:fs";
import { brotliCompressSync } from "node:zlib";
import { createHash } from "node:crypto";

function cleanup(context: unknown, callback: () => Promise<void>): void {
  (context as { after(callback: () => Promise<void>): void }).after(callback);
}

test("legacy managed installs migrate while explicit paths and custom PATH commands survive", () => {
  assert.equal(normalizeSettings(undefined).csvzallExecutableMode, "bundled");
  assert.equal(normalizeSettings({ csvzallPath: "csvzall" }).csvzallExecutableMode, "bundled");
  for (const csvzallPath of ["C:\\vault\\.obsidian\\plugins\\csvzall\\csvzall-bin\\0.4.0\\csvzall.exe",
    "/vault/.obsidian/plugins/csvzall/csvzall-bin/0.4.0/csvzall"]) {
    assert.equal(normalizeSettings({ csvzallPath, installedCsvzallVersion: "0.4.0" }).csvzallExecutableMode, "bundled");
  }
  for (const csvzallPath of ["/usr/local/bin/csvzall", "C:/My Tools/csvzall.exe", "my-csvzall"]) {
    const settings = normalizeSettings({ csvzallPath, installedCsvzallVersion: "0.4.0" });
    assert.equal(settings.csvzallExecutableMode, "custom");
    assert.equal(settings.csvzallPath, csvzallPath);
  }
  assert.equal(normalizeSettings({ csvzallPath: "csvzall", csvzallExecutableMode: "custom" }).csvzallExecutableMode, "custom");
  assert.equal(normalizeSettings({ csvzallPath: "old synced path", csvzallExecutableMode: "bundled" }).csvzallExecutableMode, "bundled");
});

test("bundled platform selection never silently substitutes another architecture", () => {
  for (const target of ["linux-x64", "darwin-arm64", "win32-x64"]) assert.ok(BUNDLED_CSVZALL_ASSETS[target]);
  for (const [platform, arch] of [["darwin", "x64"], ["linux", "arm64"], ["win32", "arm64"]]) {
    assert.throws(() => bundledCsvzallAsset(platform, arch), /custom executable path/);
  }
});

for (const [target, asset] of Object.entries(BUNDLED_CSVZALL_ASSETS)) {
  test(`pinned ${target} executable extracts offline, survives reload, and repairs damaged files`, async t => {
    const pluginDir = await mkdtemp(join(tmpdir(), "csvzall-bundled-"));
    cleanup(t, () => rm(pluginDir, { recursive: true, force: true }));
    const [platform, arch] = target.split("-") as [string, string];
    const options = { pluginDir, platform, arch };
    const first = await installBundledCsvzall(options);
    assert.equal(first.tagName, BUNDLED_CSVZALL_VERSION);
    assert.equal(first.assetName, asset.assetName);
    assert.ok(first.changed);
    assert.ok(first.executablePath.includes(target));
    const bytes = await readFile(first.executablePath);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.executableSha256);
    assert.equal(first.executablePath, join(pluginDir, "csvzall-bin", BUNDLED_CSVZALL_VERSION,
      `${target}-${asset.sha256.slice(0, 16)}`, platform === "win32" ? "csvzall.exe" : "csvzall"),
      "packaging changes preserve the archive-based install location");
    if (platform === "win32") assert.equal(bytes.toString("ascii", 0, 2), "MZ");
    else if (platform === "linux") assert.equal(bytes.toString("ascii", 1, 4), "ELF");
    else assert.equal(bytes.readUInt32LE(0), 0xfeedfacf);
    const before = await stat(first.executablePath);
    assert.equal((await installBundledCsvzall(options)).changed, false);
    assert.equal((await stat(first.executablePath)).mtimeMs, before.mtimeMs, "reload must not replace a running executable");
    await writeFile(first.executablePath, "damaged");
    assert.ok((await installBundledCsvzall(options)).changed);
    assert.deepEqual(await readFile(first.executablePath), bytes);
    await rm(first.executablePath);
    assert.ok((await installBundledCsvzall(options)).changed);
    const newer = await installBundledCsvzall({ ...options, version: "0.5.1" });
    assert.notEqual(newer.executablePath, first.executablePath);
    assert.deepEqual(await readFile(first.executablePath), bytes, "upgrades leave old sessions' executable intact");
    await assert.rejects(installBundledCsvzall({ ...options, asset: { ...asset, brotliBase64: Buffer.from("corrupt").toString("base64") } }), /Brotli decompression failed/);
    const wrongExecutable = Buffer.from("wrong executable");
    const header = Buffer.alloc(12);
    header.write("CZP1");
    header.writeUInt32LE(wrongExecutable.length, 4);
    await assert.rejects(installBundledCsvzall({ ...options, asset: { ...asset,
      brotliBase64: brotliCompressSync(Buffer.concat([header, wrongExecutable])).toString("base64") } }), /Executable SHA-256/);
    assert.deepEqual(await readFile(first.executablePath), bytes, "invalid payloads must leave the installed executable intact");
  });
}

test("the bundled native helper runs from a plugin directory containing spaces", async t => {
  if (!BUNDLED_CSVZALL_ASSETS[`${process.platform}-${process.arch}`]) { t.skip("No bundled binary for this test runner"); return; }
  const pluginDir = await mkdtemp(join(tmpdir(), "csvzall plugin with spaces "));
  cleanup(t, () => rm(pluginDir, { recursive: true, force: true }));
  const installed = await installBundledCsvzall({ pluginDir });
  const output = execFileSync(installed.executablePath, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  assert.ok(output.includes(BUNDLED_CSVZALL_VERSION), output);
  const csv = join(pluginDir, "example data.csv");
  await writeFile(csv, "name,value\nexample,42\n");
  const child = spawn(installed.executablePath, ["view", csv, "--edit", "--no-open", "--startup-json"], { windowsHide: true });
  const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
  let stdout = "", stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Viewer startup timed out: ${stderr}`)), 15000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`Viewer exited before startup: ${stderr}`)); });
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        const ready = extractViewerUrl(stdout);
        if (ready) { clearTimeout(timer); resolve(ready); }
      });
    });
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /csvzall/i);
  } finally {
    child.kill();
    await closed;
  }
});

test("builds publish all helper payloads inside main.js", () => {
  const checkScript = resolve("scripts/check-bundled-helper.mjs");
  execFileSync(process.execPath, [checkScript], { stdio: "pipe" });
  const source = readFileSync("src/main.ts", "utf8");
  assert.ok(source.indexOf("await this.installerService.ensureBundledCsvzall()") < source.indexOf("await this.chartService.reloadChartConfig()"));
  const release = readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(release, /npm run check:bundled-helper/);
  assert.match(release, /npm run check:source-archive/);
  assert.match(release, /assets=\(manifest.json main.js styles.css\)/);
  assert.ok(readFileSync("main.js", "utf8").includes(readFileSync("native-binaries/THIRD_PARTY_NOTICES.md", "utf8").trim()));
});

test("archive validation rejects corruption and missing platform payloads before generating a bundle", async t => {
  const directory = await mkdtemp(join(tmpdir(), "csvzall-pin-check-"));
  cleanup(t, () => rm(directory, { recursive: true, force: true }));
  const manifest = JSON.parse(readFileSync("native-binaries/manifest.json", "utf8"));
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
  for (const asset of Object.values(BUNDLED_CSVZALL_ASSETS)) {
    await copyFile(join("native-binaries", asset.assetName), join(directory, asset.assetName));
  }
  const script = resolve("scripts/prepare-native-binaries.mjs");
  const validate = () => execFileSync(process.execPath, ["--input-type=module", "-e",
    "const {pathToFileURL}=await import('node:url'); const {readBundledBinaries}=await import(pathToFileURL(process.argv[1])); readBundledBinaries(process.argv[2]);",
    script, directory], { stdio: "pipe" });
  validate();
  const first = Object.values(BUNDLED_CSVZALL_ASSETS)[0]!;
  await writeFile(join(directory, first.assetName), "corrupt");
  assert.throws(validate, /SHA-256 verification failed/);
  delete manifest.assets["darwin-arm64"];
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
  assert.throws(validate, /every supported target/);
});

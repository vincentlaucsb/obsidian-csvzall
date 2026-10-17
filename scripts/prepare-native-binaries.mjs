import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const bundledTargets = {
  "linux-x64": "linux-x64.tar.gz",
  "darwin-arm64": "macos-arm64.tar.gz",
  "win32-x64": "windows-x64.zip",
};

export function readBundledBinaries(directory = resolve(root, "native-binaries")) {
  const manifest = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || manifest.repository !== "vincentlaucsb/csvzall") {
    throw new Error("Invalid pinned csvzall release.");
  }
  if (Object.keys(manifest.assets).sort().join() !== Object.keys(bundledTargets).sort().join()) {
    throw new Error("The bundled csvzall release must include every supported target.");
  }
  const assets = {};
  for (const [target, suffix] of Object.entries(bundledTargets)) {
    const asset = manifest.assets[target];
    if (asset.assetName !== `csvzall-${manifest.version}-obsidian-${suffix}` || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new Error(`Invalid pinned csvzall asset for ${target}.`);
    }
    const bytes = readFileSync(resolve(directory, asset.assetName));
    if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
      throw new Error(`SHA-256 verification failed for ${asset.assetName}.`);
    }
    assets[target] = { assetName: asset.assetName, sha256: asset.sha256, base64: bytes.toString("base64") };
  }
  return { version: manifest.version, assets };
}

export function prepareNativeBinaries() {
  const { version, assets } = readBundledBinaries();
  writeFileSync(resolve(root, "src/installer/bundledBinaries.generated.ts"),
    `// Generated from verified native-binaries archives; do not edit.\n` +
    `export const BUNDLED_CSVZALL_VERSION: string = ${JSON.stringify(version)};\n` +
    `export const BUNDLED_CSVZALL_ASSETS: Record<string, { assetName: string; sha256: string; base64: string }> = ${JSON.stringify(assets)};\n`);
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Prepared bundled csvzall ${prepareNativeBinaries()} (all targets verified).`);
}

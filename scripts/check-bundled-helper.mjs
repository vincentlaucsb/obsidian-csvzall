import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { brotliDecompressSync } from "node:zlib";
import { readBundledBinaries } from "./prepare-native-binaries.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function checkBundledHelper(path = resolve(root, "main.js")) {
  const { version, assets } = readBundledBinaries();
  const bundle = readFileSync(path, "utf8");
  const manifest = JSON.parse(readFileSync(resolve(root, "native-binaries/manifest.json"), "utf8"));
  const embedded = [...bundle.matchAll(/"(linux-x64|darwin-arm64|win32-x64)":\s*\{\s*"?assetName"?:\s*"([^"]+)"\s*,\s*"?sha256"?:\s*"([a-f0-9]+)"\s*,\s*"?executableSha256"?:\s*"([a-f0-9]+)"\s*,\s*"?brotliBase64"?:\s*"([A-Za-z0-9+/=]+)"/g)];
  if (embedded.length !== Object.keys(assets).length) throw new Error("Desktop bundle must contain exactly one Brotli helper per supported target.");
  for (const [target, asset] of Object.entries(assets)) {
    const executableSha256 = manifest.assets[target].executableSha256;
    const matches = embedded.filter(([, key]) => key === target);
    const payload = matches[0];
    if (matches.length !== 1 || payload[2] !== asset.assetName || payload[3] !== asset.sha256 || payload[4] !== executableSha256 ||
        createHash("sha256").update(brotliDecompressSync(Buffer.from(payload[5], "base64"))).digest("hex") !== executableSha256) {
      throw new Error(`Desktop bundle is missing pinned helper ${asset.assetName}.`);
    }
  }
  if (/\bimport\s*\(\s*["'](?:node:)?(?:zlib|crypto|fs|path)(?:["'/])/.test(bundle)) {
    throw new Error("Desktop helper installation must use CommonJS Node imports.");
  }
  if (!bundle.includes(`"${version}"`) || bundle.includes("api.github.com/repos/vincentlaucsb/csvzall/releases/latest")) {
    throw new Error("Desktop bundle must use the pinned offline helper, without a latest-release downloader.");
  }
  console.log(`Verified bundled csvzall ${version} for ${Object.keys(assets).join(", ")}; main.js ${(statSync(path).size / 1024 / 1024).toFixed(2)} MiB.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkBundledHelper();

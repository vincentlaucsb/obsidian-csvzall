import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readBundledBinaries } from "./prepare-native-binaries.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function checkBundledHelper(path = resolve(root, "main.js")) {
  const { version, assets } = readBundledBinaries();
  const bundle = readFileSync(path, "utf8");
  for (const asset of Object.values(assets)) {
    if (![asset.base64, asset.assetName, asset.sha256].every(value => bundle.includes(value))) {
      throw new Error(`Desktop bundle is missing pinned helper ${asset.assetName}.`);
    }
  }
  if (!bundle.includes(`"${version}"`) || bundle.includes("api.github.com/repos/vincentlaucsb/csvzall/releases/latest")) {
    throw new Error("Desktop bundle must use the pinned offline helper, without a latest-release downloader.");
  }
  console.log(`Verified bundled csvzall ${version} for ${Object.keys(assets).join(", ")}; main.js ${(statSync(path).size / 1024 / 1024).toFixed(2)} MiB.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkBundledHelper();

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gunzipSync, inflateRawSync } from "node:zlib";
import { readBundledBinaries } from "./prepare-native-binaries.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

// The native recipe produces a single executable per checksum-pinned archive.
// Decode in memory so ordinary plugin builds need neither Python nor a compiler.
export function pinnedExecutable(bytes, assetName) {
  if (assetName.endsWith(".zip")) {
    const end = bytes.length - 22;
    if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50 || bytes.readUInt16LE(end + 10) !== 1) {
      throw new Error("Expected a single-file helper ZIP.");
    }
    const central = bytes.readUInt32LE(end + 16);
    if (bytes.readUInt32LE(central) !== 0x02014b50) throw new Error("Invalid helper ZIP directory.");
    const method = bytes.readUInt16LE(central + 10);
    const size = bytes.readUInt32LE(central + 20);
    const nameLength = bytes.readUInt16LE(central + 28);
    const local = bytes.readUInt32LE(central + 42);
    if (bytes.toString("utf8", central + 46, central + 46 + nameLength) !== "csvzall.exe" ||
        bytes.readUInt32LE(local) !== 0x04034b50) throw new Error("Expected csvzall.exe in helper ZIP.");
    const offset = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const payload = bytes.subarray(offset, offset + size);
    if (method === 0) return payload;
    if (method === 8) return inflateRawSync(payload);
    throw new Error("Unsupported helper ZIP compression.");
  }
  if (!assetName.endsWith(".tar.gz")) throw new Error("Unsupported pinned helper archive.");
  const tar = gunzipSync(bytes);
  const size = Number.parseInt(tar.toString("ascii", 124, 136).replace(/\0/g, "").trim(), 8);
  if (tar.toString("utf8", 0, 100).replace(/\0.*$/s, "") !== "csvzall" ||
      ![0, 48].includes(tar[156]) || !Number.isSafeInteger(size) || size <= 0 || 512 + size > tar.length ||
      tar.subarray(512 + Math.ceil(size / 512) * 512).some(byte => byte !== 0)) {
    throw new Error("Expected a single csvzall executable in helper tar.gz.");
  }
  return tar.subarray(512, 512 + size);
}

export function readBundledPayloads(directory = resolve(root, "native-binaries")) {
  const { version, assets: archives } = readBundledBinaries(directory);
  const manifest = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8"));
  const assets = {};
  for (const [target, archive] of Object.entries(archives)) {
    const executableSha256 = manifest.assets[target].executableSha256;
    const executable = pinnedExecutable(Buffer.from(archive.base64, "base64"), archive.assetName);
    if (!/^[a-f0-9]{64}$/.test(executableSha256) || sha256(executable) !== executableSha256) {
      throw new Error(`Executable SHA-256 verification failed for ${archive.assetName}.`);
    }
    const bytes = brotliCompressSync(executable, { params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_LGWIN]: 24,
    } });
    assets[target] = { assetName: archive.assetName, sha256: archive.sha256, executableSha256,
      brotliBase64: bytes.toString("base64") };
  }
  return { version, assets };
}

export function prepareBundledPayloads() {
  const { version, assets } = readBundledPayloads();
  writeFileSync(resolve(root, "src/installer/bundledPayloads.generated.ts"),
    "// Generated from verified native-binaries archives; do not edit.\n" +
    `export const BUNDLED_CSVZALL_VERSION: string = ${JSON.stringify(version)};\n` +
    `export const BUNDLED_CSVZALL_ASSETS: Record<string, { assetName: string; sha256: string; executableSha256: string; brotliBase64: string }> = ${JSON.stringify(assets)};\n`);
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Prepared Brotli helper payloads for csvzall ${prepareBundledPayloads()}.`);
}

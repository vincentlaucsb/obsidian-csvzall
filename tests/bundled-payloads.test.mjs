import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { pinnedExecutable, readBundledPayloads } from "../scripts/bundle-native-payloads.mjs";
import { checkBundledHelper } from "../scripts/check-bundled-helper.mjs";
import { buildIdentity, releasePlan } from "../scripts/native-helper-contract.mjs";
import { decodeHelperPayload } from "../src/installer/helperPayload.mjs";
import { encodeHelperPayload, shareNativeText } from "../scripts/share-native-text.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const directory = resolve("native-binaries");
const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
const identity = buildIdentity();
const payloads = readBundledPayloads();

test("Brotli payloads restore every pinned executable without changing native build identity", () => {
  let archiveBase64Bytes = 0, payloadBase64Bytes = payloads.shared.sharedBrotliBase64.length;
  for (const [target, pin] of Object.entries(manifest.assets)) {
    const archive = readFileSync(join(directory, pin.assetName));
    const payload = payloads.assets[target];
    const executable = decodeHelperPayload(payload.brotliBase64, payloads.shared.sharedBrotliBase64);
    assert.deepEqual(executable, pinnedExecutable(archive, pin.assetName));
    assert.equal(hash(executable), pin.executableSha256);
    assert.equal(payload.executableSha256, pin.executableSha256);
    assert.equal(payload.sha256, hash(archive));
    archiveBase64Bytes += archive.toString("base64").length;
    payloadBase64Bytes += payload.brotliBase64.length;
  }
  assert.ok(payloadBase64Bytes < archiveBase64Bytes * 0.7, "shared pinned helpers must save at least 30% of archive payload text");
  assert.equal(buildIdentity().key, identity.key);
  assert.equal(releasePlan().reuse, true);
  console.log(`Embedded helper text: ${archiveBase64Bytes} -> ${payloadBase64Bytes} bytes.`);
});

test("payload generation rejects an executable hash mismatch even when the archive hash matches", t => {
  const temporary = mkdtempSync(join(tmpdir(), "csvzall-payload-pin-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const changed = structuredClone(manifest);
  for (const pin of Object.values(manifest.assets)) copyFileSync(join(directory, pin.assetName), join(temporary, pin.assetName));
  changed.assets["linux-x64"].executableSha256 = "0".repeat(64);
  writeFileSync(join(temporary, "manifest.json"), JSON.stringify(changed));
  assert.throws(() => readBundledPayloads(temporary), /Executable SHA-256/);
});

test("bundle validation checks executable bytes, target association, and CommonJS imports without building", t => {
  const temporary = mkdtempSync(join(tmpdir(), "csvzall-payload-bundle-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const path = join(temporary, "main.js");
  const write = (assets, tail = "", shared = payloads.shared) => writeFileSync(path,
    `const version=${JSON.stringify(payloads.version)};const shared=${JSON.stringify(shared)};const assets=${JSON.stringify(assets)};${tail}`);
  write(payloads.assets);
  checkBundledHelper(path);
  const swapped = structuredClone(payloads.assets);
  swapped["linux-x64"].brotliBase64 = swapped["win32-x64"].brotliBase64;
  write(swapped);
  assert.throws(() => checkBundledHelper(path), /missing pinned helper/);
  write({ ...payloads.assets, "linux-x64": payloads.assets["win32-x64"], "win32-x64": payloads.assets["linux-x64"] });
  assert.throws(() => checkBundledHelper(path), /missing pinned helper/);
  write({ "win32-x64": payloads.assets["win32-x64"] });
  assert.throws(() => checkBundledHelper(path), /exactly one Brotli helper/);
  write(payloads.assets, 'import("node:zlib")');
  assert.throws(() => checkBundledHelper(path), /CommonJS Node imports/);
  write(payloads.assets, "", { sharedBrotliBase64: brotliCompressSync(Buffer.alloc(1)).toString("base64") });
  assert.throws(() => checkBundledHelper(path), /Invalid bundled helper patch/);
  const corruptedShared = brotliDecompressSync(Buffer.from(payloads.shared.sharedBrotliBase64, "base64"));
  corruptedShared[0] ^= 1;
  write(payloads.assets, "", { sharedBrotliBase64: compress(corruptedShared) });
  assert.throws(() => checkBundledHelper(path), /missing pinned helper/);
  write(payloads.assets, "", {});
  assert.throws(() => checkBundledHelper(path), /exactly one shared helper/);
});

const compress = bytes => brotliCompressSync(bytes).toString("base64");
function sharedFixture() {
  const first = Buffer.from("const café = 'shared viewer asset';\n".repeat(40));
  const second = Buffer.from("body { color: var(--text-normal); }\n".repeat(40));
  const executables = {
    a: Buffer.concat([Buffer.from([0, 1]), first, Buffer.from([0, 2]), second, Buffer.from([0, 3])]),
    b: Buffer.concat([Buffer.from([0, 4, 5]), second, Buffer.from([0, 6]), first, Buffer.from([0, 7])]),
    c: Buffer.from([0, 8, 9, 0]),
  };
  return { executables, packed: shareNativeText(executables) };
}

test("shared text reconstructs Unicode, reordered chunks, and unrelated target bytes exactly", () => {
  const { executables, packed } = sharedFixture();
  assert.ok(packed.shared.length > 1024);
  assert.deepEqual(shareNativeText(executables), packed, "packing must be deterministic");
  for (const [target, bytes] of Object.entries(executables)) {
    assert.deepEqual(decodeHelperPayload(compress(packed.payloads[target]), compress(packed.shared)), bytes);
  }
  assert.deepEqual(decodeHelperPayload(compress(packed.payloads.c), "unreadable shared pool"), executables.c,
    "targets with no shared text must not decode the shared pool");
  assert.deepEqual(decodeHelperPayload(compress(encodeHelperPayload(executables.a)), ""), executables.a,
    "single-target development helpers work without shared data");
});

test("reconstruction rejects unsupported, truncated, overlapping, and out-of-range patch recipes", () => {
  const { packed } = sharedFixture();
  const mutations = [
    bytes => { bytes.write("CZP2"); },
    bytes => { bytes.writeUInt32LE(1000000, 8); },
    bytes => { bytes.writeUInt32LE(bytes.readUInt32LE(4) + 1, 4); },
    bytes => { bytes.writeUInt32LE(0, 20); },
    bytes => { bytes.writeUInt32LE(1000000, 16); },
    bytes => { bytes.writeUInt32LE(1000000, 12); },
    bytes => { bytes.writeUInt32LE(bytes.readUInt32LE(12), 24); },
  ];
  for (const mutate of mutations) {
    const bytes = Buffer.from(packed.payloads.a);
    mutate(bytes);
    assert.throws(() => decodeHelperPayload(compress(bytes), compress(packed.shared)), /bundled helper/i);
  }
  assert.throws(() => decodeHelperPayload(compress(Buffer.alloc(4)), ""), /Unsupported/);
});

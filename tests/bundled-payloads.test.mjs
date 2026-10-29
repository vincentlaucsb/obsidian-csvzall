import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { pinnedExecutable, readBundledPayloads } from "../scripts/bundle-native-payloads.mjs";
import { checkBundledHelper } from "../scripts/check-bundled-helper.mjs";
import { buildIdentity, releasePlan } from "../scripts/native-helper-contract.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const directory = resolve("native-binaries");
const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
const identity = buildIdentity();
const payloads = readBundledPayloads();

test("Brotli payloads restore every pinned executable without changing native build identity", () => {
  let archiveBase64Bytes = 0, payloadBase64Bytes = 0;
  for (const [target, pin] of Object.entries(manifest.assets)) {
    const archive = readFileSync(join(directory, pin.assetName));
    const payload = payloads.assets[target];
    const executable = brotliDecompressSync(Buffer.from(payload.brotliBase64, "base64"));
    assert.deepEqual(executable, pinnedExecutable(archive, pin.assetName));
    assert.equal(hash(executable), pin.executableSha256);
    assert.equal(payload.executableSha256, pin.executableSha256);
    assert.equal(payload.sha256, hash(archive));
    archiveBase64Bytes += archive.toString("base64").length;
    payloadBase64Bytes += payload.brotliBase64.length;
  }
  assert.ok(payloadBase64Bytes < archiveBase64Bytes * 0.85, "pinned helpers must save at least 15% of payload text");
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
  const write = (assets, tail = "") => writeFileSync(path,
    `const version=${JSON.stringify(payloads.version)};const assets=${JSON.stringify(assets)};${tail}`);
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
});

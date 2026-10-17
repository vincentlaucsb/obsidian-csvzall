import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundledTargets, readBundledBinaries } from "./prepare-native-binaries.mjs";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const recipeFiles = [
  ".github/workflows/build-obsidian-helpers.yml",
  "scripts/native-helper-contract.mjs",
  "scripts/build-native-helper.mjs",
  "scripts/package-native-helper.py",
  "scripts/prepare-native-binaries.mjs",
];
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const canonical = value => Array.isArray(value) ? value.map(canonical) :
  value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const commitPattern = /^[a-f0-9]{40}$/;
const hashPattern = /^[a-f0-9]{64}$/;

export function buildIdentity(root = repositoryRoot) {
  const config = JSON.parse(readFileSync(join(root, "native-binaries/build.json"), "utf8"));
  if (config.schemaVersion !== 1 || config.repository !== "vincentlaucsb/csvzall" ||
      !commitPattern.test(config.sourceCommit) || !/^\d+\.\d+\.\d+$/.test(config.version)) throw new Error("Invalid native helper source pin.");
  if (![config.tools.cmake, config.tools.ninja, config.tools.python].every(version => /^\d+\.\d+(?:\.\d+)?$/.test(version))) throw new Error("Native build tools must be pinned.");
  if (Object.keys(config.targets).sort().join() !== Object.keys(bundledTargets).sort().join()) throw new Error("Expected all three native helper targets.");
  for (const [target, settings] of Object.entries(config.targets)) {
    if (`${settings.platform}-${settings.arch}` !== target || typeof settings.runner !== "string") throw new Error(`Invalid helper target ${target}.`);
  }
  for (const dependency of Object.values(config.dependencies)) {
    if (!commitPattern.test(dependency.commit) || !/^[\w.-]+\/[\w.-]+$/.test(dependency.repository) ||
        !/^[A-Z_][A-Z0-9_]*$/.test(dependency.cmakeVariable)) throw new Error("Native build dependencies must use immutable commit pins.");
  }
  const required = {
    CSVZALL_OBSIDIAN_BUILD: "ON", CSVZALL_ENABLE_POSTGRESQL: "OFF", CSVZALL_ENABLE_KEYCHAIN: "OFF",
    CSVZALL_ENABLE_COMPRESSED_INPUT: "OFF", CSVZALL_PREFER_SYSTEM_SIMDJSON: "OFF",
    CSVZALL_PREFER_SYSTEM_NLOHMANN_JSON: "OFF", CSVZALL_PREFER_SYSTEM_SVGPLOT: "OFF", CSVZALL_ENABLE_SVGPLOT: "ON",
  };
  for (const [name, value] of Object.entries(required)) {
    if (config.cmakeOptions[name] !== value) throw new Error(`Obsidian helpers require ${name}=${value}.`);
    for (const target of Object.values(config.targets)) {
      if (target.cmakeOptions[name] !== undefined && target.cmakeOptions[name] !== value) throw new Error(`Target overrides cannot change ${name}.`);
    }
  }
  const recipes = Object.fromEntries(recipeFiles.map(file => [file, sha256(readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n"))]));
  return { config, key: sha256(JSON.stringify(canonical({ config, recipes }))) };
}

export function assertPreparedManifest(directory = join(repositoryRoot, "native-binaries"), identity = buildIdentity()) {
  const payload = readBundledBinaries(directory);
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  if (manifest.buildKey !== identity.key || manifest.sourceCommit !== identity.config.sourceCommit ||
      manifest.version !== identity.config.version) throw new Error("Native helper snapshot is stale. Run the Release workflow in prepare mode, merge its preparation commit, then tag that commit.");
  if (!Object.values(manifest.assets).every(asset => hashPattern.test(asset.executableSha256))) throw new Error("Prepared helper snapshot lacks executable checksums.");
  return { manifest, payload };
}

export function verifyReceipt(directory, target, identity = buildIdentity()) {
  const receipt = JSON.parse(readFileSync(join(directory, "receipt.json"), "utf8"));
  const assetName = `csvzall-${identity.config.version}-obsidian-${bundledTargets[target]}`;
  if (!identity.config.targets[target] || receipt.schemaVersion !== 1 || receipt.target !== target ||
      receipt.sourceCommit !== identity.config.sourceCommit || receipt.buildKey !== identity.key ||
      receipt.version !== identity.config.version || receipt.assetName !== assetName ||
      !hashPattern.test(receipt.sha256) || !hashPattern.test(receipt.executableSha256)) throw new Error(`Native helper provenance mismatch for ${target}.`);
  if (sha256(readFileSync(join(directory, assetName))) !== receipt.sha256) throw new Error(`Native helper checksum mismatch for ${target}.`);
  return receipt;
}

export function collectHelpers(input, output, identity = buildIdentity()) {
  // Check the complete set before changing any release files.
  const receipts = Object.fromEntries(Object.keys(identity.config.targets).map(target =>
    [target, verifyReceipt(join(input, target), target, identity)]));
  mkdirSync(output, { recursive: true });
  const assets = {};
  for (const [target, receipt] of Object.entries(receipts)) {
    copyFileSync(join(input, target, receipt.assetName), join(output, receipt.assetName));
    assets[target] = { assetName: receipt.assetName, sha256: receipt.sha256, executableSha256: receipt.executableSha256 };
  }
  const manifest = { version: identity.config.version, repository: identity.config.repository,
    sourceCommit: identity.config.sourceCommit, buildKey: identity.key, assets };
  writeFileSync(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  assertPreparedManifest(output, identity);
  return manifest;
}

export function releasePlan(root = repositoryRoot) {
  const identity = buildIdentity(root);
  const directory = join(root, "native-binaries");
  let reuse = false;
  const existing = join(directory, "manifest.json");
  if (existsSync(existing)) {
    const manifest = JSON.parse(readFileSync(existing, "utf8"));
    if (manifest.buildKey === identity.key) { assertPreparedManifest(directory, identity); reuse = true; }
  }
  return { key: identity.key, reuse, matrix: { include: Object.entries(identity.config.targets).map(([target, value]) => ({ target, runner: value.runner })) } };
}

export function installSnapshot(input, output = join(repositoryRoot, "native-binaries"), identity = buildIdentity()) {
  const { manifest } = assertPreparedManifest(input, identity);
  const previous = existsSync(join(output, "manifest.json")) ?
    JSON.parse(readFileSync(join(output, "manifest.json"), "utf8")) : { assets: {} };
  // Validate old names before using them for narrowly scoped cleanup.
  for (const asset of Object.values(previous.assets)) {
    if (!/^csvzall-[\d.]+-obsidian-[\w.-]+\.(?:zip|tar\.gz)$/.test(asset.assetName)) throw new Error("Invalid previous helper filename.");
  }
  mkdirSync(output, { recursive: true });
  const names = new Set(Object.values(manifest.assets).map(asset => asset.assetName));
  for (const name of names) copyFileSync(join(input, name), join(output, name));
  copyFileSync(join(input, "manifest.json"), join(output, "manifest.json"));
  for (const { assetName } of Object.values(previous.assets)) if (!names.has(assetName)) rmSync(join(output, assetName), { force: true });
  assertPreparedManifest(output, identity);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, input, output] = process.argv.slice(2);
  if (command === "plan") {
    const plan = releasePlan();
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
      `key=${plan.key}\nreuse=${plan.reuse}\nmatrix=${JSON.stringify(plan.matrix)}\n`);
    console.log(JSON.stringify(plan));
  } else if (command === "verify") {
    assertPreparedManifest(input ? resolve(input) : undefined);
    console.log("Pinned native source, build configuration, and all archive checksums match.");
  } else if (command === "collect" && input && output) collectHelpers(resolve(input), resolve(output));
  else if (command === "install" && input) installSnapshot(resolve(input), output ? resolve(output) : undefined);
  else throw new Error("Usage: node scripts/native-helper-contract.mjs plan | verify [directory] | collect <input> <output> | install <snapshot> [destination]");
}

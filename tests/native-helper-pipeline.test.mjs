import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildIdentity, collectHelpers, installSnapshot, recipeFiles, releasePlan, repositoryRoot, sha256, verifyReceipt } from "../scripts/native-helper-contract.mjs";
import { bundledTargets } from "../scripts/prepare-native-binaries.mjs";
import { checkout, obsidianStartupUrl } from "../scripts/build-native-helper.mjs";

const parent = join(repositoryRoot, ".test-build");
mkdirSync(parent, { recursive: true });
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
function fixture(t) {
  const root = mkdtempSync(join(parent, "native-pipeline-"));
  t.after(() => { assert.equal(dirname(root), parent); rmSync(root, { recursive: true, force: true }); });
  for (const file of ["native-binaries/build.json", ...recipeFiles]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(join(repositoryRoot, file), join(root, file));
  }
  return root;
}
function results(root, identity) {
  const input = join(root, "results");
  for (const target of Object.keys(bundledTargets)) {
    const directory = join(input, target);
    mkdirSync(directory, { recursive: true });
    const assetName = `csvzall-${identity.config.version}-obsidian-${bundledTargets[target]}`;
    const bytes = Buffer.from(`archive fixture for ${target}`);
    writeFileSync(join(directory, assetName), bytes);
    json(join(directory, "receipt.json"), { schemaVersion: 1, target, version: identity.config.version,
      sourceCommit: identity.config.sourceCommit, buildKey: identity.key, assetName,
      sha256: sha256(bytes), executableSha256: sha256(Buffer.from(`executable ${target}`)) });
  }
  return input;
}

test("native helper smoke requires acknowledged host automation rather than a standalone URL", () => {
  const url = "http://127.0.0.1:12345/?token=smoke";
  assert.equal(obsidianStartupUrl(JSON.stringify({ url, obsidianMode: { version: 1, chartAutomation: "host" } })), url);
  for (const obsidianMode of [undefined, { version: 0, chartAutomation: "host" },
    { version: 2, chartAutomation: "host" }, { version: 1, chartAutomation: "native" }]) {
    assert.throws(() => obsidianStartupUrl(JSON.stringify({ url, obsidianMode })), /lacks Obsidian mode/);
  }
  assert.equal(obsidianStartupUrl("partial startup"), null);
  assert.equal(obsidianStartupUrl(JSON.stringify({ url: "http://example.com/?token=smoke" })), null);
  assert.equal(obsidianStartupUrl(JSON.stringify({ url: "http://127.0.0.1:12345/" })), null);
});

test("release validation refuses Windows development bundles before reading release metadata", t => {
  const root = fixture(t);
  json(join(root, "manifest.json"), { version: "0.7.1", csvzallDevelopmentBuild: "Windows Sync test" });
  assert.throws(() => execFileSync(process.execPath, [join(repositoryRoot, "scripts/validate-release.mjs"), "0.7.1"],
    { cwd: root, encoding: "utf8", stdio: "pipe", windowsHide: true }), /Development test bundles cannot be published/);
});

test("pinned source reuse refuses tracked, staged, untracked, and ignored modifications", t => {
  for (const kind of ["tracked", "staged", "untracked", "ignored"]) {
    const source = join(fixture(t), "source");
    mkdirSync(source);
    const git = args => execFileSync("git", ["-C", source, ...args], { encoding: "utf8" }).trim();
    git(["init", "--quiet"]);
    git(["config", "core.autocrlf", "false"]);
    writeFileSync(join(source, "code.cpp"), "pinned source\n");
    writeFileSync(join(source, ".gitignore"), "ignored.cpp\n");
    git(["add", "code.cpp", ".gitignore"]);
    git(["-c", "user.name=Helper test", "-c", "user.email=helper@example.invalid", "commit", "--quiet", "-m", "Pinned fixture"]);
    const commit = git(["rev-parse", "HEAD"]);
    checkout("unused/fixture", commit, source);
    const changed = join(source, kind === "ignored" ? "ignored.cpp" : kind === "untracked" ? "extra.cpp" : "code.cpp");
    writeFileSync(changed, "local changes\n");
    if (kind === "staged") git(["add", "code.cpp"]);
    assert.throws(() => checkout("unused/fixture", commit, source), /Modified source checkout/);
    assert.equal(git(["rev-parse", "HEAD"]), commit);
    assert.equal(readFileSync(changed, "utf8"), "local changes\n");
  }
});

test("helper reuse survives plugin-only edits but invalidates source, dependencies, settings, and recipe changes", t => {
  const root = fixture(t), initial = buildIdentity(root);
  collectHelpers(results(root, initial), join(root, "native-binaries"), initial);
  assert.equal(releasePlan(root).reuse, true);
  json(join(root, "manifest.json"), { version: "99.0.0" });
  writeFileSync(join(root, "README.md"), "Plugin-only documentation changes");
  assert.equal(buildIdentity(root).key, initial.key);
  assert.equal(releasePlan(root).reuse, true);
  const pin = join(root, "native-binaries/build.json");
  for (const change of [
    config => { config.sourceCommit = "a".repeat(40); },
    config => { config.dependencies.svg.commit = "b".repeat(40); },
    config => { config.targets["linux-x64"].cmakeOptions.CMAKE_CXX_COMPILER = "g++-15"; },
    config => { config.tools.cmake = "3.31.9"; },
  ]) {
    const config = structuredClone(initial.config); change(config); json(pin, config);
    assert.notEqual(buildIdentity(root).key, initial.key);
    assert.equal(releasePlan(root).reuse, false);
  }
  json(pin, initial.config);
  for (const recipe of recipeFiles) {
    const path = join(root, recipe), original = readFileSync(path);
    writeFileSync(path, Buffer.concat([original, Buffer.from("\n# changed recipe\n")]));
    assert.notEqual(buildIdentity(root).key, initial.key, recipe);
    assert.equal(releasePlan(root).reuse, false);
    writeFileSync(path, original);
  }
});

test("legacy imports trigger preparation, while corrupt committed snapshots and unpinned source fail closed", t => {
  const root = fixture(t), identity = buildIdentity(root);
  json(join(root, "native-binaries/manifest.json"), { version: "0.5.0", assets: {} });
  assert.equal(releasePlan(root).reuse, false);
  const manifest = collectHelpers(results(root, identity), join(root, "native-binaries"), identity);
  const first = Object.values(manifest.assets)[0];
  writeFileSync(join(root, "native-binaries", first.assetName), "corruption");
  assert.throws(() => releasePlan(root), /SHA-256/);
  const config = structuredClone(identity.config);
  config.sourceCommit = "master";
  json(join(root, "native-binaries/build.json"), config);
  assert.throws(() => buildIdentity(root), /source pin/);
  config.sourceCommit = identity.config.sourceCommit;
  config.targets["win32-x64"].cmakeOptions.CSVZALL_ENABLE_KEYCHAIN = "ON";
  json(join(root, "native-binaries/build.json"), config);
  assert.throws(() => buildIdentity(root), /Target overrides/);
});

test("cached helper receipts reject wrong sources, targets, configurations, and archive bytes", t => {
  const root = fixture(t), identity = buildIdentity(root), input = results(root, identity);
  const target = "linux-x64", directory = join(input, target), receiptPath = join(directory, "receipt.json");
  const original = JSON.parse(readFileSync(receiptPath, "utf8"));
  verifyReceipt(directory, target, identity);
  for (const [field, value] of [["sourceCommit", "a".repeat(40)], ["buildKey", "b".repeat(64)],
    ["target", "darwin-arm64"], ["assetName", "../../escape.tar.gz"], ["executableSha256", "missing"]]) {
    json(receiptPath, { ...original, [field]: value });
    assert.throws(() => verifyReceipt(directory, target, identity), /provenance mismatch/);
  }
  json(receiptPath, original);
  writeFileSync(join(directory, original.assetName), "tampered");
  assert.throws(() => verifyReceipt(directory, target, identity), /checksum mismatch/);
});

test("collect requires every matching platform before changing files; snapshot install removes only superseded archives", t => {
  const root = fixture(t), identity = buildIdentity(root), input = results(root, identity), output = join(root, "snapshot");
  const missing = join(input, "darwin-arm64/receipt.json");
  const saved = readFileSync(missing);
  rmSync(missing);
  assert.throws(() => collectHelpers(input, output, identity));
  assert.equal(existsSync(output), false);
  writeFileSync(missing, saved);
  collectHelpers(input, output, identity);
  const installed = join(root, "installed"); mkdirSync(installed);
  const oldName = "csvzall-0.4.0-obsidian-windows-x64.zip";
  writeFileSync(join(installed, oldName), "old");
  writeFileSync(join(installed, "custom.txt"), "preserve");
  json(join(installed, "manifest.json"), { assets: { old: { assetName: oldName } } });
  installSnapshot(output, installed, identity);
  assert.equal(existsSync(join(installed, oldName)), false);
  assert.equal(readFileSync(join(installed, "custom.txt"), "utf8"), "preserve");
  json(join(installed, "manifest.json"), { assets: { old: { assetName: "../custom.txt" } } });
  assert.throws(() => installSnapshot(output, installed, identity), /previous helper filename/);
  assert.equal(readFileSync(join(installed, "custom.txt"), "utf8"), "preserve");
});

for (const suffix of ["zip", "tar.gz"]) test(`native ${suffix} packaging ignores timestamps and rejects extra or traversal files`, t => {
  const root = fixture(t), name = suffix === "zip" ? "csvzall.exe" : "csvzall";
  const binary = join(root, name), first = join(root, `first.${suffix}`), second = join(root, `second.${suffix}`);
  const script = resolve("scripts/package-native-helper.py");
  const python = process.env.NATIVE_HELPER_PYTHON || "python";
  const run = args => execFileSync(python, [script, ...args], { stdio: "pipe", windowsHide: true });
  writeFileSync(binary, "fixture executable");
  run(["pack", first, binary]);
  utimesSync(binary, new Date(0), new Date(0));
  run(["pack", second, binary]);
  assert.equal(sha256(readFileSync(first)), sha256(readFileSync(second)));
  const extracted = join(root, "extracted", name);
  run(["extract", first, extracted]);
  assert.equal(readFileSync(extracted, "utf8"), "fixture executable");
  const bad = join(root, `bad.${suffix}`);
  const pythonCode = suffix === "zip" ?
    "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('../csvzall.exe','bad'); z.close()" :
    "import tarfile,io,sys; t=tarfile.open(sys.argv[1],'w:gz'); i=tarfile.TarInfo('../csvzall'); i.size=3; t.addfile(i,io.BytesIO(b'bad')); t.close()";
  execFileSync(python, ["-c", pythonCode, bad], { windowsHide: true });
  assert.throws(() => run(["extract", bad, extracted]), /must contain only the executable/);
  assert.equal(readFileSync(extracted, "utf8"), "fixture executable");
});

test("publication verifies the frozen snapshot and preparation owns exact-key build/cache jobs", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  const native = readFileSync(".github/workflows/build-obsidian-helpers.yml", "utf8");
  const publication = workflow.slice(workflow.indexOf("\n  release:"));
  assert.match(workflow, /options: \[prepare, publish\]/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/build-obsidian-helpers.yml/);
  assert.match(publication, /native-helper-contract.mjs verify/);
  assert.doesNotMatch(publication, /build-native-helper|git push|native-helper-contract.mjs install/);
  assert.match(native, /if: needs.plan.outputs.reuse != 'true'/);
  assert.match(native, /actions\/cache\/restore@/);
  assert.match(native, /actions\/cache\/save@/);
  assert.doesNotMatch(native, /restore-keys:/);
  assert.match(native, /build-native-helper.mjs verify/);
});

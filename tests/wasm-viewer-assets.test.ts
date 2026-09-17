import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

test("packaged WASM viewer assets are mobile-generation-ready", () => {
  const viewerDir = "wasm-viewer";
  const assetsDir = join(viewerDir, "assets");
  const metadataPath = join(viewerDir, "csvzall-wasm-viewer.json");

  assert.equal(statSync(join(viewerDir, "index.html")).isFile(), true);
  assert.equal(statSync(assetsDir).isDirectory(), true);
  assert.equal(statSync(metadataPath).isFile(), true);

  const assets = readdirSync(assetsDir);
  assert.equal(assets.some((name) => name.endsWith(".js")), true);
  assert.equal(assets.some((name) => name.endsWith(".css")), false);
  assert.equal(assets.filter((name) => name.endsWith(".wasm")).length, 1);

  const indexHtml = readFileSync(join(viewerDir, "index.html"), "utf8");
  assert.match(indexHtml, /\.\/assets\//);
  assert.doesNotMatch(indexHtml, /(?:src|href)=["']https?:\/\//i);
  const assetReferences = Array.from(indexHtml.matchAll(/(?:src|href)=["']\.\/assets\/([^"']+)["']/gi))
    .map((match) => match[1] ?? "")
    .filter((assetReference) => assetReference.length > 0);
  assert.notEqual(assetReferences.length, 0);
  for (const assetReference of assetReferences) {
    assert.equal(existsSync(join(assetsDir, assetReference)), true);
  }

  const indexBundleName = assets.find((name) => /^index-.*\.js$/.test(name));
  assert.equal(typeof indexBundleName, "string");
  const indexBundle = readFileSync(join(assetsDir, indexBundleName ?? ""), "utf8");
  if (!indexBundle.includes("theme-ready")) {
    assert.match(indexHtml, /src="\.\/assets\/host-theme\.mjs"/);
    assert.equal(readFileSync(join(assetsDir, "host-theme.mjs"), "utf8"), readFileSync("scripts/vendor/host-theme.mjs", "utf8"));
  }
  const stylesheetBundle = indexHtml.match(/<style data-csvzall-inline-viewer-style>\n?([\s\S]*?)\n?<\/style>/u)?.[1] ?? "";
  assert.notEqual(stylesheetBundle.length, 0);
  assert.match(indexBundle, /obsidian-csvzall/);
  assert.match(indexBundle, /csvzall-wasm-viewer/);
  assert.match(indexBundle, /csvzall-save-ack-v1/);
  assert.match(indexBundle, /csvzallSaveRevision===csvzallEditRevision/);
  assert.match(`${indexBundle}\n${stylesheetBundle}`, /csvzall-obsidian-host-compact-v1/);
  assert.match(stylesheetBundle, /body\[data-host-mode\] \.topbar p/);
  assert.match(stylesheetBundle, /display: none/);
  assert.match(indexBundle, /checkboxes:!1/);
  assert.match(indexBundle, /headerCheckbox:!1/);
  assert.match(indexBundle, /csvzall-obsidian-mobile-behavior-v1/);
  assert.match(indexBundle, /visualViewport/);
  assert.match(indexBundle, /csvzall-obsidian-viewport-resize-v2/);
  assert.match(indexBundle, /viewport-resized/);
  assert.doesNotMatch(indexBundle, /csvzall-obsidian-keyboard-focus-v1/);
  assert.doesNotMatch(indexBundle, /csvzallSetKeyboardOpen/);
  assert.doesNotMatch(indexBundle, /csvzall-obsidian-keyboard-lifecycle-v1/);
  assert.doesNotMatch(indexBundle, /csvzallApplyKeyboardOpen/);
  assert.match(indexBundle, /csvzall-obsidian-keyboard-lifecycle-v2/);
  assert.match(indexBundle, /onCellEditingStarted/);
  assert.match(indexBundle, /csvzallActiveEditCell/);
  assert.doesNotMatch(stylesheetBundle, /body\[data-host-mode\]\[data-keyboard-open\]/);
  assert.match(stylesheetBundle, /body\[data-host-mode\] \{ height: 100vh; min-height: 100vh/);

  const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<string, unknown>;
  assert.equal(metadata.sourceRepo, "vincentlaucsb/csvzall");
  assert.equal(typeof metadata.sourceCommit, "string");
  assert.equal(typeof metadata.sourcePath, "string");
  assert.equal(typeof metadata.syncedAt, "string");

  const manifest = JSON.parse(readFileSync("manifest.json", "utf8")) as Record<string, unknown>;
  assert.equal(manifest.isDesktopOnly, true);

  for (const asset of assets) {
    assert.equal(existsSync(join(assetsDir, asset)), true);
  }
});

test("WASM bridge waits for matching host acknowledgement and rejects failed saves", async () => {
  const path = join("wasm-viewer", "assets", readdirSync("wasm-viewer/assets").find(name => /^index-.*\.js$/.test(name))!);
  const bundle = readFileSync(path, "utf8");
  const bridgeCode = bundle.slice(bundle.indexOf('const Vw="obsidian-csvzall"'), bundle.indexOf('const Uw='));
  assert.notEqual(bridgeCode.length, 0);
  const sent: any[] = [];
  let listener: (event: any) => void = () => {};
  const parent = { postMessage: (message: any) => sent.push(message) };
  const windowRef = {parent, addEventListener: (_: string, fn: typeof listener) => { listener = fn; }, removeEventListener() {} };
  const bridge = runInNewContext(`${bridgeCode};_w({windowRef,onOpenFile:async()=>{}})`, {windowRef, ArrayBuffer});
  bridge.start();
  await bridge.markReady();
  listener({source: parent, data: {source: "obsidian-csvzall", type: "open-file", name: "a.csv", buffer: new ArrayBuffer(1)}});
  let finished = false;
  const save = bridge.saveFile({name: "a.csv", result: {buffer: new ArrayBuffer(1)}}).then(() => {finished = true;});
  await Promise.resolve();
  assert.equal(finished, false);
  const requestId = sent.at(-1).requestId;
  listener({source: {}, data: {source: "obsidian-csvzall", type: "save-result", requestId, success: true}});
  await Promise.resolve();
  assert.equal(finished, false);
  listener({source: parent, data: {source: "obsidian-csvzall", type: "save-result", requestId, success: true}});
  await save;
  assert.equal(finished, true);
  const failed = bridge.saveFile({name: "a.csv", result: {buffer: new ArrayBuffer(1)}});
  listener({source: parent, data: {source: "obsidian-csvzall", type: "save-result", requestId: sent.at(-1).requestId, success: false, error: "disk full"}});
  await assert.rejects(failed, /disk full/);
});

test("WASM save handler retains dirty state when edits occur during host write", async () => {
  const path = join("wasm-viewer", "assets", readdirSync("wasm-viewer/assets").find(name => /^index-.*\.js$/.test(name))!);
  const bundle = readFileSync(path, "utf8");
  const dirtyFunction = bundle.slice(bundle.indexOf("let csvzallEditRevision=0;function Bt"), bundle.indexOf("function St(e)"));
  const saveHandler = bundle.slice(bundle.indexOf('Bo.addEventListener("click"'), bundle.indexOf('Yl.addEventListener("click"'));
  let click: () => void = () => {};
  let acknowledge: () => void = () => {};
  const dirty: boolean[] = [];
  const context = {
    Bo: {addEventListener: (_: string, fn: () => void) => {click = fn;}},
    xe: true, Oe: "a.csv", ri: true, Uo() {}, ns() {}, Be() {}, B() {}, Ci() {},
    Se: async () => ({buffer: new ArrayBuffer(1)}),
    we: {emitDirtyState: (value: boolean) => dirty.push(value), saveFile: () => new Promise<boolean>(resolve => {acknowledge = () => resolve(true);})},
  };
  runInNewContext(`${dirtyFunction}${saveHandler};globalThis.edit=()=>Bt(true);`, context);
  click();
  await new Promise(resolve => setImmediate(resolve));
  (context as typeof context & {edit(): void}).edit();
  acknowledge();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.ri, true);
  assert.equal(dirty.includes(false), false);
  click();
  await new Promise(resolve => setImmediate(resolve));
  acknowledge();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.ri, false);
});

test("desktop release workflow publishes only standard Obsidian assets", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");

  assert.match(workflow, /assets=\(manifest\.json main\.js styles\.css\)/);
  assert.doesNotMatch(workflow, /csvzall-plugin\.zip/);
  assert.doesNotMatch(workflow, /zip -r .*wasm-viewer/);
  assert.match(workflow, /gh release upload "\$\{tag\}" "\$\{assets\[@\]\}" --clobber/);
  assert.match(workflow, /gh release create "\$\{tag\}" "\$\{assets\[@\]\}"/);
});

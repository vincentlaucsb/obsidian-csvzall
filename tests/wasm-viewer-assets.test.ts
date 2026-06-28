import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
  const stylesheetBundle = indexHtml.match(/<style data-csvzall-inline-viewer-style>\n?([\s\S]*?)\n?<\/style>/u)?.[1] ?? "";
  assert.notEqual(stylesheetBundle.length, 0);
  assert.match(indexBundle, /obsidian-csvzall/);
  assert.match(indexBundle, /csvzall-wasm-viewer/);
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

test("desktop release workflow publishes only standard Obsidian assets", () => {
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");

  assert.match(workflow, /assets=\(manifest\.json main\.js styles\.css\)/);
  assert.doesNotMatch(workflow, /csvzall-plugin\.zip/);
  assert.doesNotMatch(workflow, /zip -r .*wasm-viewer/);
  assert.match(workflow, /gh release upload "\$\{tag\}" "\$\{assets\[@\]\}" --clobber/);
  assert.match(workflow, /gh release create "\$\{tag\}" "\$\{assets\[@\]\}"/);
});

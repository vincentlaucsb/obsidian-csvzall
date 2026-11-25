import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";

const compiled = buildSync({ entryPoints: ["mobile-src/EmbeddedViewerDocument.ts"],
  bundle: true, write: false, platform: "browser", format: "cjs" }).outputFiles[0].text;
const compiledSession = buildSync({ entryPoints: ["mobile-src/WasmViewerSession.ts"],
  bundle: true, write: false, platform: "browser", format: "cjs",
  external: ["./wasmViewerAssets.generated.js"] }).outputFiles[0].text;
function fixture(code = compiled, assets = []) {
  const blobs = new Map(), revoked = [];
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, Blob, TextDecoder, TextEncoder, atob,
    require(name) { assert.equal(name, "./wasmViewerAssets.generated.js"); return { embeddedWasmViewerAssets: assets }; },
    URL: {
      createObjectURL(blob) { const url = `blob:viewer-${blobs.size}`; blobs.set(url, blob); return url; },
      revokeObjectURL(url) { revoked.push(url); },
    },
  });
  return { create: module.exports.createEmbeddedViewerDocument, session: module.exports, blobs, revoked };
}
const html = '<html><head><meta name="csvzall-embedded-assets" content="v2"><script type="module" src="./assets/index.js"></script><link rel="csvzall-worker" href="./assets/worker.js"></head><body></body></html>';
const script = 'const worker = "unchanged upstream bytes: café";';
const asset = (path, content) => ({ path: `wasm-viewer/${path}`, encoding: "base64", content: Buffer.from(content).toString("base64") });

test("desktop document uses bundled Blob script bytes and revokes all URLs on unload", async () => {
  const f = fixture();
  const document = f.create([asset("index.html", html), asset("assets/index.js", script), asset("assets/worker.js", "self.onmessage = () => {};")]);
  assert.equal(f.blobs.size, 3);
  assert.equal(await f.blobs.get("blob:viewer-0").text(), script);
  const page = await f.blobs.get(document.url).text();
  assert.match(page, /src="blob:viewer-0"/);
  assert.match(page, /rel="csvzall-worker" href="blob:viewer-1"/);
  assert.doesNotMatch(page, /src="\.\/|app:\/\//);
  assert.equal(f.blobs.get("blob:viewer-0").type, "text/javascript");
  assert.equal(f.blobs.get(document.url).type, "text/html");
  document.dispose(); document.dispose();
  assert.deepEqual(f.revoked, [...f.blobs.keys()]);
});

test("multiple Lite panes reuse the worker script URL until the plugin unloads", async () => {
  const f = fixture(compiledSession, [asset("index.html", html), asset("assets/index.js", script), asset("assets/worker.js", "self.onmessage = () => {};")]);
  const page = f.session.embeddedWasmViewerUrl();
  const firstUrls = [...f.blobs.keys()];
  const worker = (await f.blobs.get(page).text()).match(/rel="csvzall-worker" href="([^"]+)"/)[1];
  assert.ok(f.blobs.has(worker));
  assert.equal(f.session.embeddedWasmViewerUrl(), page);
  assert.deepEqual([...f.blobs.keys()], firstUrls);
  assert.deepEqual(f.revoked, []);
  f.session.releaseEmbeddedWasmViewer();
  assert.deepEqual(f.revoked, firstUrls);
  const reopened = f.session.embeddedWasmViewerUrl();
  assert.notEqual(reopened, page);
  assert.ok(!(await f.blobs.get(reopened).text()).includes(worker));
  f.session.releaseEmbeddedWasmViewer();
});

test("unsupported split-asset builds and missing assets fail without leaking URLs", () => {
  const f = fixture();
  assert.throws(() => f.create([asset("index.html", '<script src="./assets/index.js"></script>')]), /embedded build/);
  assert.equal(f.blobs.size, 0);
  assert.throws(() => f.create([asset("index.html", html), asset("assets/index.js", script)]), /Missing bundled viewer asset: assets\/worker.js/);
  assert.deepEqual(f.revoked, [...f.blobs.keys()]);
});

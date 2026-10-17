import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";

const compiled = buildSync({ entryPoints: ["mobile-src/EmbeddedViewerDocument.ts"],
  bundle: true, write: false, platform: "browser", format: "cjs" }).outputFiles[0].text;
function fixture() {
  const blobs = new Map(), revoked = [];
  const module = { exports: {} };
  runInNewContext(compiled, { module, exports: module.exports, Blob, TextDecoder, TextEncoder, atob,
    URL: {
      createObjectURL(blob) { const url = `blob:viewer-${blobs.size}`; blobs.set(url, blob); return url; },
      revokeObjectURL(url) { revoked.push(url); },
    },
  });
  return { create: module.exports.createEmbeddedViewerDocument, blobs, revoked };
}
const html = '<html><head><meta name="csvzall-embedded-assets" content="v1"><script type="module" src="./assets/index.js"></script></head><body></body></html>';
const script = 'const worker = "unchanged upstream bytes: café";';
const asset = (path, content) => ({ path: `wasm-viewer/${path}`, encoding: "base64", content: Buffer.from(content).toString("base64") });

test("desktop document uses bundled Blob script bytes and revokes all URLs on unload", async () => {
  const f = fixture();
  const document = f.create([asset("index.html", html), asset("assets/index.js", script)]);
  assert.equal(f.blobs.size, 2);
  assert.equal(await f.blobs.get("blob:viewer-0").text(), script);
  const page = await f.blobs.get(document.url).text();
  assert.match(page, /src="blob:viewer-0"/);
  assert.doesNotMatch(page, /src="\.\/|app:\/\//);
  assert.equal(f.blobs.get("blob:viewer-0").type, "text/javascript");
  assert.equal(f.blobs.get(document.url).type, "text/html");
  document.dispose(); document.dispose();
  assert.deepEqual(f.revoked, [...f.blobs.keys()]);
});

test("unsupported split-asset builds and missing assets fail without leaking URLs", () => {
  const f = fixture();
  assert.throws(() => f.create([asset("index.html", '<script src="./assets/index.js"></script>')]), /embedded build/);
  assert.equal(f.blobs.size, 0);
  assert.throws(() => f.create([asset("index.html", html.replace('</head>', '<link href="./missing.png"></head>')), asset("assets/index.js", script)]), /Missing bundled viewer asset/);
  assert.deepEqual(f.revoked, [...f.blobs.keys()]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Exercise the worker and WASM bytes shipped inside the generated Community
// plugin, rather than substituting the current upstream build or a mock engine.
function packagedWorker() {
  const bundle = readFileSync(".mobile-dist/main.js", "utf8");
  const assets = new Map(Array.from(bundle.matchAll(
    /path:"([^"]+)",encoding:"base64",content:"([^"]+)"/gu,
  ), ([, path, content]) => [path, Buffer.from(content, "base64")]));
  const metadata = JSON.parse(assets.get("wasm-viewer/csvzall-wasm-viewer.json").toString());
  const viewer = Array.from(assets).find(([path]) => /^wasm-viewer\/assets\/.*\.js$/u.test(path))[1].toString();
  assert.equal(createHash("sha256").update(viewer).digest("hex"), metadata.javascriptSha256);
  assert.equal(metadata.sourceDirty, false);
  assert.ok(viewer.includes("csvzall-csv-options-v1"));
  assert.ok(viewer.includes("csvzall-host-mobile-ui-v1"));
  assert.ok(viewer.includes('id="csv-options-header-warning"'));
  assert.ok(viewer.includes('aria-describedby="csv-options-header-help"'));
  assert.ok(assets.get("wasm-viewer/index.html").toString().includes(".csv-header-warning"));
  const source = ts.createSourceFile("viewer.js", viewer, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  let workerSource;
  function findWorker(node) {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      && node.text.includes("data:application/wasm;base64,")) workerSource = node.text;
    if (!workerSource) ts.forEachChild(node, findWorker);
  }
  findWorker(source);
  assert.ok(workerSource, "the packaged viewer must contain its compiled worker and WASM engine");
  let receive;
  let id = 0;
  const pending = new Map();
  const self = {
    location: { href: "blob:app://obsidian.md/worker" },
    addEventListener(type, listener) { if (type === "message") receive = listener; },
    postMessage(message) { pending.get(message.id)(message); pending.delete(message.id); },
  };
  runInNewContext(workerSource, {
    self, location: self.location, process: { versions: { node: "24.0.0" } },
    WorkerGlobalScope: class {}, navigator: { userAgent: "Chrome/140.0.0.0" },
    URL, fetch, console, performance, TextDecoder, TextEncoder, atob,
    WebAssembly, ArrayBuffer, Uint8Array, setTimeout, clearTimeout, crypto: webcrypto,
  });
  const request = (type, payload = {}) => new Promise(resolve => {
    pending.set(++id, resolve);
    receive({ data: { id, type, payload } });
  });
  const check = async (type, payload) => {
    const response = await request(type, payload);
    assert.equal(response.ok, true, response.error);
    return response.result;
  };
  return {
    request, check,
    open: text => check("open", { name: "fixture.csv", buffer: new TextEncoder().encode(text).buffer }),
    async save() {
      const saved = await check("save");
      return new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(saved.buffer, saved.byteOffset, saved.byteLength));
    },
  };
}

test("packaged Lite worker preserves delimiters, quotes, BOM, newlines and headerless data", async () => {
  const worker = packagedWorker();
  await worker.check("init");
  for (const delimiter of [",", ";", "\t", "|"]) {
    for (const quote of ['"', "'"]) {
      for (const bom of ["", "\ufeff"]) {
        for (const newline of ["\n", "\r\n"]) {
          const text = `${bom}name${delimiter}note${newline}alice${delimiter}${quote}two${delimiter}values${quote}${newline}`;
          const schema = await worker.open(text);
          assert.equal(schema.csvOptions.delimiter, delimiter);
          assert.equal(schema.csvOptions.quote, quote);
          assert.equal(schema.csvOptions.bom, Boolean(bom));
          assert.equal(await worker.save(), text);
          await worker.check("editCell", { rowIndex: 0, column: "name", value: "edited" });
          const headerless = await worker.check("csvOptions", { delimiter, quote, hasHeaders: false });
          assert.equal(headerless.columns.join(","), "A,B");
          assert.equal(headerless.rowCount, 2);
          assert.equal(await worker.save(), text.replace("alice", "edited"));
        }
      }
    }
  }
});

test("packaged Lite worker keeps wider rows and the first row, blocks headers, and permits repair", async () => {
  const worker = packagedWorker();
  await worker.check("init");
  for (const delimiter of [",", ";", "\t", "|"]) {
    const text = `a${delimiter}b\n1${delimiter}2\n3${delimiter}4${delimiter}EXTRA\n5${delimiter}6\n`;
    const schema = await worker.open(text);
    assert.equal(schema.csvOptions.delimiter, delimiter);
    assert.equal(schema.csvOptions.hasHeaders, false);
    assert.match(schema.csvOptions.headersDisabledReason, /3 versus 2/);
    assert.equal(schema.columns.join(","), "A,B,C");
    assert.equal(schema.rowCount, 4);
    const expected = [["a", "b", ""], ["1", "2", ""], ["3", "4", "EXTRA"], ["5", "6", ""]];
    for (let offset = 0; offset < 4; offset++) {
      assert.equal(JSON.stringify((await worker.check("readRows", { offset, limit: 1 })).rows[0]), JSON.stringify(expected[offset]));
    }
    const rejected = await worker.request("csvOptions", { delimiter, quote: '"', hasHeaders: true });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /Headers are disabled/);
    await worker.check("editCell", { rowIndex: 0, column: "C", value: "c" });
    assert.equal(await worker.save(), `a${delimiter}b${delimiter}c\n1${delimiter}2${delimiter}\n3${delimiter}4${delimiter}EXTRA\n5${delimiter}6${delimiter}\n`);
    const repaired = await worker.check("csvOptions", { delimiter, quote: '"', hasHeaders: true });
    assert.equal(repaired.csvOptions.hasHeaders, true);
    assert.equal(repaired.csvOptions.headersDisabledReason, undefined);
    assert.equal(repaired.rowCount, 3);
  }
  // A comma in the short first record must not override a delimiter inferred
  // from later records. This covers the sparse-header regression found during
  // the desktop review using the actual mobile release payload.
  for (const delimiter of ["\t", ";"]) {
    const text = `name, role\nAlice, admin${delimiter}London\nBob${delimiter}Paris\nCarol${delimiter}Rome\nDan${delimiter}Berlin\n`;
    const schema = await worker.open(text);
    assert.equal(schema.csvOptions.delimiter, delimiter);
    assert.equal(schema.csvOptions.hasHeaders, false);
    assert.equal(schema.rowCount, 5);
    assert.equal(await worker.save(), text.replace("name, role\n", `name, role${delimiter}\n`));
  }
});

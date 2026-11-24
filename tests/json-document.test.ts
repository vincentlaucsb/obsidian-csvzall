import test from "node:test";
import assert from "node:assert/strict";
import { JsonDocument } from "../src/views/jsonDocument.js";

test("compact JSON opens indented and saves edited tokens with original framing", () => {
  const source = '\uFEFF{"id":9007199254740993,"tag":"\\u0041","tag":"a b,]","n":1.00,"items":[{},true,null]}\r\n';
  const doc = new JsonDocument(source);
  assert.ok(doc.display.includes('\n  "items": [\n    {},\n    true,\n    null\n  ]'));
  assert.equal(doc.serialize(doc.display), source);
  assert.equal(doc.serialize(doc.display.replace("a b,]", 'c d,]')), source.replace("a b,]", "c d,]"));
});

test("formatted JSON keeps inline arrays, tabs, newline style, and trailing newline", () => {
  for (const eol of ["\r\n", "\n", "\r"]) {
    const source = ["{", '\t"coordinates": [12, 34]', "}", ""].join(eol);
    const doc = new JsonDocument(source);
    assert.equal(doc.indent, "\t");
    assert.equal(doc.serialize(doc.display.replace("12", "42")), source.replace("12", "42"));
  }
});

test("malformed input and unfinished edits remain editable as literal text", () => {
  const source = '{"broken":  }';
  const doc = new JsonDocument(source);
  assert.equal(doc.display, source);
  assert.equal(doc.serialize(doc.display), source);
  assert.equal(new JsonDocument("{}").serialize('{\n  "x":'), '{\n  "x":');
});

test("mixed indentation can be edited and long whitespace inside strings is data", () => {
  const doc = new JsonDocument('{\n \t"x": 1\n}');
  assert.equal(doc.indent, "  ");
  assert.equal(doc.serialize(doc.display.replace("1", "2")), '{\n \t"x": 2\n}');
  const spaces = " ".repeat(100_000);
  const source = `{"value":"${spaces}","end":1}`;
  const compact = new JsonDocument(source);
  assert.equal(compact.serialize(compact.display.replace('"end": 1', '"end": 2')), source.replace('"end":1', '"end":2'));
});

test("a long escaped JSON string opens without consuming the regex stack", () => {
  const value = '\\"'.repeat(1024 * 1024) + "a".repeat(8 * 1024 * 1024);
  const source = JSON.stringify({ value, count: 1 });
  const doc = new JsonDocument(source);
  assert.equal(doc.serialize(doc.display.replace('"count": 1', '"count": 2')), source.replace('"count":1', '"count":2'));
});

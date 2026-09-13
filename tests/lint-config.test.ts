import test from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";
import { readFileSync } from "node:fs";

const unsafeFixture = `
declare const unsafe: any;
unsafe();
const assigned: string = unsafe;
const field: unknown = unsafe.value;
function accept(value: string): void {}
accept(unsafe);
function result(): string { return unsafe; }
type Union = any | string;
void Promise.reject("not an Error");
`;

test("desktop and mobile lint reject every reported type-safety category", async () => {
  const eslint = new ESLint();
  const rules = [
    "no-explicit-any", "no-unsafe-call", "no-unsafe-member-access",
    "no-unsafe-assignment", "no-unsafe-return", "no-unsafe-argument",
    "no-redundant-type-constituents", "prefer-promise-reject-errors",
  ];
  for (const filePath of ["src/main.ts", "mobile-src/main.ts"]) {
    const results = await eslint.lintText(unsafeFixture, { filePath });
    const messages = results.flatMap((result) => result.messages);
    assert.equal(messages.some((message) => message.fatal), false);
    for (const rule of rules) {
      assert.ok(messages.some((message) => message.ruleId === `@typescript-eslint/${rule}` && message.severity === 2),
        `${filePath} must reject ${rule}`);
    }
  }
});

test("production entry points gate bundling, including direct mobile sync builds", () => {
  const desktop = readFileSync("esbuild.config.mjs", "utf8");
  const mobile = readFileSync("scripts/build-mobile.mjs", "utf8");
  const sync = readFileSync("scripts/sync-mobile-repo.mjs", "utf8");
  assert.match(desktop, /if \(prod\) runTypeSafetyChecks\(\);/);
  assert.ok(desktop.indexOf("runTypeSafetyChecks();") < desktop.indexOf("await esbuild.context("));
  assert.match(mobile, /runTypeSafetyChecks\(\);\s*generateEmbeddedAssetModule\(\);/);
  assert.match(sync, /runNodeScript\("build-mobile\.mjs"\)/);
});

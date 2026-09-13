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
setTimeout(() => {}, 10);
clearTimeout(1);
`;

test("desktop and mobile lint reject every reported type-safety category", async () => {
  const eslint = new ESLint({
    // lintText replaces file contents in memory. CI's immutable-program
    // optimization otherwise reuses the actual (safe) source from disk.
    overrideConfig: {
      languageOptions: { parserOptions: { disallowAutomaticSingleRunInference: true } },
    },
  });
  const rules = [
    "no-explicit-any", "no-unsafe-call", "no-unsafe-member-access",
    "no-unsafe-assignment", "no-unsafe-return", "no-unsafe-argument",
    "no-redundant-type-constituents", "prefer-promise-reject-errors",
  ];
  for (const filePath of ["src/main.ts", "mobile-src/main.ts"]) {
    const results = await eslint.lintText(unsafeFixture, { filePath });
    const messages = results.flatMap((result) => result.messages);
    assert.equal(messages.some((message) => message.fatal), false);
    assert.ok(messages.some((message) => message.ruleId === "no-restricted-syntax" && message.severity === 2),
      `${filePath} must reject ambiguous timer calls`);
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

test("Obsidian API lint rejects newer APIs even behind runtime guards", async () => {
  const fixture = `import { PluginSettingTab } from "obsidian";
    class Tab extends PluginSettingTab {
      display(): void {
        if (typeof this.update === "function") this.update();
      }
    }`;
  for (const minAppVersion of ["1.5.0", "1.13.0"]) {
    const eslint = new ESLint({ overrideConfig: {
      languageOptions: { parserOptions: { disallowAutomaticSingleRunInference: true } },
      rules: { "obsidianmd/no-unsupported-api": ["error", { minAppVersion }] },
    } });
    const results = await eslint.lintText(fixture, { filePath: "src/settings/SettingsTab.ts" });
    const messages = results.flatMap(result => result.messages);
    assert.equal(messages.some(message => message.fatal), false);
    assert.equal(messages.some(message => message.ruleId === "obsidianmd/no-unsupported-api"),
      minAppVersion === "1.5.0");
  }
});

test("API compatibility checks use each distribution's declared minimum version", async () => {
  const eslint = new ESLint();
  for (const [filePath, manifestPath] of [["src/main.ts", "manifest.json"],
    ["mobile-src/main.ts", "mobile-src/manifest.json"]]) {
    const config = await eslint.calculateConfigForFile(filePath!);
    const rule = config.rules["obsidianmd/no-unsupported-api"];
    assert.equal(rule[0], 2);
    const manifest = JSON.parse(readFileSync(manifestPath!, "utf8"));
    if (manifestPath === "manifest.json") {
      const versions = JSON.parse(readFileSync("versions.json", "utf8"));
      assert.equal(versions[manifest.version], manifest.minAppVersion);
    } else {
      assert.equal(rule[1].minAppVersion, manifest.minAppVersion);
    }
  }
});

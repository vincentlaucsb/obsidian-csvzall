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
import { TFile } from "obsidian";
declare const file: unknown;
void (file as TFile);
void /[\\x00-\\x1f]/;
const receiver = { value: 1, method() { return this.value; } };
const detached = receiver.method;
declare const text: string;
void (text as string);
/** @deprecated Use current APIs. */
function outdated(): void {}
outdated();
async function invalidAwait(): Promise<void> { await 42; }
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
    "unbound-method", "no-unnecessary-type-assertion", "no-deprecated", "await-thenable",
  ];
  for (const filePath of ["src/main.ts", "mobile-src/main.ts"]) {
    const results = await eslint.lintText(unsafeFixture, { filePath });
    const messages = results.flatMap((result) => result.messages);
    assert.equal(messages.some((message) => message.fatal), false);
    assert.ok(messages.some((message) => message.ruleId === "no-restricted-syntax" && message.severity === 2),
      `${filePath} must reject ambiguous timer calls`);
    for (const rule of ["obsidianmd/no-tfile-tfolder-cast", "no-control-regex"]) {
      assert.ok(messages.some(message => message.ruleId === rule && message.severity === 2), `${filePath} must reject ${rule}`);
    }
    for (const rule of rules) {
      assert.ok(messages.some((message) => message.ruleId === `@typescript-eslint/${rule}` && message.severity === 2),
        `${filePath} must reject ${rule}`);
    }
  }
});

test("desktop settings reject leftover display overrides after declarative migration", async () => {
  const eslint = new ESLint({ overrideConfig: {
    languageOptions: { parserOptions: { disallowAutomaticSingleRunInference: true } },
  } });
  const result = await eslint.lintText(`import { PluginSettingTab } from "obsidian";
    class Tab extends PluginSettingTab {
      display(): void { this.update(); }
      getSettingDefinitions() { return []; }
    }`, { filePath: "src/settings/SettingsTab.ts" });
  assert.ok(result.flatMap(item => item.messages).some(message =>
    message.ruleId === "obsidianmd/settings-tab/no-deprecated-display" && message.severity === 2));
});

test("runtime lint rejects unused imports and dynamic imports in authored TS and MJS", async () => {
  const eslint = new ESLint({ overrideConfig: { languageOptions: { parserOptions: { disallowAutomaticSingleRunInference: true } } } });
  for (const filePath of ["src/main.ts", "mobile-src/main.ts", "src/markdown/table-form.mjs"]) {
    const result = await eslint.lintText('import { Notice } from "obsidian"; void import("obsidian");', { filePath });
    const messages = result.flatMap(item => item.messages);
    assert.equal(messages.some(item => item.fatal), false);
    assert.ok(messages.some(item => item.ruleId?.endsWith("no-unused-vars")), filePath);
    assert.ok(messages.some(item => item.ruleId === "no-restricted-syntax"), filePath);
  }
});

test("mobile runtime and shared utilities reject built-ins, Electron and guarded require calls", async () => {
  const eslint = new ESLint({ overrideConfig: {
    languageOptions: { parserOptions: { disallowAutomaticSingleRunInference: true } },
  } });
  for (const filePath of ["mobile-src/main.ts", "src/utils/paths.ts"]) {
    for (const code of ['import "node:fs/promises";', 'import "fs";', 'import "electron";', 'if (true) require("path");', 'import fs = require("fs");']) {
      const results = await eslint.lintText(code, { filePath });
      assert.ok(results.flatMap(item => item.messages).some(item => item.severity === 2 &&
        (item.ruleId === "no-restricted-imports" || item.ruleId === "no-restricted-syntax")), `${filePath}: ${code}`);
    }
  }
});

test("settings heading and command naming instructions have effective rules", async () => {
  const eslint = new ESLint({ overrideConfig: {
    languageOptions: { parserOptions: { disallowAutomaticSingleRunInference: true } },
  } });
  const result = await eslint.lintText(`import { PluginSettingTab, Setting } from "obsidian";
    class Tab extends PluginSettingTab {
      getSettingDefinitions() {
        this.containerEl.createEl("h2", {text: "General"});
        new Setting(this.containerEl).setName("General settings").setHeading();
        return [];
      }
    }
    declare const plugin: import("obsidian").Plugin;
    plugin.addCommand({ id: "example", name: "csvzall example", callback() {} });`, { filePath: "src/settings/SettingsTab.ts" });
  const messages = result.flatMap(item => item.messages);
  for (const rule of ["settings-tab/no-manual-html-headings", "settings-tab/no-problematic-settings-headings", "commands/no-plugin-name-in-command-name"]) {
    assert.ok(messages.some(item => item.ruleId === `obsidianmd/${rule}`), rule);
  }
});

test("desktop and mobile lint require descriptions on opening and closing directive comments", async () => {
  const eslint = new ESLint({ overrideConfig: {
    languageOptions: { parserOptions: { disallowAutomaticSingleRunInference: true } },
  } });
  for (const filePath of ["src/main.ts", "mobile-src/main.ts"]) {
    for (const directive of ["eslint-disable", "eslint-disable-next-line", "eslint-enable"]) {
      const undescribed = await eslint.lintText(`/* ${directive} @typescript-eslint/unbound-method */\n`, { filePath });
      assert.ok(undescribed.flatMap(item => item.messages).some(message =>
        message.ruleId === "eslint-comments/require-description" && message.severity === 2), `${filePath}: ${directive}`);
      const described = await eslint.lintText(`/* ${directive} @typescript-eslint/unbound-method -- Receiver is supplied explicitly. */\n`, { filePath });
      assert.equal(described.flatMap(item => item.messages).some(message =>
        message.ruleId === "eslint-comments/require-description"), false, `${filePath}: described ${directive}`);
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

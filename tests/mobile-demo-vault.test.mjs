import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { mobileDemoFiles, setupMobileDemoVault } from "../scripts/setup-mobile-demo-vault.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "csvzall-mobile-demo-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dist = join(root, "dist"), template = resolve("mobile-demo-vault"), vault = join(root, "vault");
  mkdirSync(dist);
  writeFileSync(join(dist, "main.js"), "mobile build one\n");
  writeFileSync(join(dist, "styles.css"), "/* mobile styles */\n");
  writeFileSync(join(dist, "manifest.json"), JSON.stringify({ id: "csvzall-mobile", version: "0.1.2", isDesktopOnly: false }));
  return { root, dist, template, vault };
}

test("mobile demo refresh installs portable artifacts and preserves edits and local state", t => {
  const options = fixture(t);
  setupMobileDemoVault(options);
  const plugin = join(options.vault, ".obsidian/plugins/csvzall-mobile");
  for (const file of mobileDemoFiles) assert.ok(existsSync(join(options.vault, file)));
  for (const file of ["main.js", "manifest.json", "styles.css"]) {
    assert.equal(lstatSync(join(plugin, file)).isSymbolicLink(), false);
    assert.deepEqual(readFileSync(join(plugin, file)), readFileSync(join(options.dist, file)));
  }
  const data = join(plugin, "data.json"), workspace = join(options.vault, ".obsidian/workspace-mobile.json");
  const app = join(options.vault, ".obsidian/app.json");
  assert.equal(JSON.parse(readFileSync(app, "utf8")).showUnsupportedFiles, true);
  const enabled = join(options.vault, ".obsidian/community-plugins.json");
  writeFileSync(data, '{"local":true}\n');
  writeFileSync(workspace, '{"workspace":"device"}\n');
  writeFileSync(app, '{"local":true,"showUnsupportedFiles":false}\n');
  writeFileSync(enabled, '["other-plugin","csvzall-mobile"]\n');
  writeFileSync(join(options.vault, "Tasks.csv"), "edited fixture\n");
  writeFileSync(join(options.vault, "Private note.md"), "local note\n");
  writeFileSync(join(options.dist, "main.js"), "mobile build two\n");
  setupMobileDemoVault(options);
  assert.equal(readFileSync(join(plugin, "main.js"), "utf8"), "mobile build two\n");
  assert.equal(readFileSync(join(options.vault, "Tasks.csv"), "utf8"), "edited fixture\n");
  assert.equal(readFileSync(join(options.vault, "Private note.md"), "utf8"), "local note\n");
  assert.equal(readFileSync(data, "utf8"), '{"local":true}\n');
  assert.equal(readFileSync(workspace, "utf8"), '{"workspace":"device"}\n');
  assert.equal(readFileSync(app, "utf8"), '{"local":true,"showUnsupportedFiles":false}\n');
  assert.equal(readFileSync(enabled, "utf8"), '["other-plugin","csvzall-mobile"]\n');
});

test("mobile setup adds CSV visibility to an existing app config while preserving other preferences", t => {
  const options = fixture(t);
  mkdirSync(join(options.vault, ".obsidian"), { recursive: true });
  const app = join(options.vault, ".obsidian/app.json");
  writeFileSync(app, '{"alwaysUpdateLinks":true}\n');
  setupMobileDemoVault(options);
  assert.deepEqual(JSON.parse(readFileSync(app, "utf8")), {
    alwaysUpdateLinks: true, showUnsupportedFiles: true,
  });
});

test("mobile setup rejects desktop bundles before creating a vault", t => {
  const options = fixture(t);
  writeFileSync(join(options.dist, "manifest.json"), '{"id":"csvzall","isDesktopOnly":true}');
  assert.throws(() => setupMobileDemoVault(options), /Expected a mobile distribution/);
  assert.equal(existsSync(options.vault), false);
});

test("mobile setup refuses directory junctions without touching external vault settings", t => {
  const options = fixture(t);
  const external = join(options.root, "external");
  mkdirSync(external);
  mkdirSync(options.vault);
  writeFileSync(join(external, "community-plugins.json"), '["private"]\n');
  symlinkSync(external, join(options.vault, ".obsidian"), "junction");
  assert.throws(() => setupMobileDemoVault(options), /non-ordinary path/);
  assert.equal(readFileSync(join(external, "community-plugins.json"), "utf8"), '["private"]\n');
  assert.equal(existsSync(join(external, "plugins")), false);
});

test("setup runs from a generated checkout without the source repository", t => {
  const options = fixture(t);
  const template = join(options.dist, "demo-vault");
  for (const file of mobileDemoFiles) {
    const target = join(template, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(options.template, file), target);
  }
  mkdirSync(join(options.dist, "scripts"));
  const script = join(options.dist, "scripts/setup-mobile-demo-vault.mjs");
  copyFileSync(resolve("scripts/setup-mobile-demo-vault.mjs"), script);
  for (let run = 0; run < 2; run += 1) execFileSync(process.execPath, [script], { cwd: options.dist });
  const plugin = join(template, ".obsidian/plugins/csvzall-mobile");
  assert.deepEqual(readFileSync(join(plugin, "main.js")), readFileSync(join(options.dist, "main.js")));
  assert.deepEqual(JSON.parse(readFileSync(join(template, ".obsidian/community-plugins.json"), "utf8")), ["csvzall-mobile"]);
});

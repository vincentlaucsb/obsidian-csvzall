import test from "node:test";
import assert from "node:assert/strict";
import { ancestorVaultFolders, isCanonicalVaultPath, joinVaultPath, normalizeVaultPath, parentVaultPath, relativeVaultPath, resolveVaultRelativePath } from "../src/utils/paths.js";
import { portableBasename } from "../src/utils/filenames.js";
import { absoluteReference, ancestorConfigPaths, configPathForFolder, configRoot, directConfig, relativeReference } from "../src/exports/paths.js";
import { nextCsvPath } from "../src/csv/csvFiles.js";
import { pluginVaultDirectory } from "../src/obsidian/pluginPaths.js";
import { resolveChartPath } from "../src/chartAutomation.js";

test("vault normalization preserves case and asset installation's leading-dot behavior", () => {
  assert.equal(normalizeVaultPath(".\\Données\\Tasks.CSV"), "Données/Tasks.CSV");
  assert.equal(normalizeVaultPath("///Data//tasks.csv"), "Data/tasks.csv");
  assert.equal(normalizeVaultPath("/"), "");
  assert.equal(normalizeVaultPath("./assets//viewer.js", { stripLeadingDot: false }), "./assets/viewer.js");
});

test("vault folder operations handle root files and enumerate ancestors nearest first", () => {
  assert.equal(parentVaultPath("tasks.csv"), "");
  assert.equal(parentVaultPath("Data/tasks.csv"), "Data");
  assert.equal(joinVaultPath("", "tasks.csv"), "tasks.csv");
  assert.equal(joinVaultPath("Data", "tasks.csv"), "Data/tasks.csv");
  assert.deepEqual(ancestorVaultFolders("Reports/Weekly"), ["Reports/Weekly", "Reports", ""]);
  assert.deepEqual(ancestorVaultFolders(""), [""]);
});

test("relative vault references round-trip across folders and preserve Unicode", () => {
  for (const [base, target, expected] of [
    ["", "Data/é.csv", "Data/é.csv"],
    ["Reports", "Data/é.csv", "../Data/é.csv"],
    ["Reports/Weekly", "Reports/é.csv", "../é.csv"],
    ["Data", "Data/tasks.csv", "tasks.csv"],
    ["Data", "Data", ""],
  ] as const) {
    const reference = relativeVaultPath(base, target);
    assert.equal(reference, expected);
    assert.equal(resolveVaultRelativePath(base, reference), target);
  }
  assert.equal(resolveVaultRelativePath("Reports", ".\\..\\Data//tasks.csv"), "Data/tasks.csv");
  assert.equal(resolveVaultRelativePath("Reports", ""), "Reports");
});

test("strict resolution rejects absolute paths and traversal beyond the vault", () => {
  for (const reference of ["/tasks.csv", "\\tasks.csv", "C:\\tasks.csv", "\\\\server\\tasks.csv", "../../tasks.csv", "../a/../../tasks.csv"]) {
    assert.equal(resolveVaultRelativePath("Reports", reference), null, reference);
  }
  assert.equal(resolveVaultRelativePath("", "../tasks.csv"), null);
  // Legacy chart parsing intentionally preserves unresolved leading parent segments.
  assert.equal(resolveChartPath(".csvzall/charts.json", "../tasks.csv"), "../tasks.csv");
});

test("canonical path validation remains stricter than relative reference resolution", () => {
  assert.equal(isCanonicalVaultPath("Données/tasks.CSV"), true);
  for (const path of ["", "/tasks.csv", "a//tasks.csv", "a/../tasks.csv", "./tasks.csv", "a/", "a\\tasks.csv", "C:/tasks.csv"]) {
    assert.equal(isCanonicalVaultPath(path), false, path);
  }
  assert.equal(resolveVaultRelativePath("", "a/../tasks.csv"), "tasks.csv");
});

test("export paths use the folder containing .csvzall and retain root ancestry", () => {
  assert.equal(configPathForFolder("", "charts"), ".csvzall/charts.json");
  assert.equal(directConfig("Reports/note.md", "exports"), "Reports/.csvzall/exports.json");
  assert.equal(configRoot("Reports/.csvzall/exports.json"), "Reports");
  assert.equal(configRoot(".csvzall/charts.json"), "");
  assert.deepEqual(ancestorConfigPaths("Reports/Weekly/note.md", "exports"), [
    "Reports/Weekly/.csvzall/exports.json", "Reports/.csvzall/exports.json", ".csvzall/exports.json",
  ]);
  assert.deepEqual(ancestorConfigPaths("tasks.csv", "charts"), [".csvzall/charts.json"]);
  assert.equal(absoluteReference("Reports/.csvzall/exports.json", "../Data/é.csv"), "Data/é.csv");
  assert.equal(relativeReference("Reports/.csvzall/exports.json", "Data/é.csv"), "../Data/é.csv");
  assert.throws(() => absoluteReference(".csvzall/exports.json", "../tasks.csv"), /leaves the vault/);
  assert.throws(() => absoluteReference(".csvzall/exports.json", ""), /Invalid export path/);
});

test("CSV allocation shares collision and root-folder behavior across distributions", () => {
  assert.equal(nextCsvPath("/", () => false), "Untitled.csv");
  const occupied = new Set(["Data/Untitled.csv", "Data/Untitled 1.csv"]);
  assert.equal(nextCsvPath(".\\Data", path => occupied.has(path)), "Data/Untitled 2.csv");
  assert.throws(() => nextCsvPath("Data", () => true), /Could not find an available Untitled CSV filename/);
});

test("plugin directory selection respects custom configuration folders and manifest directories", () => {
  assert.equal(pluginVaultDirectory(".custom", { id: "csvzall" }), ".custom/plugins/csvzall");
  assert.equal(pluginVaultDirectory(".custom", { id: "csvzall", dir: "Local/plugins/development" }), "Local/plugins/development");
});

test("portable basenames support checksum and archive names from either operating system", () => {
  for (const path of ["nested/csvzall.exe", "nested\\csvzall.exe", "csvzall.exe"]) {
    assert.equal(portableBasename(path), "csvzall.exe");
  }
  assert.equal(portableBasename("nested/"), "");
  assert.equal(portableBasename(""), "");
});

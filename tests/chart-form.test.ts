import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("shared chart options work through the bundled form contract", () => {
  const result = spawnSync(process.execPath, ["--test", "tests/chart-form.test.mjs"], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

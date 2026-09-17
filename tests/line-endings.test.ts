import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

test("line-ending gate rejects mixed/CRLF text, fixes bytes safely, and respects exclusions", () => {
  const root = mkdtempSync(join(tmpdir(), "csvzall-eol-"));
  const script = pathToFileURL(resolve("scripts/check-line-endings.mjs")).href;
  try {
    execFileSync("git", ["init", "--quiet", root]);
    writeFileSync(join(root, ".gitattributes"), "* text=auto eol=lf\nimported.js -text\n");
    writeFileSync(join(root, ".gitignore"), "ignored.txt\n");
    writeFileSync(join(root, "mixed.txt"), "one\r\ntwo\nthree\rfour café\n");
    writeFileSync(join(root, "windows.txt"), "one\r\ntwo\r\n");
    writeFileSync(join(root, "imported.js"), "exact\r\nbytes\n");
    writeFileSync(join(root, "ignored.txt"), "local\r\n");
    writeFileSync(join(root, "binary.bin"), Buffer.from([0, 13, 10, 255]));
    const run = (fix: boolean) => execFileSync(process.execPath, [
      "--input-type=module", "-e",
      "const m = await import(process.argv[1]); m.checkLineEndings({root:process.argv[2],fix:process.argv[3]==='true'});",
      script, root, String(fix),
    ], { stdio: "pipe" });
    assert.throws(() => run(false), /Expected LF line endings:[\s\S]*mixed.txt[\s\S]*windows.txt/);
    run(true);
    run(false);
    assert.equal(readFileSync(join(root, "mixed.txt"), "utf8"), "one\ntwo\nthree\nfour café\n");
    assert.equal(readFileSync(join(root, "windows.txt"), "utf8"), "one\ntwo\n");
    assert.equal(readFileSync(join(root, "imported.js"), "utf8"), "exact\r\nbytes\n");
    assert.equal(readFileSync(join(root, "ignored.txt"), "utf8"), "local\r\n");
    assert.deepEqual(readFileSync(join(root, "binary.bin")), Buffer.from([0, 13, 10, 255]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

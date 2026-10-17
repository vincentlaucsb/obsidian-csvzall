import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ignore from "ignore";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Community build verification uses source archives with no Git metadata.
// Honor repository exclusions and -text attributes there as well as in Git.
export function archiveFileInfo(root) {
  const files = [], untouched = new Set();
  const readOptional = path => existsSync(path) ? readFileSync(path, "utf8") : "";
  function walk(directory, parents = []) {
    const attributes = readOptional(join(root, directory, ".gitattributes"))
      .split(/\r?\n/).flatMap(line => {
        const [pattern, ...values] = line.trim().split(/\s+/);
        if (!pattern || pattern.startsWith("#")) return [];
        const text = values.filter(value => /^(?:-text|!?text|text=auto)$/.test(value)).at(-1);
        return text ? [{ matcher: ignore().add(pattern), preserve: text === "-text" }] : [];
      });
    const scopes = [...parents, {
      directory, ignored: ignore().add(readOptional(join(root, directory, ".gitignore"))), attributes,
    }];
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (entry.name === ".git" || entry.isSymbolicLink()) continue;
      const path = directory + entry.name;
      const relativeTo = scope => path.slice(scope.directory.length) + (entry.isDirectory() ? "/" : "");
      let excluded = false;
      for (const scope of scopes) {
        const match = scope.ignored.test(relativeTo(scope));
        if (match.ignored || match.unignored) excluded = match.ignored;
      }
      if (excluded) continue;
      if (entry.isDirectory()) walk(path + "/", scopes);
      else if (entry.isFile()) {
        files.push(path);
        let preserve = false;
        for (const scope of scopes) for (const attr of scope.attributes) {
          if (attr.matcher.ignores(relativeTo(scope))) preserve = attr.preserve;
        }
        if (preserve) untouched.add(path);
      }
    }
  }
  walk("");
  return { files, untouched };
}

export function checkLineEndings({ fix = false, root = repoRoot } = {}) {
  let files, untouched;
  if (!existsSync(join(root, ".git"))) {
    ({ files, untouched } = archiveFileInfo(root));
  } else {
    const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    files = [...new Set(git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean))];
    const attrs = execFileSync("git", ["check-attr", "--stdin", "-z", "text"], {
      cwd: root, input: files.join("\0") + "\0", encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    }).split("\0");
    untouched = new Set();
    for (let i = 0; i + 2 < attrs.length; i += 3) {
      if (attrs[i + 2] === "unset") untouched.add(attrs[i]);
    }
  }
  const failures = [];
  for (const file of files) {
    if (untouched.has(file)) continue;
    const path = resolve(root, file);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.isSymbolicLink()) continue;
    const bytes = readFileSync(path);
    // Match Git's automatic text/binary distinction for ordinary UTF-8 files.
    if (bytes.includes(0) || !bytes.includes(13)) continue;
    failures.push(file);
    if (fix) {
      // Remove CR only from CRLF pairs; convert lone CR line separators to LF.
      const normalized = [];
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 13 && bytes[i + 1] === 10) continue;
        normalized.push(bytes[i] === 13 ? 10 : bytes[i]);
      }
      writeFileSync(path, Buffer.from(normalized));
    }
  }
  if (failures.length && !fix) {
    throw new Error(`Expected LF line endings:\n${failures.join("\n")}\nRun npm run fix:line-endings, then review the diff.`);
  }
  if (fix) console.log(`Normalized ${failures.length} text files to LF. Imported byte-preserved assets were left untouched.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== "--fix")) throw new Error("Usage: node scripts/check-line-endings.mjs [--fix]");
  checkLineEndings({ fix: process.argv.includes("--fix") });
}

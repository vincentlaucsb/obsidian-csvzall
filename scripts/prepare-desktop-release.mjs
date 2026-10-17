import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertPreparedManifest } from "./native-helper-contract.mjs";

const tag = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(tag) || !/^\d+$/.test(process.env.GITHUB_RUN_ID || "") ||
    !/^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT || "")) throw new Error("Release preparation must run in GitHub Actions with a valid plugin version.");
const { manifest } = assertPreparedManifest();
const run = (command, args) => execFileSync(command, args, { stdio: "inherit", windowsHide: true });
run("git", ["add", "--", "native-binaries", "main.js"]);
const diff = spawnSync("git", ["diff", "--cached", "--quiet"], { windowsHide: true });
if (diff.status === 0) {
  console.log("The selected commit already contains the verified helper snapshot and current plugin bundle; it is ready to tag.");
} else {
  if (diff.status !== 1) throw new Error("Could not inspect release preparation changes.");
  const branch = `codex/prepare-release-${tag}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  run("git", ["switch", "--create", branch]);
  run("git", ["config", "user.name", "github-actions[bot]"]);
  run("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
  run("git", ["commit", "-m", `Prepare ${tag} with verified csvzall helpers`]);
  run("git", ["push", "origin", `HEAD:refs/heads/${branch}`]);
  mkdirSync(".test-build", { recursive: true });
  const body = resolve(".test-build/release-preparation.md");
  writeFileSync(body, `Prepare desktop plugin ${tag} with bundled csvzall ${manifest.version} from commit \`${manifest.sourceCommit}\`.\n\n` +
    `The three platform archives are frozen into this commit with SHA-256 checksums and build identity \`${manifest.buildKey}\`. Unchanged source and recipe reuse verified binaries.\n\n` +
    "Validation: platform build/cache smoke checks, desktop/mobile tests, and the clean source-archive build passed.\n\n" +
    `Review and merge this PR, then tag the merged release commit as \`${tag}\`. Publication verifies the committed helper snapshot and does not rebuild native binaries.\n`);
  run("gh", ["pr", "create", "--base", process.env.RELEASE_BASE || "main", "--head", branch,
    "--title", `Prepare desktop release ${tag}`, "--body-file", body]);
}

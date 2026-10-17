import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIdentity, repositoryRoot, sha256, verifyReceipt } from "./native-helper-contract.mjs";
import { bundledTargets } from "./prepare-native-binaries.mjs";

const run = (command, args, options = {}) => execFileSync(command, args, { stdio: "inherit", windowsHide: true, ...options });
const capture = (command, args, options = {}) => execFileSync(command, args, { encoding: "utf8", windowsHide: true, ...options }).trim();
const python = process.env.NATIVE_HELPER_PYTHON || "python";
const cmake = process.env.NATIVE_HELPER_CMAKE || "cmake";
const packageScript = join(repositoryRoot, "scripts/package-native-helper.py");

function assertArchitecture(bytes, target) {
  let valid = false;
  if (target === "win32-x64" && bytes.toString("ascii", 0, 2) === "MZ") {
    const header = bytes.readUInt32LE(0x3c);
    valid = bytes.toString("ascii", header, header + 4) === "PE\0\0" && bytes.readUInt16LE(header + 4) === 0x8664;
  } else if (target === "linux-x64") valid = bytes.toString("ascii", 1, 4) === "ELF" && bytes[4] === 2 && bytes.readUInt16LE(18) === 0x3e;
  else if (target === "darwin-arm64") valid = bytes.readUInt32LE(0) === 0xfeedfacf && bytes.readUInt32LE(4) === 0x100000c;
  if (!valid) throw new Error(`Native executable architecture does not match ${target}.`);
}

async function smoke(binary, version, work) {
  if (!capture(binary, ["--version"]).includes(version)) throw new Error("Native helper version smoke test failed.");
  const csv = join(work, "smoke data.csv");
  writeFileSync(csv, "name,value\nexample,42\n");
  const child = spawn(binary, ["view", csv, "--edit", "--no-open", "--startup-json"], { windowsHide: true });
  const closed = new Promise(resolve => child.once("close", resolve));
  let stdout = "", stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Native viewer startup timed out: ${stderr}`)), 30000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`Native viewer exited: ${stderr}`)); });
      child.stdout.on("data", chunk => {
        stdout += chunk;
        for (const line of stdout.split(/\r?\n/)) {
          let ready;
          try { ready = JSON.parse(line).url; } catch { continue; }
          if (typeof ready !== "string") continue;
          const parsed = new URL(ready);
          if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || !parsed.searchParams.get("token")) continue;
          clearTimeout(timer); resolve(ready); return;
        }
      });
    });
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok || !(await response.text()).toLowerCase().includes("csvzall")) throw new Error("Native viewer HTTP smoke test failed.");
  } finally { child.kill(); await closed; }
}

export async function verifyNativeHelper(directory, target, identity = buildIdentity()) {
  const receipt = verifyReceipt(directory, target, identity);
  if (`${process.platform}-${process.arch}` !== target) throw new Error(`Native smoke test requires a ${target} runner.`);
  const temporaryRoot = join(repositoryRoot, ".test-build");
  mkdirSync(temporaryRoot, { recursive: true });
  const work = mkdtempSync(join(temporaryRoot, "native-smoke-"));
  try {
    const binary = join(work, target.startsWith("win32-") ? "csvzall.exe" : "csvzall");
    run(python, [packageScript, "extract", join(directory, receipt.assetName), binary]);
    const bytes = readFileSync(binary);
    if (sha256(bytes) !== receipt.executableSha256) throw new Error("Native executable checksum mismatch.");
    assertArchitecture(bytes, target);
    await smoke(binary, identity.config.version, work);
  } finally {
    if (dirname(work) !== temporaryRoot) throw new Error("Unexpected native smoke directory.");
    rmSync(work, { recursive: true, force: true });
  }
}

export function checkout(repository, commit, destination) {
  if (!existsSync(join(destination, ".git"))) {
    mkdirSync(destination, { recursive: true });
    run("git", ["init", "--quiet", destination]);
    run("git", ["-C", destination, "config", "core.autocrlf", "false"]);
    run("git", ["-C", destination, "remote", "add", "origin", `https://github.com/${repository}.git`]);
    run("git", ["-C", destination, "fetch", "--depth", "1", "origin", commit]);
    run("git", ["-C", destination, "checkout", "--detach", "FETCH_HEAD"]);
  }
  if (capture("git", ["-C", destination, "rev-parse", "HEAD"]) !== commit) throw new Error(`Unexpected checkout at ${destination}; use a fresh build directory.`);
  if (capture("git", ["-C", destination, "status", "--porcelain", "--untracked-files=all", "--ignored"])) {
    throw new Error(`Modified source checkout at ${destination}; preserve its files and use a fresh build directory.`);
  }
}

export async function buildNativeHelper(target, output, identity = buildIdentity()) {
  const { config, key } = identity;
  if (`${process.platform}-${process.arch}` !== target) throw new Error(`Build requires a ${target} runner.`);
  const settings = config.targets[target];
  if (capture(cmake, ["--version"]).match(/cmake version ([\d.]+)/)?.[1] !== config.tools.cmake ||
      !capture(python, ["--version"]).startsWith(`Python ${config.tools.python}.`)) throw new Error("Install the CMake and Python versions declared in native-binaries/build.json before building helpers.");
  if (settings.generator === "Ninja" && capture("ninja", ["--version"]).match(/^\d+\.\d+\.\d+/)?.[0] !== config.tools.ninja) throw new Error("Install the pinned Ninja version before building helpers.");
  const work = join(repositoryRoot, ".test-build", "native-src", key.slice(0, 16), target);
  const source = join(work, "csvzall");
  checkout(config.repository, config.sourceCommit, source);
  const versions = [
    readFileSync(join(source, "CMakeLists.txt"), "utf8").match(/project\(csvzall VERSION ([\d.]+)/)?.[1],
    readFileSync(join(source, "Doxyfile"), "utf8").match(/^PROJECT_NUMBER\s*=\s*([\d.]+)/m)?.[1],
    readFileSync(join(source, "src/main.cpp"), "utf8").match(/ArgumentParser program\("csvzall",\s*"([\d.]+)"\)/)?.[1],
  ];
  if (versions.some(version => version !== config.version)) throw new Error("Pinned csvzall source version markers disagree with the build configuration.");
  const options = { ...config.cmakeOptions, ...settings.cmakeOptions, FETCHCONTENT_FULLY_DISCONNECTED: "ON" };
  for (const [name, dependency] of Object.entries(config.dependencies)) {
    const destination = join(work, name);
    checkout(dependency.repository, dependency.commit, destination);
    options[dependency.cmakeVariable] = destination;
  }
  const build = join(work, "build");
  const args = ["-S", source, "-B", build, "-G", settings.generator];
  if (settings.generator.startsWith("Visual Studio")) args.push("-A", "x64");
  args.push(...Object.entries(options).map(([name, value]) => `-D${name}=${value}`));
  run(cmake, args);
  // Upstream's Obsidian target rejects non-system shared runtime dependencies.
  run(cmake, ["--build", build, "--config", "Release", "--parallel", "--target", "csvzall"]);
  const name = process.platform === "win32" ? "csvzall.exe" : "csvzall";
  const binary = [join(build, name), join(build, "Release", name)].find(path => existsSync(path));
  if (!binary) throw new Error("Native helper build did not produce an executable.");
  assertArchitecture(readFileSync(binary), target);
  mkdirSync(output, { recursive: true });
  const assetName = `csvzall-${config.version}-obsidian-${bundledTargets[target]}`;
  const archive = join(output, assetName);
  run(python, [packageScript, "pack", archive, binary]);
  writeFileSync(join(output, "receipt.json"), JSON.stringify({ schemaVersion: 1, target,
    version: config.version, sourceCommit: config.sourceCommit, buildKey: key, assetName,
    sha256: sha256(readFileSync(archive)), executableSha256: sha256(readFileSync(binary)),
    cmake: capture(cmake, ["--version"]).split(/\r?\n/)[0],
  }, null, 2) + "\n");
  await verifyNativeHelper(output, target, identity);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, target, directory] = process.argv.slice(2);
  if (!directory || !["build", "verify"].includes(command)) throw new Error("Usage: node scripts/build-native-helper.mjs build|verify <target> <output directory>");
  if (command === "build") await buildNativeHelper(target, resolve(directory));
  else await verifyNativeHelper(resolve(directory), target);
  console.log(`Verified ${target} helper against the pinned source and build recipe.`);
}

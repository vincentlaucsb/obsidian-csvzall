import { readFileSync } from "node:fs";

const tag = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(tag)) throw new Error("Release tag must be an exact x.y.z version.");
const read = path => JSON.parse(readFileSync(path, "utf8"));
const manifest = read("manifest.json"), pkg = read("package.json"), lock = read("package-lock.json");
if (manifest.version !== tag || !manifest.isDesktopOnly || pkg.version !== tag ||
    lock.version !== tag || lock.packages[""].version !== tag ||
    read("versions.json")[tag] !== manifest.minAppVersion) throw new Error("Desktop release tag, versions, and compatibility metadata must agree.");
console.log(`Desktop release metadata verified for ${tag}.`);

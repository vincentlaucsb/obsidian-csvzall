import { randomUUID } from "crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { join } from "path";
import { brotliDecompressSync } from "zlib";
import { sha256Hex } from "./archive.js";
import { BUNDLED_CSVZALL_ASSETS, BUNDLED_CSVZALL_VERSION } from "./bundledPayloads.generated.js";

export { BUNDLED_CSVZALL_VERSION };

export interface BundledExecutable {
  assetName: string;
  sha256: string;
  executableSha256: string;
  brotliBase64: string;
}

export function bundledCsvzallAsset(platform: string = process.platform, arch: string = process.arch): BundledExecutable {
  const asset = BUNDLED_CSVZALL_ASSETS[`${platform}-${arch}`];
  if (!asset) {
    throw new Error(`No bundled csvzall helper for ${platform}/${arch}. Configure a custom executable path in settings.`);
  }
  return asset;
}

export async function installBundledCsvzall({
  pluginDir,
  platform = process.platform,
  arch = process.arch,
  asset = bundledCsvzallAsset(platform, arch),
  version = BUNDLED_CSVZALL_VERSION,
}: {
  pluginDir: string;
  platform?: string;
  arch?: string;
  asset?: BundledExecutable;
  version?: string;
}) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !/^[a-f0-9]{64}$/.test(asset.executableSha256) ||
      !/^[a-z0-9]+$/.test(platform) || !/^[a-z0-9]+$/.test(arch)) throw new Error("Invalid bundled csvzall metadata.");
  let bytes: Buffer;
  try {
    bytes = brotliDecompressSync(Buffer.from(asset.brotliBase64, "base64"));
  } catch {
    throw new Error(`Brotli decompression failed for ${asset.assetName}.`);
  }
  if (sha256Hex(bytes) !== asset.executableSha256) throw new Error(`Executable SHA-256 verification failed for ${asset.assetName}.`);
  const executableName = platform === "win32" ? "csvzall.exe" : "csvzall";
  // Target and digest isolate upgrades and vaults synced across operating systems.
  const installDir = join(pluginDir, "csvzall-bin", version, `${platform}-${arch}-${asset.sha256.slice(0, 16)}`);
  const files = new Map([[executableName, bytes]]);
  for (const directory of [join(pluginDir, "csvzall-bin"), join(pluginDir, "csvzall-bin", version), installDir]) {
    await mkdir(directory, { recursive: true });
    const entry = await lstat(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Expected an ordinary directory: ${directory}`);
  }
  let changed = false;
  for (const [name, contents] of files) {
    if (!name || name === "." || name === ".." || /[/\\]/.test(name)) throw new Error("Invalid bundled filename.");
    const destination = join(installDir, name);
    const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error(`Expected a regular file: ${destination}`);
    if (!existing || sha256Hex(await readFile(destination)) !== sha256Hex(contents)) {
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, contents, { flag: "wx", mode: name === executableName ? 0o755 : 0o644 });
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true });
      }
      changed = true;
    }
    if (platform !== "win32" && name === executableName) await chmod(destination, 0o755);
  }
  return {
    executablePath: join(installDir, executableName),
    tagName: version,
    assetName: asset.assetName,
    sha256: asset.sha256,
    changed,
  };
}

import { createHash } from "crypto";
import { chmod, mkdir, rename, rm, writeFile } from "fs/promises";
import { get } from "https";
import { join } from "path";
import { inflateRawSync } from "zlib";

export const CSVZALL_RELEASE_API_URL = "https://api.github.com/repos/vincentlaucsb/csvzall/releases/latest";

type InstallTarget = {
  platform: string;
  arch: string;
  platformLabels: string[];
  archLabels: string[];
  executableName: string;
};

type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
  digest?: string;
};

type DownloadableReleaseAsset = ReleaseAsset & {
  name: string;
  browser_download_url: string;
};

type Release = {
  assets?: unknown;
  tag_name?: unknown;
  name?: unknown;
};

type ZipEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

type InstallOptions = {
  pluginDir?: string;
  releaseApiUrl?: string;
  platform?: string;
  arch?: string;
  fetchBuffer?: (url: string) => Promise<Buffer>;
};

export type InstallCsvzallResult = {
  executablePath: string;
  assetName: string;
  checksumAssetName: string;
  tagName: string;
  sha256: string;
  installedFromArchive: boolean;
};

const CHECKSUM_NAME_PATTERN = /(^|[-_.])(sha256|sha256sums|checksums?)([-_.]|$)/i;
const UNSUPPORTED_ARCHIVE_NAME_PATTERN = /\.(tar\.gz|tgz|tar\.xz|txz|gz)$/i;

const TARGETS: Record<string, Omit<InstallTarget, "platform" | "arch" | "archLabels">> = {
  win32: {
    platformLabels: ["windows", "win32", "win"],
    executableName: "csvzall.exe",
  },
  darwin: {
    platformLabels: ["macos", "darwin", "apple", "osx"],
    executableName: "csvzall",
  },
  linux: {
    platformLabels: ["linux"],
    executableName: "csvzall",
  },
};

const ARCH_LABELS: Record<string, string[]> = {
  x64: ["x64", "amd64", "x86_64"],
  arm64: ["arm64", "aarch64"],
};

export function csvzallInstallTarget(platform: string = process.platform, arch: string = process.arch): InstallTarget {
  const target = TARGETS[platform];
  const archLabels = ARCH_LABELS[arch];
  if (!target || !archLabels) {
    throw new Error(`csvzall installer does not support ${platform}/${arch}.`);
  }
  return {
    platform,
    arch,
    platformLabels: target.platformLabels,
    archLabels,
    executableName: target.executableName,
  };
}

export function isChecksumAssetName(name: string): boolean {
  return CHECKSUM_NAME_PATTERN.test(name) || /\.(sha256|sha256sum|sha256sums|sig|asc)$/i.test(name);
}

export function isZipAssetName(name: string): boolean {
  return /\.zip$/i.test(name);
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function checksumFromReleaseAssetDigest(asset: ReleaseAsset | null | undefined): string | null {
  const digest = typeof asset?.digest === "string" ? asset.digest.trim() : "";
  const match = digest.match(/^sha256:([a-f0-9]{64})$/i);
  return match?.[1] ? match[1].toLowerCase() : null;
}

export function parseSha256ChecksumText(text: string, assetName: string): string | null {
  const normalizedAssetName = assetName.toLowerCase();
  const basename = normalizedAssetName.split(/[\\/]/).pop();
  const hashes: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const opensslStyle = trimmed.match(/^SHA256\s*\(([^)]+)\)\s*=\s*([a-f0-9]{64})$/i);
    if (opensslStyle?.[1] && opensslStyle[2]) {
      const filename = opensslStyle[1].trim().toLowerCase();
      const hash = opensslStyle[2].toLowerCase();
      if (filename === normalizedAssetName || filename.split(/[\\/]/).pop() === basename) {
        return hash;
      }
      hashes.push(hash);
      continue;
    }

    const standardStyle = trimmed.match(/^([a-f0-9]{64})\s+[* ]?(.+)$/i);
    if (standardStyle?.[1] && standardStyle[2]) {
      const hash = standardStyle[1].toLowerCase();
      const filename = standardStyle[2].trim().toLowerCase();
      if (filename === normalizedAssetName || filename.split(/[\\/]/).pop() === basename) {
        return hash;
      }
      hashes.push(hash);
    }
  }

  return hashes.length === 1 ? hashes[0] ?? null : null;
}

function assetList(release: Release): ReleaseAsset[] {
  return Array.isArray(release.assets) ? release.assets as ReleaseAsset[] : [];
}

function hasAnyLabel(name: string, labels: string[]): boolean {
  return labels.some((label) => name.includes(label));
}

function scoreAsset(asset: ReleaseAsset, target: InstallTarget): number {
  const name = String(asset?.name ?? "").toLowerCase();
  if (
    typeof asset.browser_download_url !== "string" ||
    !asset.browser_download_url ||
    isChecksumAssetName(name) ||
    UNSUPPORTED_ARCHIVE_NAME_PATTERN.test(name)
  ) {
    return -1;
  }
  if (!name.includes("csvzall")) {
    return -1;
  }
  if (!hasAnyLabel(name, target.platformLabels) || !hasAnyLabel(name, target.archLabels)) {
    return -1;
  }

  let score = 10;
  if (target.platform === "win32" && name.endsWith(".exe")) {
    score += 3;
  }
  if (isZipAssetName(name)) {
    score += 1;
  }
  if (name === target.executableName) {
    score += 2;
  }
  score -= Math.min(name.length / 1000, 1);
  return score;
}

export function selectCsvzallReleaseAsset(
  release: Release,
  target = csvzallInstallTarget(),
): DownloadableReleaseAsset {
  const candidates = assetList(release)
    .map((asset) => ({ asset, score: scoreAsset(asset, target) }))
    .filter((candidate) => candidate.score >= 0)
    .sort((left, right) => {
      const score = right.score - left.score;
      return score || String(left.asset.name).localeCompare(String(right.asset.name));
    });

  if (candidates[0]) {
    return candidates[0].asset as DownloadableReleaseAsset;
  }

  const names = assetList(release).map((asset) => asset.name).filter(Boolean).join(", ");
  throw new Error(
    `No csvzall release asset matched ${target.platform}/${target.arch}.` +
    (names ? ` Available assets: ${names}` : ""),
  );
}

export function selectCsvzallChecksumAsset(
  release: Release,
  binaryAsset: ReleaseAsset | null | undefined,
): DownloadableReleaseAsset | null {
  const checksumAssets = assetList(release)
    .filter((asset) => isChecksumAssetName(String(asset.name ?? ""))) as DownloadableReleaseAsset[];
  const binaryName = String(binaryAsset?.name ?? "").toLowerCase();

  return checksumAssets.find((asset) => String(asset.name ?? "").toLowerCase() === `${binaryName}.sha256`) ??
    checksumAssets.find((asset) => CHECKSUM_NAME_PATTERN.test(String(asset.name ?? ""))) ??
    checksumAssets[0] ??
    null;
}

export async function fetchUrlAsBuffer(url: string, redirectsRemaining = 5): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const request = get(url, {
      headers: {
        "Accept": "application/octet-stream, application/vnd.github+json",
        "User-Agent": "obsidian-csvzall",
      },
    }, (response) => {
      const statusCode = response.statusCode ?? 0;
      const location = response.headers.location;
      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        if (redirectsRemaining <= 0) {
          reject(new Error(`Too many redirects while downloading ${url}.`));
          return;
        }
        const nextUrl = new URL(location, url).toString();
        fetchUrlAsBuffer(nextUrl, redirectsRemaining - 1).then(resolve, reject);
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${statusCode} for ${url}.`));
        return;
      }

      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    request.on("error", reject);
  });
}

export function sanitizePathSegment(value: string): string {
  return String(value || "latest").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "latest";
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  const minOffset = Math.max(0, bytes.length - 0xffff - 22);
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("ZIP archive is missing its central directory.");
}

function zipEntryBasename(name: string): string {
  return name.replace(/\\/g, "/").split("/").pop() ?? "";
}

function readZipEntries(bytes: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = bytes.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("ZIP archive contains an invalid central directory entry.");
    }

    const compressionMethod = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const fileNameLength = bytes.readUInt16LE(offset + 28);
    const extraFieldLength = bytes.readUInt16LE(offset + 30);
    const fileCommentLength = bytes.readUInt16LE(offset + 32);
    const localHeaderOffset = bytes.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const name = bytes.toString("utf8", nameStart, nameStart + fileNameLength);

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    offset = nameStart + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entries;
}

function readZipEntryBytes(archiveBytes: Buffer, entry: ZipEntry): Buffer {
  const offset = entry.localHeaderOffset;
  if (archiveBytes.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`ZIP archive has an invalid local header for ${entry.name}.`);
  }

  const fileNameLength = archiveBytes.readUInt16LE(offset + 26);
  const extraFieldLength = archiveBytes.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraFieldLength;
  const dataEnd = dataStart + entry.compressedSize;
  const compressedBytes = archiveBytes.subarray(dataStart, dataEnd);

  if (entry.compressionMethod === 0) {
    return compressedBytes;
  }
  if (entry.compressionMethod === 8) {
    const inflated = inflateRawSync(compressedBytes);
    if (inflated.length !== entry.uncompressedSize) {
      throw new Error(`ZIP entry ${entry.name} did not inflate to the expected size.`);
    }
    return inflated;
  }

  throw new Error(`ZIP entry ${entry.name} uses unsupported compression method ${entry.compressionMethod}.`);
}

export function extractCsvzallExecutableFromZip(archiveBytes: Buffer, executableName: string): Buffer {
  const entries = readZipEntries(archiveBytes);
  const normalizedExecutableName = executableName.toLowerCase();
  const entry = entries.find((candidate) => zipEntryBasename(candidate.name).toLowerCase() === normalizedExecutableName);
  if (!entry) {
    const names = entries.map((candidate) => candidate.name).join(", ");
    throw new Error(`ZIP archive did not contain ${executableName}.` + (names ? ` Entries: ${names}` : ""));
  }

  return readZipEntryBytes(archiveBytes, entry);
}

export async function installCsvzallBinary({
  pluginDir,
  releaseApiUrl = CSVZALL_RELEASE_API_URL,
  platform = process.platform,
  arch = process.arch,
  fetchBuffer = fetchUrlAsBuffer,
}: InstallOptions = {}): Promise<InstallCsvzallResult> {
  if (!pluginDir) {
    throw new Error("Could not resolve the plugin data directory.");
  }

  const target = csvzallInstallTarget(platform, arch);
  const release = JSON.parse((await fetchBuffer(releaseApiUrl)).toString("utf8")) as Release;
  const binaryAsset = selectCsvzallReleaseAsset(release, target);
  const downloadedBytes = await fetchBuffer(binaryAsset.browser_download_url);
  const actualSha256 = sha256Hex(downloadedBytes);

  let expectedSha256 = checksumFromReleaseAssetDigest(binaryAsset);
  let checksumAssetName = "";
  if (!expectedSha256) {
    const checksumAsset = selectCsvzallChecksumAsset(release, binaryAsset);
    if (checksumAsset) {
      checksumAssetName = checksumAsset.name;
      const checksumText = (await fetchBuffer(checksumAsset.browser_download_url)).toString("utf8");
      expectedSha256 = parseSha256ChecksumText(checksumText, binaryAsset.name);
    }
  }

  if (!expectedSha256) {
    throw new Error(`No SHA-256 checksum was available for ${binaryAsset.name}.`);
  }
  if (actualSha256 !== expectedSha256.toLowerCase()) {
    throw new Error(
      `SHA-256 verification failed for ${binaryAsset.name}: expected ${expectedSha256}, got ${actualSha256}.`,
    );
  }

  const tagName = String(release.tag_name || release.name || "latest");
  const installDir = join(pluginDir, "csvzall-bin", sanitizePathSegment(tagName));
  const executablePath = join(installDir, target.executableName);
  const tempPath = `${executablePath}.download`;
  const executableBytes = isZipAssetName(binaryAsset.name) ?
    extractCsvzallExecutableFromZip(downloadedBytes, target.executableName) :
    downloadedBytes;

  await mkdir(installDir, { recursive: true });
  await writeFile(tempPath, executableBytes);
  if (platform !== "win32") {
    await chmod(tempPath, 0o755);
  }
  await rm(executablePath, { force: true });
  await rename(tempPath, executablePath);

  return {
    executablePath,
    assetName: binaryAsset.name,
    checksumAssetName,
    tagName,
    sha256: actualSha256,
    installedFromArchive: isZipAssetName(binaryAsset.name),
  };
}

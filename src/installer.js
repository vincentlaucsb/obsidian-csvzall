import { createHash } from "crypto";
import { chmod, mkdir, rename, rm, writeFile } from "fs/promises";
import { get } from "https";
import { join } from "path";
import { inflateRawSync } from "zlib";

export const CSVZALL_RELEASE_API_URL = "https://api.github.com/repos/vincentlaucsb/csvzall/releases/latest";

const CHECKSUM_NAME_PATTERN = /(^|[-_.])(sha256|sha256sums|checksums?)([-_.]|$)/i;
const UNSUPPORTED_ARCHIVE_NAME_PATTERN = /\.(tar\.gz|tgz|tar\.xz|txz|gz)$/i;

const TARGETS = {
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

const ARCH_LABELS = {
  x64: ["x64", "amd64", "x86_64"],
  arm64: ["arm64", "aarch64"],
};

export function csvzallInstallTarget(platform = process.platform, arch = process.arch) {
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

export function isChecksumAssetName(name) {
  return CHECKSUM_NAME_PATTERN.test(name) || /\.(sha256|sha256sum|sha256sums|sig|asc)$/i.test(name);
}

export function isZipAssetName(name) {
  return /\.zip$/i.test(name);
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function checksumFromReleaseAssetDigest(asset) {
  const digest = typeof asset?.digest === "string" ? asset.digest.trim() : "";
  const match = digest.match(/^sha256:([a-f0-9]{64})$/i);
  return match ? match[1].toLowerCase() : null;
}

export function parseSha256ChecksumText(text, assetName) {
  const normalizedAssetName = assetName.toLowerCase();
  const basename = normalizedAssetName.split(/[\\/]/).pop();
  const hashes = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const opensslStyle = trimmed.match(/^SHA256\s*\(([^)]+)\)\s*=\s*([a-f0-9]{64})$/i);
    if (opensslStyle) {
      const filename = opensslStyle[1].trim().toLowerCase();
      const hash = opensslStyle[2].toLowerCase();
      if (filename === normalizedAssetName || filename.split(/[\\/]/).pop() === basename) {
        return hash;
      }
      hashes.push(hash);
      continue;
    }

    const standardStyle = trimmed.match(/^([a-f0-9]{64})\s+[* ]?(.+)$/i);
    if (standardStyle) {
      const hash = standardStyle[1].toLowerCase();
      const filename = standardStyle[2].trim().toLowerCase();
      if (filename === normalizedAssetName || filename.split(/[\\/]/).pop() === basename) {
        return hash;
      }
      hashes.push(hash);
    }
  }

  return hashes.length === 1 ? hashes[0] : null;
}

function assetList(release) {
  return Array.isArray(release?.assets) ? release.assets : [];
}

function hasAnyLabel(name, labels) {
  return labels.some((label) => name.includes(label));
}

function scoreAsset(asset, target) {
  const name = String(asset?.name ?? "").toLowerCase();
  if (!asset?.browser_download_url || isChecksumAssetName(name) || UNSUPPORTED_ARCHIVE_NAME_PATTERN.test(name)) {
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

export function selectCsvzallReleaseAsset(release, target = csvzallInstallTarget()) {
  const candidates = assetList(release)
    .map((asset) => ({ asset, score: scoreAsset(asset, target) }))
    .filter((candidate) => candidate.score >= 0)
    .sort((left, right) => right.score - left.score || String(left.asset.name).localeCompare(String(right.asset.name)));

  if (candidates[0]) {
    return candidates[0].asset;
  }

  const names = assetList(release).map((asset) => asset.name).filter(Boolean).join(", ");
  throw new Error(
    `No csvzall release asset matched ${target.platform}/${target.arch}.` +
    (names ? ` Available assets: ${names}` : ""),
  );
}

export function selectCsvzallChecksumAsset(release, binaryAsset) {
  const checksumAssets = assetList(release).filter((asset) => isChecksumAssetName(String(asset.name ?? "")));
  const binaryName = String(binaryAsset?.name ?? "").toLowerCase();

  return checksumAssets.find((asset) => String(asset.name ?? "").toLowerCase() === `${binaryName}.sha256`) ??
    checksumAssets.find((asset) => CHECKSUM_NAME_PATTERN.test(String(asset.name ?? ""))) ??
    checksumAssets[0] ??
    null;
}

export async function fetchUrlAsBuffer(url, redirectsRemaining = 5) {
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

      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    request.on("error", reject);
  });
}

export function sanitizePathSegment(value) {
  return String(value || "latest").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "latest";
}

function findEndOfCentralDirectory(bytes) {
  const minOffset = Math.max(0, bytes.length - 0xffff - 22);
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("ZIP archive is missing its central directory.");
}

function zipEntryBasename(name) {
  return name.replace(/\\/g, "/").split("/").pop() ?? "";
}

function readZipEntries(bytes) {
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = bytes.readUInt32LE(eocdOffset + 16);
  const entries = [];
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

function readZipEntryBytes(archiveBytes, entry) {
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

export function extractCsvzallExecutableFromZip(archiveBytes, executableName) {
  const entries = readZipEntries(archiveBytes);
  const normalizedExecutableName = executableName.toLowerCase();
  const entry = entries.find((candidate) => zipEntryBasename(candidate.name).toLowerCase() === normalizedExecutableName);
  if (!entry) {
    const names = entries.map((candidate) => candidate.name).join(", ");
    throw new Error(`ZIP archive did not contain ${executableName}.` + (names ? ` Entries: ${names}` : ""));
  }

  return readZipEntryBytes(archiveBytes, entry);
}

/**
 * @param {{
 *   pluginDir: string,
 *   releaseApiUrl?: string,
 *   platform?: string,
 *   arch?: string,
 *   fetchBuffer?: (url: string) => Promise<Buffer>,
 * }} options
 */
export async function installCsvzallBinary({
  pluginDir,
  releaseApiUrl = CSVZALL_RELEASE_API_URL,
  platform = process.platform,
  arch = process.arch,
  fetchBuffer = fetchUrlAsBuffer,
} = {}) {
  if (!pluginDir) {
    throw new Error("Could not resolve the plugin data directory.");
  }

  const target = csvzallInstallTarget(platform, arch);
  const release = JSON.parse((await fetchBuffer(releaseApiUrl)).toString("utf8"));
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

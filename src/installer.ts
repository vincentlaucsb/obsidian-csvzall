import { chmod, mkdir, rename, rm, writeFile } from "fs/promises";
import { get } from "https";
import { join } from "path";
// Downloads belong to the Node process, not the lifetime of a popout window.
import * as nodeTimers from "timers";
import { extractCsvzallFilesFromArchive, isZipAssetName, isTarGzAssetName, sha256Hex } from "./installer/archive.js";

export {
  extractCsvzallFilesFromArchive,
  extractCsvzallFilesFromZip,
  extractCsvzallExecutableFromZip,
  extractCsvzallFilesFromTarGz,
  isZipAssetName,
  isTarGzAssetName,
  sha256Hex,
} from "./installer/archive.js";

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

type InstallOptions = {
  pluginDir?: string;
  releaseApiUrl?: string;
  platform?: string;
  arch?: string;
  fetchBuffer?: (url: string) => Promise<Buffer>;
};

type ReleaseInfoOptions = Omit<InstallOptions, "pluginDir">;

export type InstallCsvzallResult = {
  executablePath: string;
  assetName: string;
  checksumAssetName: string;
  tagName: string;
  sha256: string;
  installedFromArchive: boolean;
};

export type CsvzallReleaseInfo = {
  tagName: string;
  assetName: string;
};

const CHECKSUM_NAME_PATTERN = /(^|[-_.])(sha256|sha256sums|checksums?)([-_.]|$)/i;
const OBSIDIAN_ASSET_NAME_PATTERN = /(^|[-_.])obsidian([-_.]|$)/i;

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

function isSupportedArchiveAssetName(name: string): boolean {
  return isZipAssetName(name) || isTarGzAssetName(name);
}

function isUnsupportedArchiveAssetName(name: string): boolean {
  return /\.(tar\.xz|txz)$/i.test(name) || (/\.gz$/i.test(name) && !isTarGzAssetName(name));
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
  return labels.some((label) => new RegExp(`(^|[-_.])${label}([-_.]|$)`).test(name));
}

function scoreAsset(asset: ReleaseAsset, target: InstallTarget): number {
  const name = String(asset?.name ?? "").toLowerCase();
  if (
    typeof asset.browser_download_url !== "string" ||
    !asset.browser_download_url ||
    isChecksumAssetName(name) ||
    isUnsupportedArchiveAssetName(name)
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
  if (isSupportedArchiveAssetName(name)) {
    score += 1;
  }
  if (OBSIDIAN_ASSET_NAME_PATTERN.test(name)) {
    score += 5;
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

export async function fetchUrlAsBuffer(
  url: string,
  redirectsRemaining = 5,
  options: { request?: typeof get; timeoutMs?: number } = {},
): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    let timer: ReturnType<typeof nodeTimers.setTimeout>;
    let followingRedirect = false;
    const fail = (error: Error): void => {
      nodeTimers.clearTimeout(timer);
      reject(error);
    };
    const request = (options.request ?? get)(url, {
      headers: {
        "Accept": "application/octet-stream, application/vnd.github+json",
        "User-Agent": "obsidian-csvzall",
      },
    }, (response) => {
      const statusCode = response.statusCode ?? 0;
      const location = response.headers.location;
      if (statusCode >= 300 && statusCode < 400 && location) {
        // The redirect headers suffice; do not wait for an unused response body.
        followingRedirect = true;
        response.on("error", () => {});
        response.destroy();
        nodeTimers.clearTimeout(timer);
        if (redirectsRemaining <= 0) {
          fail(new Error(`Too many redirects while downloading ${url}.`));
          return;
        }
        try {
          const nextUrl = new URL(location, url).toString();
          fetchUrlAsBuffer(nextUrl, redirectsRemaining - 1, options).then(resolve, fail);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.on("error", () => {});
        response.destroy();
        fail(new Error(`Download failed with HTTP ${statusCode} for ${url}.`));
        return;
      }

      response.on("error", fail);
      response.on("aborted", () => fail(new Error(`Download aborted for ${url}.`)));
      response.on("close", () => {
        if (!response.complete) fail(new Error(`Download closed before completion for ${url}.`));
      });
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        nodeTimers.clearTimeout(timer);
        if (!response.complete) {
          fail(new Error(`Incomplete download for ${url}.`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });
    request.on("error", (error) => { if (!followingRedirect) fail(error); });
    timer = nodeTimers.setTimeout(() => {
      const error = new Error(`Download timed out for ${url}.`);
      fail(error);
      request.destroy(error);
    }, options.timeoutMs ?? 120000);
  });
}

export function sanitizePathSegment(value: string): string {
  return String(value || "latest").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "latest";
}

function releaseTagName(release: Release): string {
  return String(release.tag_name || release.name || "latest");
}

export async function getLatestCsvzallReleaseInfo({
  releaseApiUrl = CSVZALL_RELEASE_API_URL,
  platform = process.platform,
  arch = process.arch,
  fetchBuffer = fetchUrlAsBuffer,
}: ReleaseInfoOptions = {}): Promise<CsvzallReleaseInfo> {
  const target = csvzallInstallTarget(platform, arch);
  const release = JSON.parse((await fetchBuffer(releaseApiUrl)).toString("utf8")) as Release;
  const binaryAsset = selectCsvzallReleaseAsset(release, target);

  return {
    tagName: releaseTagName(release),
    assetName: binaryAsset.name,
  };
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

  const tagName = releaseTagName(release);
  const installDir = join(pluginDir, "csvzall-bin", sanitizePathSegment(tagName));
  const executablePath = join(installDir, target.executableName);
  const filesToInstall = extractCsvzallFilesFromArchive(downloadedBytes, binaryAsset.name, target.executableName);

  await mkdir(installDir, { recursive: true });
  for (const [fileName, fileBytes] of filesToInstall) {
    const destinationPath = join(installDir, fileName);
    const tempPath = `${destinationPath}.download`;
    await writeFile(tempPath, fileBytes);
    if (platform !== "win32" && fileName === target.executableName) {
      await chmod(tempPath, 0o755);
    }
    await rm(destinationPath, { force: true });
    await rename(tempPath, destinationPath);
  }

  return {
    executablePath,
    assetName: binaryAsset.name,
    checksumAssetName,
    tagName,
    sha256: actualSha256,
    installedFromArchive: isSupportedArchiveAssetName(binaryAsset.name),
  };
}

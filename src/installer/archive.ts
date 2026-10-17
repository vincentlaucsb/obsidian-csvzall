import { createHash } from "crypto";
import { gunzipSync, inflateRawSync } from "zlib";

type ZipEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

type TarEntry = {
  name: string;
  size: number;
  dataOffset: number;
  typeFlag: number;
};

export function isZipAssetName(name: string): boolean {
  return /\.zip$/i.test(name);
}

export function isTarGzAssetName(name: string): boolean {
  return /\.(tar\.gz|tgz)$/i.test(name);
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
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

function archiveEntryBasename(name: string): string {
  return name.replace(/\\/g, "/").split("/").pop() ?? "";
}

function archiveEntryDirname(name: string): string {
  const normalized = name.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : "";
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
  return extractCsvzallFilesFromZip(archiveBytes, executableName).get(executableName) ??
    (() => {
      throw new Error(`ZIP archive did not contain ${executableName}.`);
    })();
}

export function extractCsvzallFilesFromZip(archiveBytes: Buffer, executableName: string): Map<string, Buffer> {
  const entries = readZipEntries(archiveBytes);
  const normalizedExecutableName = executableName.toLowerCase();
  const entry = entries.find((candidate) => archiveEntryBasename(candidate.name).toLowerCase() === normalizedExecutableName);
  if (!entry) {
    const names = entries.map((candidate) => candidate.name).join(", ");
    throw new Error(`ZIP archive did not contain ${executableName}.` + (names ? ` Entries: ${names}` : ""));
  }

  const executableDir = archiveEntryDirname(entry.name);
  const files = new Map<string, Buffer>();
  for (const candidate of entries) {
    const basename = archiveEntryBasename(candidate.name);
    if (!basename || archiveEntryDirname(candidate.name) !== executableDir) {
      continue;
    }
    files.set(basename, readZipEntryBytes(archiveBytes, candidate));
  }

  if (!files.has(executableName)) {
    files.set(executableName, readZipEntryBytes(archiveBytes, entry));
  }
  return files;
}

function tarString(bytes: Buffer, start: number, end: number): string {
  const zeroOffset = bytes.indexOf(0, start);
  const actualEnd = zeroOffset >= start && zeroOffset < end ? zeroOffset : end;
  return bytes.toString("utf8", start, actualEnd);
}

function tarOctal(bytes: Buffer, start: number, end: number): number {
  const value = tarString(bytes, start, end).trim().replace(/\0+$/g, "");
  return value ? Number.parseInt(value, 8) : 0;
}

function isZeroTarBlock(bytes: Buffer, offset: number): boolean {
  for (let index = 0; index < 512; index += 1) {
    if (bytes[offset + index] !== 0) {
      return false;
    }
  }
  return true;
}

function readTarEntries(bytes: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + 512 <= bytes.length) {
    if (isZeroTarBlock(bytes, offset)) {
      break;
    }

    const name = tarString(bytes, offset, offset + 100);
    const prefix = tarString(bytes, offset + 345, offset + 500);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = tarOctal(bytes, offset + 124, offset + 136);
    const typeFlag = bytes[offset + 156] ?? 0;
    const dataOffset = offset + 512;

    entries.push({
      name: fullName,
      size,
      dataOffset,
      typeFlag,
    });

    offset = dataOffset + Math.ceil(size / 512) * 512;
  }

  return entries;
}

function readTarEntryBytes(archiveBytes: Buffer, entry: TarEntry): Buffer {
  return archiveBytes.subarray(entry.dataOffset, entry.dataOffset + entry.size);
}

export function extractCsvzallFilesFromTarGz(archiveBytes: Buffer, executableName: string): Map<string, Buffer> {
  const tarBytes = gunzipSync(archiveBytes);
  const entries = readTarEntries(tarBytes).filter((entry) => entry.typeFlag === 0 || entry.typeFlag === 48);
  const normalizedExecutableName = executableName.toLowerCase();
  const entry = entries.find((candidate) => archiveEntryBasename(candidate.name).toLowerCase() === normalizedExecutableName);
  if (!entry) {
    const names = entries.map((candidate) => candidate.name).join(", ");
    throw new Error(`tar.gz archive did not contain ${executableName}.` + (names ? ` Entries: ${names}` : ""));
  }

  const executableDir = archiveEntryDirname(entry.name);
  const files = new Map<string, Buffer>();
  for (const candidate of entries) {
    const basename = archiveEntryBasename(candidate.name);
    if (!basename || archiveEntryDirname(candidate.name) !== executableDir) {
      continue;
    }
    files.set(basename, readTarEntryBytes(tarBytes, candidate));
  }

  if (!files.has(executableName)) {
    files.set(executableName, readTarEntryBytes(tarBytes, entry));
  }
  return files;
}

export function extractCsvzallFilesFromArchive(
  archiveBytes: Buffer,
  assetName: string,
  executableName: string,
): Map<string, Buffer> {
  if (isZipAssetName(assetName)) {
    return extractCsvzallFilesFromZip(archiveBytes, executableName);
  }
  if (isTarGzAssetName(assetName)) {
    return extractCsvzallFilesFromTarGz(archiveBytes, executableName);
  }
  return new Map([[executableName, archiveBytes]]);
}

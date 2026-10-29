import { brotliDecompressSync } from "zlib";

// CZP1: executable size, patch count, then destination/shared-offset/length
// triples (all uint32 LE), followed by the executable's unshared bytes.
export function decodeHelperPayload(brotliBase64, sharedBrotliBase64) {
  const payload = brotliDecompressSync(Buffer.from(brotliBase64, "base64"));
  if (payload.length < 12 || payload.readUInt32LE(0) !== 0x31505a43) {
    throw new Error("Unsupported bundled helper payload.");
  }
  const size = payload.readUInt32LE(4);
  const count = payload.readUInt32LE(8);
  const headerSize = 12 + count * 12;
  if (headerSize > payload.length) throw new Error("Truncated bundled helper patches.");
  // A single-target development helper has no shared chunks to decompress.
  const shared = count ? brotliDecompressSync(Buffer.from(sharedBrotliBase64, "base64")) : Buffer.alloc(0);
  let end = 0, omitted = 0;
  for (let index = 0; index < count; index++) {
    const entry = 12 + index * 12;
    const destination = payload.readUInt32LE(entry);
    const source = payload.readUInt32LE(entry + 4);
    const length = payload.readUInt32LE(entry + 8);
    if (!length || destination < end || destination + length > size || source + length > shared.length) {
      throw new Error("Invalid bundled helper patch.");
    }
    end = destination + length;
    omitted += length;
  }
  if (payload.length - headerSize + omitted !== size) throw new Error("Bundled helper size mismatch.");
  const executable = Buffer.alloc(size);
  let input = headerSize, output = 0;
  for (let index = 0; index < count; index++) {
    const entry = 12 + index * 12;
    const destination = payload.readUInt32LE(entry);
    const source = payload.readUInt32LE(entry + 4);
    const length = payload.readUInt32LE(entry + 8);
    input += payload.copy(executable, output, input, input + destination - output);
    shared.copy(executable, destination, source, source + length);
    output = destination + length;
  }
  payload.copy(executable, output, input);
  return executable;
}

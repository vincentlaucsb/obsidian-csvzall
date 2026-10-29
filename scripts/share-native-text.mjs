import { createHash } from "node:crypto";

export function encodeHelperPayload(executable, patches = []) {
  const header = Buffer.alloc(12 + patches.length * 12);
  header.write("CZP1");
  header.writeUInt32LE(executable.length, 4);
  header.writeUInt32LE(patches.length, 8);
  const parts = [header];
  let end = 0;
  patches.forEach(({ destination, source, length }, index) => {
    const entry = 12 + index * 12;
    header.writeUInt32LE(destination, entry);
    header.writeUInt32LE(source, entry + 4);
    header.writeUInt32LE(length, entry + 8);
    parts.push(executable.subarray(end, destination));
    end = destination + length;
  });
  parts.push(executable.subarray(end));
  return Buffer.concat(parts);
}

export function shareNativeText(executables) {
  const targets = Object.keys(executables);
  const seed = executables[targets[0]];
  const candidates = [], seen = new Set();
  let start = 0;
  // Embedded viewer strings survive compilation verbatim on every platform.
  // Find long text runs without depending on ELF/Mach-O/PE or symbol tables.
  for (let index = 0; index <= seed.length; index++) {
    const byte = seed[index];
    if ((byte >= 32 && byte !== 127) || byte === 9 || byte === 10 || byte === 13) continue;
    if (index - start >= 512) {
      const chunk = seed.subarray(start, index);
      const key = createHash("sha256").update(chunk).digest("hex");
      if (!seen.has(key)) { seen.add(key); candidates.push(chunk); }
    }
    start = index + 1;
  }
  // Prefer full runs over contained substrings, with deterministic ties.
  candidates.sort((a, b) => b.length - a.length || Buffer.compare(a, b));
  const patches = Object.fromEntries(targets.map(target => [target, []]));
  const shared = [];
  let source = 0;
  for (const chunk of candidates) {
    const locations = targets.map(target => [target, executables[target].indexOf(chunk)])
      .filter(([target, offset]) => offset >= 0 && !patches[target].some(patch =>
        offset < patch.destination + patch.length && offset + chunk.length > patch.destination));
    if (locations.length < 2) continue;
    shared.push(chunk);
    for (const [target, destination] of locations) patches[target].push({ destination, source, length: chunk.length });
    source += chunk.length;
  }
  return {
    shared: Buffer.concat(shared),
    payloads: Object.fromEntries(targets.map(target => [target,
      encodeHelperPayload(executables[target], patches[target].sort((a, b) => a.destination - b.destination))])),
  };
}

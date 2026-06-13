export function isAllowedViewerUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.searchParams.get("token") !== null &&
      url.searchParams.get("token") !== "";
  } catch {
    return false;
  }
}

export function stripOuterQuotes(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

export function tailText(value, maxLength = 2000) {
  if (value.length <= maxLength) {
    return value;
  }
  return `...${value.slice(value.length - maxLength)}`;
}

export function formatProcessFailure({ executable, args, cwd, code, signal, stdout, stderr }) {
  const combinedOutput = `${stderr}\n${stdout}`;
  if (/CSV file is empty|no header row/i.test(combinedOutput)) {
    return "This CSV does not have a header row yet. Add a first line with column names, or create a new CSV with csvzall to start from a one-column table.";
  }

  const parts = [
    `csvzall exited with code ${code ?? "unknown"}${signal ? ` (signal ${signal})` : ""}.`,
    `Command: ${[executable, ...args].join(" ")}`,
  ];
  if (cwd) {
    parts.push(`Working directory: ${cwd}`);
  }
  const stderrTail = tailText(stderr.trim());
  const stdoutTail = tailText(stdout.trim());
  if (stderrTail) {
    parts.push(`stderr:\n${stderrTail}`);
  }
  if (stdoutTail) {
    parts.push(`stdout:\n${stdoutTail}`);
  }
  return parts.join("\n\n");
}

export function extractViewerUrl(output) {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.url === "string" && isAllowedViewerUrl(parsed.url)) {
        return parsed.url;
      }
    } catch {
      // Plain URL output is also accepted.
    }

    const match = trimmed.match(/http:\/\/127\.0\.0\.1:\d+\/[^\s"]*/);
    if (match && isAllowedViewerUrl(match[0])) {
      return match[0];
    }
  }

  return null;
}

export function isCsvzallDirtyStateMessage(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.source === "csvzall-viewer" &&
      value.type === "dirty-state" &&
      typeof value.dirty === "boolean",
  );
}

export function csvzallDirtyStateFromMessageEvent(event, sourceWindow) {
  if (!sourceWindow || event?.source !== sourceWindow || !isCsvzallDirtyStateMessage(event?.data)) {
    return null;
  }
  return event.data.dirty;
}

export class ViewerSessionRegistry {
  constructor() {
    this.handles = [];
    this.leafHandles = new Map();
  }

  add(handle) {
    this.handles.push(handle);
  }

  list() {
    return this.handles;
  }

  clear() {
    this.handles = [];
    this.leafHandles.clear();
  }

  detachHandle(handle) {
    this.handles = this.handles.filter((candidate) => candidate !== handle);
    for (const [leaf, candidate] of this.leafHandles.entries()) {
      if (candidate === handle) {
        this.leafHandles.delete(leaf);
      }
    }
  }

  leafForHandle(handle) {
    for (const [leaf, candidate] of this.leafHandles.entries()) {
      if (candidate === handle) {
        return leaf;
      }
    }
    return null;
  }

  bindLeaf(leaf, handle) {
    const existing = this.leafHandles.get(leaf);
    if (existing && existing !== handle && !existing.process.killed) {
      existing.stopping = true;
      existing.process.kill();
      this.detachHandle(existing);
    }
    this.leafHandles.set(leaf, handle);
  }

  closeLeaf(leaf) {
    const handle = this.leafHandles.get(leaf) ?? null;
    if (!handle) {
      return null;
    }

    this.leafHandles.delete(leaf);
    this.handles = this.handles.filter((candidate) => candidate !== handle);
    if (!handle.process.killed) {
      handle.stopping = true;
      handle.process.kill();
    }
    return handle;
  }

  shutdownAll() {
    for (const handle of this.handles) {
      handle.stopping = true;
      handle.process.kill();
    }
    this.clear();
  }
}

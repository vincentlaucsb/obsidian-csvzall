type ProcessFailureContext = {
  executable: string;
  args: string[];
  cwd?: string;
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
};

type DirtyStateMessage = {
  source: "csvzall-viewer";
  type: "dirty-state";
  dirty: boolean;
};

type MessageLike = {
  source?: unknown;
  data?: unknown;
};

type SessionHandle = {
  stopping: boolean;
  process: {
    killed: boolean;
    kill(): unknown;
  };
};

export function isAllowedViewerUrl(value: string): boolean {
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

export function stripOuterQuotes(value: string): string {
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

export function tailText(value: string, maxLength = 2000): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `...${value.slice(value.length - maxLength)}`;
}

export function formatProcessFailure({ executable, args, cwd, code, signal, stdout, stderr }: ProcessFailureContext): string {
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

export function extractViewerUrl(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as { url?: unknown };
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

export function isCsvzallDirtyStateMessage(value: unknown): value is DirtyStateMessage {
  return Boolean(
    value &&
      typeof value === "object" &&
      "source" in value &&
      value.source === "csvzall-viewer" &&
      "type" in value &&
      value.type === "dirty-state" &&
      "dirty" in value &&
      typeof value.dirty === "boolean",
  );
}

export function csvzallDirtyStateFromMessageEvent(event: MessageLike, sourceWindow: unknown): boolean | null {
  if (!sourceWindow || event.source !== sourceWindow || !isCsvzallDirtyStateMessage(event.data)) {
    return null;
  }
  return event.data.dirty;
}

export class ViewerSessionRegistry<TLeaf = unknown, THandle extends SessionHandle = SessionHandle> {
  private handles: THandle[] = [];
  private readonly leafHandles = new Map<TLeaf, THandle>();

  add(handle: THandle): void {
    this.handles.push(handle);
  }

  list(): THandle[] {
    return this.handles;
  }

  clear(): void {
    this.handles = [];
    this.leafHandles.clear();
  }

  detachHandle(handle: THandle): void {
    this.handles = this.handles.filter((candidate) => candidate !== handle);
    for (const [leaf, candidate] of this.leafHandles.entries()) {
      if (candidate === handle) {
        this.leafHandles.delete(leaf);
      }
    }
  }

  leafForHandle(handle: THandle): TLeaf | null {
    for (const [leaf, candidate] of this.leafHandles.entries()) {
      if (candidate === handle) {
        return leaf;
      }
    }
    return null;
  }

  bindLeaf(leaf: TLeaf, handle: THandle): void {
    const existing = this.leafHandles.get(leaf);
    if (existing && existing !== handle && !existing.process.killed) {
      existing.stopping = true;
      existing.process.kill();
      this.detachHandle(existing);
    }
    this.leafHandles.set(leaf, handle);
  }

  closeLeaf(leaf: TLeaf): THandle | null {
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

  shutdownAll(): void {
    for (const handle of this.handles) {
      handle.stopping = true;
      handle.process.kill();
    }
    this.clear();
  }
}

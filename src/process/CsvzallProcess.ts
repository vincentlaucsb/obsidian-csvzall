import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { dirname, isAbsolute } from "path";
import { StringDecoder } from "string_decoder";
import { extractViewerUrl, formatProcessFailure, hasViewerUrl } from "../viewerHelpers.js";
import validateObject, { literal } from "../utils/validateObject.js";

export class ViewerStartupCancelledError extends Error {}

const diagnosticLength = 8000;
const maxStartupLineLength = 64 * 1024;
const acknowledgesHostAutomation = validateObject({
  obsidianMode: validateObject({ version: literal(1), chartAutomation: literal("host") }),
});

function startupUrl(line: string, jsonEditor: boolean, terminated: boolean): string | undefined {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    if (!terminated) return undefined;
    // Older helpers may print a plain viewer URL without a mode acknowledgment.
  }
  if (hasViewerUrl(record)) {
    if (acknowledgesHostAutomation(record) &&
        (!jsonEditor || ("viewer" in record && record.viewer === "json"))) return record.url;
  } else if (!extractViewerUrl(line)) {
    return undefined;
  }
  throw new Error(jsonEditor
    ? "This helper did not start a JSON editor. Update the custom executable or use the bundled helper."
    : "This helper does not support Obsidian mode. Update the custom executable or use the bundled helper.");
}

export class CsvzallProcess {
  readonly ready: Promise<string>;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly decoder = new StringDecoder("utf8");
  private startup?: { resolve(url: string): void; reject(error: Error): void; timer: number };
  private line = "";
  private stdout = "";
  private stderr = "";
  private ended = false;

  constructor(
    executable: string,
    readonly filePath: string,
    timeoutMs: number,
    private readonly onEnd: (viewer: CsvzallProcess, error?: Error) => void,
  ) {
    const args = ["view", filePath, "--edit", "--no-open", "--startup-json", "--obsidian"];
    const cwd = isAbsolute(executable) ? dirname(executable) : undefined;
    this.child = spawn(executable, args, { cwd, windowsHide: true });
    this.ready = new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.terminate(new Error(`timed out waiting for csvzall after ${timeoutMs}ms`));
      }, timeoutMs);
      this.startup = { resolve, reject, timer };
    });

    this.child.stdout.on("data", (chunk: Buffer) => {
      this.stdout = (this.stdout + chunk.toString("utf8")).slice(-diagnosticLength);
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-diagnosticLength);
    });
    this.child.stdout.on("data", this.readStartup);
    this.child.on("error", (error: unknown) => this.finish(error instanceof Error ? error : new Error(String(error))));
    this.child.once("exit", (code, signal) => {
      if (this.ended) return;
      this.finish(new Error(formatProcessFailure({ executable, args, cwd, code, signal, stdout: this.stdout, stderr: this.stderr })));
    });
  }

  get stopped(): boolean {
    return this.ended;
  }

  stop(): void {
    this.terminate(new ViewerStartupCancelledError("Viewer startup cancelled"));
  }

  private readonly readStartup = (chunk: Buffer): void => {
    const lines = (this.line + this.decoder.write(chunk)).split("\n");
    this.line = lines.pop() ?? "";
    try {
      for (const line of lines) {
        if (this.acceptLine(line, true)) return;
      }
      if (this.line.length > maxStartupLineLength) throw new Error("Viewer startup record is too long.");
      if (this.line.trimEnd().endsWith("}")) this.acceptLine(this.line, false);
    } catch (error) {
      this.terminate(error instanceof Error ? error : new Error(String(error)));
    }
  };

  private acceptLine(line: string, terminated: boolean): boolean {
    if (line.length > maxStartupLineLength) throw new Error("Viewer startup record is too long.");
    const url = startupUrl(line, this.filePath.toLowerCase().endsWith(".json"), terminated);
    if (!url) return false;
    this.clearStartup()?.resolve(url);
    return true;
  }

  private clearStartup() {
    const startup = this.startup;
    if (startup) {
      window.clearTimeout(startup.timer);
      this.child.stdout.off("data", this.readStartup);
      this.line = "";
      this.startup = undefined;
    }
    return startup;
  }

  private terminate(error: Error): void {
    if (this.ended) return;
    this.finish(error);
    this.child.kill();
  }

  private finish(error: Error): void {
    if (this.ended) return;
    this.ended = true;
    const startup = this.clearStartup();
    startup?.reject(error);
    this.onEnd(this, startup || error instanceof ViewerStartupCancelledError ? undefined : error);
  }
}

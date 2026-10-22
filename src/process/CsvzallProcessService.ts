import { spawn } from "child_process";
import { dirname, isAbsolute } from "path";
import { StringDecoder } from "string_decoder";
import { statSync } from "fs";
import type { WorkspaceLeaf } from "obsidian";
import { Notice } from "obsidian";
import type { EventLog } from "../logging/EventLog.js";
import type { CsvzallPluginSettings } from "../settings/settings.js";
import type { CsvzallServerHandle } from "../types.js";
import { CsvzallTableView } from "../views/CsvzallTableView.js";
import { SessionErrors } from "../logging/SessionErrors.js";
import {
  extractViewerUrl,
  formatProcessFailure,
  stripOuterQuotes,
  ViewerSessionRegistry,
} from "../viewerHelpers.js";

export class ViewerStartupCancelledError extends Error {}

export class CsvzallProcessService {
  readonly sessions = new ViewerSessionRegistry<WorkspaceLeaf, CsvzallServerHandle>();
  private unloading = false;
  private readonly pending = new Set<() => void>();
  private readonly leafPending = new Map<WorkspaceLeaf, () => void>();
  private readonly errors = new SessionErrors();
  private readonly modeSupport = new Set<string>();
  private readonly leafGeneration = new WeakMap<WorkspaceLeaf, number>();

  constructor(
    private readonly getSettings: () => CsvzallPluginSettings,
    private readonly eventLog: EventLog,
    private readonly executablePath?: () => string,
    private readonly beforeCommand?: () => Promise<void>,
  ) {}

  unload(): void {
    this.unloading = true;
    for (const cancel of this.pending) cancel();
    this.sessions.shutdownAll();
  }

  handleLeafClosed(leaf: WorkspaceLeaf): void {
    this.leafGeneration.set(leaf, (this.leafGeneration.get(leaf) ?? 0) + 1);
    this.leafPending.get(leaf)?.();
    this.sessions.closeLeaf(leaf);
  }

  viewerContinuation(leaf: WorkspaceLeaf): () => boolean {
    const generation = this.leafGeneration.get(leaf);
    return () => !this.unloading && this.leafGeneration.get(leaf) === generation;
  }

  bindLeafToServer(leaf: WorkspaceLeaf, handle: CsvzallServerHandle): void {
    this.sessions.bindLeaf(leaf, handle);
  }

  showLeafErrorText(leaf: WorkspaceLeaf | null | undefined, message: string): void {
    if (leaf?.view instanceof CsvzallTableView) {
      leaf.view.showError(message);
    }
  }

  async runCommand(args: string[], cwd: string, label: string, automatic = false, validate?: () => void): Promise<void> {
    await this.captureCommand(args, cwd, validate).catch(async (error: unknown) => {
      if (this.unloading) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const first = this.errors.first(JSON.stringify([cwd, args]), message);
      if (automatic && !first) throw error;
      new Notice(`csvzall failed to regenerate ${label}: ${message}`);
      await this.eventLog.record("error", `Failed to regenerate ${label}`, message);
      console.error(`csvzall failed to regenerate ${label}`, error);
      throw error;
    });
  }

  async captureCommand(args: string[], cwd: string, validate?: () => void): Promise<string> {
    const capabilityProbe = args.length === 2 && args[0] === "view" && args[1] === "--help";
    if (this.beforeCommand && !capabilityProbe) await this.beforeCommand();
    validate?.();
    if (this.unloading) throw new ViewerStartupCancelledError("Plugin unloaded");
    const executable = stripOuterQuotes(this.executablePath?.() ?? this.getSettings().csvzallPath);
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    const decoder = new StringDecoder("utf8");
    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      let bytes = 0;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        this.pending.delete(cancel);
        window.clearTimeout(timeout);
        if (error) reject(error);
        else resolve(stdout + decoder.end());
      };
      const cancel = () => {
        child.kill();
        finish(new ViewerStartupCancelledError("Plugin unloaded"));
      };
      const timeout = window.setTimeout(() => {
        child.kill();
        finish(new Error("CSV command timed out after 60 seconds."));
      }, 60000);
      this.pending.add(cancel);
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 16 * 1024 * 1024) {
          child.kill();
          finish(new Error("Table output exceeds 16 MB. Select fewer rows or columns with a query."));
          return;
        }
        stdout += decoder.write(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString("utf8")).slice(-8000);
      });
      child.on("error", (error: unknown) => {
        finish(error instanceof Error ? error : new Error(String(error)));
      });
      // close follows stdout EOF; exit can arrive before the last output chunk.
      child.on("close", (code, signal) => {
        if (code === 0) {
          finish();
          return;
        }
        finish(
          new Error(
            formatProcessFailure({
              executable,
              args,
              cwd,
              code,
              signal,
              stdout,
              stderr,
            }),
          ),
        );
      });
    });
  }

  async startViewer(filePath: string, leaf?: WorkspaceLeaf): Promise<CsvzallServerHandle> {
    if (leaf) this.handleLeafClosed(leaf);
    const generation = leaf ? this.leafGeneration.get(leaf) : undefined;
    // CsvService prepares the CSV's chart scope before calling this method.
    // Launching a viewer must not repeat global SQL discovery.
    if (this.unloading) throw new ViewerStartupCancelledError("Plugin unloaded");
    if (leaf && this.leafGeneration.get(leaf) !== generation) throw new ViewerStartupCancelledError("Viewer startup cancelled");
    const executable = stripOuterQuotes(this.executablePath?.() ?? this.getSettings().csvzallPath);
    if (this.beforeCommand) {
      const identity = isAbsolute(executable) ? `${executable}:${statSync(executable).mtimeMs}` : executable;
      if (!this.modeSupport.has(identity)) {
        const help = await this.captureCommand(["view", "--help"], isAbsolute(executable) ? dirname(executable) : ".");
        if (!help.includes("--obsidian")) throw new Error("This helper does not support Obsidian mode. Update the custom executable or use a helper built with --obsidian support.");
        this.modeSupport.add(identity);
      }
    }
    if (this.unloading) throw new ViewerStartupCancelledError("Plugin unloaded");
    if (leaf && this.leafGeneration.get(leaf) !== generation) throw new ViewerStartupCancelledError("Viewer startup cancelled");
    const args = ["view", filePath, "--edit", "--no-open", "--startup-json"];
    if (this.beforeCommand) args.push("--obsidian");
    const cwd = isAbsolute(executable) ? dirname(executable) : undefined;
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    return await new Promise<CsvzallServerHandle>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        window.clearTimeout(timeout);
        this.pending.delete(cancel);
        if (leaf && this.leafPending.get(leaf) === cancel) this.leafPending.delete(leaf);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        child.kill();
        reject(error);
      };
      const cancel = () => fail(new ViewerStartupCancelledError("Viewer startup cancelled"));
      const timeout = window.setTimeout(() => {
        fail(new Error(`timed out waiting for csvzall after ${this.getSettings().startupTimeoutMs}ms`));
      }, this.getSettings().startupTimeoutMs);
      this.pending.add(cancel);
      if (leaf) this.leafPending.set(leaf, cancel);

      const finish = (url: string) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        const handle = {
          filePath,
          process: child,
          url,
          stopping: false,
        };
        this.sessions.add(handle);
        if (leaf) this.sessions.bindLeaf(leaf, handle);
        resolve(handle);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        const url = extractViewerUrl(stdout);
        if (url) {
          if (this.beforeCommand) {
            const acknowledged = stdout.split(/\r?\n/).some(line => {
              try {
                const value: unknown = JSON.parse(line);
                if (!value || typeof value !== "object" || !("obsidianMode" in value)) return false;
                const mode = value.obsidianMode;
                return !!mode && typeof mode === "object" && "version" in mode && mode.version === 1 &&
                  "chartAutomation" in mode && mode.chartAutomation === "host";
              } catch { return false; }
            });
            if (!acknowledged) {
              if (!stdout.endsWith("\n")) return;
              fail(new Error("This helper does not support Obsidian mode. Update the custom executable or use the bundled helper."));
              return;
            }
          }
          finish(url);
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      });

      child.on("exit", (code, signal) => {
        cleanup();
        const existingUrl = extractViewerUrl(stdout);
        if (existingUrl && settled) {
          const handle = this.sessions.list().find((candidate: CsvzallServerHandle) => candidate.process === child);
          if (handle) {
            if (!handle.stopping && !this.unloading) {
              void this.showLeafError(
                handle,
                formatProcessFailure({
                  executable,
                  args,
                  cwd,
                  code,
                  signal,
                  stdout,
                  stderr,
                }),
              );
            }
            handle.stopping = true;
            this.sessions.detachHandle(handle);
          }
          return;
        }
        if (settled) {
          return;
        }
        settled = true;
        reject(
          new Error(
            formatProcessFailure({
              executable,
              args,
              cwd,
              code,
              signal,
              stdout,
              stderr,
            }),
          ),
        );
      });
    });
  }

  private async showLeafError(handle: CsvzallServerHandle, message: string): Promise<void> {
    const leaf = this.sessions.leafForHandle(handle);
    this.showLeafErrorText(leaf, message);
  }
}

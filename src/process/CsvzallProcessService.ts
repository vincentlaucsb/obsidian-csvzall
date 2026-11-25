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
  formatProcessFailure,
  stripOuterQuotes,
  ViewerSessionRegistry,
} from "../viewerHelpers.js";

import { CsvzallProcess, ViewerStartupCancelledError } from "./CsvzallProcess.js";

export { ViewerStartupCancelledError };

export class CsvzallProcessService {
  private readonly sessions = new ViewerSessionRegistry<WorkspaceLeaf, CsvzallProcess>();
  private unloading = false;
  private readonly pending = new Set<() => void>();
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
    this.sessions.closeLeaf(leaf);
  }

  viewerContinuation(leaf: WorkspaceLeaf): () => boolean {
    const generation = this.leafGeneration.get(leaf);
    return () => !this.unloading && this.leafGeneration.get(leaf) === generation;
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
    if (this.unloading) throw new ViewerStartupCancelledError("Plugin unloaded");
    const settings = this.getSettings();
    const executable = stripOuterQuotes(this.executablePath?.() ?? settings.csvzallPath);
    if (settings.csvzallExecutableMode === "custom") {
      const mayContinue = leaf ? this.viewerContinuation(leaf) : () => !this.unloading;
      await this.checkCustomViewer(executable);
      if (!mayContinue()) throw new ViewerStartupCancelledError("Viewer startup cancelled");
    }

    const viewer = new CsvzallProcess(executable, filePath, settings.startupTimeoutMs, (process, error) => {
      const owner = this.sessions.leafForHandle(process);
      this.sessions.detachHandle(process);
      if (error && owner) this.showLeafErrorText(owner, error.message);
    });
    this.sessions.add(viewer);
    if (leaf) this.sessions.bindLeaf(leaf, viewer);
    return { filePath, process: viewer, url: await viewer.ready };
  }

  private async checkCustomViewer(executable: string): Promise<void> {
    const identity = isAbsolute(executable) ? `${executable}:${statSync(executable).mtimeMs}` : executable;
    if (this.modeSupport.has(identity)) return;
    const help = await this.captureCommand(["view", "--help"], isAbsolute(executable) ? dirname(executable) : ".");
    if (!help.includes("--obsidian")) {
      throw new Error("This helper does not support Obsidian mode. Update the custom executable or use a helper built with --obsidian support.");
    }
    this.modeSupport.add(identity);
  }
}

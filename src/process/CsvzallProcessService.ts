import type { WorkspaceLeaf } from "obsidian";
import { Notice } from "obsidian";
import type { EventLog } from "../logging/EventLog.js";
import type { CsvzallPluginSettings } from "../settings/settings.js";
import type { CsvzallServerHandle } from "../types.js";
import { CsvzallTableView } from "../views/CsvzallTableView.js";
import {
  extractViewerUrl,
  formatProcessFailure,
  stripOuterQuotes,
  ViewerSessionRegistry,
} from "../viewerHelpers.js";

export class CsvzallProcessService {
  readonly sessions = new ViewerSessionRegistry<WorkspaceLeaf, CsvzallServerHandle>();
  private unloading = false;

  constructor(
    private readonly getSettings: () => CsvzallPluginSettings,
    private readonly eventLog: EventLog,
  ) {}

  unload(): void {
    this.unloading = true;
    this.sessions.shutdownAll();
  }

  handleLeafClosed(leaf: WorkspaceLeaf): void {
    this.sessions.closeLeaf(leaf);
  }

  bindLeafToServer(leaf: WorkspaceLeaf, handle: CsvzallServerHandle): void {
    this.sessions.bindLeaf(leaf, handle);
  }

  showLeafErrorText(leaf: WorkspaceLeaf | null | undefined, message: string): void {
    if (leaf?.view instanceof CsvzallTableView) {
      leaf.view.showError(message);
    }
  }

  async runCommand(args: string[], cwd: string, label: string): Promise<void> {
    const { spawn } = await import("child_process");
    const executable = stripOuterQuotes(this.getSettings().csvzallPath);
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("exit", (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }
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
    }).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`csvzall failed to regenerate ${label}: ${message}`);
      await this.eventLog.record("error", `Failed to regenerate ${label}`, message);
      console.error(`csvzall failed to regenerate ${label}`, error);
      throw error;
    });
  }

  async startViewer(filePath: string): Promise<CsvzallServerHandle> {
    const { spawn } = await import("child_process");
    const { dirname, isAbsolute } = await import("path");
    const executable = stripOuterQuotes(this.getSettings().csvzallPath);
    const args = ["view", filePath, "--edit", "--no-open", "--startup-json"];
    const cwd = isAbsolute(executable) ? dirname(executable) : undefined;
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    return await new Promise<CsvzallServerHandle>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        settled = true;
        child.kill();
        reject(new Error(`timed out waiting for csvzall after ${this.getSettings().startupTimeoutMs}ms`));
      }, this.getSettings().startupTimeoutMs);

      const finish = (url: string) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        const handle = {
          filePath,
          process: child,
          url,
          stopping: false,
        };
        this.sessions.add(handle);
        resolve(handle);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        const url = extractViewerUrl(stdout);
        if (url) {
          finish(url);
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        reject(error);
      });

      child.on("exit", (code, signal) => {
        window.clearTimeout(timeout);
        const existingUrl = extractViewerUrl(stdout);
        if (existingUrl) {
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

import { FileSystemAdapter, TFile, type App, type PluginManifest } from "obsidian";
import { mkdir } from "fs/promises";
import { join } from "path";
import { pluginVaultDirectory } from "./pluginPaths.js";
import { hasErrorCode } from "../utils/errors.js";

export class ObsidianFilesystem {
  constructor(
    private readonly app: App,
    private readonly manifest: PluginManifest & { dir?: string },
  ) {}

  getFullPath(file: TFile): string | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      return null;
    }
    return adapter.getFullPath(file.path);
  }

  getVaultRoot(): string | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      return null;
    }
    return adapter.getBasePath();
  }

  getPluginDataDir(): string | null {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      return null;
    }
    if (this.manifest.dir) {
      return adapter.getFullPath(this.manifest.dir);
    }

    return `${adapter.getBasePath()}/${pluginVaultDirectory(this.app.vault.configDir, { id: this.manifest.id })}`;
  }

  getPluginResourcePath(relativePath: string): string | null {
    const directory = pluginVaultDirectory(this.app.vault.configDir, { id: this.manifest.id, dir: this.manifest.dir || undefined });
    const pluginPath = `${directory}/${relativePath}`;
    return this.app.vault.adapter.getResourcePath(pluginPath.replace(/\\/g, "/"));
  }

  async createPluginSubdirectory(name: string): Promise<void> {
    const directory = this.getPluginDataDir();
    if (!directory) throw new Error("Could not resolve the plugin directory.");
    try { await mkdir(join(directory, name)); }
    catch (error) { if (!hasErrorCode(error, "EEXIST")) throw error; }
  }
}

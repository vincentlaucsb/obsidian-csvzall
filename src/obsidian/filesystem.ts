import { FileSystemAdapter, TFile, type App, type PluginManifest } from "obsidian";
import { pluginVaultDirectory } from "./pluginPaths.js";

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
}

import { FileSystemAdapter, TFile, type App, type PluginManifest } from "obsidian";

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

    return [
      adapter.getBasePath(),
      this.app.vault.configDir,
      "plugins",
      this.manifest.id,
    ].join("/");
  }

  getPluginResourcePath(relativePath: string): string | null {
    const pluginPath = this.manifest.dir ?
      `${this.manifest.dir}/${relativePath}` :
      `${this.app.vault.configDir}/plugins/${this.manifest.id}/${relativePath}`;
    return this.app.vault.adapter.getResourcePath(pluginPath.replace(/\\/g, "/"));
  }
}

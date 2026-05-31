import { join } from "path";
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

    const vault = this.app.vault as { configDir?: string };
    return join(adapter.getBasePath(), vault.configDir ?? ".obsidian", "plugins", this.manifest.id);
  }
}

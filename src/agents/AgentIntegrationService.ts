import type { App } from "obsidian";
import { relative } from "path";
import type { ObsidianFilesystem } from "../obsidian/filesystem.js";
import { bundledCsvzallAsset } from "../installer/bundledInstall.js";
import type { InstallerService } from "../installer/InstallerService.js";
import { AgentIntegration } from "./AgentIntegration.js";

/** Desktop-only glue; helper preparation never changes the viewer's settings. */
export class AgentIntegrationService {
  private integration?: AgentIntegration;
  private readonly key: string;

  constructor(private readonly app: App, private readonly filesystem: ObsidianFilesystem, private readonly installer: InstallerService) {
    this.key = `csvzall:${app.vault.configDir}:agent-integration`;
  }

  private get(): AgentIntegration {
    if (this.integration) return this.integration;
    const root = this.filesystem.getVaultRoot();
    const pluginDir = this.filesystem.getPluginDataDir();
    if (!root || !pluginDir) throw new Error("Agent integration requires a local desktop vault.");
    this.integration = new AgentIntegration({ root, pluginDirectory: relative(root, pluginDir),
      target: `${process.platform}-${process.arch}`,
      load: (): unknown => this.app.loadLocalStorage(this.key),
      save: value => this.app.saveLocalStorage(this.key, value),
      prepare: async repair => {
        const result = await this.installer.prepareBundledHelper(repair);
        return { executablePath: result.executablePath, version: result.tagName,
          executableSha256: bundledCsvzallAsset().executableSha256 };
      },
    });
    return this.integration;
  }

  async refresh(): Promise<void> {
    const value: unknown = this.app.loadLocalStorage(this.key);
    if (value && typeof value === "object" && "enabled" in value && value.enabled === true) await this.get().refresh();
  }
  async enable(): Promise<void> { await this.get().enable(); }
  async remove(): Promise<void> { await this.get().remove(); }
  async testConnection(): Promise<string> { return await this.get().testConnection(); }
}

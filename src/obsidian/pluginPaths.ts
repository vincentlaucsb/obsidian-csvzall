import type { PluginManifest } from "obsidian";

/** Return a vault-relative directory before any desktop absolute-path conversion. */
export function pluginVaultDirectory(configDir: string, manifest: Pick<PluginManifest, "id"> & { dir?: string }): string {
  return manifest.dir ?? `${configDir}/plugins/${manifest.id}`;
}

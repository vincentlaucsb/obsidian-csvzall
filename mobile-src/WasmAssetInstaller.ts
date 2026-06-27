import type { App, PluginManifest } from "obsidian";
import { embeddedWasmViewerAssets } from "./wasmViewerAssets.generated.js";

const EMBEDDED_VIEWER_MARKER = "csvzall-mobile-embedded-wasm-viewer-v1";

type PluginManifestWithDirectory = PluginManifest & {
  dir?: string;
};

type DataAdapterLike = App["vault"]["adapter"] & {
  exists(normalizedPath: string, sensitive?: boolean): Promise<boolean>;
  mkdir(normalizedPath: string): Promise<void>;
  write(normalizedPath: string, data: string): Promise<void>;
  writeBinary(normalizedPath: string, data: ArrayBuffer): Promise<void>;
  getResourcePath(normalizedPath: string): string;
};

function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");
}

function pluginDirectory(app: App, manifest: PluginManifestWithDirectory): string {
  return normalizeVaultPath(manifest.dir ?? `${app.vault.configDir}/plugins/${manifest.id}`);
}

async function ensureParentDirectory(adapter: DataAdapterLike, normalizedPath: string): Promise<void> {
  const parts = normalizedPath.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const directory = parts.slice(0, index).join("/");
    if (!directory || await adapter.exists(directory)) {
      continue;
    }
    try {
      await adapter.mkdir(directory);
    } catch {
      if (!await adapter.exists(directory)) {
        throw new Error(`Could not create plugin asset directory: ${directory}`);
      }
    }
  }
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

export async function ensureEmbeddedWasmViewerAssets(
  app: App,
  manifest: PluginManifestWithDirectory,
): Promise<void> {
  const adapter = app.vault.adapter as DataAdapterLike;
  const basePath = pluginDirectory(app, manifest);

  for (const asset of embeddedWasmViewerAssets) {
    const targetPath = normalizeVaultPath(`${basePath}/${asset.path}`);
    await ensureParentDirectory(adapter, targetPath);
    if (asset.encoding === "text") {
      await adapter.write(targetPath, asset.content);
    } else {
      await adapter.writeBinary(targetPath, base64ToArrayBuffer(asset.content));
    }
  }

  console.debug(`${EMBEDDED_VIEWER_MARKER}: wrote ${embeddedWasmViewerAssets.length} viewer assets`);
}

export function embeddedWasmViewerUrl(app: App, manifest: PluginManifestWithDirectory): string {
  const adapter = app.vault.adapter as DataAdapterLike;
  return adapter.getResourcePath(normalizeVaultPath(`${pluginDirectory(app, manifest)}/wasm-viewer/index.html`));
}

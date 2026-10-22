import { ancestorVaultFolders, joinVaultPath, parentVaultPath, relativeVaultPath, resolveVaultRelativePath } from "../utils/paths.js";

type ConfigKind = "charts" | "exports";

export function configPathForFolder(folder: string, kind: ConfigKind): string {
  return joinVaultPath(folder, `.csvzall/${kind}.json`);
}

/** References are based at the folder containing .csvzall, not inside it. */
export function configRoot(config: string): string {
  return parentVaultPath(parentVaultPath(config));
}

export function directConfig(file: string, kind: ConfigKind): string {
  return configPathForFolder(parentVaultPath(file), kind);
}

/** For migration and legacy bindings; callers control whether ancestors are allowed. */
export function ancestorConfigPaths(file: string, kind: ConfigKind): string[] {
  return ancestorVaultFolders(parentVaultPath(file)).map(folder => configPathForFolder(folder, kind));
}

export function absoluteReference(config: string, reference: string): string {
  if (!reference || reference.includes(":") || /^[\\/]/.test(reference)) throw new Error(`Invalid export path in ${config}.`);
  const resolved = resolveVaultRelativePath(configRoot(config), reference);
  if (resolved === null) throw new Error("Export path leaves the vault.");
  return resolved;
}

export function relativeReference(config: string, absolute: string): string {
  return relativeVaultPath(configRoot(config), absolute);
}

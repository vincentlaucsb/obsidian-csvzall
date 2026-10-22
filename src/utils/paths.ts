/** Portable vault paths only; native filesystem paths belong in desktop adapters. */
export function normalizeVaultPath(path: string, options: { stripLeadingDot?: boolean } = {}): string {
  const slashes = path.replace(/\\/g, "/");
  const relative = options.stripLeadingDot === false ? slashes : slashes.replace(/^\.\//, "");
  return relative.replace(/^\/+/, "").replace(/\/+/g, "/");
}

/** These operations expect canonical, slash-separated paths and preserve case. */
export function parentVaultPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

export function joinVaultPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

export function ancestorVaultFolders(folder: string): string[] {
  const parts = folder ? folder.split("/") : [];
  const folders = [folder];
  while (parts.length) {
    parts.pop();
    folders.push(parts.join("/"));
  }
  return folders;
}

export function isCanonicalVaultPath(path: string): boolean {
  return !path.includes("\\") && !path.includes(":") &&
    !path.split("/").some(part => !part || part === "." || part === "..");
}

/** Empty references mean the base folder; null means an invalid path or vault escape. */
export function resolveVaultRelativePath(baseFolder: string, reference: string): string | null {
  if (reference.includes(":") || /^[\\/]/.test(reference)) return null;
  const parts = baseFolder ? baseFolder.split("/") : [];
  for (const part of reference.replace(/\\/g, "/").split("/")) {
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

export function relativeVaultPath(baseFolder: string, target: string): string {
  const root = baseFolder ? baseFolder.split("/") : [], parts = target.split("/");
  while (root.length && parts.length && root[0] === parts[0]) { root.shift(); parts.shift(); }
  return [...root.map(() => ".."), ...parts].join("/");
}

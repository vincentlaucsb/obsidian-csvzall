/** Accept either slash style regardless of the operating system running the plugin. */
export function portableBasename(path: string): string {
  return path.split(/[\\/]/).pop() ?? "";
}

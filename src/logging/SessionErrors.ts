/** Every distinct background failure is reported at most once per plugin load. */
export class SessionErrors {
  private readonly seen = new Set<string>();
  first(context: string, cause: string): boolean {
    const key = JSON.stringify([context, cause]);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}

// Server memory only. Every use still requires a fresh published catalog.
class BodyTextCache {
  private entries = new Map<string, { revision: string; text: string; expires: number; truncated: boolean }>();
  get(key: string, revision: string) {
    const entry = this.entries.get(key);
    if (!entry || entry.revision !== revision || entry.expires <= Date.now()) {
      this.entries.delete(key);
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }
  set(key: string, revision: string, text: string, truncated = false) {
    const entry = { revision, text: text.slice(0, 80_000), truncated: truncated || text.length > 80_000, expires: Date.now() + 300_000 };
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > 64) this.entries.delete(this.entries.keys().next().value!);
    return entry;
  }
  clear() { this.entries.clear(); }
}
export const bodyTextCache = new BodyTextCache();

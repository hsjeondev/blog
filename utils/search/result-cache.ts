import { normalizeFolderPath } from "./folders";
import type { SearchResult, SearchScope } from "./types";
import { matchesSearchScope } from './types';

export type SearchSnapshot = { results: SearchResult[]; partial: boolean };
const MAX_ENTRIES = 24;
const TTL = 60_000;

export function searchKey(query: string, scope: SearchScope, folder = "") {
  return JSON.stringify([query.trim(), scope, normalizeFolderPath(folder)]);
}

// Each open search owns its cache; closing it releases the query history.
export class SearchResultCache {
  private entries = new Map<string, { snapshot: SearchSnapshot; expires: number }>();

  set(query: string, scope: SearchScope, folder: string, snapshot: SearchSnapshot, now = Date.now()) {
    for (const [key, entry] of this.entries) if (entry.expires <= now) this.entries.delete(key);
    const key = searchKey(query, scope, folder);
    this.entries.delete(key);
    this.entries.set(key, { snapshot, expires: now + TTL });
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
  }

  get(query: string, scope: SearchScope, folder = "", now = Date.now()): SearchSnapshot | undefined {
    const lookup = (type: SearchScope, path: string) => {
      const key = searchKey(query, type, path);
      const entry = this.entries.get(key);
      if (!entry) return undefined;
      if (entry.expires <= now) { this.entries.delete(key); return undefined; }
      return entry.snapshot;
    };
    const exact = lookup(scope, folder);
    if (exact) return exact;
    const all = lookup("all", folder);
    if (!all || scope === "all") return all;
    return { results: all.results.filter((result) => matchesSearchScope(result, scope)), partial: all.partial };
  }
}

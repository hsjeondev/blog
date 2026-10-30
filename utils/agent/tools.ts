import { fetchNotionBacklinks } from '../notion-backlinks';
import { getNotionPage } from "../blog-data";
import { getPublishedPage } from "../blog-data";
import { blockValue, compactNotionId, resolveBacklinkSources } from "../backlink-graph";
import { inScope, searchContent } from "../search/search-service";
import { normalizeFolderPath } from "../search/folders";
import type { SearchResult, SearchScope } from "../search/types";

export function createAgentTools(catalog: SearchResult[], scope: SearchScope, folder: string, signal: AbortSignal) {
  const allowed = new Map(catalog.filter((item) => inScope(item, scope, folder)).map((item) => [compactNotionId(item.id), item]));
  const sources = new Map<string, SearchResult>();
  let reads = 0;
  const readCache = new Map<string, string>();
  const getAllowed = (id: unknown) => typeof id === "string" ? allowed.get(compactNotionId(id)) : undefined;

  const run = async (name: string, args: Record<string, unknown>) => {
    signal.throwIfAborted();
    if (name === "search_content") {
      if (typeof args.query !== "string" || !args.query.trim() || args.query.length > 300) return { error: "Invalid query" };
      const result = await searchContent(args.query, scope, folder, 8, { mode: 'body', signal });
      return { partial: result.partial || !!('nextCursor' in result && result.nextCursor), results: result.results.filter((item) => allowed.has(compactNotionId(item.id))) };
    }
    if (name === "list_folder") {
      if (typeof args.path !== "string" || args.path.length > 500) return { error: "Invalid path" };
      const path = normalizeFolderPath(args.path);
      return { documents: [...allowed.values()].filter((item) => inScope(item, scope, path)).slice(0, 30) };
    }
    const item = getAllowed(args.pageId);
    if (!item) return { error: "Document is outside the published search scope" };
    if (name === "read_document") {
      await getPublishedPage(item.id, signal);
      const existing = readCache.get(item.id);
      if (existing !== undefined) return { ...item, text: existing, citation: [...sources.keys()].indexOf(item.id) + 1 };
      if (reads >= 5) return { error: "Document read limit reached" };
      reads++;
      const recordMap = await getNotionPage(item.id, signal);
      signal.throwIfAborted();
      const blocks = recordMap.block || {};
      const byId = new Map(Object.entries(blocks).map(([id, entry]) => [compactNotionId(id), blockValue(entry)]));
      const visited = new Set<string>();
      const parts: string[] = [];
      let length = 0;
      const visit = (id: string, root = false) => {
        const key = compactNotionId(id);
        if (visited.has(key) || length >= 12_000) return;
        visited.add(key);
        const block = byId.get(key);
        if (!block || (!root && block.type === "page")) return;
        const text = (block.properties?.title || []).map((part: any) => part[0] || "").join("");
        if (text) { parts.push(text.slice(0, 12_000 - length)); length += text.length + 1; }
        for (const child of block.content || []) visit(child);
      };
      visit(item.id, true);
      const text = parts.join("\n").slice(0, 12_000);
      if (!text) return { error: "No readable public text" };
      readCache.set(item.id, text);
      sources.set(item.id, item);
      return { ...item, text, citation: sources.size };
    }
    if (name === "get_backlinks") {
      const payload = await fetchNotionBacklinks(item.id, AbortSignal.any([signal, AbortSignal.timeout(8_000)]));
      signal.throwIfAborted();
      return { documents: resolveBacklinkSources(payload).flatMap((source) => {
        const published = getAllowed(source.id);
        return published ? [published] : [];
      }).slice(0, 20) };
    }
    return { error: "Unknown tool" };
  };
  return { run, sources };
}

import { createHash } from 'node:crypto';
import { getDatabase } from '../get-database';
import { bookMetadata, getPublishedPage, publicationKind } from '../published-notion';
import { bookDatabaseId } from '../notion-server';
import { officialRecordMap } from '../official-record-map';
import { bodyTextCache } from './body-cache';
import { normalizeFolderPath } from './folders';
import type { SearchResult, SearchScope } from './types';

export function normalizePage(page: any, type: SearchResult['type']): SearchResult {
  const meta = bookMetadata(page);
  return { id: meta.id, title: meta.title, author: meta.author, category: meta.category, type, folderPath: normalizeFolderPath(meta.folderPath),
    href: type === 'document' ? '/forest?document=' + meta.id : type === 'recap' ? '/recap?document=' + meta.id : '/' + meta.id,
    createdTime: meta.createdTime, lastEditedTime: meta.lastEditedTime };
}
export async function getSearchCatalog(signal?: AbortSignal): Promise<SearchResult[]> {
  return (await getDatabase(undefined, undefined, signal)).results.map((page) => normalizePage(page, publicationKind(page)));
}
export function inScope(item: SearchResult, scope: SearchScope = 'all', folder = '') {
  const path = normalizeFolderPath(folder);
  return (scope === 'all' || item.type === scope) && (!path || item.folderPath === path || item.folderPath.startsWith(path + '/'));
}
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ko-KR');
const metadataMatch = (item: SearchResult, query: string) => [item.title, item.author || '', item.category || ''].some(value => normalize(value).includes(query));

// Only this book's body is searchable. Referenced page titles and internal
// links must not enter a cache that could outlive their publication.
export function searchableBody(map: any, pageId: string) {
  const parts: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string, root = false) => {
    if (visited.has(id)) return;
    visited.add(id);
    const block = map.block?.[id]?.value;
    if (!block || (!root && ['page', 'collection_view_page'].includes(block.type))) return;
    if (!root) {
      const rich = (value: any[]) => (value || []).filter(part => !(part[1] || []).some((a: any[]) => a[0] === 'p' || (a[0] === 'a' && /^\/[a-f0-9-]{32,36}$/.test(a[1] || '')))).map(part => part[0] || '').join('');
      for (const [key, value] of Object.entries(block.properties || {})) {
        if (key === 'title' || key.startsWith('column_')) parts.push(rich(value as any[]));
      }
    }
    for (const child of block.content || []) visit(child);
  };
  visit(pageId, true);
  return parts.join('\n').trim();
}

export type SearchRequest = { mode?: 'metadata' | 'body'; cursor?: string; signal?: AbortSignal };
export async function searchContent(query: string, scope: SearchScope = 'all', folder = '', limit = 30, options: SearchRequest = {}) {
  const normalized = normalize(query.trim());
  if (!normalized) return { results: [], partial: false };
  options.signal?.throwIfAborted();
  const raw = (await getDatabase(undefined, undefined, options.signal)).results;
  const catalog = raw.map((page) => normalizePage(page, publicationKind(page)));
  const items = catalog.filter(item => inScope(item, scope, folder)).sort((a, b) => a.id.localeCompare(b.id));
  const titles = items.filter(item => metadataMatch(item, normalized));
  const max = Math.max(1, Math.min(limit, 50));
  if (options.mode !== 'body') return { results: titles.slice(0, max), partial: false };

  const candidates = items.filter(item => !metadataMatch(item, normalized));
  const revision = createHash('sha256').update(JSON.stringify([normalized, scope, folder, items.map(item => [item.id, item.lastEditedTime])])).digest('hex');
  let offset = 0;
  if (options.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString());
      if (!Number.isSafeInteger(cursor.offset) || cursor.offset < 0) throw new Error();
      if (cursor.revision === revision) offset = Math.min(cursor.offset, candidates.length);
    } catch { throw Object.assign(new Error('Invalid search cursor'), { status: 400 }); }
  }
  const texts = new Map<string, { text: string; revision: string; truncated: boolean }>();
  let partial = false;
  const end = Math.min(offset + 2, candidates.length);
  for (const item of candidates.slice(offset, end)) {
    options.signal?.throwIfAborted();
    const key = bookDatabaseId() + ':' + item.id;
    const cached = bodyTextCache.get(key, item.lastEditedTime);
    if (cached) { texts.set(item.id, cached); partial ||= cached.truncated; continue; }
    try {
      const page = await getPublishedPage(item.id, options.signal);
      const map = await officialRecordMap(page, raw.map(bookMetadata), options.signal);
      const text = searchableBody(map, item.id);
      texts.set(item.id, { text, revision: page.last_edited_time, truncated: text.length > 80_000 });
    } catch (error) {
      options.signal?.throwIfAborted();
      if ([429, 529].includes(error.status)) throw error;
      partial = true;
    }
  }
  // Do not release new or cached excerpts if fresh publication checks fail.
  const live = (await getSearchCatalog(options.signal)).filter(item => inScope(item, scope, folder));
  const results = live.filter(item => metadataMatch(item, normalized));
  for (const item of live) {
    const candidate = texts.get(item.id);
    if (!candidate || candidate.revision !== item.lastEditedTime) { if (candidate) partial = true; continue; }
    const cached = bodyTextCache.set(bookDatabaseId() + ':' + item.id, item.lastEditedTime, candidate.text, candidate.truncated);
    partial ||= candidate.truncated;
    const index = normalize(cached.text).indexOf(normalized);
    if (index >= 0 && !metadataMatch(item, normalized)) results.push({ ...item, excerpt: cached.text.slice(Math.max(0, index - 60), index + 180) });
  }
  return { results: results.slice(0, max), partial, scanned: end, total: candidates.length,
    live: Object.fromEntries(live.map(item => [item.id, item.lastEditedTime])),
    nextCursor: end < candidates.length ? Buffer.from(JSON.stringify({ offset: end, revision })).toString('base64url') : null };
}

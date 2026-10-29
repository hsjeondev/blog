import { getNotionPage } from '../get-notion-page';
import { getDatabase } from '../get-database';
import { bookMetadata, publicationKind } from '../published-notion';
import { normalizeFolderPath } from './folders';
import { extractTextFromRecordMap } from '../extract-text';
import type { SearchResult, SearchScope } from './types';

export function normalizePage(page: any, type: SearchResult['type']): SearchResult {
  const meta = bookMetadata(page);
  return { id: meta.id, title: meta.title, type, folderPath: normalizeFolderPath(meta.folderPath),
    href: type === 'document' ? '/forest?document=' + meta.id : type === 'recap' ? '/recap?document=' + meta.id : '/' + meta.id,
    createdTime: meta.createdTime, lastEditedTime: meta.lastEditedTime };
}
export async function getSearchCatalog(): Promise<SearchResult[]> {
  const data = await getDatabase();
  const currentMonth = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date());
  return data.results.filter((page) => publicationKind(page) !== 'recap' || !bookMetadata(page).date.startsWith(currentMonth))
    .map((page) => normalizePage(page, publicationKind(page)));
}
export function inScope(item: SearchResult, scope: SearchScope = 'all', folder = '') {
  const path = normalizeFolderPath(folder);
  return (scope === 'all' || item.type === scope) && (!path || item.folderPath === path || item.folderPath.startsWith(path + '/'));
}
export async function searchContent(query: string, scope: SearchScope = 'all', folder = '', limit = 30) {
  const normalized = query.trim().toLocaleLowerCase('ko-KR');
  if (!normalized) return { results: [], partial: false };
  const items = (await getSearchCatalog()).filter((item) => inScope(item, scope, folder));
  const matches = new Map(items.filter((item) => item.title.toLocaleLowerCase('ko-KR').includes(normalized)).map((item) => [item.id, item]));
  const candidates = items.filter((item) => !matches.has(item.id));
  let partial = candidates.length > 20;
  const signal = AbortSignal.timeout(20_000);
  for (const item of candidates.slice(0, 20)) {
    try {
      const text = extractTextFromRecordMap(await getNotionPage(item.id, signal));
      const index = text.toLocaleLowerCase('ko-KR').indexOf(normalized);
      if (index >= 0) matches.set(item.id, { ...item, excerpt: text.slice(Math.max(0, index - 60), index + 180) });
    } catch { partial = true; }
    if (signal.aborted) { partial = true; break; }
  }
  const live = new Set((await getSearchCatalog()).map((item) => item.id));
  return { results: [...matches.values()].filter((item) => live.has(item.id)).slice(0, Math.max(1, Math.min(limit, 50))), partial };
}

import { getDatabase } from '../blog-data';
import { bookMetadata, publicationKind } from '../book-metadata';
import { bookDatabaseId } from '../notion-server';
import { supabaseRead } from '../supabase-http';
import { normalizeFolderPath } from './folders';
import type { SearchResult, SearchScope } from './types';
export { searchableBody } from '../record-map-text';

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

export type SearchRequest = { mode?: 'metadata' | 'body'; cursor?: string; signal?: AbortSignal };
export async function searchContent(query: string, scope: SearchScope = 'all', folder = '', limit = 30, options: SearchRequest = {}) {
  const normalized = normalize(query.trim());
  if (!normalized) return { results: [], partial: false };
  options.signal?.throwIfAborted();
  const catalog = (await getSearchCatalog(options.signal)).filter(item => inScope(item,scope,folder));
  const max = Math.max(1,Math.min(limit,50));
  if (options.mode !== 'body') return { results: catalog.filter(item=>metadataMatch(item,normalized)).slice(0,max), partial:false };
  let snippets: any[] = [], partial=false;
  try {
    const data=await supabaseRead('blog_search_public',{p_database:bookDatabaseId(),p_query:query.trim(),p_ids:catalog.map(item=>item.id)},options.signal);
    if(!Array.isArray(data))throw new Error('Invalid body search result');
    snippets=data;
  } catch(error) { options.signal?.throwIfAborted(); partial=true; }
  // A second small metadata read also revokes excerpts if visibility changed.
  const live=(await getSearchCatalog(options.signal)).filter(item=>inScope(item,scope,folder));
  const byId=new Map(snippets.map(item=>[item.id,item]));
  const results: SearchResult[]=live.flatMap(item=>{
    if(metadataMatch(item,normalized))return [item];
    const found=byId.get(item.id);
    return found&&new Date(found.revision).getTime()===Date.parse(item.lastEditedTime)?[{...item,excerpt:String(found.excerpt).slice(0,240)}]:[];
  });
  return {results:results.slice(0,max),partial,scanned:catalog.length,total:catalog.length,nextCursor:null,
    live:Object.fromEntries(live.map(item=>[item.id,item.lastEditedTime]))};
}

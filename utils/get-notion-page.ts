import { blockValue } from './backlink-graph';
import { officialRecordMap } from './official-record-map';
import { getPublishedPage, publishedBooks } from './published-notion';

export function deferredNotionPaths() {
  return { paths: [], fallback: 'blocking' as const };
}
export function normalizeNotionRecordMap(recordMap: any, pageId: string) {
  const root = blockValue(recordMap?.block?.[pageId]);
  if (!root?.id || !['page', 'collection_view_page'].includes(root.type)) throw new Error('Incomplete Notion page response');
  for (const [id, entry] of Object.entries(recordMap.block) as [string, any][]) recordMap.block[id] = { ...entry, value: blockValue(entry) };
  return recordMap;
}
export async function getNotionPage(pageId: string, signal?: AbortSignal) {
  const page = await getPublishedPage(pageId, signal);
  const recordMap = await officialRecordMap(page, await publishedBooks(), signal);
  await getPublishedPage(pageId, signal);
  return recordMap;
}
export function isNotionNotFound(error: any) {
  return (error?.statusCode || error?.status || error?.response?.status) === 404 || error?.code === 'object_not_found';
}

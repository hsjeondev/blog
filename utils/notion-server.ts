import { fetchNotionJson } from './notion-fetch';

export function notionId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const id = value.replace(/-/g, '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(id)) return '';
  return [id.slice(0, 8), id.slice(8, 12), id.slice(12, 16), id.slice(16, 20), id.slice(20)].join('-');
}

export function notionToken() {
  const token = process.env.NOTION_API_KEY?.trim() || process.env.NOTION_TOKEN?.trim();
  if (!token) throw Object.assign(new Error('Notion integration is not configured'), { status: 503 });
  return token;
}

export function bookDatabaseId() {
  const id = notionId(process.env.NOTION_MYBOOKLIST_ID?.trim());
  if (!id) throw Object.assign(new Error('NOTION_MYBOOKLIST_ID is not configured'), { status: 503 });
  return id;
}

export function notPublished() {
  return Object.assign(new Error('Page not found'), { status: 404, code: 'object_not_found' });
}

export async function notionRequest(path: string, body?: any, signal?: AbortSignal) {
  return fetchNotionJson('https://api.notion.com/v1/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + notionToken(), 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
}

export function isPublishedBook(page: any) {
  return page?.object === 'page' && !page.archived && !page.in_trash
    && notionId(page.parent?.database_id) === bookDatabaseId()
    && page.properties?.['공개']?.type === 'checkbox' && page.properties['공개'].checkbox === true;
}

export function noPublicationCache(res: { setHeader: (name: string, value: string) => any }) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
}

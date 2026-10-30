import { supabaseRead } from './supabase-http';
import { bookDatabaseId, notionId, notPublished } from './notion-server';
export { bookMetadata, propertyText, publicationKind, siteUrl } from './book-metadata';

export function rowMetadata(row: any) {
  return { id: row.id, title: row.title, author: row.author, category: row.category, tags: row.tags || [], date: new Date(row.written_at).toISOString(),
    createdTime: new Date(row.notion_created_at).toISOString(), lastEditedTime: new Date(row.notion_edited_at).toISOString(),
    icon: row.icon || null, cover: row.cover || null, description: row.description || '', folderPath: row.folder_path || '', kind: row.kind };
}
function pageShape(row: any) {
  const rich = (text: string) => ({ type: 'rich_text', rich_text: [{ plain_text: text }] });
  const kind = { post: '포스트', document: '문서', project: '프로젝트', recap: '월말결산' };
  return { object: 'page', id: row.id, parent: { database_id: row.notion_database_id }, created_time: row.notion_created_at, last_edited_time: row.notion_edited_at,
    icon: row.icon, cover: row.cover, properties: {
      책제목: { type: 'title', title: [{ plain_text: row.title }] }, 저자: rich(row.author), 분류: { select: { name: row.category } },
      태그: { multi_select: row.tags || [] }, 작성일: { date: { start: row.written_at } }, forest_날짜: { date: { start: row.written_at } },
      유형: { select: { name: kind[row.kind] || '포스트' } }, forest_폴더: rich(row.folder_path || ''), 설명: rich(row.description || ''), 공개: { type: 'checkbox', checkbox: true },
    } };
}
export async function publishedBooks(signal?: AbortSignal) {
  const rows = await supabaseRead('blog_read_catalog', { p_database: bookDatabaseId() }, signal);
  if (!Array.isArray(rows)) throw new Error('Invalid blog catalog');
  return rows.map(rowMetadata);
}
// Legacy metadata adapters keep existing views compatible without calling Notion.
export async function getDatabase(databaseId = bookDatabaseId(), _body: any = {}, signal?: AbortSignal) {
  if (notionId(databaseId) !== bookDatabaseId()) throw notPublished();
  const rows = await supabaseRead('blog_read_catalog', { p_database: bookDatabaseId() }, signal);
  if (!Array.isArray(rows)) throw new Error('Invalid blog catalog');
  return { results: rows.map(pageShape) };
}
export async function getPublishedPage(pageId: string, signal?: AbortSignal) {
  const id = notionId(pageId);
  if (!id) throw notPublished();
  const row = await supabaseRead('blog_read_post', { p_database: bookDatabaseId(), p_page: id }, signal);
  if (!row) throw notPublished();
  return pageShape(row);
}
export async function getNotionPage(pageId: string, signal?: AbortSignal) {
  const id = notionId(pageId);
  if (!id) throw notPublished();
  const data = await supabaseRead('blog_read_page', { p_database: bookDatabaseId(), p_page: id }, signal);
  if (!data) throw notPublished();
  const map = data.recordMap;
  if (!map?.block?.[id]?.value) throw new Error('Incomplete stored blog body');
  const meta = rowMetadata(data.post);
  const allowed = new Map<string, any>([[id, meta], ...(data.references || []).map((row: any) => [row.id, rowMetadata(row)] as [string, any])]);
  const denied = new Set<string>((map.published_references || []).filter((target: string) => !allowed.has(target)));
  for (const [blockId, entry] of Object.entries(map.block) as [string, any][]) {
    if (denied.has(blockId)) { delete map.block[blockId]; if (map.signed_urls) delete map.signed_urls[blockId]; continue; }
    const block = entry.value;
    if (block.content) block.content = block.content.filter((child: string) => !denied.has(child));
    if (block.type === 'page') {
      const current = allowed.get(blockId);
      if (!current) { delete map.block[blockId]; continue; }
      block.properties ||= {};
      block.blog_metadata = current; block.properties.title = [[current.title]];
    }
    for (const value of Object.values(block.properties || {}) as any[]) if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        const part = value[index];
        if (!Array.isArray(part?.[1])) continue;
        const mention = part[1].find((a: any[]) => a[0] === 'p');
        const internal = part[1].find((a: any[]) => a[0] === 'a' && /^\/[a-f0-9-]{32,36}$/.test(a[1] || ''));
        const target = mention?.[1] || internal?.[1]?.slice(1);
        if (target && !allowed.has(notionId(target))) value[index] = ['[비공개 문서]'];
        else if (mention) part[0] = allowed.get(notionId(target)).title;
      }
    }
  }
  const root = map.block[id].value;
  root.format ||= {};
  root.blog_metadata = meta;
  root.format.page_cover = meta.cover?.file?.url || meta.cover?.external?.url;
  root.format.page_icon = meta.icon?.emoji || meta.icon?.file?.url || meta.icon?.external?.url;
  map.reading_minutes = data.readingMinutes;
  map.published_references = (map.published_references || []).filter((target: string) => allowed.has(target));
  // PostgreSQL jsonb does not preserve object key order. The legacy renderer
  // selects the first block as its root, so restore that contract after reading.
  map.block = { [id]: map.block[id], ...map.block };
  return map;
}
export function isNotionNotFound(error: any) { return error?.status === 404 || error?.code === 'object_not_found'; }

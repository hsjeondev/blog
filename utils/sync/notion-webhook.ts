import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { getDatabase } from '../get-database';
import { bookMetadata } from '../published-notion';
import { bookDatabaseId, isPublishedBook, notionId, notionRequest } from '../notion-server';
import { commentReferences } from '../comment-references';
import { collectPage, type SyncStore } from './notion-sync';
import { withNotionPacing } from './notion-pacing';

const pageTypes = new Set(['page.created', 'page.properties_updated', 'page.content_updated', 'page.deleted', 'page.undeleted', 'page.moved']);
const commentTypes = new Set(['comment.created', 'comment.updated', 'comment.deleted']);
export function validNotionSignature(raw: Buffer, signature: unknown, token: string) {
  if (!token || typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', token).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

export function normalizedNotionEvent(payload: any) {
  const type = payload?.type;
  if (!pageTypes.has(type) && !commentTypes.has(type)) return null;
  const id = notionId(payload.id);
  const time = typeof payload.timestamp === 'string' ? Date.parse(payload.timestamp) : NaN;
  if (!id || !Number.isFinite(time) || time > Date.now() + 300_000) throw Object.assign(new Error('Invalid event'), { status: 400 });
  if (commentTypes.has(type) && (payload.data?.parent?.type !== 'page' || payload.data?.property_id)) return null;
  const page = notionId(pageTypes.has(type) ? payload.entity?.type === 'page' && payload.entity.id : payload.data?.page_id);
  if (!page) throw Object.assign(new Error('Invalid event page'), { status: 400 });
  return { id, type, page, time: new Date(time).toISOString() };
}

async function syncPageDelta(store: SyncStore, source: string, worker: string, event: any, signal: AbortSignal) {
  const started = await store.call('blog_sync_started_at', {}, signal);
  for (let attempt = 0; attempt < 3; attempt++) {
    let page: any;
    try { page = await notionRequest('pages/' + event.pageId, undefined, signal); }
    catch (error) { if (error.status !== 404) throw error; }
    const raw = (await getDatabase(undefined, undefined, signal)).results;
    const catalog = raw.map(bookMetadata);
    const ids = catalog.map(book => book.id);
    if (!page || !isPublishedBook(page)) {
      // A 404 alone is ambiguous. A successful full public catalog excluding
      // the page is authoritative, including pages moved outside this DB.
      if (ids.includes(event.pageId)) continue;
      return store.call('blog_commit_notion_page', { p_database: source, p_worker: worker, p_event: event.id,
        p_page: event.pageId, p_started_at: started, p_book: null, p_public_ids: ids }, signal);
    }
    if (!ids.includes(event.pageId)) continue;
    if (event.type.startsWith('comment.')) {
      const links = await commentReferences(event.pageId, new Set(ids), signal);
      const fresh = (await getDatabase(undefined, undefined, signal)).results;
      if (fresh.find(item => notionId(item.id) === event.pageId)?.last_edited_time !== page.last_edited_time) continue;
      const live = fresh.map(item => notionId(item.id));
      return store.call('blog_commit_notion_page', { p_database: source, p_worker: worker, p_event: event.id,
        p_page: event.pageId, p_started_at: started, p_public_ids: live,
        p_book: { links_only: true, post: { id: event.pageId, notion_edited_at: page.last_edited_time }, links: links.filter(id => live.includes(id)) } }, signal);
    }
    let book;
    try { book = await collectPage(event.pageId, catalog, signal); }
    catch (error) { if (error.status === 404) continue; throw error; }
    if (store.prepareBook) book = await store.prepareBook(book, signal);
    const fresh = (await getDatabase(undefined, undefined, signal)).results;
    const live = new Map(fresh.map(item => [notionId(item.id), item]));
    if (live.get(event.pageId)?.last_edited_time !== book.post.notion_edited_at
      || book.content.referenced_page_ids.some((id: string) => !live.has(id)
        || book.content.record_map.block[id]?.value?.blog_metadata?.lastEditedTime !== live.get(id).last_edited_time)) continue;
    book.links = book.links.filter(id => live.has(id));
    return store.call('blog_commit_notion_page', { p_database: source, p_worker: worker, p_event: event.id,
      p_page: event.pageId, p_started_at: started, p_book: book, p_public_ids: [...live.keys()] }, signal);
  }
  throw new Error('Notion page did not stabilize');
}

async function syncGraphDelta(store: SyncStore, source: string, worker: string, event: any, signal: AbortSignal) {
  const started = await store.call('blog_sync_started_at', {}, signal);
  const raw = (await getDatabase(undefined, undefined, signal)).results;
  const allowed = new Set(raw.map(page => notionId(page.id)));
  const links: { source: string; target: string }[] = [];
  for (const id of allowed) for (const target of await commentReferences(id, allowed, signal)) links.push({ source: id, target });
  const live = new Set((await getDatabase(undefined, undefined, signal)).results.map(page => notionId(page.id)));
  if (allowed.size !== live.size || [...allowed].some(id => !live.has(id))) throw new Error('Publication changed during graph refresh');
  await store.call('blog_commit_notion_graph', { p_database: source, p_worker: worker, p_event: event.id,
    p_started_at: started, p_public_ids: [...live], p_links: links }, signal);
}

// Work stays attached to the HTTP request. Return 503 until work is complete,
// so Notion's delivery retries recover durable queued/failed work as well.
export async function drainNotionEvents(store: SyncStore, signal: AbortSignal) {
  const source = bookDatabaseId(), worker = randomUUID();
  try {
    for (let processed = 0; processed < 5; processed++) {
      signal.throwIfAborted();
      const event = await store.call('blog_claim_notion_event', { p_database: source, p_worker: worker }, signal);
      if (event.status === 'empty') return true;
      if (event.status !== 'claimed') return false;
      try {
        await withNotionPacing(() => event.type === 'graph.refresh'
          ? syncGraphDelta(store, source, worker, event, signal) : syncPageDelta(store, source, worker, event, signal));
        await store.call('blog_finish_notion_event', { p_database: source, p_worker: worker, p_event: event.id, p_success: true, p_error: null }, signal);
      } catch (error) {
        await store.call('blog_finish_notion_event', { p_database: source, p_worker: worker, p_event: event.id,
          p_success: false, p_error: `Sync failed (${error.status || error.code || error.name || 'unknown'})` }, AbortSignal.timeout(5000)).catch(() => {});
        return false;
      }
    }
    return false; // A later signed retry continues the bounded batch.
  } finally {
    await store.call('blog_release_notion_worker', { p_database: source, p_worker: worker }, AbortSignal.timeout(5000)).catch(() => {});
  }
}

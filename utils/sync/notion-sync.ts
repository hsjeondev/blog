import { getDatabase } from '../get-database';
import { bookMetadata, getPublishedPage } from '../published-notion';
import { bookDatabaseId, isPublishedBook, notionId, notionRequest } from '../notion-server';
import { officialRecordMap } from '../official-record-map';
import { commentReferences } from '../comment-references';
import { searchableBody } from '../search/search-service';
import { calculateReadingTime } from '../readingTime';

export interface SyncStore {
  call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<any>;
}
export type SyncBook = { post: any; content: any; links: string[] };
type Progress = (value: { phase: string; processed?: number; total?: number; id?: string }) => void;

function storedBook(page: any, map: any, links: string[]): SyncBook {
  const meta = bookMetadata(page);
  const text = searchableBody(map, meta.id);
  return {
    post: { id: meta.id, title: meta.title, author: meta.author, category: meta.category, tags: meta.tags, kind: meta.kind,
      description: meta.description, folder_path: meta.folderPath, icon: meta.icon, cover: meta.cover, written_at: meta.date,
      notion_created_at: meta.createdTime, notion_edited_at: meta.lastEditedTime },
    content: { record_map: map, plain_text: text, reading_minutes: calculateReadingTime(text), source_edited_at: meta.lastEditedTime,
      referenced_page_ids: map.published_references || [] },
    links,
  };
}

export async function collectPage(id: string, catalog: ReturnType<typeof bookMetadata>[], signal?: AbortSignal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const page = await getPublishedPage(id, signal);
    const map = await officialRecordMap(page, catalog, signal);
    const links = await commentReferences(id, new Set(catalog.map(book => book.id)), signal);
    const live = await getPublishedPage(id, signal);
    if (live.last_edited_time === page.last_edited_time) return storedBook(live, map, links);
  }
  throw new Error('Notion page changed repeatedly during sync');
}

// No post/body/link writes happen until the complete public catalog and all bodies have
// been read successfully. Empty *successful* catalogs intentionally revoke all.
export async function syncPublishedNotion(store: SyncStore, signal?: AbortSignal, progress: Progress = () => {}) {
  const source = bookDatabaseId();
  try {
    signal?.throwIfAborted();
    const started = await store.call('blog_sync_started_at', {}, signal);
    let raw = (await getDatabase(undefined, undefined, signal)).results;
    const captured = new Map<string, SyncBook>();
    for (let round = 0; round < 3; round++) {
      const catalog = raw.map(bookMetadata);
      const allowed = new Map(catalog.map(book => [book.id, book]));
      for (const id of captured.keys()) if (!allowed.has(id)) captured.delete(id);
      progress({ phase: 'catalog', total: catalog.length });
      for (const item of catalog) {
        const previous = captured.get(item.id);
        const staleReference = previous?.content.referenced_page_ids.some((id: string) => !allowed.has(id)
          || previous.content.record_map.block[id]?.value?.blog_metadata?.lastEditedTime !== allowed.get(id)?.lastEditedTime);
        if (previous && previous.post.notion_edited_at === item.lastEditedTime && !staleReference) continue;
        try { captured.set(item.id, await collectPage(item.id, catalog, signal)); }
        catch (error) { if (error.status !== 404) throw error; captured.delete(item.id); }
        progress({ phase: 'body', processed: captured.size, total: catalog.length, id: item.id });
      }
      raw = (await getDatabase(undefined, undefined, signal)).results;
      const live = new Map(raw.map(page => [notionId(page.id), page]));
      const stable = raw.every(page => captured.get(notionId(page.id))?.post.notion_edited_at === page.last_edited_time)
        && [...captured.values()].every(book => !live.has(book.post.id) || book.content.referenced_page_ids.every((id: string) => live.has(id)
          && book.content.record_map.block[id]?.value?.blog_metadata?.lastEditedTime === live.get(id).last_edited_time));
      if (!stable) continue;
      const books = [...captured.values()].filter(book => live.has(book.post.id));
      const allowedIds = new Set(live.keys());
      for (const book of books) book.links = book.links.filter(id => allowedIds.has(id));
      signal?.throwIfAborted();
      progress({ phase: 'commit', total: books.length });
      return await store.call('blog_commit_notion_snapshot', { p_database: source, p_started_at: started, p_books: books }, signal);
    }
    throw new Error('Notion catalog did not stabilize during sync');
  } catch (error) {
    if (!signal?.aborted) await store.call('blog_note_sync_failure', { p_database: source, p_error: `Sync failed (${error.status || error.name || 'unknown'})` }).catch(() => {});
    throw error;
  }
}

// Publication revocations can later be called by a webhook worker. A public
// page currently uses a fresh complete snapshot so new relationships stay safe.
export async function syncNotionPage(store: SyncStore, pageId: string, signal?: AbortSignal, progress?: Progress) {
  const id = notionId(pageId);
  if (!id) throw new Error('Invalid Notion page ID');
  // A 404 can mean lost permissions, so propagate it instead of treating it as
  // proof of unpublication. Only a successful page read can revoke this way.
  const page = await notionRequest('pages/' + id, undefined, signal);
  if (!isPublishedBook(page)) {
    if (notionId(page.parent?.database_id) !== bookDatabaseId()) throw new Error('Page is outside the configured database');
    return store.call('blog_soft_delete_notion_post', { p_database: bookDatabaseId(), p_page: id }, signal);
  }
  return syncPublishedNotion(store, signal, progress);
}

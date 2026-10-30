import { notionId, notionRequest } from './notion-server';

// Only page-level, unresolved comments are returned by this Notion endpoint.
// Keep their text and authors on the server; export published page IDs only.
export async function commentReferences(pageId: string, allowed: Set<string>, signal?: AbortSignal) {
  const references = new Set<string>();
  let cursor: string | undefined;
  do {
    const data = await notionRequest('comments?block_id=' + pageId + '&page_size=100'
      + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''), undefined, signal);
    for (const comment of data.results || []) {
      const parent = notionId(comment.parent?.page_id || comment.parent?.block_id);
      if (parent !== pageId) continue;
      for (const part of comment.rich_text || []) {
        const target = part.type === 'mention' ? notionId(part.mention?.page?.id) : '';
        if (target && target !== pageId && allowed.has(target)) references.add(target);
      }
    }
    const next = data.has_more ? data.next_cursor : undefined;
    if (data.has_more && (!next || next === cursor)) throw new Error('Incomplete Notion comment pagination');
    cursor = next;
  } while (cursor);
  return [...references];
}

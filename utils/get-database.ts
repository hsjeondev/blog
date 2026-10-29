import { bookDatabaseId, isPublishedBook, notionId, notionRequest, notPublished } from './notion-server';

// Every caller, including the legacy API route, must use this publication boundary.
export async function getDatabase(databaseId = bookDatabaseId(), body: any = {}) {
  const id = notionId(databaseId);
  if (!id || id !== bookDatabaseId()) throw notPublished();
  const publication = { property: '공개', checkbox: { equals: true } };
  const results: any[] = [];
  let cursor: string | undefined;
  do {
    const data = await notionRequest('databases/' + id + '/query', {
      page_size: 100,
      sorts: body.sorts || [{ timestamp: 'last_edited_time', direction: 'descending' }],
      filter: body.filter ? { and: [publication, body.filter] } : publication,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    results.push(...(data.results || []).filter(isPublishedBook));
    cursor = data.has_more ? data.next_cursor : undefined;
    if (data.has_more && !cursor) throw new Error('Incomplete Notion pagination');
  } while (cursor);
  return { results };
}

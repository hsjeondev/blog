import { getDatabase } from './get-database';
import { isPublishedBook, notionId, notionRequest, notPublished } from './notion-server';

import { bookMetadata } from './book-metadata';
export { bookMetadata, propertyText, publicationKind, siteUrl } from './book-metadata';

export async function getPublishedPage(pageId: string, signal?: AbortSignal) {
  const id = notionId(pageId);
  if (!id) throw notPublished();
  const page = await notionRequest('pages/' + id, undefined, signal);
  if (!isPublishedBook(page)) throw notPublished();
  return page;
}

export async function publishedBooks(signal?: AbortSignal) {
  return (await getDatabase(undefined, undefined, signal)).results.map(bookMetadata).sort((a, b) =>
    Date.parse(b.date) - Date.parse(a.date)
    || Date.parse(b.createdTime) - Date.parse(a.createdTime)
    || a.id.localeCompare(b.id));
}

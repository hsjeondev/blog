import { createHash } from 'node:crypto';
import { publishedBooks } from './published-notion';
import { commentReferences } from './comment-references';
import { notionId, notPublished } from './notion-server';

export type GraphOptions = { cursor?: string; focus?: string };
const BATCH_SIZE = 4;

export async function buildGraphData(signal?: AbortSignal, options?: GraphOptions) {
  const books = await publishedBooks(signal);
  const allowed = new Set(books.map(book => book.id));
  const focus = options?.focus ? notionId(options.focus) : '';
  if (options?.focus && !allowed.has(focus)) throw notPublished();
  // Stable traversal even when a comment or page is edited between batches.
  const ordered = [...books].sort((a, b) => Number(b.id === focus) - Number(a.id === focus) || a.id.localeCompare(b.id));
  const key = createHash('sha256').update(JSON.stringify([focus, ordered.map(book => book.id)])).digest('hex');
  let offset = 0;
  let reset = !options?.cursor;
  if (options?.cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(options.cursor, 'base64url').toString());
      if (!Number.isInteger(parsed.offset) || parsed.offset < 0 || parsed.offset > ordered.length || typeof parsed.key !== 'string') throw new Error();
      if (parsed.key === key) offset = parsed.offset;
      else reset = true;
    } catch { throw Object.assign(new Error('Invalid graph cursor'), { status: 400 }); }
  }
  const batch = options ? ordered.slice(offset, offset + BATCH_SIZE) : ordered;
  const links: { source: string; target: string; kind: string }[] = [];
  for (const book of batch) {
    for (const target of await commentReferences(book.id, allowed, signal)) links.push({ source: book.id, target, kind: 'reference' });
  }
  // Every batch rechecks publication, including revocations during comment reads.
  const liveBooks = await publishedBooks(signal);
  const live = new Set(liveBooks.map(book => book.id));
  const nodes = liveBooks.map((book) => ({ id: book.id, title: book.title, href: '/' + book.id, kind: book.kind, group: book.kind }));
  const groups = [
    { id: 'group:post', title: '포스팅', href: '/', kind: 'group', group: 'post' },
    { id: 'group:project', title: '프로젝트', href: '/forest', kind: 'group', group: 'project' },
    { id: 'group:recap', title: '월말결산', href: '/recap', kind: 'group', group: 'recap' },
    { id: 'group:document', title: '문서', href: '/forest', kind: 'group', group: 'document' },
  ].filter((group) => nodes.some((node) => node.group === group.group));
  const membership = nodes.map((node) => ({ source: 'group:' + node.group, target: node.id, kind: 'membership' }));
  const processed = offset + batch.length;
  // A membership change invalidates the traversal; the next request restarts it.
  const changed = live.size !== allowed.size || [...live].some(id => !allowed.has(id));
  const nextCursor = options && (changed || processed < ordered.length)
    ? Buffer.from(JSON.stringify({ key: changed ? '' : key, offset: changed ? 0 : processed })).toString('base64url') : null;
  return { version: 5, nodes: [...nodes, ...groups], links: [...links.filter((edge) => live.has(edge.source) && live.has(edge.target)), ...membership],
    scannedIds: batch.map(book => book.id), processed, total: books.length, nextCursor, complete: !nextCursor, reset, generatedAt: new Date().toISOString() };
}

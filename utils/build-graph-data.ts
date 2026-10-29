import { getNotionPage } from './get-notion-page';
import { publishedBooks } from './published-notion';

export async function buildGraphData(signal?: AbortSignal) {
  const books = await publishedBooks();
  const links: { source: string; target: string; kind: string }[] = [];
  for (const book of books) {
    const page = await getNotionPage(book.id, signal);
    for (const target of page.published_references || []) links.push({ source: book.id, target, kind: 'reference' });
  }
  // Revalidate membership after collecting bodies, including revocations mid-build.
  const live = new Set((await publishedBooks()).map((book) => book.id));
  const nodes = books.filter((book) => live.has(book.id)).map((book) => ({ id: book.id, title: book.title, href: '/' + book.id, kind: book.kind, group: book.kind }));
  const groups = [
    { id: 'group:post', title: '포스팅', href: '/', kind: 'group', group: 'post' },
    { id: 'group:project', title: '프로젝트', href: '/forest', kind: 'group', group: 'project' },
    { id: 'group:recap', title: '월말결산', href: '/recap', kind: 'group', group: 'recap' },
    { id: 'group:document', title: '문서', href: '/forest', kind: 'group', group: 'document' },
  ].filter((group) => nodes.some((node) => node.group === group.group));
  const membership = nodes.map((node) => ({ source: 'group:' + node.group, target: node.id, kind: 'membership' }));
  return { version: 4, nodes: [...nodes, ...groups], links: [...links.filter((edge) => live.has(edge.source) && live.has(edge.target)), ...membership], generatedAt: new Date().toISOString() };
}

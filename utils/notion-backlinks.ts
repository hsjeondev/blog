export async function fetchNotionBacklinks(currentId: string, signal?: AbortSignal, cursor?: string) {
  const { getPublishedPage } = await import('./published-notion');
  const { notionId } = await import('./notion-server');
  await getPublishedPage(currentId, signal);
  const { buildGraphData } = await import('./build-graph-data');
  const graph = await buildGraphData(signal, cursor === undefined ? undefined : { cursor, focus: currentId });
  const id = notionId(currentId);
  const sourceIds = new Set(graph.links.filter((link) => link.kind === 'reference' && link.target === id).map((link) => link.source));
  return { ...graph, sources: graph.nodes.filter((node) => sourceIds.has(node.id)).map((node) => ({ id: node.id, title: node.title, href: node.href })) };
}

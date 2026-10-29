export async function fetchNotionBacklinks(currentId: string, signal?: AbortSignal) {
  const { getPublishedPage } = await import('./published-notion');
  const page = await getPublishedPage(currentId, signal);
  const { buildGraphData } = await import('./build-graph-data');
  const graph = await buildGraphData(signal);
  const sourceIds = new Set(graph.links.filter((link) => link.kind === 'reference' && link.target === page.id).map((link) => link.source));
  return { sources: graph.nodes.filter((node) => sourceIds.has(node.id)).map((node) => ({ id: node.id, title: node.title, href: node.href })) };
}

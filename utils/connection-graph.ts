import type { GraphData } from '../components/Graph/KnowledgeGraph';

export type GraphBatch = GraphData & {
  scannedIds: string[];
  processed: number;
  total: number;
  nextCursor: string | null;
  complete: boolean;
  reset: boolean;
};

export function mergeGraphBatch(previous: GraphData, batch: GraphBatch): GraphData {
  const allowed = new Set(batch.nodes.map(node => node.id));
  const rescanned = new Set(batch.scannedIds);
  const retained = batch.reset ? [] : previous.links.filter(link => link.kind !== 'membership'
    && !rescanned.has(link.source) && allowed.has(link.source) && allowed.has(link.target));
  const links = new Map([...retained, ...batch.links].map(link => [JSON.stringify([link.source, link.target, link.kind]), link]));
  return { nodes: batch.nodes, links: [...links.values()] };
}

export function adjacentGraph(graph: GraphData, currentId: string): GraphData {
  const links = graph.links.filter(link => link.kind === 'reference' && (link.source === currentId || link.target === currentId));
  const neighbors = new Set([currentId, ...links.flatMap(link => [link.source, link.target])]);
  return { nodes: graph.nodes.filter(node => neighbors.has(node.id)).map(node => node.id === currentId ? { ...node, kind: 'current' } : node), links };
}

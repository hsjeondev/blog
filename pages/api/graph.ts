import type { NextApiRequest, NextApiResponse } from 'next';
import { buildGraphData } from '../../utils/build-graph-data';
import { noPublicationCache } from '../../utils/notion-server';
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  noPublicationCache(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  const { cursor = '', focus = '' } = req.query;
  if (typeof cursor !== 'string' || cursor.length > 500 || typeof focus !== 'string' || focus.length > 36) return res.status(400).json({ error: 'Invalid graph request' });
  const controller = new AbortController();
  const disconnect = () => { if (!res.writableEnded) controller.abort(); };
  req.once?.('aborted', disconnect);
  res.once?.('close', disconnect);
  if (req.aborted) controller.abort();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]);
  try {
    const graph = await buildGraphData(signal, { cursor, focus });
    signal.throwIfAborted();
    return res.status(200).json(graph);
  } catch (error) {
    if (controller.signal.aborted) return;
    return res.status([400, 404].includes(error.status) ? error.status : 502).json({ error: 'failed to load graph' });
  } finally {
    req.off?.('aborted', disconnect);
    res.off?.('close', disconnect);
  }
}
export const config = { maxDuration: 60 };

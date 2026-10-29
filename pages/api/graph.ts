import type { NextApiRequest, NextApiResponse } from 'next';
import { buildGraphData } from '../../utils/build-graph-data';
import { noPublicationCache } from '../../utils/notion-server';
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  noPublicationCache(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  try { return res.status(200).json(await buildGraphData(AbortSignal.timeout(45_000))); }
  catch { return res.status(502).json({ error: 'failed to load graph' }); }
}
export const config = { maxDuration: 60 };

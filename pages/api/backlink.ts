import { NextApiRequest, NextApiResponse } from 'next';
import { noPublicationCache } from '../../utils/notion-server';
import { isNotionNotFound } from '../../utils/blog-data';
import { fetchNotionBacklinks } from '../../utils/notion-backlinks';

export default async (req: NextApiRequest, res: NextApiResponse) => {
  noPublicationCache(res);
  if (req.method !== 'POST') {
    return res.status(405).send({ error: 'method not allowed' });
  }

  const { currentId, cursor = '' } = req.body;
  if (!currentId || typeof currentId !== 'string' || currentId.length > 36 || typeof cursor !== 'string' || cursor.length > 500) {
    return res.status(400).json({ error: 'currentId is required' });
  }

  const controller = new AbortController();
  const disconnect = () => { if (!res.writableEnded) controller.abort(); };
  req.once?.('aborted', disconnect);
  res.once?.('close', disconnect);
  if (req.aborted) controller.abort();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]);
  try {
    const results = await fetchNotionBacklinks(currentId, signal, cursor);
    signal.throwIfAborted();
    res.status(200).json(results);
  } catch (error) {
    if (controller.signal.aborted) return;
    res.status(isNotionNotFound(error) ? 404 : error.status === 400 ? 400 : 502).json({ error: 'failed to fetch backlinks' });
  } finally {
    req.off?.('aborted', disconnect);
    res.off?.('close', disconnect);
  }
};
export const config = { maxDuration: 60 };

import { NextApiRequest, NextApiResponse } from 'next';
import { noPublicationCache } from '../../utils/notion-server';
import { isNotionNotFound } from '../../utils/get-notion-page';
import { fetchNotionBacklinks } from '../../utils/notion-backlinks';

export default async (req: NextApiRequest, res: NextApiResponse) => {
  noPublicationCache(res);
  if (req.method !== 'POST') {
    return res.status(405).send({ error: 'method not allowed' });
  }

  const { currentId } = req.body;
  if (!currentId || typeof currentId !== 'string') {
    return res.status(400).json({ error: 'currentId is required' });
  }

  try {
    const results = await fetchNotionBacklinks(currentId);

    res.status(200).json(results);
  } catch (error) {
    res.status(isNotionNotFound(error) ? 404 : 502).json({ error: 'failed to fetch backlinks' });
  }
};

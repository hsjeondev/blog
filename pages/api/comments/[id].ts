import type { NextApiRequest, NextApiResponse } from 'next';
import { noPublicationCache } from '../../../utils/notion-server';
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  noPublicationCache(res);
  // Notion comments are private graph input, never a public read/write API.
  return res.status(404).json({ error: 'Not found' });
}

import type { NextApiRequest, NextApiResponse } from 'next';
import { getDatabase } from '../../../utils/get-database';
import { bookMetadata } from '../../../utils/published-notion';
import { noPublicationCache } from '../../../utils/notion-server';
import { isNotionNotFound } from '../../../utils/get-notion-page';
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  noPublicationCache(res);
  if (!['GET', 'POST'].includes(req.method || '')) return res.status(405).json({ error: 'method not allowed' });
  const ids = req.query.id;
  const id = Array.isArray(ids) && ids.length === 1 ? ids[0] : typeof ids === 'string' ? ids : '';
  if (!id) return res.status(400).json({ error: 'Database ID is required' });
  try {
    // Never forward client-supplied filters or arbitrary database IDs upstream.
    const data = await getDatabase(id);
    return res.json({ results: data.results.map(bookMetadata) });
  } catch (error) { return res.status(isNotionNotFound(error) ? 404 : 502).json({ error: 'Database unavailable' }); }
}

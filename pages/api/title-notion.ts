import type { NextApiRequest, NextApiResponse } from 'next';
import { bookMetadata, getPublishedPage } from '../../utils/blog-data';
import { noPublicationCache } from '../../utils/notion-server';
import { isNotionNotFound } from '../../utils/blog-data';
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  noPublicationCache(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  let block = req.body?.block?.value;
  const visited = new Set<string>();
  while (block?.id && !visited.has(block.id)) {
    visited.add(block.id);
    if (block.type === 'page') break;
    block = req.body?.recordMap?.block?.[block.parent_id]?.value;
  }
  try {
    const meta = bookMetadata(await getPublishedPage(block?.type === 'page' ? block.id : ''));
    return res.json({ title: meta.title, link: meta.id });
  } catch (error) { return res.status(isNotionNotFound(error) ? 404 : 502).json({ error: 'Document unavailable' }); }
}

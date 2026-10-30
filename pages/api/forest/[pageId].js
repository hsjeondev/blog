import { getNotionPage, isNotionNotFound } from '../../../utils/blog-data';
import { noPublicationCache } from '../../../utils/notion-server';
export default async function handler(req, res) {
  noPublicationCache(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  try { return res.json(await getNotionPage(req.query.pageId)); }
  catch (error) { return res.status(isNotionNotFound(error) ? 404 : 502).json({ error: 'Document unavailable' }); }
}

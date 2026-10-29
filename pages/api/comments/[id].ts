import type { NextApiRequest, NextApiResponse } from 'next';
import { getPublishedPage } from '../../../utils/published-notion';
import { noPublicationCache, notionRequest } from '../../../utils/notion-server';
import { isNotionNotFound } from '../../../utils/get-notion-page';
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  noPublicationCache(res);
  if (!['GET', 'POST'].includes(req.method || '')) return res.status(405).json({ error: 'method not allowed' });
  try {
    const page = await getPublishedPage(req.query.id as string);
    if (req.method === 'POST') {
      const content = req.body?.content;
      if (typeof content !== 'string' || !content.trim() || content.length > 2000) return res.status(400).json({ error: 'Invalid comment' });
      await notionRequest('comments', { parent: { page_id: page.id }, rich_text: [{ text: { content } }] });
      return res.json({ ok: true });
    }
    const cursor = typeof req.query.cursor === 'string' ? '&start_cursor=' + encodeURIComponent(req.query.cursor) : '';
    const data = await notionRequest('comments?block_id=' + page.id + cursor);
    return res.json({ results: (data.results || []).map((comment: any) => ({
      id: comment.id, created_time: comment.created_time, created_by: { id: '' },
      rich_text: [{ plain_text: (comment.rich_text || []).map((part: any) => part.plain_text || part.text?.content || '').join('') }],
    })), has_more: data.has_more, next_cursor: data.next_cursor });
  } catch (error) { return res.status(isNotionNotFound(error) ? 404 : 502).json({ error: 'Comments unavailable' }); }
}

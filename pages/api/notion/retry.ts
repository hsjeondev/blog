import type { NextApiRequest, NextApiResponse } from 'next';
import { timingSafeEqual } from 'node:crypto';
import { bookDatabaseId, noPublicationCache } from '../../../utils/notion-server';
import { createSyncStore } from '../../../utils/sync/supabase-store';
import { drainNotionEvents } from '../../../utils/sync/notion-webhook';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  noPublicationCache(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const token = process.env.CRON_SECRET?.trim() || process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN?.trim();
  if (!token) return res.status(503).json({ error: 'Retry endpoint is not configured' });
  const expected = Buffer.from('Bearer ' + token), actual = Buffer.from(req.headers.authorization || '');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const store = createSyncStore();
    await store.call('blog_retry_failed_notion_events', { p_database: bookDatabaseId() });
    const complete = await drainNotionEvents(store, AbortSignal.timeout(45_000));
    return res.status(complete ? 200 : 503).json({ complete });
  } catch { return res.status(503).json({ error: 'Retry unavailable' }); }
}
export const config = { maxDuration: 60 };

import type { NextApiRequest, NextApiResponse } from 'next';
import { bookDatabaseId, notionId, noPublicationCache } from '../../../utils/notion-server';
import { createSyncStore } from '../../../utils/sync/supabase-store';
import { drainNotionEvents, normalizedNotionEvent, validNotionSignature } from '../../../utils/sync/notion-webhook';

const MAX_BODY = 256 * 1024;
function configurationDetails() {
  const missing: string[] = [], invalid: string[] = [];
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  else {
    try {
      const url = new URL(supabaseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) invalid.push('NEXT_PUBLIC_SUPABASE_URL');
    } catch { invalid.push('NEXT_PUBLIC_SUPABASE_URL'); }
  }
  const serverKey = process.env.SUPABASE_SECRET_KEY?.trim() ? 'SUPABASE_SECRET_KEY'
    : process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ? 'SUPABASE_SERVICE_ROLE_KEY' : null;
  if (!serverKey) missing.push('SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY');
  if (!process.env.NOTION_MYBOOKLIST_ID?.trim()) missing.push('NOTION_MYBOOKLIST_ID');
  else if (!notionId(process.env.NOTION_MYBOOKLIST_ID.trim())) invalid.push('NOTION_MYBOOKLIST_ID');
  return { missing, invalid, serverKeyVariable: serverKey };
}
function readRaw(req: NextApiRequest) {
  return new Promise<Buffer>((resolve, reject) => {
    const parts: Buffer[] = [];
    let length = 0;
    const clean = () => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', fail); req.off('aborted', aborted); };
    const fail = (error: any) => { clean(); req.resume(); reject(error); };
    const aborted = () => fail(Object.assign(new Error('Aborted body'), { status: 400 }));
    const data = (part: Buffer) => {
      length += part.length;
      if (length > MAX_BODY) return fail(Object.assign(new Error('Body too large'), { status: 413 }));
      parts.push(Buffer.from(part));
    };
    const end = () => { clean(); resolve(Buffer.concat(parts)); };
    const timer = setTimeout(() => fail(Object.assign(new Error('Body timeout'), { status: 408 })), 5000);
    req.on('data', data); req.once('end', end); req.once('error', fail); req.once('aborted', aborted);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  noPublicationCache(res);
  const token = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN?.trim() || '';
  const details = configurationDetails();
  let databaseReady = false;
  try { createSyncStore(); bookDatabaseId(); databaseReady = details.missing.length === 0 && details.invalid.length === 0; } catch {}
  if (req.method === 'GET') {
    let databaseConnection: { connected: boolean; httpStatus?: number; code?: string } | undefined;
    if (databaseReady && req.query?.check === 'database') {
      try {
        await createSyncStore().call('blog_sync_started_at', {}, AbortSignal.timeout(5000));
        databaseConnection = { connected: true };
      } catch (error) {
        databaseConnection = { connected: false, httpStatus: error.status,
          code: typeof error.code === 'string' && /^[a-z0-9_]{1,40}$/i.test(error.code) ? error.code : 'CONNECTION_FAILED' };
      }
    }
    return res.status(200).json({ databaseConfigured: databaseReady, signatureConfigured: !!token, ...details, ...(databaseConnection ? { databaseConnection } : {}) });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!databaseReady) return res.status(503).json({ error: 'Webhook database configuration required', ...details });
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return res.status(415).json({ error: 'JSON required' });
  try {
    const raw = await readRaw(req);
    let payload: any;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
    const store = createSyncStore();
    if (payload && Object.keys(payload).length === 1 && typeof payload.verification_token === 'string') {
      if (payload.verification_token.length < 16 || payload.verification_token.length > 200) return res.status(400).json({ error: 'Invalid verification' });
      // Never activate an unsigned handshake as a signing key. An operator
      // verifies it in Notion first, then configures the server environment.
      if (!token && !await store.call('blog_store_webhook_verification', { p_token: payload.verification_token })) return res.status(503).json({ error: 'Verification inbox full' });
      return res.status(200).json({ received: true });
    }
    if (!token) return res.status(503).json({ error: 'Webhook signature configuration required' });
    if (!validNotionSignature(raw, req.headers['x-notion-signature'], token)) return res.status(401).json({ error: 'Invalid signature' });
    if (process.env.NOTION_WEBHOOK_SUBSCRIPTION_ID && payload?.subscription_id !== process.env.NOTION_WEBHOOK_SUBSCRIPTION_ID.trim()) return res.status(401).json({ error: 'Invalid subscription' });
    const event = normalizedNotionEvent(payload);
    if (!event) return res.status(200).json({ ignored: true });
    await store.call('blog_enqueue_notion_event', { p_database: bookDatabaseId(), p_event: event.id, p_type: event.type,
      p_page: event.page, p_time: event.time });
    const complete = await drainNotionEvents(store, AbortSignal.timeout(45_000));
    if (!complete) res.setHeader('Retry-After', '30');
    return res.status(complete ? 200 : 503).json({ received: true, complete });
  } catch (error) {
    res.setHeader('Retry-After', '30');
    return res.status([400, 408, 413].includes(error.status) ? error.status : 503).json({ error: 'Webhook processing unavailable' });
  }
}
export const config = { api: { bodyParser: false }, maxDuration: 60 };

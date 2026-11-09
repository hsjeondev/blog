import type { NextApiRequest, NextApiResponse } from 'next';
import { blogDatabaseIds, notionId, noPublicationCache } from '../../../utils/notion-server';
import { createSyncStore } from '../../../utils/sync/supabase-store';
import { drainNotionEvents, normalizedNotionEvent, validNotionSignature, sourceEventId } from '../../../utils/sync/notion-webhook';
import { webhookDiagnostics, webhookErrorCode } from '../../../utils/sync/webhook-diagnostics';

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
  if (process.env.NOTION_BLOG_DATABASE_ID?.trim() && !notionId(process.env.NOTION_BLOG_DATABASE_ID.trim())) invalid.push('NOTION_BLOG_DATABASE_ID');
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
  try { createSyncStore(); blogDatabaseIds(); databaseReady = details.missing.length === 0 && details.invalid.length === 0; } catch {}
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
  const diagnostic = webhookDiagnostics(() => createSyncStore());
  res.setHeader('X-Webhook-Request-Id', diagnostic.requestId);
  req.once('aborted', () => diagnostic.disconnected());
  res.once?.('close', () => { if (!res.writableFinished) diagnostic.disconnected(); });
  res.once?.('finish', () => console.info('notion_webhook_response_finished', JSON.stringify({ request_id: diagnostic.requestId, status_code: res.statusCode })));
  await diagnostic.start();
  const respond = async (status: number, body: Record<string, any>, code?: string) => {
    if (code) diagnostic.report({ code });
    await diagnostic.finish(status, status >= 400 ? body.error || 'Synchronization incomplete' : undefined);
    return res.status(status).json(body);
  };
  diagnostic.stage('configuration');
  if (!databaseReady) return respond(503, { error: 'Webhook database configuration required', ...details }, 'CONFIGURATION_REQUIRED');
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return respond(415, { error: 'JSON required' }, 'INVALID_CONTENT_TYPE');
  try {
    diagnostic.stage('body');
    const raw = await readRaw(req);
    diagnostic.stage('parse');
    let payload: any;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { return respond(400, { error: 'Invalid JSON' }, 'INVALID_JSON'); }
    const store = createSyncStore();
    if (payload && Object.keys(payload).length === 1 && typeof payload.verification_token === 'string') {
      diagnostic.stage('verification');
      if (payload.verification_token.length < 16 || payload.verification_token.length > 200) return respond(400, { error: 'Invalid verification' }, 'INVALID_VERIFICATION');
      // Never activate an unsigned handshake as a signing key. An operator
      // verifies it in Notion first, then configures the server environment.
      if (!token && !await store.call('blog_store_webhook_verification', { p_token: payload.verification_token })) return respond(503, { error: 'Verification inbox full' }, 'VERIFICATION_INBOX_FULL');
      return respond(200, { received: true });
    }
    diagnostic.stage('signature');
    if (!token) return respond(503, { error: 'Webhook signature configuration required' }, 'SIGNATURE_NOT_CONFIGURED');
    const signatureValid = validNotionSignature(raw, req.headers['x-notion-signature'], token);
    diagnostic.signature(signatureValid);
    if (!signatureValid) return respond(401, { error: 'Invalid signature' }, 'INVALID_SIGNATURE');
    diagnostic.trustedEvent(payload);
    diagnostic.stage('subscription');
    if (process.env.NOTION_WEBHOOK_SUBSCRIPTION_ID && payload?.subscription_id !== process.env.NOTION_WEBHOOK_SUBSCRIPTION_ID.trim()) return respond(401, { error: 'Invalid subscription' }, 'INVALID_SUBSCRIPTION');
    diagnostic.stage('event');
    const event = normalizedNotionEvent(payload);
    if (!event) return respond(200, { ignored: true });
    const sources = blogDatabaseIds();
    diagnostic.stage('enqueue');
    for (const source of sources) await store.call('blog_enqueue_notion_event', { p_database: source, p_event: sourceEventId(event.id, source), p_type: event.type,
      p_page: event.page, p_time: event.time });
    diagnostic.stage('sync');
    await diagnostic.checkpoint();
    const signal = AbortSignal.timeout(45_000);
    let complete = true;
    for (const source of sources) complete = await drainNotionEvents(store, signal, source, failure => diagnostic.report(failure, source)) && complete;
    if (!complete) res.setHeader('Retry-After', '30');
    else diagnostic.stage('complete');
    return respond(complete ? 200 : 503, { received: true, complete });
  } catch (error) {
    diagnostic.report({ code: webhookErrorCode(error), status: error.status });
    res.setHeader('Retry-After', '30');
    return respond([400, 408, 413].includes(error.status) ? error.status : 503, { error: 'Webhook processing unavailable' });
  }
}
export const config = { api: { bodyParser: false }, maxDuration: 60 };

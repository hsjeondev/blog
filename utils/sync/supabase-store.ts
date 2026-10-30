import { randomBytes } from 'node:crypto';
import type { SyncStore } from './notion-sync';

const functions = new Set(['blog_sync_started_at', 'blog_commit_notion_snapshot', 'blog_soft_delete_notion_post', 'blog_note_sync_failure',
  'blog_store_webhook_verification', 'blog_enqueue_notion_event', 'blog_claim_notion_event', 'blog_finish_notion_event',
  'blog_release_notion_worker', 'blog_commit_notion_page', 'blog_commit_notion_graph', 'blog_retry_failed_notion_events']);

// Administrative CLI transport only. Application workers must use a server
// secret/service-role key and the ordinary RPC transport below, never the PAT.
export function createSyncStore(management = false): SyncStore {
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
  const secret = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (management ? !token : !secret) throw new Error('Supabase sync credentials are not configured');
  return { async call(name, args, signal) {
    if (!functions.has(name)) throw new Error('Unsupported sync function');
    let target: string;
    let options: RequestInit;
    if (management) {
      const json = JSON.stringify(args);
      let marker: string;
      do { marker = '$blog_' + randomBytes(8).toString('hex') + '$'; } while (json.includes(marker));
      const cast: Record<string, string> = { p_database: 'uuid', p_page: 'uuid', p_started_at: 'timestamptz', p_error: 'text', p_books: 'jsonb',
        p_worker: 'uuid', p_event: 'text', p_type: 'text', p_time: 'timestamptz', p_token: 'text', p_success: 'boolean', p_book: 'jsonb', p_public_ids: 'jsonb', p_links: 'jsonb' };
      const expressions = Object.keys(args).map(key => {
        if (!Object.hasOwn(cast, key)) throw new Error('Invalid sync parameter');
        return `${key} => (payload${cast[key] === 'jsonb' ? '->' : '->>'}'${key}')::${cast[key]}`;
      });
      const query = `SELECT public.${name}(${expressions.join(', ')}) AS result FROM (SELECT ${marker}${json}${marker}::jsonb AS payload) input`;
      target = `https://api.supabase.com/v1/projects/${url.hostname.split('.')[0]}/database/query`;
      options = { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, read_only: false }) };
    } else {
      target = new URL('/rest/v1/rpc/' + name, url).href;
      options = { method: 'POST', headers: { apikey: secret!, ...(secret!.startsWith('eyJ') ? { Authorization: 'Bearer ' + secret } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(args) };
    }
    const response = await fetch(target, { ...options, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000), cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error('Supabase synchronization request failed'), { status: response.status, code: data?.code });
    if (management && (!Array.isArray(data) || !data[0] || !Object.hasOwn(data[0], 'result'))) throw new Error('Invalid synchronization response');
    return management ? data[0].result : data;
  } };
}

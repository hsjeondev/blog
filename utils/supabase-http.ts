export function supabaseUrl() {
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || '');
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1') throw new Error('Invalid Supabase URL');
  return url;
}
export function supabaseHeaders(key: string) {
  return { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: 'Bearer ' + key } : {}) };
}
export function supabaseReadKey() {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw Object.assign(new Error('Supabase read key is not configured'), { status: 503 });
  return key;
}
export async function supabaseRead(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
  if (!['blog_read_catalog', 'blog_read_post', 'blog_read_page', 'blog_read_graph', 'blog_search_public', 'blog_read_asset'].includes(name)) throw new Error('Unsupported read');
  const response = await fetch(new URL('/rest/v1/rpc/' + name, supabaseUrl()), {
    method: 'POST', headers: { ...supabaseHeaders(supabaseReadKey()), 'Content-Type': 'application/json' }, body: JSON.stringify(args),
    cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error('Blog database read failed'), { status: 502, upstreamStatus: response.status, code: data?.code });
  return data;
}

// Bootstrap/CLI only may read an existing administrative key into memory.
// Keys are never printed, persisted, or returned by application endpoints.
export async function storageServiceKey(management = false): Promise<string> {
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (key) return key;
  if (!management || !process.env.SUPABASE_ACCESS_TOKEN) throw new Error('Storage server key is not configured');
  const ref = supabaseUrl().hostname.split('.')[0];
  const response = await fetch('https://api.supabase.com/v1/projects/' + ref + '/api-keys', {
    headers: { Authorization: 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN }, signal: AbortSignal.timeout(15000), cache: 'no-store',
  });
  const keys = await response.json().catch(() => null);
  const found = Array.isArray(keys) && keys.find(item => item.name === 'service_role' && typeof item.api_key === 'string');
  if (!response.ok || !found) throw new Error('Storage administrative key is unavailable');
  return found.api_key;
}

import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { supabaseUrl, supabaseHeaders, storageServiceKey } from '../supabase-http';
import { bookDatabaseId } from '../notion-server';
import type { SyncBook, SyncStore } from './notion-sync';

export const ASSET_BUCKET = 'blog-assets';
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const fileTypes = new Set(['application/pdf', 'application/octet-stream', 'application/zip', 'application/epub+zip', 'text/plain']);
const allowedMime = (mime: string) => /^(image|audio|video)\/[a-z0-9.+-]+$/.test(mime) || fileTypes.has(mime);
export const assetUrl = (pageId: string, key: string) => `/api/blog-media/${pageId}/${key}`;
export function immutableNotionFile(url: URL) {
  return url.hostname === 'file.notion.so' || url.hostname.endsWith('.notion-static.com') || url.hostname.endsWith('.notionusercontent.com')
    || /^prod-files-secure\.s3\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname) || (url.hostname.endsWith('.amazonaws.com') && url.pathname.includes('secure.notion-static.com'));
}
export function assetSourceKey(value: string) {
  const url = new URL(value);
  return hash(immutableNotionFile(url) ? url.origin + url.pathname : url.href);
}
function publicAddress(address: string) {
  if (address.includes(':')) return /^[23]/.test(address);
  const p = address.split('.').map(Number);
  return p.length === 4 && p[0] > 0 && p[0] < 224 && ![10, 127].includes(p[0])
    && !(p[0] === 169 && p[1] === 254) && !(p[0] === 172 && p[1] >= 16 && p[1] <= 31)
    && !(p[0] === 192 && p[1] === 168) && !(p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    && !(p[0] === 198 && [18, 19].includes(p[1]));
}
export async function safeAssetUrl(value: string, resolve = lookup) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || isIP(url.hostname.replace(/^\[|\]$/g, ''))
    || /(^|\.)(localhost|local|internal)$/.test(url.hostname)) throw new Error('Unsupported asset URL');
  if (!immutableNotionFile(url) && url.hostname !== 'images.unsplash.com') {
    const addresses = await resolve(url.hostname, { all: true });
    if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('Non-public asset destination');
  }
  return url;
}
export async function downloadAsset(value: string, signal?: AbortSignal) {
  let url = await safeAssetUrl(value);
  const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
  for (let hop = 0; hop < 5; hop++) {
    const response = await fetch(url, { signal: deadline, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Invalid asset redirect');
      url = await safeAssetUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw Object.assign(new Error('Asset download failed'), { status: response.status });
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
    if (!allowedMime(contentType) || Number(response.headers.get('content-length') || 0) > MAX_ASSET_BYTES) {
      await response.body?.cancel(); throw new Error('Unsupported asset type or size');
    }
    if (!response.body) throw new Error('Empty asset');
    const reader = response.body.getReader(), parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value: bytes } = await reader.read();
      if (done) break;
      size += bytes.byteLength;
      if (size > MAX_ASSET_BYTES) { await reader.cancel(); throw new Error('Asset size limit exceeded'); }
      parts.push(bytes);
    }
    if (!size) throw new Error('Empty asset');
    return { bytes: Buffer.concat(parts), contentType, size };
  }
  throw new Error('Asset redirect limit exceeded');
}

export function createAssetMirror(store: SyncStore, management = false) {
  let secret: Promise<string> | undefined;
  return async (input: SyncBook, signal?: AbortSignal): Promise<SyncBook> => {
    const book = structuredClone(input), pageId = book.post.id;
    const cacheRows = await store.call('blog_sync_asset_cache', { p_database: bookDatabaseId(), p_page: pageId }, signal);
    if (!Array.isArray(cacheRows)) throw new Error('Invalid asset cache');
    const cache = new Map(cacheRows.map(item => [item.asset_key, item]));
    const candidates = new Set<string>();
    const add = (value: any) => { if (typeof value === 'string' && /^https?:\/\//i.test(value)) candidates.add(value); };
    for (const meta of [book.post.cover, book.post.icon]) add(meta?.file?.url || meta?.external?.url);
    for (const entry of Object.values(book.content.record_map.block) as any[]) {
      const value = entry.value;
      if (value.type === 'page' && value.id !== pageId) {
        if (value.blog_metadata) { delete value.blog_metadata.cover; delete value.blog_metadata.icon; }
        continue;
      }
      add(value.format?.page_cover); add(value.format?.page_icon);
      if (['image', 'file', 'pdf', 'audio', 'video'].includes(value.type)) {
        const source = value.properties?.source?.[0]?.[0];
        // External video players remain embeds. Uploaded files are mirrored.
        if (value.type === 'image' || ['file', 'pdf'].includes(value.type) || (typeof source === 'string' && immutableNotionFile(new URL(source)))) add(source);
      }
    }
    const replacements = new Map<string, string>(), manifest = new Map<string, any>();
    for (const source of candidates) {
      signal?.throwIfAborted();
      const key = assetSourceKey(source), old = cache.get(key);
      if (manifest.has(key)) { replacements.set(source, assetUrl(pageId, key)); continue; }
      if (immutableNotionFile(new URL(source)) && old) {
        manifest.set(key, { asset_key: key, object_path: old.object_path, content_hash: old.content_hash, content_type: old.content_type, byte_size: old.byte_size });
      } else {
        const file = await downloadAsset(source, signal), digest = hash(file.bytes), objectPath = `${pageId}/${digest}`;
        const serverKey = await (secret ||= storageServiceKey(management));
        const response = await fetch(new URL(`/storage/v1/object/${ASSET_BUCKET}/${objectPath}`, supabaseUrl()), {
          method: 'POST', headers: { ...supabaseHeaders(serverKey), 'Content-Type': file.contentType, 'x-upsert': 'true', 'cache-control': '86400' },
          body: new Uint8Array(file.bytes), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
        });
        if (!response.ok) throw Object.assign(new Error('Asset upload failed'), { status: response.status });
        await response.body?.cancel();
        manifest.set(key, { asset_key: key, object_path: objectPath, content_hash: digest, content_type: file.contentType, byte_size: file.size });
      }
      replacements.set(source, assetUrl(pageId, key));
    }
    const replace = (value: any): any => {
      if (typeof value === 'string') return replacements.get(value) || value;
      if (Array.isArray(value)) return value.map(replace);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
      return value;
    };
    const result = replace(book);
    result.assets = [...manifest.values()];
    return result;
  };
}

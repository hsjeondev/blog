import type { NextApiRequest, NextApiResponse } from 'next';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { bookDatabaseId, notionId, noPublicationCache } from '../../../../utils/notion-server';
import { supabaseRead, supabaseUrl, supabaseHeaders, storageServiceKey } from '../../../../utils/supabase-http';

export default async function handler(req: NextApiRequest,res: NextApiResponse) {
  noPublicationCache(res);
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  if(!['GET','HEAD'].includes(req.method||''))return res.status(405).end();
  const page=notionId(req.query.pageId),key=req.query.assetKey;
  if(!page||typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))return res.status(404).end();
  const controller=new AbortController();
  const closed=()=>{if(!res.writableEnded)controller.abort();};
  res.once('close',closed);
  try {
    const asset=await supabaseRead('blog_read_asset',{p_database:bookDatabaseId(),p_page:page,p_asset:key},controller.signal);
    if(!asset)return res.status(404).end();
    if(!new RegExp('^'+page+'/[a-f0-9]{64}$').test(asset.object_path))throw new Error('Invalid asset path');
    const range=req.headers.range;
    if(range&&!/^bytes=\d*-\d*$/.test(range))return res.status(416).end();
    res.setHeader('Content-Type',asset.content_type);
    res.setHeader('Content-Disposition',/^(image|audio|video)\//.test(asset.content_type)||asset.content_type==='application/pdf'?'inline':'attachment');
    if(req.method==='HEAD'){res.setHeader('Content-Length',asset.byte_size);return res.status(200).end();}
    const secret=await storageServiceKey();
    const upstream=await fetch(new URL('/storage/v1/object/authenticated/blog-assets/'+asset.object_path,supabaseUrl()),{
      headers:{...supabaseHeaders(secret),...(range?{Range:range}:{})},cache:'no-store',
      signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]),
    });
    if(!upstream.ok||!upstream.body)return res.status(upstream.status===404?404:502).end();
    for(const header of ['content-length','content-range','accept-ranges']){const value=upstream.headers.get(header);if(value)res.setHeader(header,value);}
    res.status(upstream.status);
    await pipeline(Readable.fromWeb(upstream.body as any),res);
  } catch {
    if(!res.headersSent)res.status(502).end();else res.end();
  } finally {res.off('close',closed);}
}
export const config={api:{responseLimit:false},maxDuration:60};

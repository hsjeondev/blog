import { supabaseRead } from './supabase-http';
import { bookDatabaseId, notionId, notPublished } from './notion-server';

export type GraphOptions = { cursor?: string; focus?: string };
export async function buildGraphData(signal?: AbortSignal, options?: GraphOptions) {
  if (options?.cursor) {
    try { JSON.parse(Buffer.from(options.cursor,'base64url').toString()); }
    catch { throw Object.assign(new Error('Invalid graph cursor'),{status:400}); }
  }
  const data=await supabaseRead('blog_read_graph',{p_database:bookDatabaseId()},signal);
  if(!Array.isArray(data?.posts)||!Array.isArray(data?.links))throw new Error('Invalid stored graph');
  const nodes=data.posts.map((post:any)=>({id:post.id,title:post.title,href:'/'+post.id,kind:post.kind,group:post.kind}));
  if(options?.focus&&!nodes.some((node:any)=>node.id===notionId(options.focus)))throw notPublished();
  const groups=[
    {id:'group:post',title:'포스팅',href:'/',kind:'group',group:'post'},
    {id:'group:project',title:'프로젝트',href:'/forest',kind:'group',group:'project'},
    {id:'group:recap',title:'월말결산',href:'/recap',kind:'group',group:'recap'},
    {id:'group:document',title:'문서',href:'/forest',kind:'group',group:'document'},
  ].filter(group=>nodes.some((node:any)=>node.group===group.group));
  const membership=nodes.map((node:any)=>({source:'group:'+node.group,target:node.id,kind:'membership'}));
  return {version:6,nodes:[...nodes,...groups],links:[...data.links,...membership],scannedIds:nodes.map((node:any)=>node.id),
    processed:nodes.length,total:nodes.length,nextCursor:null,complete:true,reset:true,generatedAt:new Date().toISOString()};
}

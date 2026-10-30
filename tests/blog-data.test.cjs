const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),ts=require('typescript');const {Writable}=require('node:stream');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {upstream,database,ids}=require('./fixtures/notion-api.cjs');const {rowFromPage,blogFixture}=require('./fixtures/blog-db.cjs');
const data=require('../utils/blog-data.ts');const {buildGraphData}=require('../utils/build-graph-data.ts');const media=require('../pages/api/blog-media/[pageId]/[assetKey].ts').default;
const [published,hidden,target]=ids;
async function fixture(run){const env={...process.env},fetch=global.fetch;Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture-read',SUPABASE_SECRET_KEY:'fixture-server',NOTION_MYBOOKLIST_ID:database});delete process.env.NOTION_TOKEN;delete process.env.NOTION_API_KEY;const db=blogFixture(upstream().pages.map(rowFromPage));db.links=[{source:published,target,kind:'reference'}];global.fetch=db.fetch;try{await run(db);}finally{global.fetch=fetch;process.env=env;}}
class ResponseStream extends Writable{constructor(){super();this.headers={};this.statusCode=200;this.parts=[];}setHeader(k,v){this.headers[k]=v;}status(code){this.statusCode=code;return this;}_write(chunk,_encoding,done){this.parts.push(Buffer.from(chunk));done();}}
test('catalog, detail, title metadata and graph work without Notion credentials or requests',()=>fixture(async db=>{
 const books=await data.publishedBooks();assert.equal(books.length,2);assert.ok(!books.some(b=>b.id===hidden));
 const page=await data.getNotionPage(published);assert.equal(page.reading_minutes,3);assert.equal(page.block[published].value.blog_metadata.title,'공개 책');
 assert.equal(data.bookMetadata(await data.getPublishedPage(target)).title,'연결 책');
 const before=db.calls.length,graph=await buildGraphData();assert.equal(db.calls.length-before,1);assert.equal(graph.nextCursor,null);assert.ok(graph.links.some(l=>l.source===published&&l.target===target));
 assert.ok(db.calls.every(c=>c.path.startsWith('/rest/v1/rpc/blog_')));
}));
test('unpublished, deleted, incomplete-media and foreign-source records are never returned',()=>fixture(async db=>{
 await assert.rejects(data.getNotionPage(hidden),e=>e.status===404);
 for(const update of [{deleted_at:'2026-10-30T00:00:00Z'},{assets_ready:false},{notion_database_id:target},{sync_status:'pending'}]){
  const original=structuredClone(db.rows[0]);Object.assign(db.rows[0],update);await assert.rejects(data.getNotionPage(published),e=>e.status===404);db.rows[0]=original;
 }
 await assert.rejects(data.getDatabase(hidden),e=>e.status===404);
}));
test('stored referenced-page titles are refreshed and revoked page entries and mentions are stripped',()=>fixture(async db=>{
 db.maps.set(published,{published_references:[hidden,target],signed_urls:{},block:{
  [published]:{value:{id:published,type:'page',content:['body'],properties:{title:[['old root']]},format:{}}},
  body:{value:{id:'body',type:'text',properties:{title:[['PRIVATE_TITLE',[['p',hidden]]],['old linked title',[['p',target]]]]}}},
  [hidden]:{value:{id:hidden,type:'page',properties:{title:[['PRIVATE_TITLE']]}}},
  [target]:{value:{id:target,type:'page',properties:{title:[['old linked title']]}}},
 }});
 const map=await data.getNotionPage(published);assert.ok(!JSON.stringify(map).includes('PRIVATE_TITLE'));assert.ok(!JSON.stringify(map).includes(hidden));assert.match(JSON.stringify(map),/연결 책/);
}));
test('database RPC failures are service errors, not cached missing posts or a fallback to Notion',()=>fixture(async()=>{
 global.fetch=async url=>{assert.ok(new URL(url).hostname.endsWith('.supabase.co'));return Response.json({code:'PGRST202'},{status:404});};
 await assert.rejects(data.getNotionPage(published),e=>e.status===502&&!data.isNotionNotFound(e));
}));
test('media requests recheck publication and never reveal a private bucket URL or server key',()=>fixture(async db=>{
 const key='a'.repeat(64),path=published+'/'+ 'b'.repeat(64);db.assets.push({post_id:published,asset_key:key,object_path:path,content_type:'image/png',byte_size:8});
 const original=db.fetch;let storageRequests=0;
 global.fetch=async(url,init)=>{const u=new URL(url);if(u.pathname.startsWith('/storage/v1/')){storageRequests++;assert.equal(init.headers.apikey,'fixture-server');return new Response(Buffer.from('PNGbytes'),{headers:{'content-length':'8'}});}return original(url,init);};
 const res=new ResponseStream();await media({method:'GET',query:{pageId:published,assetKey:key},headers:{}},res);assert.equal(res.statusCode,200);assert.equal(Buffer.concat(res.parts).toString(),'PNGbytes');assert.match(res.headers['Cache-Control'],/no-store/);assert.match(res.headers['Content-Security-Policy'],/sandbox/);assert.equal(res.headers['Content-Type'],'image/png');
 db.rows[0].is_published=false;db.rows[0].deleted_at='2026-10-30T00:00:00Z';const hiddenResponse=new ResponseStream();await media({method:'GET',query:{pageId:published,assetKey:key},headers:{}},hiddenResponse);assert.equal(hiddenResponse.statusCode,404);assert.equal(storageRequests,1);
 assert.ok(!JSON.stringify(res.headers).includes('fixture-server'));assert.ok(!JSON.stringify(res.headers).includes('object_path'));
}));
test('HEAD media requests avoid loading bytes and cross-post object paths are refused',()=>fixture(async db=>{
 const key='a'.repeat(64);db.assets.push({post_id:published,asset_key:key,object_path:published+'/'+ 'b'.repeat(64),content_type:'image/png',byte_size:8});
 const head=new ResponseStream();await media({method:'HEAD',query:{pageId:published,assetKey:key},headers:{}},head);assert.equal(head.statusCode,200);assert.equal(head.headers['Content-Length'],8);assert.equal(db.calls.length,1);
 db.assets[0].object_path=target+'/'+ 'b'.repeat(64);const bad=new ResponseStream();await media({method:'GET',query:{pageId:published,assetKey:key},headers:{}},bad);assert.equal(bad.statusCode,502);
}));
test('database JSON key reordering cannot make a child block replace the rendered page root',()=>fixture(async db=>{
 const root={value:{id:published,type:'page',content:['00000000-0000-4000-8000-000000000001'],properties:{},format:{}}};
 db.maps.set(published,{block:{'00000000-0000-4000-8000-000000000001':{value:{id:'00000000-0000-4000-8000-000000000001',type:'text',properties:{title:[['본문 전체']]}}},[published]:root},published_references:[]});
 const map=await data.getNotionPage(published);
 assert.equal(Object.keys(map.block)[0],published);
 assert.deepEqual(map.block[published].value.content,['00000000-0000-4000-8000-000000000001']);
 assert.match(JSON.stringify(map),/본문 전체/);
}));

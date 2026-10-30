const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {createAssetMirror,assetSourceKey,safeAssetUrl,downloadAsset,MAX_ASSET_BYTES}=require('../utils/sync/blog-assets.ts');
const {database,ids}=require('./fixtures/notion-api.cjs');const [page,,target]=ids;
const source='https://file.notion.so/f/space/image.png?signature=old';const source2='https://file.notion.so/f/space/image.png?signature=new';
const png=Buffer.from([137,80,78,71,13,10,26,10]);
function book(){return {post:{id:page,cover:{type:'file',file:{url:source}},icon:{type:'emoji',emoji:'📚'}},content:{record_map:{block:{[page]:{value:{id:page,type:'page',format:{page_cover:source},blog_metadata:{cover:{file:{url:source}}}}},image:{value:{id:'image',type:'image',properties:{source:[[source2]]}}},[target]:{value:{id:target,type:'page',blog_metadata:{title:'Other',cover:{file:{url:'https://file.notion.so/foreign'}}}}}},signed_urls:{image:source2}}},links:[]};}
async function withEnvironment(run){const env={...process.env},fetch=global.fetch;Object.assign(process.env,{NOTION_MYBOOKLIST_ID:database,NEXT_PUBLIC_SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'fixture-storage-key'});try{await run();}finally{process.env=env;global.fetch=fetch;}}
test('asset identity ignores expiring Notion signatures but keeps external image transformations',()=>{
 assert.equal(assetSourceKey(source),assetSourceKey(source2));assert.notEqual(assetSourceKey('https://images.unsplash.com/photo?w=100'),assetSourceKey('https://images.unsplash.com/photo?w=200'));
});
test('private destinations, credentials and insecure redirects are rejected before downloading',async()=>{
 for(const value of ['http://example.com/a','https://127.0.0.1/a','https://[::1]/a','https://user:pass@example.com/a','https://metadata.internal/a'])await assert.rejects(safeAssetUrl(value));
 await assert.rejects(safeAssetUrl('https://example.com/a',async()=>[{address:'169.254.169.254'}]),/Non-public/);
 const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/secret'}});};
 try{await assert.rejects(downloadAsset(source));assert.equal(calls,1);}finally{global.fetch=original;}
});
test('unsupported content and oversized files do not reach Storage',async()=>{
 const original=global.fetch;try{
  global.fetch=async()=>new Response('<html>',{headers:{'content-type':'text/html'}});await assert.rejects(downloadAsset(source),/Unsupported/);
  global.fetch=async()=>new Response(png,{headers:{'content-type':'image/png','content-length':String(MAX_ASSET_BYTES+1)}});await assert.rejects(downloadAsset(source),/Unsupported/);
 }finally{global.fetch=original;}
});
test('one immutable file is copied once and every own URL is rewritten, without copying referenced-book media',()=>withEnvironment(async()=>{
 const calls=[];global.fetch=async(url,init={})=>{calls.push({url:String(url),init});if(new URL(url).hostname==='file.notion.so'){assert.equal(init.headers,undefined);return new Response(png,{headers:{'content-type':'image/png'}});}assert.equal(new URL(url).hostname,'fixture.supabase.co');assert.equal(init.headers.apikey,'fixture-storage-key');assert.equal(init.method,'POST');return Response.json({Key:'ok'});};
 const input=book();const result=await createAssetMirror({call:async()=>[]})(input);
 assert.equal(calls.length,2);assert.equal(result.assets.length,1);assert.equal(result.assets[0].byte_size,8);
 const path='/api/blog-media/'+page+'/'+assetSourceKey(source);assert.equal(result.post.cover.file.url,path);assert.equal(result.content.record_map.signed_urls.image,path);assert.equal(result.content.record_map.block.image.value.properties.source[0][0],path);
 assert.equal(result.content.record_map.block[target].value.blog_metadata.cover,undefined);assert.equal(input.post.cover.file.url,source);
 assert.ok(!JSON.stringify(result).includes('signature='));
}));
test('an existing private Storage object is reused without downloading an expiring source',()=>withEnvironment(async()=>{
 const key=assetSourceKey(source),cached={asset_key:key,object_path:page+'/'+ 'b'.repeat(64),content_hash:'b'.repeat(64),content_type:'image/png',byte_size:8};
 global.fetch=async()=>assert.fail('cached immutable media must not use the network');
 const result=await createAssetMirror({call:async()=>[cached]})(book());assert.equal(result.assets.length,1);assert.equal(result.assets[0].object_path,cached.object_path);
}));
test('failed Storage uploads leave the input untouched and never produce a ready manifest',()=>withEnvironment(async()=>{
 global.fetch=async url=>new URL(url).hostname==='file.notion.so'?new Response(png,{headers:{'content-type':'image/png'}}):Response.json({error:'unavailable'},{status:503});
 const input=book();await assert.rejects(createAssetMirror({call:async()=>[]})(input),e=>e.status===503);assert.equal(input.assets,undefined);assert.equal(input.post.cover.file.url,source);
}));

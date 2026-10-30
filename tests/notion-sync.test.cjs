const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText,filename);
const {syncPublishedNotion,syncNotionPage}=require('../utils/sync/notion-sync.ts');
const {createSyncStore}=require('../utils/sync/supabase-store.ts');
const {upstream,database,ids}=require('./fixtures/notion-api.cjs');
const [published,hidden,target]=ids;
async function fixture(run){
  const env={...process.env},fetch=global.fetch,f=upstream(),calls=[];
  Object.assign(process.env,{NOTION_TOKEN:'fixture',NOTION_MYBOOKLIST_ID:database});delete process.env.NOTION_API_KEY;
  global.fetch=f.fetch;
  const store={async call(name,args){calls.push({name,args:structuredClone(args)});return name==='blog_sync_started_at'?'2026-10-30T00:00:00Z':name==='blog_commit_notion_snapshot'?{synced:args.p_books.length}:{};}};
  try{await run({f,store,calls});}finally{global.fetch=fetch;process.env=env;}
}
test('initial sync stores only public metadata and own bodies, never comments or private properties',()=>fixture(async({f,store,calls})=>{
  assert.equal((await syncPublishedNotion(store)).synced,2);
  const commit=calls.find(c=>c.name==='blog_commit_notion_snapshot');
  assert.deepEqual(commit.args.p_books.map(b=>b.post.id),[published,target]);
  const source=commit.args.p_books[0];assert.deepEqual(source.links,[target]);
  assert.match(source.content.plain_text,/중첩된 문장/);assert.match(source.content.plain_text,/표 셀/);
  for(const value of [hidden,'PROPERTY_SECRET','PRIVATE_COMMENT_TEXT','PRIVATE_COMMENT_AUTHOR'])assert.ok(!JSON.stringify(commit.args).includes(value));
  assert.ok(f.calls.every(c=>!c.path.startsWith('/v1/blocks/'+hidden)));
}));
test('failed or incomplete Notion catalogs never commit a partial destructive snapshot',()=>fixture(async({f,store,calls})=>{
  const fetch=f.fetch;global.fetch=async(url,init)=>new URL(url).pathname.includes('/query')?Response.json({code:'unauthorized'},{status:401}):fetch(url,init);
  await assert.rejects(syncPublishedNotion(store),e=>e.status===401);
  assert.ok(!calls.some(c=>c.name==='blog_commit_notion_snapshot'||c.name==='blog_soft_delete_notion_post'));
  assert.ok(calls.some(c=>c.name==='blog_note_sync_failure'));
}));
test('a successful empty catalog is authoritative, and a private page never creates a new row',()=>fixture(async({f,store,calls})=>{
  f.pages.forEach(p=>p.properties.공개.checkbox=false);
  await syncPublishedNotion(store);
  assert.deepEqual(calls.find(c=>c.name==='blog_commit_notion_snapshot').args.p_books,[]);
  calls.length=0;await syncNotionPage(store,hidden);
  assert.deepEqual(calls,[{name:'blog_soft_delete_notion_post',args:{p_database:database,p_page:hidden}}]);
}));
test('unpublishing during a scan rebuilds dependent bodies before the one atomic commit',()=>fixture(async({f,store,calls})=>{
  const fetch=f.fetch;let changed=false;
  global.fetch=async(url,init)=>{const response=await fetch(url,init);if(!changed&&new URL(url).pathname==='/v1/comments'){changed=true;f.pages[2].properties.공개.checkbox=false;}return response;};
  await syncPublishedNotion(store);
  const books=calls.find(c=>c.name==='blog_commit_notion_snapshot').args.p_books;
  assert.equal(books.length,1);assert.equal(books[0].post.id,published);
  assert.deepEqual(books[0].content.referenced_page_ids,[]);assert.deepEqual(books[0].links,[]);
  assert.ok(!JSON.stringify(books).includes(target));
}));
test('an inaccessible or foreign page is not interpreted as a publication revocation',()=>fixture(async({f,store,calls})=>{
  await assert.rejects(syncNotionPage(store,ids[11]),e=>e.status===404);
  f.pages[0].parent.database_id=target;
  await assert.rejects(syncNotionPage(store,published),/outside/);
  assert.equal(calls.length,0);
}));
test('cancellation aborts before committing and does not record a spurious failure',()=>fixture(async({store,calls})=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(syncPublishedNotion(store,controller.signal));
  assert.ok(!calls.some(c=>c.name==='blog_commit_notion_snapshot'||c.name==='blog_note_sync_failure'));
}));
test('management transport parameterizes JSON with collision-safe dollar quoting, without printing credentials',async()=>{
  const env={...process.env},fetch=global.fetch;
  try{
    Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ACCESS_TOKEN:'test-only'});
    global.fetch=async(url,init)=>{
      assert.equal(new URL(url).hostname,'api.supabase.com');
      const query=JSON.parse(init.body).query;
      assert.ok(query.includes('public.blog_note_sync_failure('));
      const marker=query.match(/\$blog_[a-f0-9]+\$/)[0];
      const payload=JSON.parse(query.split(marker)[1]);
      assert.equal(payload.p_error,"Quotes ' ; DROP TABLE test; -- 한글 \\ path");
      return Response.json([{result:null}]);
    };
    await createSyncStore(true).call('blog_note_sync_failure',{p_database:database,p_error:"Quotes ' ; DROP TABLE test; -- 한글 \\ path"});
  }finally{global.fetch=fetch;process.env=env;}
});

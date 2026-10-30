const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createHmac}=require('node:crypto');
const fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {upstream,database,ids}=require('./fixtures/notion-api.cjs');
const [published,hidden,target]=ids;
const pacing=require('../utils/sync/notion-pacing.ts');
const storage=require('../utils/sync/supabase-store.ts');
const {validNotionSignature,normalizedNotionEvent,drainNotionEvents}=require('../utils/sync/notion-webhook.ts');
const handler=require('../pages/api/notion/webhook.ts').default;
const retry=require('../pages/api/notion/retry.ts').default;
const token='fixture-verification-token-only';
const event={id:ids[11],type:'page.properties_updated',timestamp:'2026-10-30T00:00:00Z',entity:{id:published,type:'page'}};
const signature=raw=>'sha256='+createHmac('sha256',token).update(raw).digest('hex');
function request(raw='',headers={},method='POST'){return Object.assign(Readable.from([Buffer.from(raw)]),{method,headers:{'content-type':'application/json',...headers}});}
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}};}
async function fixture(run,jobs=[]){
  const env={...process.env},fetch=global.fetch,create=storage.createSyncStore,pace=pacing.withNotionPacing,f=upstream(),calls=[];
  Object.assign(process.env,{NOTION_TOKEN:'fixture',NOTION_MYBOOKLIST_ID:database,NOTION_WEBHOOK_VERIFICATION_TOKEN:token});delete process.env.NOTION_API_KEY;delete process.env.NOTION_WEBHOOK_SUBSCRIPTION_ID;delete process.env.CRON_SECRET;
  global.fetch=f.fetch;pacing.withNotionPacing=work=>work();
  const store={async call(name,args){calls.push({name,args:structuredClone(args)});if(name==='blog_sync_started_at')return '2026-10-30T00:00:00Z';if(name==='blog_claim_notion_event')return jobs.shift()||{status:'empty'};return true;}};
  storage.createSyncStore=()=>store;
  try{await run({f,calls,store});}finally{global.fetch=fetch;process.env=env;storage.createSyncStore=create;pacing.withNotionPacing=pace;}
}

test('signature uses the exact raw bytes, rejects altered Unicode/whitespace and malformed lengths',()=>{
  const raw=Buffer.from('{ "title": "회복탄력성" }\n');
  assert.equal(validNotionSignature(raw,signature(raw),token),true);
  assert.equal(validNotionSignature(Buffer.from(JSON.stringify(JSON.parse(raw))),signature(raw),token),false);
  for(const value of [undefined,'sha256=short','sha256='+'g'.repeat(64),['sha256=abc']])assert.equal(validNotionSignature(raw,value,token),false);
});
test('only page-level comments map to their parent book, and unknown event types are ignored',()=>{
  const comment={...event,type:'comment.updated',entity:{type:'comment',id:target},data:{page_id:published,parent:{type:'page',id:published}}};
  assert.equal(normalizedNotionEvent(comment).page,published);
  assert.equal(normalizedNotionEvent({...comment,data:{...comment.data,parent:{type:'block'}}}),null);
  assert.equal(normalizedNotionEvent({...comment,data:{...comment.data,property_id:'property'}}),null);
  assert.equal(normalizedNotionEvent({...event,type:'page.locked'}),null);
  assert.throws(()=>normalizedNotionEvent({...event,id:'invalid'}),/Invalid/);
});
test('unsigned or modified deliveries cannot enqueue work, including alternate subscription IDs',()=>fixture(async({calls})=>{
  const raw=JSON.stringify(event);
  for(const header of [undefined,signature(raw+'changed')]){const res=response();await handler(request(raw,{'x-notion-signature':header}),res);assert.equal(res.statusCode,401);}
  process.env.NOTION_WEBHOOK_SUBSCRIPTION_ID='expected-subscription';const res=response();await handler(request(raw,{'x-notion-signature':signature(raw)}),res);assert.equal(res.statusCode,401);
  assert.equal(calls.length,0);
}));
test('verification is stored privately without activation or returning its token',()=>fixture(async({calls})=>{
  delete process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN;
  const res=response();await handler(request(JSON.stringify({verification_token:token})),res);
  assert.equal(res.statusCode,200);assert.ok(!JSON.stringify(res.body).includes(token));
  assert.deepEqual(calls,[{name:'blog_store_webhook_verification',args:{p_token:token}}]);
  calls.length=0;const delivery=response();const raw=JSON.stringify(event);await handler(request(raw,{'x-notion-signature':signature(raw)}),delivery);
  assert.equal(delivery.statusCode,503);assert.equal(calls.length,0);
}));
test('valid event is durably enqueued with no comment text or authors, and busy workers cause a retry response',()=>fixture(async({calls})=>{
  const raw=JSON.stringify({...event,authors:[{id:'PRIVATE_AUTHOR'}],unused:'PRIVATE_TEXT'});
  const res=response();await handler(request(raw,{'x-notion-signature':signature(raw)}),res);
  assert.equal(res.statusCode,503);assert.equal(res.headers['Retry-After'],'30');
  const enqueue=calls.find(c=>c.name==='blog_enqueue_notion_event');assert.equal(enqueue.args.p_page,published);
  assert.ok(!JSON.stringify(calls).includes('PRIVATE_AUTHOR'));assert.ok(!JSON.stringify(calls).includes('PRIVATE_TEXT'));
},[{status:'busy'}]));
test('delta updates one book without fetching other public bodies, even for an old delete event',()=>fixture(async({f,calls,store})=>{
  assert.equal(await drainNotionEvents(store,AbortSignal.timeout(2000)),true);
  const commit=calls.find(c=>c.name==='blog_commit_notion_page');assert.equal(commit.args.p_book.post.id,published);assert.deepEqual(commit.args.p_book.links,[target]);
  assert.ok(!f.calls.some(c=>c.path==='/v1/blocks/'+target+'/children'));
  assert.ok(!calls.some(c=>c.name==='blog_commit_notion_snapshot'));
},[{status:'claimed',id:ids[11],type:'page.deleted',pageId:published}]));
test('a publication revocation reads no body and reconciles only the successful current public catalog',()=>fixture(async({f,calls,store})=>{
  f.pages[0].properties.공개.checkbox=false;
  assert.equal(await drainNotionEvents(store,AbortSignal.timeout(2000)),true);
  const commit=calls.find(c=>c.name==='blog_commit_notion_page');assert.equal(commit.args.p_book,null);assert.deepEqual(commit.args.p_public_ids,[target]);
  assert.ok(f.calls.every(c=>!c.path.startsWith('/v1/blocks/')));
},[{status:'claimed',id:ids[11],type:'page.properties_updated',pageId:published}]));
test('source read failures retain queued work and never commit an empty deletion snapshot',()=>fixture(async({calls,store})=>{
  global.fetch=async()=>Response.json({code:'unauthorized'},{status:401});
  assert.equal(await drainNotionEvents(store,AbortSignal.timeout(2000)),false);
  assert.ok(!calls.some(c=>c.name==='blog_commit_notion_page'));
  assert.equal(calls.find(c=>c.name==='blog_finish_notion_event').args.p_success,false);
},[{status:'claimed',id:ids[11],type:'page.properties_updated',pageId:published}]));
test('graph repair reads only comments and never Notion bodies',()=>fixture(async({f,calls,store})=>{
  assert.equal(await drainNotionEvents(store,AbortSignal.timeout(2000)),true);
  assert.ok(f.calls.every(c=>!c.path.startsWith('/v1/blocks/')));
  assert.deepEqual(calls.find(c=>c.name==='blog_commit_notion_graph').args.p_links,[{source:published,target}]);
},[{status:'claimed',id:ids[11],type:'graph.refresh',pageId:database}]));
test('comment updates refresh links without fetching an unchanged body',()=>fixture(async({f,calls,store})=>{
  assert.equal(await drainNotionEvents(store,AbortSignal.timeout(2000)),true);
  assert.ok(f.calls.every(c=>!c.path.startsWith('/v1/blocks/')));
  const commit=calls.find(c=>c.name==='blog_commit_notion_page');assert.equal(commit.args.p_book.links_only,true);assert.deepEqual(commit.args.p_book.links,[target]);
},[{status:'claimed',id:ids[11],type:'comment.updated',pageId:published}]));
test('duplicate completed deliveries return success without doing Notion work; malformed/oversized payloads are rejected',()=>fixture(async({f,calls})=>{
  const raw=JSON.stringify(event),res=response();await handler(request(raw,{'x-notion-signature':signature(raw)}),res);assert.equal(res.statusCode,200);assert.equal(f.calls.length,0);
  const invalid=response();await handler(request('{'),invalid);assert.equal(invalid.statusCode,400);
  const large=response();await handler(request(' '.repeat(256*1024+1)),large);assert.equal(large.statusCode,413);
}));
test('manual recovery requires a server secret and resets failures only after authentication',()=>fixture(async({calls})=>{
  const bad=response();await retry(request('',{authorization:'Bearer wrong'}),bad);assert.equal(bad.statusCode,401);assert.equal(calls.length,0);
  const good=response();await retry(request('',{authorization:'Bearer '+token}),good);assert.equal(good.statusCode,200);
  assert.equal(calls[0].name,'blog_retry_failed_notion_events');
}));

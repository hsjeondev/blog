const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText, filename);
const { deferredNotionPaths, normalizeNotionRecordMap, isNotionNotFound } = require('../utils/get-notion-page.ts');
const { fetchNotionJson } = require('../utils/notion-fetch.ts');
const id = '3fdfc9b9-3eca-8041-b98c-ca653f320b1c';

test('missing titles and nested recordMap values remain valid; incomplete responses are errors, not cached 404s', () => {
  for (const entry of [{value:{id,type:'page'}}, {value:{role:'reader',value:{id,type:'page'}}}, {id,type:'page'}]) {
    const map = normalizeNotionRecordMap({block:{[id]:entry}},id);
    assert.equal(map.block[id].value.id,id);
    assert.equal(map.block[id].value.properties,undefined);
  }
  assert.throws(() => normalizeNotionRecordMap({block:{}},id), /Incomplete/);
  for (const error of [{status:429},{statusCode:503},new Error('network'),new Error('Incomplete')]) assert.equal(isNotionNotFound(error), false);
  assert.equal(isNotionNotFound({response:{status:404}}),true);
});

test('the embed component renders without title, category or tags properties', () => {
  const path='pages/embed/[pageId].js';
  const source=ts.createSourceFile(path,fs.readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  const component=source.statements.find(node=>ts.isFunctionDeclaration(node) && node.name?.text==='Page');
  const code=ts.createPrinter().printNode(ts.EmitHint.Unspecified,component,source).replace(/^export default\s+/,'');
  const compiled=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  const Page=new Function('require','exports','useState','useEffect','NotionRenderer','Code','Collection','Equation','Modal','mapPublishedImageUrl',compiled+'\nreturn Page;')(require,{},value=>[value,()=>{}],()=>{},()=>null,null,null,null,null, value=>value);
  assert.doesNotThrow(()=>Page({pageId:id,recordMap:{block:{[id]:{value:{id,type:'page',properties:{}}}}}}));
});

function pageFunctions(path, getNotionPage) {
  const source = ts.createSourceFile(path, fs.readFileSync(path,'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const printer = ts.createPrinter();
  const code = source.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'getServerSideProps').map(node => printer.printNode(ts.EmitHint.Unspecified,node,source).replace(/^export\s+/, '')).join('\n');
  return new Function('getNotionPage','isNotionNotFound','console',code+'\nreturn getServerSideProps;')(getNotionPage,isNotionNotFound,{error(){}});
}
test('detail and embed recheck publication on every request without ISR or public caching', async () => {
  for (const path of ['pages/[pageId].js','pages/embed/[pageId].js']) {
    const headers = {};
    const context = {params:{pageId:id}, res:{setHeader(k,v){headers[k]=v;}}};
    const hidden=pageFunctions(path,async()=>{throw Object.assign(new Error('hidden'),{status:404});});
    assert.deepEqual(await hidden(context),{notFound:true});
    assert.match(headers['Cache-Control'], /no-store/);
    const success=pageFunctions(path,async()=>({block:{[id]:{value:{id,type:'page'}}}}));
    const result=await success(context);
    assert.equal(result.props.pageId,id);
    assert.equal(result.revalidate,undefined);
    const limited=pageFunctions(path,async()=>{throw Object.assign(new Error('limited'),{status:429});});
    await assert.rejects(limited(context),error=>error.status===429);
  }
});

test('database 429 respects Retry-After, bounds retries, and never retries auth failures or long cooldowns early', async () => {
  const original=global.fetch;
  try {
    let calls=0; const waits=[];
    global.fetch=async()=> ++calls===1 ? Response.json({code:'rate_limited'},{status:429,headers:{'retry-after':'2'}}) : Response.json({results:[]});
    assert.deepEqual(await fetchNotionJson('https://api.notion.com/test',{},async ms=>waits.push(ms)),{results:[]});
    assert.equal(calls,2); assert.ok(waits[0]>=2000 && waits[0]<2250);
    calls=0; global.fetch=async()=>{calls++;return Response.json({}, {status:429});};
    await assert.rejects(fetchNotionJson('https://api.notion.com/test',{},async()=>{}),error=>error.status===429);
    assert.equal(calls,3);
    for(const [status,header] of [[401,null],[429,'120']]) {
      calls=0;global.fetch=async()=>{calls++;return Response.json({}, {status,headers:header?{'retry-after':header}:{}});};
      await assert.rejects(fetchNotionJson('https://api.notion.com/test',{},async()=>assert.fail('must not wait')),error=>error.status===status);
      assert.equal(calls,1);
    }
  } finally { global.fetch=original; }
});

test('cancelled requests stop during a Notion cooldown without issuing another fetch',async()=>{
  const original=global.fetch;
  try {
    const controller=new AbortController();let calls=0;
    global.fetch=async()=>{calls++;return Response.json({}, {status:429,headers:{'retry-after':'20'}});};
    const pending=fetchNotionJson('https://api.notion.com/test',{signal:controller.signal});
    await new Promise(resolve=>setImmediate(resolve));controller.abort();
    await assert.rejects(pending,error=>error.name==='AbortError');assert.equal(calls,1);
  } finally {global.fetch=original;}
});

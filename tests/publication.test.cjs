const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const originalJs = require.extensions['.js'];
const compile = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = compile;
require.extensions['.css'] = () => {};
require.extensions['.js'] = (module, filename) => filename.startsWith(root + path.sep) && !filename.includes('/node_modules/') ? compile(module, filename) : originalJs(module, filename);
const { getDatabase } = require('../utils/get-database.ts');
const { getNotionPage } = require('../utils/get-notion-page.ts');
const { publishedBooks } = require('../utils/published-notion.ts');
const { searchContent } = require('../utils/search/search-service.ts');
const { buildGraphData } = require('../utils/build-graph-data.ts');
const { fetchNotionBacklinks } = require('../utils/notion-backlinks.ts');
const { database, ids, upstream } = require('./fixtures/notion-api.cjs');
const [published, hidden, target, text, image, nested, row, table, child, linked, synced] = ids;
async function withFixture(run) {
  const previous={...process.env},fetch=global.fetch;
  Object.assign(process.env,{NOTION_TOKEN:'fixture-integration',NOTION_MYBOOKLIST_ID:database});delete process.env.NOTION_API_KEY;
  const fixture=upstream();global.fetch=fixture.fetch;
  try {await run(fixture);} finally {global.fetch=fetch;process.env=previous;}
}
function response() {return {headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;return this;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},end(body){this.body=body;return this;}};}

test('book query enforces publication, database membership and pagination even with a caller filter',()=>withFixture(async f=>{
  await getDatabase(database,{filter:{property:'공개',checkbox:{equals:false}}});
  const query=f.calls[0];assert.deepEqual(query.body.filter.and[0],{property:'공개',checkbox:{equals:true}});
  assert.equal(query.init.headers.Authorization,'Bearer fixture-integration');
  assert.equal(query.init.cache,'no-store');
  const before=f.calls.length;await assert.rejects(getDatabase(hidden),e=>e.status===404);assert.equal(f.calls.length,before);
  global.fetch=async()=>Response.json({results:[...f.pages,{...f.pages[0],archived:true},{...f.pages[0],parent:{database_id:hidden}}, {...f.pages[0],properties:{}}],has_more:false});
  assert.deepEqual((await getDatabase()).results.map(p=>p.id),[published,target]);
  let batches=0;global.fetch=async(_url,init)=>{const b=JSON.parse(init.body);batches++;assert.equal(b.start_cursor,batches===1?undefined:'cursor');return Response.json({results:[f.pages[0]],has_more:batches===1,next_cursor:batches===1?'cursor':null});};
  await getDatabase();assert.equal(batches,2);
}));

test('official renderer adapter paginates nested blocks and excludes private mentions, child pages and foreign synced content',()=>withFixture(async f=>{
  const map=await getNotionPage(published);
  assert.equal(map.block[published].value.blog_metadata.title,'공개 책');
  assert.equal(map.block[nested].value.properties.checked[0][0],'Yes');
  assert.equal(map.block[image].value.properties.source[0][0],'https://example.com/signed-image.png?signature=fixture');
  assert.equal(map.block[row].value.properties.column_0[0][0],'표 셀');
  assert.deepEqual(map.published_references,[target]);
  const serialized=JSON.stringify(map);
  for(const secret of ['PRIVATE_TITLE','PRIVATE_DATABASE','PROPERTY_SECRET',hidden]) assert.ok(!serialized.includes(secret),secret);
  assert.ok(f.calls.every(call=>!call.path.startsWith('/v1/blocks/'+hidden)));
  assert.ok(!f.calls.some(call=>call.path.includes('/users/')));
}));

test('private, archived, missing-public-property and foreign-database records are rejected before body reads',()=>withFixture(async f=>{
  for(const variant of [false,'missing','archived','foreign']) {
    const p=f.pages[0];p.properties.공개={type:'checkbox',checkbox:true};p.archived=false;p.parent.database_id=database;
    if(variant===false)p.properties.공개.checkbox=false;
    if(variant==='missing')delete p.properties.공개;
    if(variant==='archived')p.archived=true;
    if(variant==='foreign')p.parent.database_id=hidden;
    const before=f.calls.filter(c=>c.path.startsWith('/v1/blocks/')).length;
    await assert.rejects(getNotionPage(published),e=>e.status===404);
    assert.equal(f.calls.filter(c=>c.path.startsWith('/v1/blocks/')).length,before);
  }
}));

test('unpublishing takes effect on the next detail, search and graph request',()=>withFixture(async f=>{
  await getNotionPage(published);
  f.pages[0].properties.공개.checkbox=false;
  await assert.rejects(getNotionPage(published),e=>e.status===404);
  assert.ok(!(await publishedBooks()).some(p=>p.id===published));
  assert.equal((await searchContent('공개 책')).results.length,0);
  const graph=await buildGraphData();assert.ok(!graph.nodes.some(n=>n.id===published));assert.equal(graph.links.filter(e=>e.source===published||e.target===published).length,0);
}));

test('detail-facing APIs reject a private ID and return no-store, including comments, narration and social images',()=>withFixture(async f=>{
  const cases=[
    ['../pages/api/forest/[pageId].js','GET',{pageId:hidden}],
    ['../pages/api/recap/[pageId].js','GET',{pageId:hidden}],
    ['../pages/api/narration/[pageId].js','GET',{pageId:hidden}],
    ['../pages/api/comments/[id].ts','GET',{id:hidden}],
    ['../pages/api/comments/[id].ts','POST',{id:hidden}],
    ['../pages/api/backlink.ts','POST',{}],
  ];
  for(const [file,method,query] of cases) {
    const res=response();await require(file).default({method,query,body:{currentId:hidden,content:'no write'}},res);
    assert.equal(res.statusCode,404,file);assert.match(res.headers['Cache-Control'],/no-store/,file);
    assert.ok(!JSON.stringify(res.body).includes('PRIVATE_TITLE'));
  }
  const image=response();await require('../pages/api/social-image.tsx').default({method:'GET',query:{id:hidden}},image);
  assert.equal(image.statusCode,404);assert.match(image.headers['Cache-Control'],/no-store/);
  assert.ok(f.calls.every(call=>!call.path.includes('/comments')));
}));

test('legacy database API cannot broaden filters, leak private properties or query another database',()=>withFixture(async()=>{
  const handler=require('../pages/api/getDatabase/[...id].ts').default;
  let res=response();await handler({method:'POST',query:{id:[database]},body:{filter:{property:'공개',checkbox:{equals:false}}}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.results.length,2);
  assert.ok(!JSON.stringify(res.body).includes('PROPERTY_SECRET'));
  res=response();await handler({method:'GET',query:{id:[hidden]}},res);assert.equal(res.statusCode,404);
}));

test('graph contains only published links and retains category membership nodes',()=>withFixture(async()=>{
  const graph=await buildGraphData();assert.ok(graph.nodes.some(n=>n.id==='group:post'));
  assert.ok(graph.links.some(e=>e.source===published&&e.target===target&&e.kind==='reference'));
  assert.ok(!JSON.stringify(graph).includes(hidden));
}));

test('backlinks contain referring published documents, never category membership hubs',()=>withFixture(async()=>{
  assert.deepEqual((await fetchNotionBacklinks(published)).sources, []);
  assert.deepEqual((await fetchNotionBacklinks(target)).sources.map(source=>source.id), [published]);
}));

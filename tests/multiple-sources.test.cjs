const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, f);
const { database, ids, upstream } = require('./fixtures/notion-api.cjs');
const secondary = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const { blogDatabaseIds } = require('../utils/notion-server.ts');
const { syncPublishedNotion } = require('../utils/sync/notion-sync.ts');
const { drainNotionEvents, sourceEventId } = require('../utils/sync/notion-webhook.ts');
const { supabaseReadAll } = require('../utils/supabase-http.ts');
const { publishedBooks, getNotionPage, sectionPosts } = require('../utils/blog-data.ts');
async function fixture(work) {
  const env = { ...process.env }, fetch = global.fetch;
  Object.assign(process.env, { NOTION_TOKEN: 'fixture', NOTION_MYBOOKLIST_ID: database, NOTION_BLOG_DATABASE_ID: secondary,
    NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'fixture' });
  delete process.env.NOTION_API_KEY;
  try { await work(); } finally { process.env = env; global.fetch = fetch; }
}
test('each source sync has its own public catalog, metadata and revocation boundary', () => fixture(async () => {
  const f = upstream(), calls = [];
  const blog = f.pages[2];
  blog.parent.database_id = secondary;
  blog.properties.제목 = blog.properties.책제목; delete blog.properties.책제목;
  delete blog.properties.분류; blog.properties.카테고리 = { type: 'select', select: { name: '나중에 추가한 카테고리' } };
  blog.properties.진행상태 = { type: 'select', select: { name: 'ing' } };
  global.fetch = (url, init) => new URL(url).pathname === '/v1/databases/' + secondary + '/query'
    ? Promise.resolve(Response.json({ results: [blog], has_more: false })) : f.fetch(url, init);
  const store = { async call(name, args) {
    calls.push({ name, args: structuredClone(args) });
    return name === 'blog_sync_started_at' ? '2026-10-30T00:00:00Z' : {};
  } };
  await syncPublishedNotion(store);
  await syncPublishedNotion(store, undefined, undefined, secondary);
  const commits = calls.filter(c => c.name === 'blog_commit_notion_snapshot');
  assert.deepEqual(commits.map(c => [c.args.p_database, c.args.p_books.map(b => b.post.id)]), [[database, [ids[0]]], [secondary, [ids[2]]]]);
  assert.equal(commits[1].args.p_books[0].post.category, '나중에 추가한 카테고리');
  assert.equal(commits[1].args.p_books[0].post.notion_database_id, secondary);
  assert.deepEqual(commits[0].args.p_books[0].content.referenced_page_ids, []);
}));
test('a foreign-source event cannot collect a body or revoke another source', () => fixture(async () => {
  const f = upstream(), calls = [];
  global.fetch = (url, init) => new URL(url).pathname === '/v1/databases/' + secondary + '/query'
    ? Promise.resolve(Response.json({ results: [], has_more: false })) : f.fetch(url, init);
  let job = { status: 'claimed', id: ids[11], type: 'page.properties_updated', pageId: ids[0] };
  const store = { async call(name, args) {
    calls.push({ name, args });
    if (name === 'blog_sync_started_at') return '2026-10-30T00:00:00Z';
    if (name === 'blog_claim_notion_event') { const next = job; job = null; return next || { status: 'empty' }; }
    return {};
  } };
  assert.equal(await drainNotionEvents(store, AbortSignal.timeout(5000), secondary), true);
  const commit = calls.find(c => c.name === 'blog_commit_notion_page');
  assert.equal(commit.args.p_database, secondary); assert.equal(commit.args.p_book, null);
  assert.deepEqual(commit.args.p_public_ids, []);
  assert.ok(!f.calls.some(c => c.path.startsWith('/v1/blocks/')));
}));
test('public catalog, detail, search, graph and media reads include both source scopes', () => fixture(async () => {
  const seen = [];
  global.fetch = async (url, init) => {
    const name = new URL(url).pathname.split('/').pop(), args = JSON.parse(init.body);
    seen.push([name, args.p_database]);
    const second = args.p_database === secondary;
    if (name === 'blog_read_catalog') return Response.json([{ notion_database_id: args.p_database, id: second ? ids[2] : ids[0], title: second ? '새 글' : '책', category: second ? '자유로운 이름' : '독서',
      written_at: second ? '2026-11-01' : '2026-10-01', notion_created_at: '2026-10-01', notion_edited_at: '2026-11-01', kind: 'post' }]);
    if (name === 'blog_read_graph') return Response.json({ posts: [{ id: second ? ids[2] : ids[0] }], links: [] });
    if (name === 'blog_search_public') return Response.json(second ? [{ id: ids[2], excerpt: '본문 검색' }] : []);
    if (name === 'blog_read_page') return Response.json(second ? { post: { id: ids[2], title: '새 글', category: '자유로운 이름', written_at: '2026-11-01', notion_created_at: '2026-10-01', notion_edited_at: '2026-11-01' },
      recordMap: { block: { [ids[2]]: { value: { id: ids[2], type: 'page' } } }, published_references: [] } } : null);
    return Response.json(second ? { id: ids[2] } : null);
  };
  assert.deepEqual((await publishedBooks()).map(p => p.title), ['새 글', '책']);
  assert.deepEqual((await sectionPosts('books')).map(post => post.id), [ids[0]]);
  assert.deepEqual((await sectionPosts('writing')).map(post => post.id), [ids[2]]);
  assert.ok((await getNotionPage(ids[2])).block[ids[2]]);
  assert.equal((await supabaseReadAll('blog_read_graph', {})).posts.length, 2);
  assert.equal((await supabaseReadAll('blog_search_public', {}))[0].id, ids[2]);
  assert.equal((await supabaseReadAll('blog_read_asset', { p_page: ids[2] })).id, ids[2]);
  assert.ok(seen.every(([, source]) => [database, secondary].includes(source)));
}));
test('malformed source configuration fails closed and delivery keys remain stable across retries', () => fixture(async () => {
  assert.deepEqual(blogDatabaseIds(), [database, secondary]);
  assert.equal(sourceEventId(ids[11], database), ids[11]);
  assert.equal(sourceEventId(ids[11], secondary), sourceEventId(ids[11], secondary));
  assert.notEqual(sourceEventId(ids[11], database), sourceEventId(ids[11], secondary));
  process.env.NOTION_BLOG_DATABASE_ID = database;
  assert.deepEqual(blogDatabaseIds(), [database]);
  process.env.NOTION_BLOG_DATABASE_ID = 'invalid';
  assert.throws(() => blogDatabaseIds(), /NOTION_BLOG_DATABASE_ID/);
}));

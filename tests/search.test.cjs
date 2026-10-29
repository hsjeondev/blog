const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { EventEmitter } = require('node:events');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const { normalizeFolderPath, folderPathFromProperty, folderAncestors, buildFolderTree } = require('../utils/search/folders.ts');
const { normalizePage, searchContent, inScope } = require('../utils/search/search-service.ts');
const { clientAddress, reserveUsage, agentConfigured, answerCacheKey, agentModel, missingAgentSettings, getAnswerCache, setAnswerCache } = require('../utils/agent/usage.ts');
const { createAgentTools } = require('../utils/agent/tools.ts');
const pageReader = require('../utils/get-notion-page.ts');
const publication = require('../utils/published-notion.ts');
process.env.NOTION_MYBOOKLIST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
process.env.NOTION_TOKEN = 'test-only';
const { runSearchAgent } = require('../utils/agent/search-agent.ts');
const searchHandler = require('../pages/api/search.ts').default;
const agentHandler = require('../pages/api/agent/search.ts').default;

const doc = { id: '11111111-1111-4111-8111-111111111111', title: 'KMP', type: 'document', folderPath: '개발/Web', href: '/forest?document=11111111-1111-4111-8111-111111111111', createdTime: '2026-01-01', lastEditedTime: '2026-10-17' };
function page(item, category) {
  return { object: 'page', parent: { database_id: process.env.NOTION_MYBOOKLIST_ID }, id: item.id, created_time: item.createdTime, last_edited_time: item.lastEditedTime,
    properties: { 공개: { type: 'checkbox', checkbox: true }, 이름: { type: 'title', title: [{ plain_text: item.title }] }, forest_폴더: { select: { name: item.folderPath } }, forest_분류: { select: { name: category } } } };
}
function response() {
  const result = new EventEmitter();
  Object.assign(result, { headers: {}, statusCode: 200, chunks: [], setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, write(chunk) { this.chunks.push(chunk); }, flushHeaders() { this.headersSent = true; }, end() { this.writableEnded = true; } });
  return result;
}

test('folder normalization, ancestors, root documents and same-name branches', () => {
  assert.equal(normalizeFolderPath(' / 개발 // Web / '), '개발/Web');
  assert.deepEqual(folderAncestors('개발/Web/React'), ['개발', '개발/Web', '개발/Web/React']);
  const tree = buildFolderTree([doc, { ...doc, id: 'root', folderPath: '' }, { ...doc, id: 'other', folderPath: '프로젝트/Web' }]);
  assert.equal(tree.documents[0].id, 'root');
  assert.equal(tree.folders.get('개발').folders.get('개발/Web').documents[0].id, doc.id);
  assert.equal(tree.folders.get('프로젝트').folders.get('프로젝트/Web').documents[0].id, 'other');
  assert.equal(inScope(doc, 'document', '개발'), true);
  assert.equal(inScope(doc, 'document', '개'), false);
  assert.equal(inScope(doc, 'post'), false);
});

test('normalized results retain page routes and metadata', () => {
  assert.equal(normalizePage(page(doc), 'document').href, doc.href);
  assert.equal(normalizePage(page(doc), 'recap').href, `/recap?document=${doc.id}`);
  assert.equal(normalizePage(page(doc), 'project').href, `/${doc.id}`);
  assert.equal(normalizePage({ ...page(doc), properties: {} }, 'post').folderPath, '');
  const richTextPage = page(doc);
  richTextPage.properties.forest_폴더 = { type: 'rich_text', rich_text: [{ plain_text: ' / 개발 / ' }, { text: { content: '/ Web /' } }] };
  assert.equal(normalizePage(richTextPage, 'document').folderPath, '개발/Web');
  assert.equal(folderPathFromProperty({ rich_text: [] }), '');
  assert.equal(folderPathFromProperty(undefined), '');
});

test('body search reads only the published catalog and retains title results on body failure', async () => {
  const original = global.fetch, reader = pageReader.getNotionPage;
  try {
    global.fetch = async () => Response.json({ results: [page(doc, '문서')] });
    pageReader.getNotionPage = async () => ({ block: { text: {value:{type:'text',properties:{title:[['본문 내용']]}}} } });
    const result = await searchContent('본문', 'document', '개발');
    assert.equal(result.partial, false);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].href, doc.href);
    assert.match(result.results[0].excerpt, /본문/);
    pageReader.getNotionPage = async () => { throw new Error('unavailable'); };
    assert.deepEqual((await searchContent('KMP', 'document')).results.map(item => item.id), [doc.id]);
    assert.equal((await searchContent('missing')).partial, true);
  } finally { global.fetch = original; pageReader.getNotionPage = reader; }
});

test('agent tools enforce scope, public text traversal, source membership and five-read budget', async () => {
  const original = pageReader.getNotionPage, gate = publication.getPublishedPage;
  publication.getPublishedPage = async () => ({});
  let reads = 0;
  pageReader.getNotionPage = async (id) => { reads++; return { block: {
    [id]: { value: { type: 'page', content: ['text', 'subpage'] } },
    text: { value: { type: 'text', properties: { title: [['a'.repeat(15000)]] } } },
    subpage: { value: { type: 'page', properties: { title: [['not part of document']] } } },
    unrelated: { value: { type: 'text', properties: { title: [['unrelated private text']] } } },
  } }; };
  try {
    const catalog = Array.from({ length: 6 }, (_, i) => ({ ...doc, id: `read-${i}` }));
    const access = createAgentTools(catalog, 'document', '개발', new AbortController().signal);
    assert.ok((await access.run('read_document', { pageId: 'unknown' })).error);
    assert.equal(reads, 0);
    const read = await access.run('read_document', { pageId: 'read-0' });
    assert.equal(read.text.length, 12000);
    assert.equal(read.citation, 1);
    assert.equal(read.text.includes('private'), false);
    await access.run('read_document', { pageId: 'read-0' });
    assert.equal(reads, 1);
    for (let i = 1; i < 5; i++) await access.run('read_document', { pageId: `read-${i}` });
    assert.ok((await access.run('read_document', { pageId: 'read-5' })).error);
    assert.equal(reads, 5);
    assert.equal(access.sources.size, 5);
  } finally { pageReader.getNotionPage = original; publication.getPublishedPage = gate; }
});

test('rate limiting ignores spoofed forwarding off Vercel and fails closed', async () => {
  const original = global.fetch;
  const previous = { ...process.env };
  try {
    delete process.env.VERCEL;
    const req = { headers: { 'x-forwarded-for': '1.2.3.4', 'x-vercel-forwarded-for': '5.6.7.8' }, socket: { remoteAddress: '127.0.0.1' } };
    assert.equal(clientAddress(req), '127.0.0.1');
    process.env.VERCEL = '1';
    assert.equal(clientAddress(req), '5.6.7.8');
    process.env.SEARCH_AGENT_IP_SALT = 'test-only-salt';
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.invalid';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    global.fetch = async (_url, init) => {
      const command = JSON.parse(init.body);
      assert.equal(command[0], 'EVAL');
      assert.equal(command[4].includes('5.6.7.8'), false);
      return Response.json({ result: 0 });
    };
    assert.equal(await reserveUsage(req), false);
    global.fetch = async () => { throw new Error('redis unavailable'); };
    await assert.rejects(() => reserveUsage(req));
    assert.notEqual(answerCacheKey('q', 'document', '', 'before'), answerCacheKey('q', 'document', '', 'after'));
    delete process.env.OPENAI_API_KEY;
    assert.equal(agentConfigured(), false);
  } finally { global.fetch = original; process.env = previous; }
});

test('API rejects invalid scopes, disabled agent and exhausted shared usage before paid calls', async () => {
  const previous = { ...process.env };
  const original = global.fetch;
  try {
    let res = response();
    await searchHandler({ method: 'GET', query: { q: 'x', type: 'private' } }, res);
    assert.equal(res.statusCode, 400);
    delete process.env.OPENAI_API_KEY;
    res = response();
    await agentHandler({ method: 'POST', body: { question: 'test' } }, res);
    assert.equal(res.statusCode, 503);
    Object.assign(process.env, { OPENAI_API_KEY: 'test', SEARCH_AGENT_MODEL: 'test', SEARCH_AGENT_IP_SALT: 'test', UPSTASH_REDIS_REST_URL: 'https://example.invalid', UPSTASH_REDIS_REST_TOKEN: 'test' });
    delete process.env.VERCEL;
    let requests = 0;
    global.fetch = async () => { requests++; return Response.json({ result: 0 }); };
    res = response();
    await agentHandler({ method: 'POST', body: { question: 'test' }, headers: {}, socket: { remoteAddress: '127.0.0.1' } }, res);
    assert.equal(res.statusCode, 429);
    assert.equal(requests, 1);
    assert.equal(res.headers['Retry-After'], '3600');
  } finally { global.fetch = original; process.env = previous; }
});

test('Responses function loop reads evidence then streams answer with server-owned sources', async () => {
  const originalFetch = global.fetch;
  const originalPage = pageReader.getNotionPage, gate = publication.getPublishedPage;
  publication.getPublishedPage = async () => ({});
  const previous = { ...process.env };
  const events = [];
  let rounds = 0;
  try {
    process.env.OPENAI_API_KEY = 'test-no-network'; delete process.env.SEARCH_AGENT_MODEL;
    pageReader.getNotionPage = async (id) => ({ block: { [id]: { value: { type: 'page', content: ['text'] } }, text: { value: { type: 'text', properties: { title: [['KMP shared code']] } } } } });
    global.fetch = async (url, init) => {
      if (!String(url).includes('api.openai.com')) return Response.json({ results: [page(doc, '문서')], recordMap: {} });
      const body = JSON.parse(init.body);
      assert.equal(body.store, false);
      assert.equal(body.model, "gpt-5.6-terra");
      assert.deepEqual(body.reasoning, { effort: "none" });
      if (!body.stream) {
        rounds++;
        const name = rounds === 1 ? 'search_content' : 'read_document';
        const output = rounds < 3 ? [{ type: 'function_call', id: `fc${rounds}`, call_id: `call${rounds}`, name, arguments: JSON.stringify(rounds === 1 ? { query: 'KMP' } : { pageId: doc.id }) }] : [];
        return Response.json({ id: `r${rounds}`, object: 'response', status: 'completed', output });
      }
      return new Response('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: '공유 코드를 사용합니다. [1]' }) + '\n\ndata: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed' } }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
    };
    const result = await runSearchAgent({ question: 'KMP?', scope: 'document', folder: '', catalog: [doc], signal: new AbortController().signal, emit: (event) => events.push(event) });
    assert.equal(result.answer, '공유 코드를 사용합니다. [1]');
    assert.deepEqual(result.sources.map((item) => item.href), [doc.href]);
    assert.ok(events.some(event => event.type === 'sources'));
    const progress = events.filter(event => event.type === 'progress' && event.kind === 'tool');
    assert.deepEqual(progress.map(event => event.state), ['running', 'completed', 'running', 'completed']);
    assert.equal(progress[0].label, '공개 글 검색');
    assert.equal(progress[2].label, '문서 본문 읽기');
    assert.ok(!JSON.stringify(progress).includes('KMP shared code'));
    assert.ok(events.findIndex(event => event.type === 'progress') < events.findIndex(event => event.type === 'delta'));
    assert.equal(rounds, 3);
  } finally { global.fetch = originalFetch; pageReader.getNotionPage = originalPage; publication.getPublishedPage = gate; process.env = previous; }
});

test('agent stops at eight tool calls and returns an evidence-free answer without invented sources', async () => {
  const original = global.fetch;
  const previous = { ...process.env };
  let calls = 0;
  try {
    process.env.OPENAI_API_KEY = 'test-no-network'; process.env.SEARCH_AGENT_MODEL = 'test';
    global.fetch = async (url) => {
      if (!String(url).includes('api.openai.com')) return Response.json({ results: [page(doc, '문서')], recordMap: {} });
      calls++;
      return Response.json({ id: `r${calls}`, object: 'response', status: 'completed', output: [{ type: 'function_call', id: `fc${calls}`, call_id: `call${calls}`, name: 'search_content', arguments: '{"query":"KMP"}' }] });
    };
    const result = await runSearchAgent({ question: 'KMP?', scope: 'document', folder: '', catalog: [doc], signal: new AbortController().signal, emit() {} });
    assert.equal(calls, 8);
    assert.deepEqual(result.sources, []);
    assert.match(result.answer, /근거를 찾지 못했습니다/);
  } finally { global.fetch = original; process.env = previous; }
});

test('scope switches immediately derive matching results from the same whole-search query', () => {
  const { SearchResultCache } = require('../utils/search/result-cache.ts');
  const cache = new SearchResultCache();
  const post = { ...doc, id: 'post', type: 'post' };
  cache.set('KMP', 'all', '', { results: [post, doc], partial: true }, 1000);
  assert.deepEqual(cache.get('KMP', 'document', '', 1001), { results: [doc], partial: true });
  assert.deepEqual(cache.get('KMP', 'post', '', 1001).results, [post]);
  assert.deepEqual(cache.get('KMP', 'project', '', 1001).results, []);
  assert.equal(cache.get('other-query', 'document', '', 1001), undefined);
  assert.equal(cache.get('KMP', 'document', '개발', 1001), undefined);
  const refreshed = { ...doc, title: 'Updated document' };
  cache.set('KMP', 'document', '', { results: [refreshed], partial: false }, 1002);
  assert.deepEqual(cache.get('KMP', 'document', '', 1003).results, [refreshed]);
  assert.deepEqual(cache.get('KMP', 'all', '', 1003).results, [post, doc]);
});

test('search-result cache expires, is bounded, and keeps valid empty scoped responses', () => {
  const { SearchResultCache } = require('../utils/search/result-cache.ts');
  const cache = new SearchResultCache();
  cache.set('KMP', 'all', '', { results: [doc], partial: false }, 1000);
  cache.set('KMP', 'document', '', { results: [], partial: false }, 1001);
  assert.deepEqual(cache.get('KMP', 'document', '', 1002).results, []);
  assert.equal(cache.get('KMP', 'all', '', 61000), undefined);
  for (let i = 0; i < 25; i++) cache.set(`query-${i}`, 'all', '', { results: [doc], partial: false }, 70000);
  assert.equal(cache.get('query-0', 'all', '', 70001), undefined);
  assert.equal(cache.get('query-24', 'all', '', 70001).results.length, 1);
});

function memoryAgentEnvironment() {
  Object.assign(process.env, { OPENAI_API_KEY: 'test-no-paid-calls', SEARCH_AGENT_IP_SALT: 'memory-test-salt' });
  for (const key of ['SEARCH_AGENT_MODEL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'VERCEL']) delete process.env[key];
}

test('Redis-free configuration needs only key and salt, with the requested default model', () => {
  const previous = { ...process.env };
  try {
    memoryAgentEnvironment();
    assert.equal(agentConfigured(), true);
    assert.equal(agentModel(), 'gpt-5.6-terra');
    process.env.SEARCH_AGENT_MODEL = ' custom-model ';
    assert.equal(agentModel(), 'custom-model');
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.invalid';
    assert.deepEqual(missingAgentSettings(), ['UPSTASH_REDIS_REST_TOKEN']);
    assert.equal(agentConfigured(), false);
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.SEARCH_AGENT_IP_SALT;
    assert.equal(agentConfigured(), false);
  } finally { process.env = previous; }
});

test('memory limits reserve synchronously under concurrency and reset next hour', async () => {
  const previous = { ...process.env }, clock = Date.now, originalFetch = global.fetch;
  let now = 3_600_000 * 900000;
  try {
    memoryAgentEnvironment(); Date.now = () => now;
    global.fetch = async () => { throw new Error('Redis must not be called'); };
    const req = (ip) => ({headers: {}, socket: {remoteAddress: ip}});
    const results = await Promise.all(Array.from({length: 30}, () => reserveUsage(req('127.0.0.1'))));
    assert.equal(results.filter(Boolean).length, 15);
    for (let i = 2; i <= 86; i++) assert.equal(await reserveUsage(req('127.0.0.' + i)), true);
    assert.equal(await reserveUsage(req('127.0.0.99')), false);
    now += 3_600_000;
    assert.equal(await reserveUsage(req('127.0.0.1')), true);
  } finally { process.env = previous; Date.now = clock; global.fetch = originalFetch; }
});

test('memory answer cache expires, evicts LRU and rejects oversized values', async () => {
  const previous = { ...process.env }, clock = Date.now;
  let now = 3_600_000 * 900002;
  try {
    memoryAgentEnvironment(); Date.now = () => now;
    for (let i = 0; i < 100; i++) await setAnswerCache('memory-' + i, 'answer-' + i);
    assert.equal(await getAnswerCache('memory-0'), 'answer-0');
    await setAnswerCache('memory-new', 'new');
    assert.equal(await getAnswerCache('memory-1'), null);
    assert.equal(await getAnswerCache('memory-0'), 'answer-0');
    await setAnswerCache('oversized', 'x'.repeat(65 * 1024));
    assert.equal(await getAnswerCache('oversized'), null);
    now += 600_000;
    assert.equal(await getAnswerCache('memory-0'), null);
  } finally { process.env = previous; Date.now = clock; }
});

test('Vercel API streams and caches answers with no Redis or explicit model configured', async () => {
  const previous = { ...process.env }, clock = Date.now;
  const service = require('../utils/search/search-service.ts');
  const agent = require('../utils/agent/search-agent.ts');
  const catalog = service.getSearchCatalog, run = agent.runSearchAgent;
  let calls = 0;
  try {
    memoryAgentEnvironment(); Date.now = () => 3_600_000 * 900003;
    process.env.VERCEL = '1';
    service.getSearchCatalog = async () => [];
    agent.runSearchAgent = async ({emit}) => { calls++; emit({type:'delta', text:'test answer '.repeat(8)}); return {answer:'test answer '.repeat(8), sources:[]}; };
    const req = {method:'POST', body:{question:'memory integration'}, headers:{'x-vercel-forwarded-for':'127.0.0.20'}, socket:{remoteAddress:'127.0.0.1'}};
    for (let i = 0; i < 2; i++) {
      const res = response(); await agentHandler(req, res);
      assert.equal(res.statusCode, 200);
      assert.ok(res.chunks.join('').includes('test answer'));
      assert.ok(res.chunks.join('').includes('"type":"done"'));
      if (i === 1) {
        const deltas = res.chunks.flatMap(chunk => chunk.trim().split('\n').map(line => JSON.parse(line))).filter(event => event.type === 'delta');
        assert.ok(deltas.length > 1);
        assert.ok(deltas.every(event => Array.from(event.text).length <= 24));
        assert.equal(deltas.map(event => event.text).join(''), 'test answer '.repeat(8));
      }
    }
    assert.equal(calls, 1);
  } finally { process.env = previous; Date.now = clock; service.getSearchCatalog = catalog; agent.runSearchAgent = run; }
});

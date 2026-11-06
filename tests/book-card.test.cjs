const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const context = React.createContext({ setTitle() {}, setPostId() {} });
const file = path.resolve(__dirname, '../components/ArticleCard.js');
const compiled = new Module(file, module);
compiled.filename = file;
compiled.paths = Module._nodeModulePaths(path.dirname(file));
const load = Module._load;
try {
  Module._load = function(request, ...args) { return request === '../pages/_app' ? { currentPostContext: context } : load.call(this, request, ...args); };
  compiled._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: 'ArticleCard.jsx', compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, file);
} finally { Module._load = load; }
const { ArticleCard } = compiled.exports;
const post = { id: 'book', title: '책', category: '독서', tags: [], date: '2026-11-01', icon: { type: 'emoji', emoji: '📚' }, cardCover: '/api/blog-media/book/cover' };
const render = data => renderToStaticMarkup(React.createElement(ArticleCard, { post: data }));
test('only book-source cards replace their icon with the stored book cover', () => {
  const books = render({ ...post, source: 'books' });
  assert.match(books, /class="article-card-book-cover"/);
  assert.ok(!books.includes('📚'));
  const writing = render({ ...post, source: 'writing' });
  assert.ok(!writing.includes('article-card-book-cover'));
  assert.ok(writing.includes('📚'));
});
test('books without stored covers retain their existing icon', () => {
  const html = render({ ...post, source: 'books', cardCover: null });
  assert.ok(!html.includes('article-card-book-cover'));
  assert.ok(html.includes('📚'));
});

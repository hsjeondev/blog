const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Exercise the actual text-block branch without loading unrelated PDF/embed renderers.
const filename = 'packages/notionx/block.tsx';
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let branch;
function visit(node) {
  if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === 'text') branch = node.statements[0];
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(branch);
const body = ts.createPrinter().printNode(ts.EmitHint.Unspecified, branch, source);
const code = ts.transpileModule(`function renderParagraph(block, children) { const blockId = 'paragraph'; ${body} }`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }, fileName: 'paragraph.tsx',
}).outputText;
const Text = ({ value }) => value.map(part => part[0]);
const render = new Function('require', 'exports', 'Text', 'cs', code + '\nreturn renderParagraph;')(require, {}, Text, (...values) => values.filter(Boolean).join(' '));
const html = (block, children) => renderToStaticMarkup(render({ type: 'text', ...block }, children));

test('empty official API paragraphs retain a full text line, including consecutive blank blocks', () => {
  const blocks = [{}, { properties: {} }, { properties: { title: [] } }, { properties: { title: [['']] } }];
  for (const block of blocks) {
    const result = html(block);
    assert.match(result, /class="notion-text notion-blank paragraph"/);
    assert.ok(result.includes('\u00a0'));
    assert.match(result, /aria-hidden="true"/);
  }
  const consecutive = renderToStaticMarkup(React.createElement(React.Fragment, null,
    ...blocks.map((block, index) => React.cloneElement(render(block), { key: index }))));
  assert.equal((consecutive.match(/notion-blank/g) || []).length, blocks.length);
});

test('soft breaks and whitespace are preserved and child paragraphs remain visible', () => {
  const result = html({ properties: { title: [['첫 줄\n둘째 줄\n셋째 줄']] } });
  assert.ok(result.includes('첫 줄\n둘째 줄\n셋째 줄'));
  assert.ok(!result.includes('notion-blank'));
  assert.ok(!html({ properties: { title: [['  ']] } }).includes('notion-blank'));
  const nested = html({ properties: { title: [] }, content: ['child'] }, React.createElement('span', null, '자식 문단'));
  assert.match(nested, /자식 문단/);
  assert.ok(!nested.includes('aria-hidden'));
  assert.match(html({ properties: { title: [] }, format: { block_color: 'orange_background' } }), /notion-orange_background/);
});

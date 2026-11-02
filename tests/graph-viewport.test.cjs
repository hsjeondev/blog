const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { fitGraphBounds } = require('../utils/graph-viewport.ts');

test('all graph and label bounds fit on phones and desktop, leaving space for the reset button', () => {
  const examples = [
    { x: -540, y: -280, width: 980, height: 700 },
    { x: 900, y: -1200, width: 2400, height: 1800 },
    { x: 80, y: 150, width: 165, height: 28 },
  ];
  for (const [width, height] of [[320, 300], [390, 300], [1100, 360]]) {
    for (const bounds of examples) {
      const fit = fitGraphBounds(bounds, width, height);
      const left = bounds.x * fit.k + fit.x;
      const top = bounds.y * fit.k + fit.y;
      assert.ok(fit.k > 0 && fit.k <= 1);
      assert.ok(left >= 24 - 1e-6);
      assert.ok(top >= 24 - 1e-6);
      assert.ok(left + bounds.width * fit.k <= width - 24 + 1e-6);
      assert.ok(top + bounds.height * fit.k <= height - 76 + 1e-6);
    }
  }
});

test('reset recenters a moved layout without enlarging a small graph', () => {
  const bounds = { x: 80, y: 150, width: 165, height: 28 };
  const original = fitGraphBounds(bounds, 390, 300);
  const moved = { ...bounds, x: bounds.x + 5000, y: bounds.y - 3000 };
  const reset = fitGraphBounds(moved, 390, 300);
  assert.equal(original.k, 1);
  assert.equal(reset.k, original.k);
  assert.ok(Math.abs(bounds.x * original.k + original.x - (moved.x * reset.k + reset.x)) < 1e-6);
  assert.ok(Math.abs(bounds.y * original.k + original.y - (moved.y * reset.k + reset.y)) < 1e-6);
});

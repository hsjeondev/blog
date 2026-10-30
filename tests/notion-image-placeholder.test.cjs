const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { notionImageLayout, notionImageThumbnail } = require('../utils/notion-image-placeholder.ts');

test('image geometry is available before load and prefers intrinsic preview dimensions over display dimensions', () => {
  assert.deepEqual(notionImageLayout({block_width:600,block_height:300}, {originalWidth:800,originalHeight:1200}), {width:800,height:1200});
  assert.deepEqual(notionImageLayout({block_aspect_ratio:1.5}), {width:1,height:1.5});
  assert.deepEqual(notionImageLayout({block_width:640,block_height:480}), {width:640,height:480});
  for (const format of [undefined, {}, {block_aspect_ratio:0}, {block_aspect_ratio:NaN}, {block_width:0,block_height:400}]) {
    assert.deepEqual(notionImageLayout(format), {width:16,height:9});
  }
});

test('thumbnails use direct image services and never route stored media through Notion',()=>{
  assert.equal(new URL(notionImageThumbnail('https://images.unsplash.com/photo?fit=crop','id')).searchParams.get('w'),'64');
  for(const src of ['/api/blog-media/id/hash','https://www.notion.so/image/example','https://example.com/image.png','data:image/png;base64,AAA','javascript:alert(1)','invalid'])assert.equal(notionImageThumbnail(src,'id'),undefined);
});

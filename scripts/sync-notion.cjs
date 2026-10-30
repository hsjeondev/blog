const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require('@next/env').loadEnvConfig(path.resolve(__dirname, '..'));
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);

const { syncPublishedNotion, syncNotionPage } = require('../utils/sync/notion-sync.ts');
const { createSyncStore } = require('../utils/sync/supabase-store.ts');
const args = process.argv.slice(2);
let management = false, pageId;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--management') management = true;
  else if (args[index] === '--page' && !pageId && args[index + 1] && !args[index + 1].startsWith('--')) pageId = args[++index];
  else {
    console.error('Usage: npm run sync:notion -- [--management] [--page PAGE_ID]');
    process.exit(1);
  }
}
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());

// Pace only this CLI's Notion requests; website requests are unaffected.
const originalFetch = global.fetch;
let gate = Promise.resolve(), last = 0;
global.fetch = async (url, options = {}) => {
  if (new URL(url).hostname === 'api.notion.com') {
    const pending = gate.then(async () => {
      options.signal?.throwIfAborted();
      const pause = Math.max(0, 400 - (Date.now() - last));
      if (pause) await new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(options.signal.reason); };
        const timer = setTimeout(() => { options.signal?.removeEventListener('abort', abort); resolve(); }, pause);
        options.signal?.addEventListener('abort', abort, { once: true });
      });
      options.signal?.throwIfAborted();
      last = Date.now();
    });
    gate = pending.catch(() => {});
    await pending;
  }
  return originalFetch(url, options);
};

(async () => {
  const store = createSyncStore(management);
  const progress = value => console.log(JSON.stringify(value));
  const result = pageId ? await syncNotionPage(store, pageId, controller.signal, progress)
    : await syncPublishedNotion(store, controller.signal, progress);
  console.log(JSON.stringify({ phase: 'complete', ...result }));
})().catch(error => {
  console.error(JSON.stringify({ phase: 'failed', error: error.name, status: error.status, code: error.code }));
  process.exitCode = 1;
}).finally(() => { global.fetch = originalFetch; });

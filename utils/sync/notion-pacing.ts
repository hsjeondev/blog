import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage<{ next: number; gate: Promise<void> }>();
export function withNotionPacing<T>(work: () => Promise<T>) {
  return context.run({ next: 0, gate: Promise.resolve() }, work);
}
export function paceNotionRequest(signal?: AbortSignal) {
  const state = context.getStore();
  if (!state) return;
  const run = state.gate.then(async () => {
    signal?.throwIfAborted();
    const ms = Math.max(0, state.next - Date.now());
    if (ms) await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal?.reason); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
      signal?.addEventListener('abort', abort, { once: true });
    });
    signal?.throwIfAborted();
    state.next = Date.now() + 400;
  });
  state.gate = run.catch(() => {});
  return run;
}

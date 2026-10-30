function waitForRetry(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function fetchNotionJson(url: string, options: RequestInit, wait = waitForRetry) {
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    const response = await fetch(url, options);
    const data = await response.json().catch(() => null);
    if (response.ok) return data;
    const error = Object.assign(new Error(data?.message || `Notion request failed (${response.status})`), { status: response.status, code: data?.code });
    if (![429, 529].includes(response.status) || attempt >= 2) throw error;
    const header = response.headers.get('retry-after');
    const seconds = header === null ? NaN : Number(header);
    const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 1000 * 2 ** attempt;
    // A long cooldown should fail this request, allowing a later ISR retry.
    if (delay > 30_000) throw error;
    await wait(delay + Math.floor(Math.random() * 250), options.signal);
  }
}

import { useEffect, useRef, useState } from 'react';

const CACHE_NAME = 'blog-book-covers-v1';
const MAX_COVERS = 60;
const MAX_COVER_BYTES = 2 * 1024 * 1024;

async function rememberCover(cache, key, blob) {
  if (!cache || blob.size > MAX_COVER_BYTES) return;
  await cache.put(key, new Response(blob, { headers: { 'Content-Type': blob.type } }));
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_COVERS)).map(entry => cache.delete(entry)));
}

// The uncached public catalog supplies the revision. Never use a saved catalog
// to decide which covers are eligible for reuse, or store private post content.
export default function useBookCover(url, revision, priority) {
  const imageRef = useRef(null);
  const [image, setImage] = useState(null);
  const identity = `${url || ''}:${revision || ''}`;

  useEffect(() => {
    if (!url) return;
    let active = true, objectUrl, observer;
    const controller = new AbortController();
    const reveal = (blob, cached) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setImage({ identity, src: objectUrl, cached });
    };
    const load = async () => {
      let cache, key;
      if (revision && /^\/api\/blog-media\/[a-f0-9-]{36}\/[a-f0-9]{64}$/.test(url)) {
        try {
          cache = await caches.open(CACHE_NAME);
          key = new URL(url, window.location.origin);
          key.searchParams.set('revision', revision);
          const saved = await cache.match(key.href);
          if (saved) { reveal(await saved.blob(), true); return; }
        } catch { /* Storage may be unavailable or full; image loading still works. */ }
      }
      if (!active) return;
      // Only cache misses below the initial six wait until near the viewport.
      if (!priority && imageRef.current && 'IntersectionObserver' in window) {
        await new Promise(resolve => {
          observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); resolve(); }
          }, { rootMargin: '300px' });
          observer.observe(imageRef.current);
          controller.signal.addEventListener('abort', resolve, { once: true });
        });
      }
      if (!active) return;
      const response = await fetch(url, { signal: controller.signal, priority: priority ? 'high' : 'low' });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Cover unavailable');
      const blob = await response.blob();
      reveal(blob, false);
      // Persist after displaying; disk writes must not delay the first view.
      if (active && key) rememberCover(cache, key.href, blob).catch(() => {});
    };
    load().catch(() => {
      if (active) setImage({ identity, src: url, cached: false });
    });
    return () => {
      active = false;
      controller.abort();
      observer?.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, revision, priority, identity]);

  const current = image?.identity === identity ? image : null;
  return { imageRef, src: current?.src, cached: current?.cached || false };
}

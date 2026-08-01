// grok-remote service worker.
//
// Caching strategy (craft desk — avoid stale shells):
//   - HTML / navigations / sw.js: network-first (never serve a shell that
//     points at deleted hashed assets).
//   - /api/*: network-only, never cached.
//   - /assets/* (content-hashed): cache-first with revalidation.
//   - other static: stale-while-revalidate after a network attempt.

const CACHE = 'gr-shell-v3';
const SHELL_URLS = ['/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isHtmlPath(pathname) {
  return pathname === '/' || pathname === '/index.html' || pathname.endsWith('.html');
}

function isHashedAsset(pathname) {
  // Vite content-hashed bundles: /assets/index-XXXX.js
  return pathname.startsWith('/assets/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Live API — never cache.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req));
    return;
  }

  // Always take the network for the service worker script itself.
  if (url.pathname === '/sw.js') {
    event.respondWith(
      fetch(req).then((resp) => {
        return resp;
      })
    );
    return;
  }

  // Navigations + HTML: network-first so index always matches current dist hashes.
  if (req.mode === 'navigate' || isHtmlPath(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200 && resp.type === 'basic') {
            const copy = resp.clone();
            caches.open(CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          }
          return resp;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match('/index.html')) ||
            (await cache.match(req)) ||
            new Response('offline', { status: 504, statusText: 'offline' })
          );
        })
    );
    return;
  }

  // Content-hashed assets: cache-first (safe — hash changes bust the key).
  if (isHashedAsset(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const resp = await fetch(req);
        if (resp && resp.status === 200 && resp.type === 'basic') {
          cache.put(req, resp.clone()).catch(() => {});
        }
        return resp;
      })
    );
    return;
  }

  // Fonts / icons / misc: stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200 && resp.type === 'basic') {
            cache.put(req, resp.clone()).catch(() => {});
          }
          return resp;
        })
        .catch(() => null);

      if (cached) {
        networkFetch.catch(() => {});
        return cached;
      }
      const fresh = await networkFetch;
      if (fresh) return fresh;
      return new Response('', { status: 504, statusText: 'offline' });
    })
  );
});

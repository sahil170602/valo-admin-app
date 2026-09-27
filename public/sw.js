const CACHE_NAME = 'valo-admin-pwa-v10';
const RUNTIME_CACHE = 'valo-admin-runtime-v10';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/logo.png'
];

const isSameOrigin = (request) => {
  try { return new URL(request.url).origin === self.location.origin; }
  catch (_) { return false; }
};

const cacheResponse = async (request, response) => {
  if (!response || !response.ok) return response;
  try {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
  } catch (_) {}
  return response;
};

const precacheBuildAssets = async (cache) => {
  try {
    const htmlResponse = await fetch('/index.html', { cache: 'no-store' });
    if (!htmlResponse.ok) return;
    await cache.put('/index.html', htmlResponse.clone());

    const html = await htmlResponse.text();
    const assets = new Set(STATIC_ASSETS);
    const matches = html.matchAll(/(?:src|href)=["']([^"']+)["']/gi);
    for (const match of matches) {
      const raw = match[1];
      if (!raw || raw.startsWith('http') || raw.startsWith('//')) continue;
      if (/\.(js|css|png|jpg|jpeg|webp|svg|woff2?|ttf|ico)(\?.*)?$/i.test(raw)) {
        assets.add(raw.startsWith('/') ? raw : `/${raw.replace(/^\.\//, '')}`);
      }
    }

    for (const asset of assets) {
      try {
        const response = await fetch(asset, { cache: 'no-store' });
        if (response.ok) await cache.put(asset, response.clone());
      } catch (_) {}
    }
  } catch (_) {}
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    for (const asset of STATIC_ASSETS) {
      try {
        const response = await fetch(asset, { cache: 'no-store' });
        if (response.ok) await cache.put(asset, response.clone());
      } catch (_) {}
    }
    await precacheBuildAssets(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => ![RUNTIME_CACHE].includes(key)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'VALO_REFRESH_CACHE') {
    event.waitUntil((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      await precacheBuildAssets(cache);
    })());
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!isSameOrigin(event.request)) return;

  const request = event.request;
  const url = new URL(request.url);

  // Navigation: network first, then cached app shell.
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          await cache.put('/index.html', response.clone());
          // Refresh the current build's hashed assets whenever online.
          precacheBuildAssets(cache).catch(() => {});
        }
        return response;
      } catch (_) {
        return (await caches.match(request)) || (await caches.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  // Static assets: cache first, then update cache from network.
  if (/\.(js|css|png|jpg|jpeg|webp|svg|woff2?|ttf|ico|webmanifest)$/i.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) {
        fetch(request).then(response => cacheResponse(request, response)).catch(() => {});
        return cached;
      }
      try {
        const response = await fetch(request);
        return cacheResponse(request, response);
      } catch (_) {
        return Response.error();
      }
    })());
    return;
  }

  // Other same-origin GET requests use network first with runtime fallback.
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      return cacheResponse(request, response);
    } catch (_) {
      return (await caches.match(request)) || Response.error();
    }
  })());
});

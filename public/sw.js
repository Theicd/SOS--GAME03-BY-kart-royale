// Page shell (index.html, manifest, sw.js): network first, so a new deploy is
// seen on the next visit; cached copy when offline.
// Hashed build assets, music and icons: cache first. Assets are content-hashed
// so they never change under the same name; music and icons only change if
// CACHE is bumped. Returning players load the game without re-requesting it.
const CACHE = 'kart-v2';
const STATIC = /\/(assets|music|icons)\//;

// The worker registers after the page has loaded, so the first visit's build
// files went past it; fetch them again here (the HTTP cache usually has them).
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil((async () => {
    try {
      const res = await fetch('./');
      if (!res.ok) return;
      const html = await res.text();
      const urls = [...html.matchAll(/(?:src|href)="([^"]*\/(?:assets|icons)\/[^"]+)"/g)].map((m) => m[1]);
      const cache = await caches.open(CACHE);
      await Promise.all(urls.map((u) => cache.match(new URL(u, self.location).href).then((hit) => hit || cache.add(u)).catch(() => {})));
    } catch { /* offline install: runtime caching fills in */ }
  })());
});
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (STATIC.test(url.pathname)) e.respondWith(cacheFirst(req, url));
  else e.respondWith(networkFirst(req));
});

async function cacheFirst(req, url) {
  const cache = await caches.open(CACHE);
  const key = url.origin + url.pathname;
  const hit = await cache.match(key);
  const range = req.headers.get('range');
  if (hit) return range ? slice(hit, range) : hit;
  if (range) {
    // <audio> asks for byte ranges; store the whole file once in the background
    // and let this request go to the network as-is.
    fetch(key).then((res) => { if (res.ok && res.status === 200) cache.put(key, res); }).catch(() => {});
    return fetch(req);
  }
  const res = await fetch(req);
  if (res.ok && res.status === 200) cache.put(key, res.clone()).catch(() => {});
  return res;
}

async function slice(res, range) {
  const buf = await res.clone().arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const size = buf.byteLength;
  let start = m && m[1] ? Number(m[1]) : 0;
  let end = m && m[2] ? Number(m[2]) : size - 1;
  if (m && !m[1] && m[2]) { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  end = Math.min(end, size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.status === 200) {
      cache.put(req, res.clone()).catch(() => {});
      if (req.mode === 'navigate') res.clone().text().then((html) => prune(cache, html)).catch(() => {});
    }
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    return hit || Response.error();
  }
}

// Drop build assets the current page no longer references, so old deploys do
// not pile up in storage.
async function prune(cache, html) {
  for (const req of await cache.keys()) {
    const p = new URL(req.url).pathname;
    if (p.includes('/assets/') && !html.includes(p.slice(p.lastIndexOf('/assets/') + 1))) await cache.delete(req);
  }
}

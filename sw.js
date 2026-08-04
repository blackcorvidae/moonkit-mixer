const CACHE = 'moonkit-v8';

self.addEventListener('install', e => {
  const scope = self.registration.scope;
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll([
      scope,
      scope + 'manifest.json',
      scope + 'sw.js',
      scope + 'icon.svg',
      scope + 'icon-maskable.svg',
      scope + 'styles.css',
      scope + 'js/main.js',
    ]).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Only handle GET requests for same-origin or Google Fonts
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && (e.request.url.startsWith(self.registration.scope) || e.request.url.includes('fonts.googleapis') || e.request.url.includes('fonts.gstatic'))) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(scope));
    })
  );
});

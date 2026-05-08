const CACHE_NAME = 'gurragym-v4';
const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    const requestUrl = new URL(e.request.url);
    const isSameOrigin = requestUrl.origin === self.location.origin;
    const isNavigation = e.request.mode === 'navigate';

    // Keep HTML fresh so new deployments are picked up.
    if (isNavigation) {
        e.respondWith(
            fetch(e.request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
                    return response;
                })
                .catch(() => caches.match(e.request).then((cached) => cached || caches.match('./index.html')))
        );
        return;
    }

    if (!isSameOrigin) return;

    // Stale-while-revalidate for app assets.
    e.respondWith(
        caches.match(e.request).then((cached) => {
            const fetched = fetch(e.request)
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
                    }
                    return response;
                })
                .catch(() => cached);
            return cached || fetched;
        })
    );
});

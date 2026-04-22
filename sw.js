const CACHE = 'contec-challenge-v42';
const ASSETS = [
  '/CONTEC-Plus/logo_premium_transparent.png',
  '/CONTEC-Plus/og-image.jpg',
  '/CONTEC-Plus/manifest.json',
  '/CONTEC-Plus/icon-192.png',
  '/CONTEC-Plus/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // index.html은 항상 네트워크에서 최신본 사용 (캐시 안함)
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('/CONTEC-Plus/') || url.pathname.endsWith('/CONTEC-Plus')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // 이미지·아이콘 등 정적 파일만 캐시
  e.respondWith(
    fetch(e.request)
      .then(r => {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

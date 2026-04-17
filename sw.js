const CACHE = 'contec-challenge-v40';
const ASSETS = [
  '/CONTEC-Plus/',
  '/CONTEC-Plus/index.html',
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

// 네트워크 우선, 실패 시 캐시
self.addEventListener('fetch', e => {
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

// 페이지에서 캐시 강제 삭제 메시지 수신
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

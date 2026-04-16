const CACHE = 'contec-challenge-v27';
const ASSETS = ['/pdeometer/','/pdeometer/index.html','/pdeometer/logo.png','/pdeometer/manifest.json','/pdeometer/icon-192.png','/pdeometer/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting()) // 즉시 대기 건너뛰고 활성화
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()) // 열린 탭 즉시 제어권 획득
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

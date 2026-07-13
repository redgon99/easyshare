const CACHE = 'easyshare-v10';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './shared.js',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC_ASSETS))
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
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Supabase API / 리얼타임 / CDN — 네트워크 우선
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('jsdelivr.net')
  ) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // 같은 출처 앱 셸 — 네트워크 우선(캐시는 백업). 구 CSS+신 HTML 불일치로 레이아웃 깨짐 방지
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  }
});

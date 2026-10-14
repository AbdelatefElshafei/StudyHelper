/* العدّاد — Service Worker: يخلي التطبيق يشتغل أوفلاين بالكامل */
const VERSION = 'addad-v1.1.0';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/syllabus.js',
  './js/planner.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ملفات التطبيق نفسها: من الكاش فوراً، وتحديث في الخلفية (stale-while-revalidate)
  // كده التطبيق بيفتح لحظياً وأوفلاين، وأي تحديث مرفوع بيوصل في الفتحة اللي بعدها.
  if (url.origin === location.origin) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(req, { ignoreSearch: true });
        const net = fetch(req).then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => hit || (req.mode === 'navigate' ? cache.match('./index.html') : undefined));
        return hit || net;
      })
    );
    return;
  }

  // الخطوط وأي ملفات خارجية: stale-while-revalidate
  event.respondWith(
    caches.open(VERSION + '-ext').then(async (cache) => {
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

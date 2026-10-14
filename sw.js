/* العدّاد — Service Worker: يخلي التطبيق يشتغل أوفلاين بالكامل */
const VERSION = 'addad-v1.1.1';
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
    caches.open(VERSION).then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())
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

  // ملفات التطبيق نفسها: الشبكة أولاً (عشان كل الملفات تبقى من نفس النسخة)،
  // ولو مفيش نت يرجع للكاش فيشتغل أوفلاين.
  if (url.origin === location.origin) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' }).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(async () => {
        const cache = await caches.open(VERSION);
        return (await cache.match(req, { ignoreSearch: true })) ||
          (req.mode === 'navigate' ? cache.match('./index.html') : undefined);
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

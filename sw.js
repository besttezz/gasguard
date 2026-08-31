/* GasGuard Service Worker — offline shell + runtime cache */
const VERSION = 'gasguard-v2.1.0';
const CORE = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/store.js',
  './js/auth.js',
  './js/db.js',
  './js/sources.js',
  './js/alerts.js',
  './js/charts.js',
  './js/ui.js',
  './js/app.js',
  './manifest.webmanifest',
  './vendor/chart.umd.min.js',
  './vendor/supabase.min.js',
  './vendor/fa/css/all.min.css',
  './vendor/fa/webfonts/fa-solid-900.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(CORE).catch(err => console.warn('[SW] precache บางไฟล์ไม่สำเร็จ', err)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ข้อมูลสด (API ของผู้ใช้) ไม่แคช
  if (url.pathname.includes('/api/') || url.searchParams.has('nocache')) return;

  // ไฟล์ของเว็บ: cache-first แล้วอัปเดตเบื้องหลัง
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then(hit => {
        const fetchPromise = fetch(req).then(res => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(VERSION).then(c => c.put(req, copy));
          }
          return res;
        }).catch(() => hit);
        return hit || fetchPromise;
      })
    );
    return;
  }

  // CDN (fonts, chart.js, font awesome): stale-while-revalidate
  e.respondWith(
    caches.open(VERSION + '-cdn').then(cache =>
      cache.match(req).then(hit => {
        const net = fetch(req).then(res => {
          if (res && (res.status === 200 || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    )
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html#alerts');
    })
  );
});

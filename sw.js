/* ============================================================
   Pawdy Workspace — Service Worker
   หน้าที่: ทำให้ติดตั้งเป็นแอปได้ + เปิดดูของเดิมได้ตอนเน็ตหลุด

   กลยุทธ์:
   - หน้าเว็บ (navigate) → เอาของใหม่จากเน็ตก่อนเสมอ ถ้าเน็ตล่มค่อยใช้ของใน cache
     (สำคัญมาก เพราะแอปเป็นไฟล์เดียว ถ้า cache-first จะค้างเวอร์ชันเก่าตลอด)
   - ไฟล์ static ของเราเอง → ใช้ของใน cache ก่อน แล้วแอบอัปเดตเบื้องหลัง
   - Supabase / CDN / อะไรที่ไม่ใช่ origin เรา → ไม่ยุ่งเลย ปล่อยผ่าน
   ============================================================ */

const VERSION = 'pawdy-v1';
const SHELL = [
  './',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // ข้ามทุกอย่างที่ไม่ใช่โดเมนเรา — Supabase realtime/REST ห้ามแตะเด็ดขาด
  if (url.origin !== self.location.origin) return;

  // หน้าเว็บ: เน็ตก่อน แล้วค่อย cache
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./').then((r) => r || caches.match(req)))
    );
    return;
  }

  // ไฟล์อื่นในโดเมนเรา: cache ก่อน แล้วอัปเดตเงียบๆ
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

/* ---------- Web Push ---------- */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Pawdy Workspace', body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'Pawdy Workspace';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: d.tag || 'pawdy',
    data: { url: d.url || './' },
    // iOS ต้องมี body ที่มองเห็นได้เสมอ ไม่งั้นระบบจะถอนสิทธิ์ push ทิ้ง
    requireInteraction: false
  }));
});

// subscription หมดอายุเอง เบราว์เซอร์จะยิง event นี้มา ต้องต่อใหม่
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true })
      .then((list) => list.forEach((c) => c.postMessage({ type: 'resubscribe-push' })))
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      const url = (e.notification.data && e.notification.data.url) || './';
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

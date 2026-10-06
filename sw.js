// Service worker Bel Sekolah. Naikkan nomor VERSION setiap kali Anda mengubah file aplikasi.
const VERSION = 'belsperopa-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'ikonpwabelsperopa.jpg'];
const CDN_HOSTS = ['cdn.tailwindcss.com', 'www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'raw.githubusercontent.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Data Firebase (database, login) TIDAK pernah di-cache atau dicegat.
  if (!url.protocol.startsWith('http')) return;
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CDN_HOSTS.includes(url.hostname)) return;

  if (sameOrigin) {
    // File aplikasi: ambil dari jaringan dulu (selalu versi terbaru), cache hanya cadangan saat offline.
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
  } else {
    // Library/font CDN (versi dipatok): cache dulu, perbarui di belakang layar.
    e.respondWith(caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    }));
  }
});

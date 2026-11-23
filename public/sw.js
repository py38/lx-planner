// Service worker : permet d'ouvrir l'application hors connexion (les données, elles, sont dans IndexedDB).
const CACHE = 'lx-planner-v2';
const BASE = new URL('./', self.location).pathname; // ex : /lx-planner/

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([BASE, BASE + 'index.html', BASE + 'manifest.webmanifest', BASE + 'icon.svg'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, CDN : jamais mis en cache ici
  if (req.mode === 'navigate') {
    // réseau d'abord pour avoir la dernière version, cache en secours hors ligne
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(BASE + 'index.html', copy));
        return res;
      }).catch(() => caches.match(BASE + 'index.html')),
    );
    return;
  }
  // fichiers statiques versionnés : cache d'abord
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && (url.pathname.startsWith(BASE + 'assets/') || url.pathname.endsWith('.png') || url.pathname.endsWith('.svg'))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow(BASE))));
});

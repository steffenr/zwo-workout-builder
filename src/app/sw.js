// Service worker for the Zwo Workout Builder.
// The app itself is one self-contained HTML file (engine data included), so the
// worker only adds the offline part: it caches the app page and the PWA assets,
// all resolved relative to the worker's own URL so it works on any sub-path
// (GitHub Pages serves the app below /zwo-workout-builder/).
//
// Navigations are network-first with a cache fallback, so a new release reaches
// the user as soon as the page revalidates, but the app keeps working without
// a connection.
const CACHE = 'zwo-workout-builder-v1';
// The app page ('.' = the directory the worker lives in), the worker itself,
// the manifest and the icons — all siblings of the worker script.
const APP_SHELL = ['.', 'sw.js', 'manifest.webmanifest', '192.png', '512.png', '1024.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(APP_SHELL.map((u) => new URL(u, self.location.href))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

// The cached copy of the app page, as installed (the directory index).
const APP_PAGE = new URL('.', self.location.href);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // Fresh page first so new releases reach users; offline, fall back to the
    // cached copy of the page (or of the app itself).
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match(APP_PAGE)) || Response.error())
    );
    return;
  }
  // The PWA assets are cached at install time; cache-first.
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});

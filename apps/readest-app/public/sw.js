// Kill-switch service worker.
//
// The app no longer ships a PWA service worker: @serwist/next only runs under
// webpack, but the web build uses Next's default Turbopack, so serwist silently
// generates nothing. Older deploys DID register a serwist SW whose CacheFirst
// font rule froze /fonts/*.woff2 at stale/broken entries (an app-shell HTML
// fallback got cached before the font file existed), so self-hosted fonts never
// loaded no matter how many times the page was refreshed.
//
// This replacement, served as valid JS at /sw.js, is picked up by the browser's
// periodic service-worker update check. On activation it deletes every cache
// and then unregisters itself, so any device still running the old worker heals
// on its next visit — no manual "clear site data" required. Devices without a
// service worker never fetch this and are unaffected.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch {
        // Best-effort purge; unregister regardless so the worker can't linger.
      }
      await self.registration.unregister();
      // Reload open tabs so they drop out from under the (now removed) worker
      // and refetch everything fresh over the network.
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.navigate(client.url);
      }
    })(),
  );
});

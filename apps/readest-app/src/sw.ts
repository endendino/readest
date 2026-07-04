import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkFirst, CacheFirst, StaleWhileRevalidate, ExpirationPlugin, Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  disableDevLogs: true,
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher({ request }) {
          return request.destination === 'document';
        },
      },
    ],
  },
  runtimeCaching: [
    {
      matcher: ({ url, request }) => {
        const clientRoutes = ['/library', '/reader'];
        const isClientRoute = clientRoutes.some((route) => url.pathname.startsWith(route));
        return isClientRoute && request.mode === 'navigate';
      },
      handler: new NetworkFirst({
        cacheName: 'client-pages',
        networkTimeoutSeconds: 3,
        matchOptions: {
          ignoreSearch: true,
        },
        plugins: [
          new ExpirationPlugin({
            maxEntries: 128,
            maxAgeSeconds: 365 * 24 * 60 * 60,
          }),
          {
            cacheKeyWillBeUsed: async ({ request }) => {
              const url = new URL(request.url);
              const basePath = url.pathname.split('/')[1];
              const cacheKey = `${url.origin}/${basePath}`;
              return cacheKey;
            },
          },
        ],
      }),
    },
    // Self-hosted fonts (/fonts/*.woff2): served at STABLE, unversioned URLs, so
    // CacheFirst would freeze whatever got cached first — including an app-shell
    // HTML fallback cached before the file existed — for the 2-year TTL, and the
    // real font would never load. StaleWhileRevalidate serves fast but refreshes
    // in the background so a redeployed/added font self-heals on the next load.
    // The cache name is deliberately new so any poisoned legacy `fonts-cache`
    // entry is abandoned and the correct file is fetched fresh.
    {
      matcher: ({ url, request }) => {
        const isSameOrigin = url.origin === self.location.origin;
        const isFontFile = /\.(woff2?|ttf|otf|eot|svg)(\?.*)?$/i.test(url.pathname);
        return isSameOrigin && (isFontFile || request.destination === 'font');
      },
      handler: new StaleWhileRevalidate({
        cacheName: 'fonts-cache-local-v2',
        plugins: [
          new ExpirationPlugin({
            maxEntries: 64,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days — deploys refresh sooner
            purgeOnQuotaError: true,
          }),
        ],
      }),
    },
    // External font CDNs: immutable, versioned URLs — CacheFirst is correct here.
    {
      matcher: ({ url }) => {
        const fontCDNs = [
          'fonts.googleapis.com',
          'fonts.gstatic.com',
          'cdn.jsdelivr.net',
          'cdnjs.cloudflare.com',
          'ik.imagekit.io',
          'db.onlinewebfonts.com',
        ];
        return fontCDNs.includes(url.hostname);
      },
      handler: new CacheFirst({
        cacheName: 'fonts-cache',
        plugins: [
          new ExpirationPlugin({
            maxEntries: 200, // More entries for various font files
            maxAgeSeconds: 365 * 24 * 60 * 60 * 2, // 2 years - fonts rarely change
            purgeOnQuotaError: true, // Automatically purge if storage quota exceeded
          }),
        ],
      }),
    },
    // Other external resources
    {
      matcher: ({ url }) => {
        if (url.pathname.startsWith('/api/')) {
          return false;
        }
        return /^https?.*/.test(url.href);
      },
      handler: new NetworkFirst({
        cacheName: 'offline-cache',
        networkTimeoutSeconds: 3,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 512,
            maxAgeSeconds: 365 * 24 * 60 * 60,
          }),
        ],
      }),
    },
  ],
});

serwist.addEventListeners();

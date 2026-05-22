/**
 * Counsel.day · Service Worker
 *
 * Responsibilities:
 *   1. Cache the offline shell so the brand still renders when the
 *      network is gone (offline.html + the core fonts + ga4.js are
 *      all that's worth caching · everything else is per-user).
 *   2. Receive Web Push messages and show notifications.
 *   3. Route notification clicks to the right page (vote-today,
 *      decision detail, verdict reveal, etc.).
 *
 * Versioning: bump CACHE_VERSION any time the shell changes; old
 * caches are cleaned in the activate step.
 *
 * Push payload contract (sent by the backend, JSON-stringified):
 *   {
 *     "title":    "Tonight's vote is ready",
 *     "body":     "Decide slowly. One tap, one sentence.",
 *     "url":      "/vote-today.html",
 *     "tag":      "vote-today-<decision-id>",   // collapses duplicates
 *     "badge":    "/icon-192.png",
 *     "icon":     "/icon-192.png",
 *     "renotify": false
 *   }
 *
 * The URL is always same-origin · we hard-strip absolute URLs to
 * prevent open-redirect via a malicious payload (push payloads are
 * encrypted in transit but bugs happen).
 */

const CACHE_VERSION = 'cd-shell-v3';
const SHELL_PATHS = [
  '/offline.html',
  '/styles-i8.css',
  '/fonts/fonts.css',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

// Cache each path independently · cache.addAll() rejects the entire
// install when a single path 404s, which marks the SW redundant
// (seen 2026-05-22 · pre-v3 SW was failing on every page load,
// preventing Chrome from firing beforeinstallprompt cleanly). With
// allSettled, a single broken path just gets logged; the SW still
// activates and the rest of the shell is cached.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.allSettled(SHELL_PATHS.map((path) =>
        fetch(path, { cache: 'reload' }).then((res) => {
          if (!res.ok) throw new Error(path + ' returned ' + res.status);
          return cache.put(path, res);
        })
      )).then((results) => {
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            console.warn('[sw] failed to precache ' + SHELL_PATHS[i] + ':', r.reason && r.reason.message);
          }
        });
      })
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

/**
 * Fetch strategy:
 *   · Navigation request → network, fall back to /offline.html
 *   · Same-origin static asset (fonts, css, png) → cache-first
 *   · Everything else (incl. /api/*) → network-only · we never want
 *     stale user data
 */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/offline.html'))
    );
    return;
  }

  if (SHELL_PATHS.includes(url.pathname) || /\.(woff2|css|svg|png|webp)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((r) => {
        const copy = r.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        return r;
      }).catch(() => cached || Response.error()))
    );
  }
});

/**
 * Web Push handler.
 * The browser fires 'push' when our backend sends an encrypted
 * payload via the user's push endpoint (FCM / Mozilla push / APN).
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    // Fallback for plain-text payloads
    data = { title: 'Counsel.day', body: event.data ? event.data.text() : '' };
  }

  const title = String(data.title || 'Counsel.day').slice(0, 120);
  const body = String(data.body || '').slice(0, 400);
  const tag = String(data.tag || 'cd-default').slice(0, 64);
  // Hard-strip absolute URLs in payload · prevents open-redirect
  let target = String(data.url || '/');
  if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('//')) {
    target = '/';
  }
  if (!target.startsWith('/')) target = '/' + target;

  const options = {
    body,
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    tag,
    renotify: !!data.renotify,
    data: { url: target },
    requireInteraction: !!data.requireInteraction,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * On notification click, focus an existing tab if it's already on
 * the target URL; otherwise open a new tab.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        try {
          const url = new URL(client.url);
          if (url.pathname === target) {
            return client.focus();
          }
        } catch (e) { /* ignore */ }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(target);
      }
    })
  );
});

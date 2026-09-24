/* Shelf Control service worker (plan §2.4): the game is one file, so the whole app shell fits in one cache.
   Network first, cache when offline: a deploy lands on the next online load, and an installed copy still opens in a tunnel.
   The Pages workflow writes the deployed commit into VERSION, which retires the previous cache on activation. */
'use strict';
const VERSION = 'dev';
const CACHE = 'shelf-control-' + VERSION;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shelf-control-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;   // fonts and the like: the network, or nothing
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })
    .then((m) => m || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined))));
});

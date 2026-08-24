/* QuickGrade service worker.
 *
 * Purpose: once a teacher has loaded the hosted page, the whole app keeps
 * working with no network — in a classroom with bad wifi, on a cart, offline.
 * It caches only the app's own files. Student data never goes through here;
 * that lives in IndexedDB on the device and is never uploaded.
 *
 * Bump CACHE when the app files change so clients pick up the new version.
 */
var CACHE = 'quickgrade-v5';
var SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/lib.js',
  './js/ooxml.js',
  './js/exportmap.js',
  './js/parse.js',
  './js/scoring.js',
  './js/mastery.js',
  './js/sheet.js',
  './js/vision.js',
  './js/synth.js',
  './js/scan.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      // addAll fails the whole install if any one file 404s, so add
      // individually and let the rest succeed.
      .then(function (c) {
        return Promise.all(SHELL.map(function (u) {
          return c.add(u).catch(function () {});
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* Network-first for navigations so a redeployed app is picked up promptly,
   * falling back to cache when offline. Cache-first for everything else. */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (r) { return r || caches.match('./index.html'); });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});

/* عاملُ الخدمة: يحفظ الغلافَ ليفتح بسرعة · والواجهةُ والبياناتُ من Apps Script مباشرةً ولا تُحفظ */
var CACHE = 'tabour-v2';
var SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;
  var clean = u.origin + u.pathname; // بلا المفتاح — فلا يُحفظ المفتاحُ في الذاكرة
  e.respondWith(fetch(e.request).then(function (r) {
    var copy = r.clone();
    caches.open(CACHE).then(function (c) { c.put(clean, copy); });
    return r;
  }).catch(function () {
    return caches.match(clean);
  }));
});

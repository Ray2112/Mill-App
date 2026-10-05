/* Service worker: guarda a aplicação no telemóvel para funcionar sem rede.
   Alterar CACHE quando publicar uma nova versão. / Bump CACHE on each release. */
const CACHE = 'moagem-v0.2.0';
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/styles.css',
  './js/i18n.js', './js/logic.js', './js/db.js', './js/app.js', './vendor/xlsx.mini.min.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'
];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// Primeiro a rede (para receber actualizações). Se a rede demorar mais de 3 s ou falhar, usa a cópia local.
// Network first (so updates arrive). If the network takes over 3 s or fails, use the local copy.
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const net = fetch(e.request).then(function (r) {
    if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); }
    return r;
  });
  const cached = function () { return caches.match(e.request, { ignoreSearch: true }); };
  e.respondWith(new Promise(function (resolve) {
    let done = false;
    const finish = function (r) { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(function () { cached().then(finish); }, 3000);
    net.then(function (r) { clearTimeout(timer); finish(r); }, function () {
      clearTimeout(timer); cached().then(function (r) { if (r) finish(r); else { done = true; resolve(Response.error()); } });
    });
  }));
});

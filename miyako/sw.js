// 画面の仕組みを iPad に取っておき、ネットが無くても開けるようにする(データは IndexedDB にあり、ここでは扱わない)
const V = "miyako-ipad-2026-11-02a";
const FILES = ["./", "index.html", "app.js", "style.css", "manifest.webmanifest", "icon-180.png", "icon-512.png", "lib/jszip.min.js", "lib/xlsx.full.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== "GET") return;   // ほかのサイトはそのまま
  // ネットがあれば新しいものを取り、無ければ取っておいたものを出す
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match("index.html"))));
});

const CACHE_NAME = "comboio-v2-v1";
const ASSET_VER  = "1";
const APP_SHELL  = ["./index.html",`./config.js?v=${ASSET_VER}`,"./styles.css",`./app.js?v=${ASSET_VER}`,"./manifest.webmanifest"];

self.addEventListener("install",  (e) => { e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(APP_SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const bypass = url.pathname.endsWith("/config.js") || url.pathname.endsWith("/app.js");
  if (e.request.mode === "navigate" || bypass) {
    e.respondWith(fetch(e.request,{cache:"no-store"}).then(r=>{if(r.ok)caches.open(CACHE_NAME).then(c=>c.put(e.request,r.clone()));return r;}).catch(()=>caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(r=>{if(r.ok)caches.open(CACHE_NAME).then(c=>c.put(e.request,r.clone()));return r;})));
});

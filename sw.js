const CACHE_NAME = "comboio-v2-v2";
/** Bump with index.html + app.js SW_URL when changing offline shell. */
const ASSET_VER = "2";
const APP_SHELL = [
  "./",
  "./index.html",
  `./config.js?v=${ASSET_VER}`,
  "./styles.css",
  `./app.js?v=${ASSET_VER}`,
  "./manifest.webmanifest",
  "./logo_sv.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => console.warn("SW precache skip:", url, err))
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : Promise.resolve())))
    )
  );
  self.clients.claim();
});

function isHtmlNavigation(request) {
  if (request.mode === "navigate") return true;
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/html")) return true;
  try {
    const u = new URL(request.url);
    if (u.pathname.endsWith(".html") || u.pathname.endsWith("/")) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function shouldBypassCache(request) {
  try {
    const p = new URL(request.url).pathname;
    return p.endsWith("/config.js") || p.endsWith("/app.js");
  } catch {
    return false;
  }
}

async function matchShell(request) {
  const direct = await caches.match(request);
  if (direct) return direct;

  if (isHtmlNavigation(request)) {
    const fallbacks = ["./index.html", "./", "/pwa-comboio/index.html", "/pwa-comboio/"];
    for (const url of fallbacks) {
      const hit = await caches.match(url);
      if (hit) return hit;
    }
  }

  try {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/config.js")) {
      return (
        (await caches.match(`./config.js?v=${ASSET_VER}`)) || (await caches.match("./config.js"))
      );
    }
    if (path.endsWith("/app.js")) {
      return (await caches.match(`./app.js?v=${ASSET_VER}`)) || (await caches.match("./app.js"));
    }
  } catch {
    /* ignore */
  }

  return undefined;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  } catch {
    const cached = await matchShell(request);
    if (cached) return cached;
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  try {
    if (new URL(event.request.url).origin !== self.location.origin) return;
  } catch {
    return;
  }

  if (isHtmlNavigation(event.request) || shouldBypassCache(event.request)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
    )
  );
});

const CACHE_NAME = "cleanit-presentismo-shell-20260909-exit-delay1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=20260909-exit-delay1",
  "./js/config.js?v=20260909-exit-delay1",
  "./js/storage.js?v=20260909-exit-delay1",
  "./js/app.js?v=20260909-exit-delay1",
  "./manifest.webmanifest?v=20260909-exit-delay1",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const results = await Promise.allSettled(APP_SHELL.map(url => cache.add(url)));
    // Los recursos locales son los imprescindibles; un CDN puede fallar temporalmente sin invalidar la instalación.
    const localFailures = results
      .map((result, index) => ({ result, url: APP_SHELL[index] }))
      .filter(item => item.result.status === "rejected" && !/^https?:\/\//i.test(item.url));
    if (localFailures.length) throw localFailures[0].result.reason;
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("cleanit-presentismo-shell-") && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isSupabaseRequest(url) {
  return /\.supabase\.co$/i.test(url.hostname) || /\.supabase\.in$/i.test(url.hostname);
}

function isStaticRequest(request, url) {
  if (request.mode === "navigate") return true;
  if (url.origin === self.location.origin) return ["script", "style", "image", "font", "manifest"].includes(request.destination) || url.pathname.endsWith(".json");
  return [
    "cdn.jsdelivr.net",
    "cdnjs.cloudflare.com",
    "unpkg.com"
  ].includes(url.hostname);
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isSupabaseRequest(url)) return; // nunca cachear datos/API/auth de Supabase
  if (!isStaticRequest(request, url)) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone()).catch(() => {});
        return response;
      } catch (_) {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(request)) || (await cache.match("./index.html")) || (await cache.match("./"));
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) {
      event.waitUntil(fetch(request).then(response => {
        if (response && (response.ok || response.type === "opaque")) return cache.put(request, response.clone());
      }).catch(() => {}));
      return cached;
    }
    try {
      const response = await fetch(request);
      if (response && (response.ok || response.type === "opaque")) cache.put(request, response.clone()).catch(() => {});
      return response;
    } catch (_) {
      return new Response("", { status: 503, statusText: "Offline" });
    }
  })());
});

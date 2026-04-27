const CACHE = "launcher-v27";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./mechanism.js",
  "./weather.js",
  "./config.json",
  "./apps.json",
  "./manifest.webmanifest",
  "./icons/icon.svg",
];
// build.json is only written by the deploy workflow, so it 404s in local
// dev. Cache it best-effort so a missing file doesn't break SW install.
const OPTIONAL = ["./build.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        c.addAll(SHELL).then(() =>
          Promise.all(OPTIONAL.map((url) => c.add(url).catch(() => {})))
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin) return;
  if (!url.pathname.startsWith(scope.pathname)) return;
  const rel = url.pathname.slice(scope.pathname.length);
  // Hand control of /apps/* off to each app's own service worker (or network).
  if (rel.startsWith("apps/")) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((cached) => cached || caches.match("./"))
      )
  );
});

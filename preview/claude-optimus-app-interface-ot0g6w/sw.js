const CACHE = "launcher-v31";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./data.js",
  "./feel.js",
  "./scores.js",
  "./weather.js",
  "./config.json",
  "./apps.json",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./fonts/Anton-400.woff2",
  "./fonts/DMMono-400.woff2",
  "./fonts/DMMono-500.woff2",
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

  // Stale-while-revalidate for the launcher shell. The previous strategy
  // was network-first, which meant every cold launch (tapping the PWA
  // icon on the home screen) blocked the first paint on a full network
  // round-trip even though every asset was already cached. Now we serve
  // the cached copy INSTANTLY and refresh the cache in the background, so
  // the next launch picks up any deploy. The deploy bumps CACHE on each
  // push, so a new SW version still fully re-primes on activate.
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(e.request);
      const network = fetch(e.request)
        .then((res) => {
          if (res && res.ok) cache.put(e.request, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => null);
      // Cached wins the race when present; otherwise wait on the network,
      // and fall back to the app shell for navigations that miss both.
      return cached || (await network) || cache.match("./");
    })()
  );
});

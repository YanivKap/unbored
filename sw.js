/**
 * index.html and feed.json are network-first with a cache fallback: app updates
 * and a new deck arrive whenever there is a connection, and both still open
 * offline. Static assets (icons, manifest) are cache-first — they are immutable
 * in practice and this keeps the app opening instantly.
 */
const CACHE = "unbored-v5";
const SHELL = ["./", "./index.html", "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // Network-first for the document itself, so a new build reaches the phone.
  const isDoc = request.mode === "navigate"
    || url.pathname.endsWith("/")
    || url.pathname.endsWith("index.html")
    || url.pathname.endsWith("feed.json")
    // Archived decks: fresh when online, still readable offline once seen.
    || url.pathname.includes("/decks/")
    || url.pathname.endsWith("search.json");

  if (isDoc) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(() => caches.match(request).then((r) => r ?? caches.match("./index.html")).then((r) => r ?? Response.error())),
    );
    return;
  }

  e.respondWith(
    caches.match(request).then((hit) =>
      hit ?? fetch(request).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
        return res;
      }).catch(() => caches.match("./index.html")),
    ),
  );
});

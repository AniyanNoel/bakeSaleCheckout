// Lets the checkout page open and run with no connection.
// Only GET requests are cached. Sales are never sent through here: the page keeps
// its own outbox and talks to /api/sales directly.
const VERSION = "bake-sale-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Built JS and CSS never change for a given URL: cache first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // The checkout page: always try the network, fall back to the last copy.
  if (req.mode === "navigate" && /^\/events\/\d+\/checkout\/?$/.test(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(url.pathname).then(
            (hit) =>
              hit ||
              new Response("<h1>Offline</h1><p>Open the checkout page once while online so it can work offline.</p>", {
                headers: { "Content-Type": "text/html" },
              }),
          ),
        ),
    );
  }
});

// The checkout page asks for itself and its scripts to be saved, so it opens
// offline even if the Wi-Fi drops right after the first visit.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "precache" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      Promise.all(
        data.urls
          .filter((u) => typeof u === "string" && u.startsWith("/"))
          .map((u) =>
            fetch(u, { credentials: "same-origin" })
              .then((res) => (res.ok && !res.redirected ? cache.put(u, res) : undefined))
              .catch(() => undefined),
          ),
      ),
    ),
  );
});

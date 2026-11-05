/* Relay service worker.
 * Purpose: make Relay installable and show a friendly offline screen.
 * It NEVER caches anything from the Relay API, Square, Shopify or Plaid - only
 * Relay's own static pages and icons from this same site. Bump VERSION to force
 * every installed copy to drop its old cache. */
const VERSION = "relay-shell-v114";
const SHELL = ["./", "index.html", "manifest.webmanifest", "account.js", "relay-gestures.js", "terms.html", "privacy.html", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API / third-party calls go straight to the network
  // Network first so a new Relay release always shows up; the cache is only the offline fallback.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});

// Phone alerts. The message arrives encrypted from the push service and is shown as a normal notification.
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  event.waitUntil(self.registration.showNotification(String(d.title || "Relay").slice(0, 80), {
    body: String(d.body || "").slice(0, 200), icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url: appLink(d.url) }
  }));
});
// Where a notification leads: one of Relay's own screens (./#open=…), never anywhere else.
function appLink(url) {
  try {
    const u = new URL(String(url || "./"), self.registration.scope);
    if (u.origin === self.location.origin && u.href.startsWith(self.registration.scope)) return u.href;
  } catch (e) { /* not an address */ }
  return self.registration.scope;
}
// Tapping a notification opens the exact thing it's about: Relay already open is brought forward and told where to go;
// otherwise Relay opens there.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = appLink(event.notification.data && event.notification.data.url);
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ("focus" in c) { c.postMessage({ type: "relay-open", url }); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});

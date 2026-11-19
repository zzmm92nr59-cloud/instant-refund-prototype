/* Relay service worker.
 * Purpose: make Relay installable, open it straight away from the copy kept on the phone, and show it with no connection.
 * It NEVER caches anything from the Relay API, Square, Shopify or Plaid - only
 * Relay's own static pages and icons from this same site. Bump VERSION to force
 * every installed copy to drop its old cache (and, through pwa-register.js, show the new release straight away). */
const VERSION = "relay-shell-v214";
// What opening Relay needs, kept on install. The scripts are listed exactly as index.html asks for them (with their ?v=),
// so none waits on the network when Relay opens (scripts/test-app-speed-ui.mjs checks this list against the page).
const SHELL = ["./", "index.html", "relay-app-v2.html", "manifest.webmanifest", "pwa-register.js", "account.js", "relay-gestures.js", "relay-corners.js",
  "relay-exchange-engine.js?v=20261014-simulate", "worker/item-kind-core.js?v=20261119-kinds5", "relay-recommendation-engine.js?v=20261119-kinds5", "relay-wallet-ledger.js?v=20261018-exchange-wallet",
  "terms.html", "privacy.html", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  // Past the browser's own copies, so a new release keeps the new files and not ones the browser had from before.
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The app itself (its page and its own scripts, icons and logos): answered from the copy at once, and the copy brought up
// to date in the background for next time. Opening Relay on a weak signal (back from the Mail app, say, after the phone
// closed Relay) no longer waits on the network with a blank screen.
const APP_PAGE = /\/(index\.html|relay-app-v2\.html)?$/, APP_FILE = /\.(js|png|svg|jpg|jpeg|webp|webmanifest)$/;
function fromCopy(event, req, url, page) {
  // The page is kept once, whatever comes after its address (?testtools=1 and the like are read by the page itself).
  const key = page ? url.origin + url.pathname : req.url;
  return caches.open(VERSION).then((cache) => cache.match(key).then((hit) => {
    const fresh = fetch(key, { cache: "no-cache", credentials: "same-origin" }).then((res) => {
      if (res && res.ok && res.type === "basic") { const copy = res.clone(); return cache.put(key, copy).then(() => res, () => res); }
      return res;
    });
    if (hit) { event.waitUntil(fresh.catch(() => {})); return hit; }
    return fresh.catch(() => (page ? cache.match(new URL("index.html", self.registration.scope).href).then((h) => h || Response.error()) : Response.error()));
  }));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API / third-party calls go straight to the network
  // next.html (where the new layout was tried out) is now only a way back to the app: never kept, always from the network.
  if (/\/next\.html$/.test(url.pathname)) {
    event.respondWith(fetch(req.url, { cache: "no-store" }).catch(() => (req.mode === "navigate" ? Response.redirect("./") : Response.error())));
    return;
  }
  const page = req.mode === "navigate";
  if (page ? APP_PAGE.test(url.pathname) : APP_FILE.test(url.pathname)) { event.respondWith(fromCopy(event, req, url, page)); return; }
  // Everything else (Relay's other pages): network first, the copy only when there's no connection.
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

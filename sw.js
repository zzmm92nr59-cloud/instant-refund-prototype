/* Relay service worker.
 * Purpose: make Relay installable, open it straight away from the copy kept on the phone, and show it with no connection.
 * It NEVER caches anything from the Relay API, Square, Shopify or Plaid - only
 * Relay's own static pages and icons from this same site. Bump VERSION to force
 * every installed copy to drop its old cache (and, through pwa-register.js, show the new release straight away). */
const VERSION = "relay-shell-v242";
// What opening Relay needs, kept on install. The scripts are listed exactly as index.html asks for them (with their ?v=),
// so none waits on the network when Relay opens (scripts/test-app-speed-ui.mjs checks this list against the page).
const SHELL = ["./", "index.html", "relay-app-v2.html", "manifest.webmanifest", "pwa-register.js", "account.js", "relay-gestures.js", "relay-corners.js",
  "relay-exchange-engine.js?v=20261014-simulate", "worker/item-kind-core.js?v=20261119-kinds5", "relay-recommendation-engine.js?v=20261119-kinds5", "relay-wallet-ledger.js?v=20261018-exchange-wallet",
  "terms.html", "privacy.html", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  // Past the browser's own copies, so a new release keeps the new files and not ones the browser had from before.
  // All of them or none: addAll keeps nothing unless every file arrived.
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      // Everything from earlier releases goes, and so does the note of which set of files was in use (it named one of them).
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k.indexOf(VERSION + "+") !== 0).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The app's own files (its page and the scripts the page asks for: SHELL) depend on each other, so they are only ever
// kept, used and replaced as one set:
//  - the set a release installs with (the cache named VERSION), all or nothing;
//  - a newer set fetched in the background a few seconds after Relay opens (a cache named VERSION+<time>), written in
//    full to one side first and only then switched to, by changing one note (which set is current). If the phone closes
//    Relay or loses signal part-way, nothing has changed: the page never runs with a newer page and an older account.js.
// A page gets every file from the set its own page came from, even if a newer set arrives while it is still loading.
// Nothing is rewritten when nothing changed (it used to write all of it, about 1.6 MB, every time Relay opened).
const META = "relay-meta", NOTE = new URL("__relay-current-shell", self.registration.scope).href;
const SHELL_URLS = SHELL.map((u) => new URL(u, self.registration.scope).href), SHELL_SET = new Set(SHELL_URLS);
const REFRESH_AFTER_MS = 3000, REFRESH_GAP_MS = 60000;
let currentName = null, refreshing = null, refreshedAt = 0;
const pinned = new Map();   // which set each open page is using
function current() {
  if (currentName) return Promise.resolve(currentName);
  return caches.open(META).then((m) => m.match(NOTE)).then((r) => (r ? r.text() : ""))
    .then((name) => (name && name.indexOf(VERSION + "+") === 0 ? caches.has(name).then((ok) => (ok ? name : VERSION)) : VERSION), () => VERSION)
    .then((name) => (currentName = name));
}
// Whether what the network has is different from the copy: by the server's own stamp when it gives one, else by reading both.
function differs(old, res) {
  if (!old) return Promise.resolve(true);
  const a = old.headers.get("etag"), b = res.headers.get("etag");
  if (a && b) return Promise.resolve(a !== b);
  const la = old.headers.get("last-modified"), lb = res.headers.get("last-modified"), na = old.headers.get("content-length"), nb = res.headers.get("content-length");
  if (la && lb && na && nb) return Promise.resolve(la !== lb || na !== nb);
  return Promise.all([old.clone().arrayBuffer(), res.clone().arrayBuffer()]).then(([x, y]) => {
    if (x.byteLength !== y.byteLength) return true;
    const p = new Uint8Array(x), q = new Uint8Array(y);
    for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return true;
    return false;
  }, () => true);
}
function refreshShell() {
  if (refreshing) return refreshing;
  if (Date.now() - refreshedAt < REFRESH_GAP_MS) return Promise.resolve();
  refreshing = current().then((name) => caches.open(name).then((cache) =>
    Promise.all(SHELL_URLS.map((u) => fetch(u, { cache: "no-cache", credentials: "same-origin" }).then((res) => {
      if (!res || !res.ok || res.type !== "basic") throw new Error("not all of the app's files arrived");
      return cache.match(u).then((old) => differs(old, res)).then((changed) => ({ u, res, changed }));
    }))).then((all) => {
      if (!all.some((x) => x.changed)) return null;
      // The whole new set is written to one side, then one note makes it the set in use.
      const next = VERSION + "+" + Date.now();
      return caches.open(next).then((nc) => Promise.all(all.map((x) => nc.put(x.u, x.res))))
        .then(() => caches.open(META)).then((m) => m.put(NOTE, new Response(next)))
        .then(() => { const was = name; currentName = next; return tidy(next, was); });
    })
  )).catch(() => {}).then(() => { refreshing = null; refreshedAt = Date.now(); });
  return refreshing;
}
// Older sets go once a newer one is in use: all but the release's own set (the fallback), the one just replaced (a page
// still open may be using it) and any a page is pinned to.
function tidy(now, was) {
  const inUse = new Set([VERSION, now, was]); pinned.forEach((n) => inUse.add(n));
  return caches.keys().then((keys) => Promise.all(keys.filter((k) => k.indexOf(VERSION + "+") === 0 && !inUse.has(k)).map((k) => caches.delete(k)))).catch(() => {});
}
function fromSet(name, key) {
  // (By name, without opening it: opening a set that has been tidied away would make an empty one.)
  return caches.match(key, { cacheName: name }).then((hit) => hit || (name === VERSION ? undefined : caches.match(key, { cacheName: VERSION })));
}
const APP_PAGE = /\/(index\.html|relay-app-v2\.html)?$/, APP_FILE = /\.(js|png|svg|jpg|jpeg|webp|webmanifest)$/;
// The app itself: answered from the copy at once. Opening Relay on a weak signal (back from the Mail app, say, after the
// phone closed Relay) never waits on the network with a blank screen.
function shellFile(event, key, page) {
  const mine = page ? current().then((name) => { if (event.resultingClientId) { pinned.set(event.resultingClientId, name); if (pinned.size > 24) pinned.delete(pinned.keys().next().value); } return name; })
    : pinned.has(event.clientId) ? Promise.resolve(pinned.get(event.clientId)) : current();
  return mine.then((name) => fromSet(name, key)).then((hit) => {
    if (page) event.waitUntil(new Promise((r) => setTimeout(r, REFRESH_AFTER_MS)).then(refreshShell));
    if (hit) return hit;
    // Not kept (it should be): the network, and for the page its kept copy under its other name.
    return fetch(key, { cache: "no-cache", credentials: "same-origin" })
      .catch(() => (page ? caches.open(VERSION).then((c) => c.match(new URL("index.html", self.registration.scope).href)).then((h) => h || Response.error()) : Response.error()));
  });
}
// Relay's other own files (icons, shop logos, pictures) stand alone: each is answered from its copy at once and brought
// up to date in the background for next time, and written again only when it changed.
function fromCopy(event, key) {
  return caches.open(VERSION).then((cache) => cache.match(key).then((hit) => {
    const fresh = fetch(key, { cache: "no-cache", credentials: "same-origin" }).then((res) => {
      if (!(res && res.ok && res.type === "basic")) return res;
      const copy = res.clone();
      return differs(hit, res).then((changed) => (changed ? cache.put(key, copy) : null)).then(() => res, () => res);
    });
    if (hit) { event.waitUntil(fresh.catch(() => {})); return hit; }
    return fresh.catch(() => Response.error());
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
  // The page is kept once, whatever comes after its address (?testtools=1 and the like are read by the page itself).
  if (page && APP_PAGE.test(url.pathname)) { event.respondWith(shellFile(event, url.origin + url.pathname, true)); return; }
  if (!page && SHELL_SET.has(req.url)) { event.respondWith(shellFile(event, req.url, false)); return; }
  if (!page && APP_FILE.test(url.pathname)) { event.respondWith(fromCopy(event, req.url)); return; }
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
    // A window showing the app itself (not the privacy policy or terms, which wouldn't know what to do with it).
    for (const c of list) {
      let app = false; try { app = APP_PAGE.test(new URL(c.url).pathname); } catch (e) { app = false; }
      if (app && "focus" in c) { c.postMessage({ type: "relay-open", url }); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});

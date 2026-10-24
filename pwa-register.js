// Registers Relay's service worker so the app can be installed to a phone's home screen,
// and makes a new release show up straight away instead of on the next open.
if ("serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  const typing = () => {
    const el = document.activeElement;
    return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable));
  };
  const reloadOnce = () => {
    if (reloading) return;
    reloading = true;
    try { if (sessionStorage.getItem("relay-sw-reloaded") === "1") return; sessionStorage.setItem("relay-sw-reloaded", "1"); } catch (e) {}
    location.reload();
  };
  // Only when a new version replaces an old one (never on a first visit), and never while someone is typing:
  // in that case wait until they leave the app, so the next open is already the new version.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    if (!typing()) { reloadOnce(); return; }
    document.addEventListener("visibilitychange", () => { if (document.hidden) reloadOnce(); });
  });
  window.addEventListener("load", () => {
    try { sessionStorage.removeItem("relay-sw-reloaded"); } catch (e) {}
    navigator.serviceWorker.register("sw.js").then((reg) => reg.update()).catch(() => {});
  });
}

// Registers Relay's service worker so the app can be installed to a phone's home screen,
// and brings a new release in without getting in anyone's way.
if ("serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false, used = false;
  // Whether Relay is being used right now: something has been tapped or typed since it opened, a sheet is open, or a
  // field has the keyboard. Reloading then would close what they were doing (a return half filled in, a payment just
  // sent with the screen never showing what happened).
  const mark = () => { used = true; };
  ["pointerdown", "keydown", "touchstart"].forEach((ev) => window.addEventListener(ev, mark, { capture: true, passive: true }));
  const typing = () => {
    const el = document.activeElement;
    return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
  };
  const busy = () => used || typing() || Boolean(document.querySelector(".rl-back, .rl-story"));
  const reloadOnce = () => {
    if (reloading) return;
    reloading = true;
    try { if (sessionStorage.getItem("relay-sw-reloaded") === "1") return; sessionStorage.setItem("relay-sw-reloaded", "1"); } catch (e) {}
    location.reload();
  };
  // Only when a new version replaces an old one (never on a first visit). Straight away only if Relay has just opened
  // and nothing has been touched; otherwise it waits until they leave the app, so the next open is the new version.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    if (!busy()) { reloadOnce(); return; }
    document.addEventListener("visibilitychange", () => { if (document.hidden) reloadOnce(); });
  });
  window.addEventListener("load", () => {
    try { sessionStorage.removeItem("relay-sw-reloaded"); } catch (e) {}
    navigator.serviceWorker.register("sw.js").then((reg) => reg.update()).catch(() => {});
  });
}

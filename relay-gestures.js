// Relay's phone gestures: going back, pulling down to refresh, and swiping sheets away.
//  - Back. The phone's own back (Android's back gesture or button, Safari's swipe in from the left edge) does exactly what
//    the screen's Back button does. Relay keeps one extra history step while there's somewhere to go back to, so back never
//    leaves the app by surprise. The installed app on an iPhone has no back gesture of its own, so there a swipe in from
//    the left edge slides the screen away and goes back.
//  - Pull to refresh. On Home, Receipts, Discover and Profile, pulling down from the top asks Relay for everything again
//    (and on Receipts checks the inbox too). What's on screen stays until the new copy arrives.
//  - Sheets that rise from the bottom can be swiped down to close, like the phone's own.
// What counts as "Back" on a screen: the first visible control marked data-back in the open sheet (or, with no sheet, in the
// page). A sheet without one closes, as tapping outside it does; a full-screen step without one has no back.
// index.html provides window.RelayShell (is this a tab's own screen, and how to refresh it).
(function () {
  "use strict";
  var W = window, D = document, H = W.history;
  if (!D.addEventListener || !H || !H.pushState || W.__relayGestures) return;
  W.__relayGestures = true;
  var STANDALONE = (W.matchMedia && W.matchMedia("(display-mode: standalone)").matches) || W.navigator.standalone === true;
  var CALM = W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var ICONS = { down: '<path d="M12 5v14M6 13l6 6 6-6"/>', again: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>', check: '<path d="m5 12.5 4.2 4.2L19 7"/>' };

  var css = D.createElement("style");
  css.textContent =
    // The pull-to-refresh disc: Relay's drawn icons on a card, no spinner (CLAUDE.md rule 7).
    ".rl-ptr{position:fixed;left:50%;top:calc(env(safe-area-inset-top) - 44px);z-index:9000;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;" +
    "background:var(--rl-card,#fff);color:var(--rl-text,#101828);box-shadow:0 6px 20px rgba(16,24,40,.18);transform:translate(-50%,0);opacity:0;pointer-events:none}" +
    ".rl-ptr.on{opacity:1}.rl-ptr svg{transition:transform .15s ease}.rl-ptr.ready svg{transform:rotate(180deg)}" +
    ".rl-ptr.busy svg{transform:none;animation:rl-ptr-breathe 1.2s ease-in-out infinite}.rl-ptr.settle{transition:transform .22s ease,opacity .22s ease}" +
    "@keyframes rl-ptr-breathe{50%{opacity:.45}}" +
    "@media (prefers-reduced-motion: reduce){.rl-ptr.busy svg{animation:none}.rl-ptr.settle{transition:none}}" +
    // While a screen is swiped away, a soft shadow along its left edge shows it's lifting off.
    "html.rl-swiping{overflow-x:hidden}.rl-swipe-edge{box-shadow:-12px 0 24px rgba(16,24,40,.18)}" +
    // Sheets from the bottom carry a grabber: the sign they can be pulled down. (Full-screen steps and desktop dialogs don't.)
    ".rl-back>.rl-sheet:not(.rl-jr){position:relative}" +
    ".rl-back>.rl-sheet:not(.rl-jr)::before{content:'';position:absolute;top:8px;left:50%;width:40px;height:5px;margin-left:-20px;border-radius:3px;background:var(--rl-line,#d0d5dd);z-index:3}" +
    "@media(min-width:640px){.rl-back>.rl-sheet:not(.rl-jr)::before{display:none}}" +
    ".rl-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
    // Pulling down at the top is Relay's refresh, not the browser's own reload or bounce.
    "html,body{overscroll-behavior-y:none}";
  D.head.appendChild(css);

  var live = D.createElement("div");
  live.className = "rl-sr"; live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite");

  function shown(n) {
    if (!n || !n.isConnected || (n.closest && n.closest("[hidden]"))) return false;
    var r = n.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    var s = W.getComputedStyle(n);
    return s.visibility !== "hidden" && s.display !== "none";
  }
  // The sheet on top, if one is open.
  function topLayer() {
    var ls = D.querySelectorAll(".rl-back");
    for (var i = ls.length - 1; i >= 0; i--) if (shown(ls[i])) return ls[i];
    return null;
  }
  // What "back" does right now, or null when this is as far back as it goes.
  function backAction() {
    var layer = topLayer(), root = layer || D.getElementById("view");
    if (!root) return null;
    var marks = root.querySelectorAll("[data-back]");
    for (var i = 0; i < marks.length; i++) {
      if (shown(marks[i]) && !marks[i].disabled) return { button: marks[i], layer: layer };
    }
    if (layer && !layer.querySelector(".rl-jr")) return { layer: layer, closeSheet: true };
    return null;
  }
  function runBack(act) {
    if (!act) return;
    if (act.button) act.button.click();
    else if (act.closeSheet) act.layer.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }
  W.RelayBack = { can: function () { return Boolean(backAction()); }, go: function () { runBack(backAction()); } };

  // ---- The phone's own back ----
  // One extra history step while there's somewhere to go back to. Using it runs Back; leaving that screen another way
  // removes the step again (quietly), so the browser's history never fills up with Relay's screens.
  // Arriving on a step left from an earlier visit (going back across pages, or a reload) makes it an ordinary entry, so
  // Relay never moves through history by itself when it opens.
  if (H.state && H.state.relayBack) { try { H.replaceState(null, "", W.location.href); } catch (e) { /* fine as it is */ } }
  var armed = false, skipping = 0, timer = 0;
  function sync() {
    timer = 0;
    if (skipping) return; // a step is still being removed: look again once it has
    var can = Boolean(backAction());
    if (can && !armed) { try { H.pushState({ relayBack: 1 }, "", W.location.href); armed = true; } catch (e) { /* not allowed here */ } }
    else if (!can && armed) { armed = false; skipping++; H.back(); }
  }
  function soon() { if (!timer) timer = setTimeout(sync, 80); }
  W.addEventListener("popstate", function (e) {
    if (skipping) { skipping--; soon(); return; }
    if (!armed) { if (e.state && e.state.relayBack) armed = true; soon(); return; } // forward onto a step, or a link's #
    armed = false;
    runBack(backAction());
    soon();
  });
  function watch() {
    new MutationObserver(soon).observe(D.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    D.body.appendChild(live);
    soon();
  }

  // ---- Swiping in from the left edge (the installed app on iPhone; elsewhere the phone does this itself) ----
  function edgeSwipe() {
    var t = null;
    D.addEventListener("touchstart", function (e) {
      t = null;
      if (e.touches.length !== 1 || e.touches[0].clientX > 24) return;
      // Something with a drag of its own (the slider to bid) keeps its drag: it isn't a swipe back.
      if (e.target.closest && e.target.closest(".rl-noswipe")) return;
      var act = backAction();
      if (!act) return;
      var el = act.layer ? (act.layer.querySelector(".rl-sheet") || act.layer) : D.querySelector("main.main");
      if (el) t = { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now(), act: act, el: el, dx: 0, going: false };
    }, { passive: true });
    D.addEventListener("touchmove", function (e) {
      if (!t) return;
      var p = e.touches[0], dx = p.clientX - t.x, dy = p.clientY - t.y;
      if (!t.going) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > dx) { t = null; return; } // that's a scroll
        if (dx < 10) return;
        t.going = true; t.el.style.transition = "none"; t.el.classList.add("rl-swipe-edge"); D.documentElement.classList.add("rl-swiping");
      }
      if (e.cancelable) e.preventDefault();
      t.dx = Math.max(0, dx);
      t.el.style.transform = "translateX(" + t.dx + "px)";
    }, { passive: false });
    function end() {
      var s = t; t = null;
      if (!s || !s.going) return;
      var w = W.innerWidth || 390, speed = s.dx / Math.max(1, Date.now() - s.at);
      var back = s.dx > w * 0.33 || (speed > 0.5 && s.dx > 40);
      s.el.style.transition = CALM ? "none" : "transform .2s ease-out";
      s.el.style.transform = back ? "translateX(" + w + "px)" : "";
      setTimeout(function () {
        D.documentElement.classList.remove("rl-swiping");
        s.el.classList.remove("rl-swipe-edge");
        if (back) runBack(s.act);
        s.el.style.transition = ""; s.el.style.transform = "";
      }, CALM ? 0 : 200);
    }
    D.addEventListener("touchend", end, { passive: true });
    D.addEventListener("touchcancel", end, { passive: true });
  }

  // ---- Pull to refresh ----
  function pullToRefresh() {
    var disc = D.createElement("div"), PULL = 72, s = null, busy = false;
    disc.className = "rl-ptr"; disc.setAttribute("aria-hidden", "true"); disc.innerHTML = SVG + ICONS.down + "</svg>";
    D.body.appendChild(disc);
    function icon(n) { disc.innerHTML = SVG + ICONS[n] + "</svg>"; }
    // The screen moves down with the finger and the disc sits in the gap it opens above it.
    function content() { return D.querySelector("main.main"); }
    function place(y, animate) {
      var m = content(), t = animate && !CALM ? "transform .22s ease" : "none";
      disc.style.transform = "translate(-50%," + Math.max(0, y / 2 + 30) + "px)";
      if (m) { m.style.transition = t; m.style.transform = y > 0 ? "translateY(" + y + "px)" : ""; }
    }
    function hide() {
      disc.classList.add("settle"); disc.classList.remove("on", "ready", "busy"); place(0, true);
      setTimeout(function () { disc.classList.remove("settle"); icon("down"); var m = content(); if (m) m.style.transition = ""; }, 240);
    }
    function allowed() {
      var shell = W.RelayShell;
      return !busy && shell && shell.isTabRoot && shell.isTabRoot() && !topLayer() && (W.scrollY || D.documentElement.scrollTop || 0) <= 0;
    }
    D.addEventListener("touchstart", function (e) {
      s = null;
      if (e.touches.length !== 1 || !allowed()) return;
      if (e.target.closest && e.target.closest("input,textarea,select,[contenteditable],.rl-noptr")) return;
      s = { x: e.touches[0].clientX, y: e.touches[0].clientY, pull: 0, on: false };
    }, { passive: true });
    D.addEventListener("touchmove", function (e) {
      if (!s) return;
      var dy = e.touches[0].clientY - s.y, dx = e.touches[0].clientX - s.x;
      if (!s.on) {
        if (dy < -4 || Math.abs(dx) > 14 || (W.scrollY || 0) > 0) { s = null; return; }
        if (dy < 10 || Math.abs(dx) > dy) return;
        s.on = true; disc.classList.remove("settle"); disc.classList.add("on");
      }
      if (e.cancelable) e.preventDefault();
      s.pull = Math.min(140, Math.max(0, dy) * 0.55);
      place(s.pull, false);
      disc.classList.toggle("ready", s.pull >= PULL);
    }, { passive: false });
    function end() {
      var x = s; s = null;
      if (!x || !x.on) return;
      if (x.pull < PULL) return hide();
      busy = true;
      disc.classList.remove("ready"); disc.classList.add("busy", "settle"); icon("again"); place(64, true);
      live.textContent = "Refreshing";
      var shell = W.RelayShell;
      Promise.resolve().then(function () { return shell.refresh(); }).catch(function () {}).then(function () {
        disc.classList.remove("busy"); icon("check"); live.textContent = "Up to date";
        setTimeout(function () { hide(); busy = false; }, 500);
      });
    }
    D.addEventListener("touchend", end, { passive: true });
    D.addEventListener("touchcancel", end, { passive: true });
  }

  // ---- Swiping a sheet down to close it ----
  function sheetSwipe() {
    var s = null;
    D.addEventListener("touchstart", function (e) {
      s = null;
      if (e.touches.length !== 1) return;
      var sheet = e.target.closest && e.target.closest(".rl-back>.rl-sheet");
      if (!sheet || sheet.classList.contains("rl-jr") || (W.innerWidth || 0) >= 640) return;
      if (e.target.closest("input,textarea,select,[contenteditable],.rl-noswipe")) return;
      if (sheet.scrollTop > 0) return; // scrolled down inside the sheet: that drag scrolls it back up
      s = { sheet: sheet, layer: sheet.parentNode, x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now(), dy: 0, on: false };
    }, { passive: true });
    D.addEventListener("touchmove", function (e) {
      if (!s) return;
      var dy = e.touches[0].clientY - s.y, dx = e.touches[0].clientX - s.x;
      if (!s.on) {
        if (dy < -4 || Math.abs(dx) > Math.max(12, dy) || s.sheet.scrollTop > 0) { s = null; return; }
        if (dy < 10) return;
        s.on = true; s.sheet.style.transition = "none";
      }
      if (e.cancelable) e.preventDefault();
      s.dy = Math.max(0, dy);
      s.sheet.style.transform = "translateY(" + s.dy + "px)";
    }, { passive: false });
    function end() {
      var x = s; s = null;
      if (!x || !x.on) return;
      var speed = x.dy / Math.max(1, Date.now() - x.at), h = x.sheet.offsetHeight || 400;
      var close = x.dy > Math.min(140, h * 0.3) || (speed > 0.6 && x.dy > 30);
      x.sheet.style.transition = CALM ? "none" : "transform .2s ease-out";
      x.sheet.style.transform = close ? "translateY(" + (h + 40) + "px)" : "";
      setTimeout(function () {
        // Swiped away: the sheet closes as tapping outside it does (an inner page of the sheet closes with it).
        if (close) x.layer.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        if (close && x.layer.isConnected && shown(x.layer)) {
          // This sheet doesn't close from outside (it's asking something that needs an answer): it comes back up.
          x.sheet.style.transition = CALM ? "none" : "transform .2s ease-out"; x.sheet.style.transform = "";
          setTimeout(function () { x.sheet.style.transition = ""; }, 220);
          return;
        }
        x.sheet.style.transition = ""; x.sheet.style.transform = "";
      }, CALM ? 0 : 200);
    }
    D.addEventListener("touchend", end, { passive: true });
    D.addEventListener("touchcancel", end, { passive: true });
  }

  function start() {
    watch();
    if (STANDALONE) edgeSwipe();
    pullToRefresh();
    sheetSwipe();
  }
  if (D.body) start(); else D.addEventListener("DOMContentLoaded", start);
})();

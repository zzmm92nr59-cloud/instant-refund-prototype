// Smooth corners, the way iPhone draws them (Connor, 16 Nov 2026). A plain CSS rounded corner is a quarter circle, so the
// straight edge meets the curve with a visible kink. iOS uses "continuous" corners: the curve starts a little earlier
// and eases in. CSS's own way (corner-shape: squircle) isn't in Safari yet, so this draws the shape and clips to it.
//
// What gets smoothed: anything with a rounded corner of 6px or more that isn't a pill or a circle (those keep their
// shape). Left alone: things with a visible border, a shadow, a blur behind them (the tab bar, sheets' glass) or
// data-round="plain", because clipping would cut the border or shadow off. The CSS border-radius stays as it was, so if
// this file doesn't run, everything still has ordinary rounded corners.
//
// The shape is Figma's corner smoothing at 60% (what Apple's corners match); the curve never goes outside the CSS
// rounded corner, so nothing that was visible before gets uncovered. Sizes are watched, so cards that grow re-shape.
(function () {
  "use strict";
  if (typeof window === "undefined" || !window.ResizeObserver || !window.MutationObserver) return;
  if (!CSS.supports("clip-path", "path('M0 0')")) return;
  const SMOOTHING = 0.6, MIN_R = 6;
  const done = new WeakMap();   // element -> its CSS radii [tl, tr, br, bl] when first seen (or false: left alone)
  const rad = (deg) => (deg * Math.PI) / 180;

  // One corner's measurements (after figma-squircle, MIT: the same maths Figma uses for "corner smoothing").
  function corner(r, budget) {
    if (r <= 0) return null;
    r = Math.min(r, budget);
    let s = SMOOTHING, p = (1 + s) * r;
    const most = budget / r - 1;   // room to smooth before running into the next corner
    s = Math.max(0, Math.min(s, most)); p = Math.min(p, budget);
    const arcMeasure = 90 * (1 - s);
    const arc = Math.sin(rad(arcMeasure / 2)) * r * Math.SQRT2;
    const alpha = (90 - arcMeasure) / 2;
    const p3p4 = r * Math.tan(rad(alpha / 2));
    const beta = 45 * s;
    const c = p3p4 * Math.cos(rad(beta));
    const d = c * Math.tan(rad(beta));
    const b = (p - arc - c - d) / 3, a = 2 * b;
    return { a, b, c, d, p, arc, r };
  }
  const n = (x) => Math.round(x * 100) / 100;

  function shape(w, h, radii) {
    const budget = Math.min(w, h) / 2;
    const [tl, tr, br, bl] = radii.map((r) => corner(r, budget));
    let s = `M ${n(w - (tr ? tr.p : 0))} 0`;
    if (tr) s += ` c ${n(tr.a)} 0 ${n(tr.a + tr.b)} 0 ${n(tr.a + tr.b + tr.c)} ${n(tr.d)} a ${n(tr.r)} ${n(tr.r)} 0 0 1 ${n(tr.arc)} ${n(tr.arc)} c ${n(tr.d)} ${n(tr.c)} ${n(tr.d)} ${n(tr.b + tr.c)} ${n(tr.d)} ${n(tr.a + tr.b + tr.c)}`;
    s += ` L ${n(w)} ${n(h - (br ? br.p : 0))}`;
    if (br) s += ` c 0 ${n(br.a)} 0 ${n(br.a + br.b)} ${n(-br.d)} ${n(br.a + br.b + br.c)} a ${n(br.r)} ${n(br.r)} 0 0 1 ${n(-br.arc)} ${n(br.arc)} c ${n(-br.c)} ${n(br.d)} ${n(-(br.b + br.c))} ${n(br.d)} ${n(-(br.a + br.b + br.c))} ${n(br.d)}`;
    s += ` L ${n(bl ? bl.p : 0)} ${n(h)}`;
    if (bl) s += ` c ${n(-bl.a)} 0 ${n(-(bl.a + bl.b))} 0 ${n(-(bl.a + bl.b + bl.c))} ${n(-bl.d)} a ${n(bl.r)} ${n(bl.r)} 0 0 1 ${n(-bl.arc)} ${n(-bl.arc)} c ${n(-bl.d)} ${n(-bl.c)} ${n(-bl.d)} ${n(-(bl.b + bl.c))} ${n(-bl.d)} ${n(-(bl.a + bl.b + bl.c))}`;
    s += ` L 0 ${n(tl ? tl.p : 0)}`;
    if (tl) s += ` c 0 ${n(-tl.a)} 0 ${n(-(tl.a + tl.b))} ${n(tl.d)} ${n(-(tl.a + tl.b + tl.c))} a ${n(tl.r)} ${n(tl.r)} 0 0 1 ${n(tl.arc)} ${n(-tl.arc)} c ${n(tl.c)} ${n(-tl.d)} ${n(tl.b + tl.c)} ${n(-tl.d)} ${n(tl.a + tl.b + tl.c)} ${n(-tl.d)}`;
    return s + " Z";
  }

  const px = (v) => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
  const visibleBorder = (cs) => ["Top", "Right", "Bottom", "Left"].some((k) => px(cs["border" + k + "Width"]) > 0 && cs["border" + k + "Style"] !== "none" && !/rgba\([^)]*,\s*0\)|transparent/.test(cs["border" + k + "Color"]));

  // Is this element one to smooth? Returns its radii, or false.
  function look(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.closest("[data-round='plain']")) return false;
    const cs = getComputedStyle(el);
    if (cs.borderRadius === "0px" || !cs.borderRadius) return false;
    if (/%/.test(cs.borderTopLeftRadius + cs.borderTopRightRadius + cs.borderBottomRightRadius + cs.borderBottomLeftRadius)) return false;   // circles
    const radii = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(px);
    if (Math.max(...radii) < MIN_R) return false;
    if (radii.some((r) => r >= 99)) return false;   // pills (999px, 99px)
    if (cs.boxShadow !== "none" || visibleBorder(cs)) return false;
    if ((cs.backdropFilter && cs.backdropFilter !== "none") || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== "none")) return false;
    if (cs.clipPath && cs.clipPath !== "none" && !el.hasAttribute("data-rl-sq")) return false;   // already shaped by the app
    return radii;
  }

  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const el = e.target, radii = done.get(el);
      if (!radii) continue;
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) continue;
      if (Math.max(...radii) * 2 >= Math.min(w, h) - 1) {   // rounded right round: a pill or circle at this size
        if (el.hasAttribute("data-rl-sq")) { el.style.removeProperty("clip-path"); el.removeAttribute("data-rl-sq"); }
        continue;
      }
      const key = w + "x" + h;
      if (el.getAttribute("data-rl-sq") === key) continue;
      el.style.setProperty("clip-path", `path('${shape(w, h, radii)}')`);
      el.setAttribute("data-rl-sq", key);
    }
  });

  function visit(el) {
    if (done.has(el)) return;
    const radii = look(el);
    done.set(el, radii);
    if (radii) ro.observe(el);
  }
  function scan(root) {
    if (root.nodeType !== 1) return;
    visit(root);
    const all = root.getElementsByTagName("*");
    for (let i = 0; i < all.length; i++) visit(all[i]);
  }

  // New things on screen: checked together once per frame. Class or style changes can round something new, so those
  // are looked at again too (only elements not already smoothed).
  let queue = new Set(), planned = false;
  function plan(node) {
    queue.add(node);
    if (planned) return;
    planned = true;
    requestAnimationFrame(() => {
      planned = false;
      const q = queue; queue = new Set();
      q.forEach((node) => scan(node));
    });
  }
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "childList") m.addedNodes.forEach((x) => { if (x.nodeType === 1) plan(x); });
      else if (m.target.nodeType === 1 && !done.get(m.target)) { done.delete(m.target); plan(m.target); }
    }
  });
  function start() {
    scan(document.body);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  window.relayCorners = { shape, count: () => document.querySelectorAll("[data-rl-sq]").length };
})();

/* Relay shopper sign-in: emailed one-time link, session kept in this browser only.
   All server data is written with textContent (never innerHTML). */
(function () {
  var API = "https://relay-square-api2.9pts72cy5j.workers.dev";
  var KEY = "relay.session.v1";
  // The shopper's name and photo, kept on this device so the avatar shows straight away (the server copy is the real one).
  var PROFILE_KEY = "relay.profile";
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  // Ask the browser not to clear Relay's saved sign-in when it tidies up storage.
  function keepStorage() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {} }
  // Keeps what the app has already loaded so moving between tabs is instant. It lives in memory only and is wiped on sign-out.
  var memo = { blobs: {}, consent: null, gmail: null, receipts: null, openCat: null, openIds: {} };
  // Logos fetched ahead of time for popular UK stores (domain -> file type). Anything else falls back to a live lookup.
  var STORE_LOGOS = {"morrisons.com":"png","aldi.co.uk":"png","lidl.co.uk":"svg","marksandspencer.com":"png","coop.co.uk":"png","boots.com":"ico","iceland.co.uk":"png","amazon.co.uk":"ico","spacenk.com":"ico","debenhams.com":"ico","selfridges.com":"ico","boohoo.com":"ico","ebay.co.uk":"ico","prettylittlething.com":"ico","missguided.co.uk":"png","newlook.com":"png","riverisland.com":"png","topshop.com":"png","primark.com":"ico","matalan.co.uk":"png","peacocks.co.uk":"png","dorothyperkins.com":"ico","burton.co.uk":"ico","bonmarche.co.uk":"ico","wallis.co.uk":"ico","nike.com":"png","jdsports.co.uk":"png","schuh.co.uk":"png","office.co.uk":"ico","drmartens.com":"png","gymshark.com":"png","ugg.com":"ico","trespass.com":"png","ikea.com":"ico","dunelm.com":"png","wayfair.co.uk":"ico","wickes.co.uk":"png","screwfix.com":"png","toolstation.com":"png","sofology.co.uk":"ico","furniturevillage.co.uk":"png","made.com":"ico","dreams.co.uk":"ico","apple.com":"png","box.co.uk":"ico","samsung.com":"png","laptopsdirect.co.uk":"png","overclockers.co.uk":"ico","hughes.co.uk":"ico","jessops.com":"png","smythstoys.com":"png","game.co.uk":"png","hmv.com":"ico","zooplus.co.uk":"png","petsathome.com":"ico","just-eat.co.uk":"png","deliveroo.co.uk":"png","greggs.co.uk":"png","ebuyer.com":"png","ubereats.com":"png","pret.co.uk":"svg","nandos.co.uk":"png","starbucks.co.uk":"png","costa.co.uk":"png","nationalrail.co.uk":"png","trainline.com":"png","booking.com":"png","airbnb.co.uk":"ico","easyjet.com":"ico","ryanair.com":"png","britishairways.com":"png"};
  var MEMO_MS = 5 * 60 * 1000;
  function memoFresh(e) { return e && Date.now() - e.at < MEMO_MS; }
  function memoReset() { memo = { blobs: {}, consent: null, gmail: null, receipts: null, openCat: null, openIds: {} }; try { localStorage.removeItem("relay.cache.v1"); } catch (e) {} }
  // The last receipts and shop orders are also kept on this device (for the signed-in account only, removed on sign-out),
  // so opening Relay shows them at once instead of a loading screen, then updates them.
  var DISK_KEY = "relay.cache.v1";
  function diskRead() { try { var c = JSON.parse(localStorage.getItem(DISK_KEY) || "null"), s = load(); return c && s && c.email && c.email === s.email ? c : null; } catch (e) { return null; } }
  function diskWrite(kind, value) {
    try { var s = load(); if (!s || !s.email) return; var c = diskRead() || { email: s.email }; c[kind] = value; c.at = Date.now();
      var t = JSON.stringify(c); if (t.length < 2500000) localStorage.setItem(DISK_KEY, t); else localStorage.removeItem(DISK_KEY); } catch (e) {}
  }
  (function () {
    var c = diskRead(); if (!c) return;
    if (Array.isArray(c.receipts)) memo.receipts = { rows: c.receipts, sig: JSON.stringify(c.receipts), at: 0 };
    if (Array.isArray(c.purchases)) memo.walletPurchases = c.purchases;
  })();
  // Asks the server only when the answer isn't already remembered (and recent enough).
  function cachedGet(kind, path) {
    if (memoFresh(memo[kind])) return Promise.resolve(memo[kind].r);
    return api(path).then(function (r) { if (r.ok) { memo[kind] = { at: Date.now(), r: r }; if (kind === "gmail") rememberMailbox(r.body); } return r; });
  }
  // Which inbox Relay reads for this shopper (Gmail or Outlook), remembered on the device so every screen names the right one.
  var MAILBOX_KEY = "relay.mailbox";
  function rememberMailbox(g) {
    try { if (g && g.connected) localStorage.setItem(MAILBOX_KEY, g.provider === "microsoft" ? "outlook" : "gmail"); else if (g) localStorage.removeItem(MAILBOX_KEY); } catch (e) {}
  }
  function mailName() { try { return localStorage.getItem(MAILBOX_KEY) === "outlook" ? "Outlook" : "Gmail"; } catch (e) { return "Gmail"; } }
  function mailOwner() { return mailName() === "Outlook" ? "Microsoft" : "Google"; }
  // An email Relay can open again: its id in Gmail or in Outlook.
  function mailRef(x) { return x && (/^[A-Za-z0-9]{6,40}$/.test(x.gmailId || "") || /^[A-Za-z0-9_=+\/-]{16,512}$/.test(x.outlookId || "")); }
  function save(v) { var was = load(); if (!v || (was && was.email !== v.email)) { memoReset(); try { localStorage.removeItem("relay.cache.v1"); } catch (e) {} } if (!v) { try { localStorage.removeItem(MAILBOX_KEY); localStorage.removeItem(PROFILE_KEY); } catch (e) {} } try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (e) {} if (!v) paintAvatars();
    if (((was && was.token) || null) !== ((v && v.token) || null)) { try { window.dispatchEvent(new Event("relay:session")); } catch (e) {} } }
  function api(path, opts) {
    opts = opts || {};
    var s = load(), headers = { "Content-Type": "application/json" };
    if (s && s.token) headers.Authorization = "Bearer " + s.token;
    return fetch(API + path, { method: opts.method || "GET", headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); });
  }
  // Fetches a signed-in image and returns a local address for it (or null).
  function apiBlob(path) {
    // Pictures and logos are fetched once per visit, not every time a list is redrawn.
    if (!memo.blobs[path]) memo.blobs[path] = apiBlobFetch(path).then(function (u) { if (!u) delete memo.blobs[path]; return u; });
    return memo.blobs[path];
  }
  function apiBlobFetch(path) {
    var s = load(), headers = {};
    if (s && s.token) headers.Authorization = "Bearer " + s.token;
    return fetch(API + path, { headers: headers }).then(function (r) { return r.ok ? r.blob() : null; })
      .then(function (b) { return b && /^image\//.test(b.type) ? URL.createObjectURL(b) : null; }).catch(function () { return null; });
  }
  function deadlineOf(x) {
    return (x.returnPlan && x.returnPlan.deadline) || (x.kind === "return_instructions" && x.deadline) || (x.returns && x.returns.deadline) ||
      (x.returnBy && x.returnable !== false && x.returnBy.date) || null;
  }
  // The shop's own logo in a picture box, when there's no photo of the item: one Relay keeps for well-known shops, or
  // the one Relay fetched once from the shop's website. The box keeps its initials until a logo has loaded.
  function shopLogo(box, dom, px) {
    if (!box || !dom || !/^[A-Za-z0-9.-]{3,80}$/.test(dom)) return;
    var put = function (src) {
      var pic = el("img", { alt: "", className: "rl-logo-img", style: "width:" + px + "px;height:" + px + "px;object-fit:contain" });
      pic.onload = function () { box.textContent = ""; box.classList.add("rl-has-logo"); box.appendChild(pic); };
      pic.src = src;
    };
    var known = Object.keys(STORE_LOGOS).filter(function (k) { return dom === k || dom.slice(-(k.length + 1)) === "." + k; })[0];
    if (known) return put("logos/" + known + "." + STORE_LOGOS[known]);
    apiBlob("/relay/my/logo/" + encodeURIComponent(dom)).then(function (u) { if (u) put(u); });
  }
  // Delivery companies send "on its way" emails of their own: they aren't the shop you bought from.
  var CARRIER_DOMAIN = /(^|\.)(royalmail\.(com|co\.uk)|parcelforce\.(com|co\.uk)|evri\.com|hermes(world|-europe)?\.(com|co\.uk)|myhermes\.co\.uk|dpd(local)?\.co\.uk|dpd\.com|yodel\.co\.uk|dhl\.(com|co\.uk)|ups\.com|fedex\.com|inpost\.co\.uk|tnt\.com|ukmail\.com|apc-overnight\.com)$/i;
  function isCarrier(x) { return CARRIER_DOMAIN.test(String((x && x.retailer && x.retailer.domain) || "")); }
  // "On its way" only while that's still likely: three weeks after the order (or the last delivery date). After that an
  // old "shipped" email says nothing about now, so it isn't shown and doesn't keep an order in the wallet.
  function freshDelivery(x) {
    var dv = x && x.delivery; if (!dv || !dv.status || dv.status === "delivered") return false;
    var ref = dv.at || x.orderDate; if (!ref || !/^\d{4}-\d{2}-\d{2}/.test(ref)) return false;
    return (Date.now() - Date.parse(ref.slice(0, 10) + "T00:00:00Z")) / 864e5 <= 21;
  }
  function daysLeft(dl) {
    if (!dl || !/^\d{4}-\d{2}-\d{2}$/.test(dl)) return null;
    return Math.round((Date.parse(dl) - Date.parse(new Date().toISOString().slice(0, 10))) / 864e5);
  }
  var css = document.createElement("style");
  css.textContent = ".rl-back{position:fixed;inset:0;background:rgba(15,27,51,.45);display:flex;align-items:flex-end;justify-content:center;z-index:9999}" +
    "@media(min-width:640px){.rl-back{align-items:center}}" +
    ".rl-sheet{background:#fffdf9;width:100%;max-width:420px;border-radius:28px 28px 0 0;padding:26px 22px calc(26px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.18);max-height:88vh;overflow:auto;font-family:inherit;color:#0f1b33}" +
    "@media(min-width:640px){.rl-sheet{border-radius:28px}}" +
    ".rl-sheet h2{font-family:Georgia,serif;font-weight:600;font-size:24px;margin:0 0 6px;letter-spacing:-.01em}" +
    ".rl-sheet p{margin:0 0 14px;color:#5b6475;font-size:15px;line-height:1.45}" +
    ".rl-sheet input{width:100%;box-sizing:border-box;padding:14px 16px;border:1px solid #ddd6c6;border-radius:16px;font-size:16px;background:#fff;margin-bottom:12px}" +
    ".rl-btn{display:block;width:100%;border:0;border-radius:999px;padding:14px 18px;font-size:16px;font-weight:600;background:#c7f567;color:#0f1b33;cursor:pointer}" +
    ".rl-btn.ghost{background:transparent;border:1px solid #ddd6c6;color:#0f1b33;margin-top:10px}" +
    ".rl-btn:disabled{opacity:.6}.rl-msg{min-height:20px;font-size:14px;margin:8px 0 0;color:#46601b}.rl-msg.err{color:#b3261e}" +
    ".rl-order{border:1px solid #ece4d3;border-radius:18px;padding:12px 14px;margin:10px 0;background:#fff}" +
    ".rl-po-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin:12px 0 8px}" +
    ".rl-po{background:#fff;border:1px solid #ebe6da;border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:10px;box-shadow:0 1px 2px rgba(16,24,40,.04)}" +
    ".rl-po-top{display:flex;gap:14px;align-items:flex-start}.rl-po-info{flex:1;min-width:0}" +
    ".rl-po-img{width:68px;height:68px;border-radius:16px;background:#f3efe6;flex:none;overflow:hidden;display:grid;place-items:center;font-weight:800;font-size:20px;color:#526549}" +
    ".rl-po-img img{width:100%;height:100%;object-fit:cover}.rl-has-logo{background:#fff!important;box-shadow:inset 0 0 0 1px #e7e1d2}.rl-po-img img.rl-logo-img{object-fit:contain}" +
    ".rl-po-shop{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#526549}" +
    ".rl-po h3{font-size:17px;line-height:1.25;margin:3px 0 2px;color:#101828}.rl-po-meta{font-size:13px;color:#667085}" +
    ".rl-po-price{font-weight:800;font-size:17px;white-space:nowrap;color:#101828}" +
    ".rl-po-status{font-size:13px;line-height:1.4;padding:8px 11px;border-radius:12px;background:#eef6df;color:#3f5a17}.rl-po-status.wait{background:#f4f2ec;color:#475467}" +
    ".rl-po-actions{display:flex;gap:8px;flex-wrap:wrap}" +
    ".rl-po-primary,.rl-po-secondary{flex:1 1 130px;min-height:44px;padding:10px 14px;border-radius:999px;font-weight:700;font-size:14px;border:1.5px solid #101828;text-align:center;text-decoration:none;cursor:pointer}" +
    ".rl-po-primary{background:#101828;color:#fff}.rl-po-secondary{background:#fff;color:#101828}.rl-po-primary:disabled,.rl-po-secondary:disabled{opacity:.6}" +
    ".rl-wr-years{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}.rl-wr-years button{all:unset;cursor:pointer;box-sizing:border-box;min-height:44px;display:inline-flex;align-items:center;padding:7px 18px;border-radius:999px;border:1px solid #d9d3c4;font-weight:800;font-size:14px;background:#fff;color:#101828}.rl-wr-years button.on{background:#101828;color:#c7f567;border-color:#101828}.rl-wr-kinds{display:flex;gap:8px;overflow-x:auto;margin:-4px -2px 14px;padding:2px;scrollbar-width:none}.rl-wr-kinds::-webkit-scrollbar{display:none}.rl-wr-kinds button{all:unset;flex:none;cursor:pointer;box-sizing:border-box;min-height:44px;display:inline-flex;align-items:center;padding:8px 17px;border-radius:999px;background:#f2f4ec;color:#263513;font-weight:750;font-size:14px}.rl-wr-kinds button.on{background:#c7f567;color:#16210a;box-shadow:inset 0 0 0 1.5px #16210a}" +
    ".rl-wr-cover{position:relative;overflow:hidden;border-radius:28px;padding:30px 28px;background:#101828;color:#fff;margin-bottom:16px}.rl-wr-cover h2{font-size:clamp(30px,4vw,44px);letter-spacing:-1.5px;line-height:1.05;margin:10px 0;color:#fff;max-width:560px}.rl-wr-cover p{color:#d4d4e5;margin:0 0 18px;font-size:15px}.rl-wr-kicker{color:#c7f567;font-size:12px;font-weight:900;letter-spacing:2px}@media(max-width:520px){.rl-wr-cover{padding:24px 22px}}" +
    ".rl-wr-play{all:unset;cursor:pointer;box-sizing:border-box;display:inline-flex;align-items:center;min-height:52px;background:#c7f567;color:#16210a;font-weight:900;padding:0 26px;border-radius:999px;font-size:16px;box-shadow:0 10px 30px rgba(199,245,103,.25)}.rl-wr-play:hover{transform:translateY(-1px)}" +
    ".rl-wr-glance{background:#fff;border:1px solid #ebe6da;border-radius:24px;padding:20px;margin-bottom:16px}.rl-wr-glance h3{margin:0 0 12px;font-size:18px;color:#101828}.rl-wr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}.rl-wr-stats div{background:#f7f5ef;border-radius:16px;padding:14px}.rl-wr-stats span{display:block;font-size:13px;color:#667085;font-weight:700}.rl-wr-stats strong{display:block;font-size:20px;color:#101828;margin:4px 0;word-break:break-word}.rl-wr-stats small{font-size:13px;color:#667085}.rl-wr-note{font-size:12px;color:#667085;margin:12px 0 0}" +
    ".rl-story{position:fixed;inset:0;z-index:10050;background:rgba(5,8,18,.92);display:flex;align-items:center;justify-content:center}.rl-story-frame{position:relative;width:min(440px,100vw);height:min(820px,100dvh);border-radius:26px;overflow:hidden;transition:background .5s,color .5s;cursor:pointer;user-select:none;-webkit-user-select:none}@media(max-width:500px){.rl-story-frame{border-radius:0}}" +
    ".rl-story-bars{position:absolute;top:12px;left:12px;right:12px;display:flex;gap:4px;z-index:2}.rl-story-bars div{flex:1;height:3px;border-radius:3px;background:rgba(127,127,127,.35);overflow:hidden}.rl-story-bars i{display:block;height:100%;width:0;background:currentColor}.rl-story-bars .done i{width:100%}.rl-story-bars .now i{animation:rlbar linear forwards}.rl-story-frame.paused .rl-story-bars .now i{animation-play-state:paused}@keyframes rlbar{to{width:100%}}" +
    ".rl-story-x{all:unset;position:absolute;top:22px;right:16px;z-index:3;font-size:30px;line-height:1;cursor:pointer;opacity:.8;padding:4px 8px}.rl-story-body{position:absolute;inset:0;display:flex;align-items:center;padding:56px 30px 40px}" +
    ".rl-story-slide{width:100%}.rl-story-slide>*{opacity:0;animation:rlup .6s cubic-bezier(.2,.8,.2,1) forwards}.rl-story-slide>*:nth-child(2){animation-delay:.15s}.rl-story-slide>*:nth-child(3){animation-delay:.35s}.rl-story-slide>*:nth-child(4){animation-delay:.55s}.rl-story-slide>*:nth-child(5){animation-delay:.75s}@keyframes rlup{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}" +
    ".rl-story-slide .k{font-size:12px;font-weight:900;letter-spacing:2px;color:var(--accent)}.rl-story-slide h1{font-size:42px;line-height:1.02;letter-spacing:-1.5px;margin:14px 0}.rl-story-slide p{font-size:18px;line-height:1.4;margin:10px 0;opacity:.9}.rl-story-slide .lead{font-size:20px;font-weight:800;opacity:1}.rl-story-slide .big{font-size:64px;font-weight:900;letter-spacing:-2.5px;line-height:1;margin:12px 0;color:var(--accent);word-break:break-word}.rl-story-slide .big.name{font-size:46px;letter-spacing:-1.5px}.rl-story-slide .fine{font-size:13px;opacity:.75}.rl-story-slide .pill{display:inline-block;border:2px solid currentColor;border-radius:999px;padding:6px 14px;font-weight:800;font-size:15px}" +
    ".rl-story-slide .rank{list-style:none;padding:0;margin:16px 0 0}.rl-story-slide .rank li{display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.15);opacity:0;animation:rlup .5s forwards;font-size:19px;font-weight:800}.rl-story-slide .rank b{font-size:28px;color:var(--accent);width:28px}.rl-story-slide .rank span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rl-story-slide .rank em{font-style:normal;font-size:14px;opacity:.75;font-weight:600}" +
    ".rl-story-slide .bars{margin-top:18px}.rl-story-slide .bar{display:grid;grid-template-columns:1fr 2fr auto;gap:10px;align-items:center;margin:8px 0;font-weight:700;font-size:14px}.rl-story-slide .bar i{display:block;height:14px;border-radius:7px;background:currentColor;width:0;animation:rlw .9s cubic-bezier(.2,.8,.2,1) forwards}@keyframes rlw{to{width:var(--w)}}.rl-story-slide .bar em{font-style:normal}" +
    ".rl-story-slide .months{display:flex;align-items:flex-end;gap:5px;height:150px;margin:20px 0 6px}.rl-story-slide .months div{flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;gap:6px}.rl-story-slide .months i{display:block;width:100%;border-radius:6px 6px 2px 2px;background:currentColor;opacity:.35;height:0;animation:rlh .8s cubic-bezier(.2,.8,.2,1) forwards}.rl-story-slide .months i.hot{opacity:1;background:var(--accent)}.rl-story-slide .months span{font-size:11px;opacity:.7}@keyframes rlh{to{height:var(--h)}}" +
    ".rl-story-slide .ph{display:grid;gap:8px;margin:16px 0 8px}.rl-story-slide .ph.n1{grid-template-columns:1fr}.rl-story-slide .ph.n2,.rl-story-slide .ph.n4{grid-template-columns:1fr 1fr}.rl-story-slide .ph.n3,.rl-story-slide .ph.n5,.rl-story-slide .ph.n6,.rl-story-slide .ph.n7,.rl-story-slide .ph.n8,.rl-story-slide .ph.n9{grid-template-columns:1fr 1fr 1fr}" +
    ".rl-story-slide .ph figure{margin:0;background:#fff;border-radius:16px;overflow:hidden;aspect-ratio:1;position:relative;opacity:0;animation:rlpop .5s cubic-bezier(.2,.8,.2,1) forwards}.rl-story-slide .ph.n1 figure{aspect-ratio:4/5;max-height:46vh}.rl-story-slide .ph img{width:100%;height:100%;object-fit:contain;display:block}.rl-story-slide .ph figcaption{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(transparent,rgba(0,0,0,.65));color:#fff;font-size:11px;font-weight:700;padding:14px 8px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@keyframes rlpop{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:none}}" +
    ".rl-story-slide .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.rl-story-slide .chips span{border:2px solid currentColor;border-radius:999px;padding:6px 12px;font-weight:800;font-size:14px;display:inline-flex;align-items:center;gap:6px}.rl-story-slide .chips i{width:12px;height:12px;border-radius:50%;box-shadow:0 0 0 1px rgba(0,0,0,.25)}" +
    ".rl-story-slide .sprint{margin-top:18px;display:grid;gap:10px}.rl-story-slide .sprint .row{display:grid;grid-template-columns:96px repeat(12,1fr);gap:3px;align-items:center;font-size:12px;font-weight:800}.rl-story-slide .sprint .row span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:4px}.rl-story-slide .sprint i{display:block;aspect-ratio:1;border-radius:4px;background:var(--accent);opacity:0;animation:rlfade .4s forwards}.rl-story-slide .sprint .head i{background:none;opacity:1;animation:none;font-style:normal;text-align:center;font-size:10px;opacity:.7}@keyframes rlfade{to{opacity:var(--o)}}" +
    ".rl-story-slide .badges{display:grid;gap:10px;margin-top:16px}.rl-story-slide .badges div{border:2px solid currentColor;border-radius:18px;padding:12px 14px;opacity:0;animation:rlup .5s forwards}.rl-story-slide .badges b{display:block;font-size:19px;color:var(--accent)}.rl-story-slide .badges small{font-size:13px;opacity:.85}" +
    ".rl-wr-strip{display:flex;gap:8px;overflow-x:auto;margin:4px 0 2px}.rl-wr-strip figure{margin:0;flex:none;width:96px}.rl-wr-strip .im{width:96px;height:96px;border-radius:14px;background:#f4f1ea;overflow:hidden}.rl-wr-strip img{width:100%;height:100%;object-fit:contain}.rl-wr-strip figcaption{font-size:12px;color:#475467;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".rl-story-slide .sum{background:#1f3d2b;border-radius:24px;padding:22px}.rl-story-slide .sumgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}.rl-story-slide .sumgrid span{display:block;font-size:12px;opacity:.75;font-weight:700}.rl-story-slide .sumgrid strong{display:block;font-size:20px;word-break:break-word}.rl-story-slide .acts{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}.rl-story-slide .acts button{all:unset;cursor:pointer;background:#c7f567;color:#16210a;font-weight:900;padding:12px 20px;border-radius:999px}.rl-story-slide .acts button.ghost{background:transparent;color:inherit;border:1px solid rgba(255,255,255,.4)}" +
    ".rl-po-status.urgent{background:#fde7e4;color:#a5281d}.rl-skel{min-height:132px;background:linear-gradient(90deg,#f4f2ec,#fbfaf6,#f4f2ec);background-size:200% 100%;animation:rlsk 1.2s infinite}@keyframes rlsk{to{background-position:-200% 0}}" +
    ".rl-empty{background:#fff;border:1px dashed #d9d3c4;border-radius:22px;padding:22px}.rl-empty h3{margin:0 0 6px;font-size:18px;color:#101828}.rl-empty p{margin:0 0 12px;color:#475467;font-size:14px}" +
    ".rl-cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));grid-auto-rows:1fr;gap:12px;margin-top:8px}" +
    ".rl-face{display:inline-grid;place-items:center;border-radius:50%;overflow:hidden;background:#e9efd6;color:#2b3d12;font-weight:900;line-height:1;flex:none;box-shadow:0 0 0 1px rgba(16,24,40,.06)}.rl-face img{width:100%;height:100%;object-fit:cover;display:block}" +
    ".avatar.rl-has-photo{width:44px;height:44px;padding:0;box-sizing:border-box;background-size:cover;background-position:center;background-repeat:no-repeat}" +
    ".rl-po-more{margin:6px 0 4px;padding:10px 16px;border-radius:999px;border:1.5px solid #101828;background:#fff;font-weight:700;cursor:pointer}" +
    ".rl-order b{display:block}.rl-order span{color:#5b6475;font-size:14px}" +
    // The Account page: full height on a phone, grouped rows like a phone's Settings.
    ".rl-sheet.rl-full{max-width:560px;background:#f6f3ec;padding:0 16px calc(28px + env(safe-area-inset-bottom));min-height:min(92dvh,880px);max-height:calc(94dvh - var(--rl-kb,0px))}" +
    "@media(max-width:639px){.rl-sheet.rl-full{border-radius:22px 22px 0 0}}" +
    ".rl-abar{position:sticky;top:0;z-index:2;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;margin:0 -16px;padding:6px 8px;background:rgba(246,243,236,.94);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}" +
    ".rl-abar-t{font-size:16px;color:#101828;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:56vw}" +
    ".rl-abtn{all:unset;box-sizing:border-box;cursor:pointer;min-height:44px;display:inline-flex;align-items:center;gap:2px;padding:0 10px;border-radius:12px;font-size:16px;font-weight:600;color:#101828;justify-self:start}" +
    ".rl-abtn.done{justify-self:end;font-weight:800}.rl-abtn:active{background:rgba(16,24,40,.08)}.rl-abtn:focus-visible{outline:2px solid #101828;outline-offset:2px}.rl-ab-i{display:inline-flex}" +
    ".rl-sheet h2.rl-atitle{font-family:Georgia,serif;font-size:32px;margin:2px 2px 14px;letter-spacing:-.02em;color:#101828}" +
    ".rl-ahead{all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;align-items:center;gap:14px;background:#fff;border:1px solid #ebe5d8;border-radius:20px;padding:16px;transition:background .15s}" +
    ".rl-ahead:active{background:#f3efe6}.rl-ahead:focus-visible{outline:2px solid #101828;outline-offset:2px}" +
    ".rl-ahead-t{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}.rl-ahead-t b{font-size:19px;color:#101828;overflow:hidden;text-overflow:ellipsis}" +
    ".rl-ahead-t span{font-size:14px;color:#5b6475;word-break:break-all}.rl-ahead-t em{font-style:normal;font-size:14px;font-weight:700;color:#3f6212;margin-top:2px}" +
    ".rl-agroup{margin-top:22px}.rl-agroup h3{margin:0 4px 8px;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#5b6475}" +
    ".rl-acard{background:#fff;border:1px solid #ebe5d8;border-radius:18px;overflow:hidden}" +
    ".rl-arow{all:unset;box-sizing:border-box;cursor:pointer;width:100%;min-height:56px;display:flex;align-items:center;gap:12px;padding:10px 14px;transition:background .15s}" +
    ".rl-arow+.rl-arow{border-top:1px solid #f0ebe0}.rl-arow:active{background:#f3efe6}.rl-arow:focus-visible{outline:2px solid #101828;outline-offset:-2px}" +
    ".rl-ai{flex:none;width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#f1ede3;color:#101828}" +
    ".rl-arow-t{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}.rl-arow-t b{font-size:16px;font-weight:650;color:#101828}.rl-arow-d{font-size:13.5px;color:#5b6475}" +
    ".rl-arow-c{flex:none;display:inline-flex;color:#a39d90}" +
    ".rl-arow.danger b{color:#b3261e}.rl-arow.danger .rl-ai{background:#fde8e6;color:#b3261e}" +
    ".rl-aout{all:unset;box-sizing:border-box;cursor:pointer;width:100%;min-height:52px;margin-top:22px;text-align:center;background:#fff;border:1px solid #ebe5d8;border-radius:18px;font-size:16px;font-weight:700;color:#b3261e;transition:background .15s}" +
    ".rl-aout:active{background:#f3efe6}.rl-aout:disabled{opacity:.6}.rl-aout:focus-visible{outline:2px solid #101828;outline-offset:2px}" +
    ".rl-afoot{text-align:center;font-size:13px!important;color:#5b6475;margin:14px 0 0!important;word-break:break-all}" +
    ".rl-asub{background:#fff;border:1px solid #ebe5d8;border-radius:18px;padding:18px 16px;margin-top:8px}" +
    ".rl-asub>div>h2:first-child,.rl-asub>h2:first-child{display:none}" +
    ".rl-anote{font-size:13.5px!important;margin:6px 2px 16px!important}.rl-aterm{color:#101828!important}" +
    ".rl-full .rl-msg:empty{display:none}.rl-full>h2:first-child{margin-top:24px}" +
    ".rl-btn.rl-red{color:#b3261e}.rl-btn.rl-danger{background:#b3261e;color:#fff}" +
    ".rl-faq{border-top:1px solid #f0ebe0}.rl-faq:first-child{border-top:0}.rl-faq summary{cursor:pointer;min-height:48px;display:flex;align-items:center;font-weight:700;font-size:16px;color:#101828;list-style:none;padding:6px 0}" +
    ".rl-faq summary::-webkit-details-marker{display:none}.rl-faq summary::after{content:'';margin-left:auto;width:8px;height:8px;border-right:2px solid #a39d90;border-bottom:2px solid #a39d90;transform:rotate(45deg);transition:transform .15s;flex:none}" +
    ".rl-faq[open] summary::after{transform:rotate(-135deg)}.rl-faq p{margin:0 0 14px!important}" +
    ".rl-sheet .rl-arow:active,.rl-sheet .rl-ahead:active,.rl-sheet .rl-aout:active{transform:scale(.985);filter:none}" +
    "@media(prefers-reduced-motion:reduce){.rl-arow,.rl-ahead,.rl-aout,.rl-faq summary::after{transition:none}.rl-sheet .rl-arow:active,.rl-sheet .rl-ahead:active,.rl-sheet .rl-aout:active{transform:none}}" +
    // Getting started: the journey from Welcome to "You're all set".
    ".rl-jr{padding-top:0}.rl-jtop{position:sticky;top:0;z-index:2;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;margin:0 -16px;padding:6px 8px;background:rgba(246,243,236,.94);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}" +
    ".rl-dots{display:flex;gap:6px}.rl-dots span{width:8px;height:8px;border-radius:99px;background:#d9d3c4;transition:width .2s,background .2s}.rl-dots span.on{width:22px;background:#101828}.rl-dots span.done{background:#7da23a}" +
    ".rl-jbody{padding:8px 2px 4px}.rl-jkick{font-size:12px;font-weight:800;letter-spacing:.1em;color:#3f6212;margin:6px 0 6px}" +
    ".rl-sheet h2.rl-jh{font-family:Georgia,serif;font-size:30px;line-height:1.1;letter-spacing:-.02em;color:#101828;margin:6px 0 10px}" +
    ".rl-sheet p.rl-jsub{font-size:16px;color:#475467;margin:0 0 20px}" +
    ".rl-jcard{background:#fff;border:1px solid #ebe5d8;border-radius:18px;padding:6px 16px;margin:0 0 16px}" +
    ".rl-jpt{display:flex;gap:12px;align-items:flex-start;padding:10px 0;font-size:15px;color:#101828;line-height:1.4}.rl-jpt+.rl-jpt{border-top:1px solid #f0ebe0}" +
    ".rl-jic{flex:none;display:inline-grid;place-items:center;color:#3f6212;margin-top:1px}" +
    ".rl-jwords{margin:0 0 16px;background:#efeadf;border-radius:16px;padding:12px 12px 4px;max-height:32vh;overflow:auto}.rl-jwords>b{display:block;font-size:14px;color:#101828;margin:0 2px 8px}.rl-jwords:focus-visible{outline:2px solid #101828;outline-offset:2px}" +
    ".rl-jwords p{font-size:14px!important;color:#344054!important;background:#fff;border-radius:12px;padding:10px 12px;margin:0 0 8px!important}" +
    ".rl-btn.rl-prov{background:#fff;color:#101828;border:1.5px solid #101828;margin-top:10px}.rl-btn.rl-prov:first-child{margin-top:0}" +
    ".rl-jr .rl-btn+.rl-btn{margin-top:10px}" +
    ".rl-sheet p.rl-jnote{font-size:13.5px;color:#5b6475;margin:10px 2px 0}" +
    ".rl-sheet p.rl-jlegal{font-size:13px;color:#5b6475;margin:22px 2px 0;text-align:center}.rl-jlegal a{color:#3f6212;font-weight:700;display:inline-block;line-height:20px;padding:12px 2px;margin:-12px 0}" +
    ".rl-jhint{margin-top:14px}.rl-jhint p{font-size:14px!important;color:#344054!important;margin:0 0 4px!important}" +
    ".rl-jlabel{display:block;font-weight:700;font-size:14px;margin:4px 0 6px;color:#101828}" +
    ".rl-jscan{background:#101828;color:#fff;border-radius:18px;padding:16px;margin:0 0 18px}.rl-jscan-t{display:flex;gap:12px;align-items:center}.rl-jscan .rl-jic{color:#c7f567;width:36px;height:36px;border-radius:10px;background:rgba(199,245,103,.12)}" +
    ".rl-jscan b{display:block;font-size:17px}.rl-jscan span{display:block;font-size:13.5px;color:#c9d0df}" +
    ".rl-jbar{height:6px;border-radius:99px;background:rgba(255,255,255,.14);margin-top:14px;overflow:hidden}.rl-jbar i{display:block;height:100%;width:6%;background:#c7f567;border-radius:99px;transition:width .6s ease}" +
    "@media(prefers-reduced-motion:reduce){.rl-jbar i,.rl-dots span{transition:none}}" +
    // A group's page: header, filters, receipts by month.
    ".rl-cat-back{all:unset;box-sizing:border-box;cursor:pointer;min-height:44px;display:inline-flex;align-items:center;gap:6px;padding:0 14px 0 10px;border-radius:999px;background:#fff;border:1px solid #e7e1d2;font-weight:700;font-size:15px;color:#101828}.rl-cat-back-i{font-size:22px;line-height:1;margin-top:-2px}" +
    ".rl-cat-back:active{background:#f3efe6}.rl-cat-back:focus-visible{outline:2px solid #101828;outline-offset:2px}" +
    ".rl-cat-hero{display:flex;gap:16px;align-items:center;border-radius:24px;padding:18px;margin:14px 0 14px}.rl-cat-hero h3{margin:0;font-family:Georgia,serif;font-size:28px;letter-spacing:-.02em;line-height:1.1}.rl-cat-hero-t span{display:block;font-size:14px;font-weight:600;opacity:.85;margin-top:4px}" +
    ".rl-cat-note{font-size:13.5px;color:#5b6475;margin:-4px 2px 12px}" +
    ".rl-cat-chips{display:flex;gap:8px;overflow-x:auto;padding:2px;margin:0 -2px 12px;scrollbar-width:none}.rl-cat-chips::-webkit-scrollbar{display:none}" +
    ".rl-cat-chips button{all:unset;flex:none;box-sizing:border-box;cursor:pointer;min-height:44px;display:inline-flex;align-items:center;padding:0 16px;border-radius:999px;background:#fff;border:1px solid #e7e1d2;font-weight:700;font-size:14px;color:#101828}" +
    ".rl-cat-chips button.on{background:#101828;color:#fff;border-color:#101828}.rl-cat-chips button:focus-visible{outline:2px solid #101828;outline-offset:2px}" +
    ".rl-cat-search{width:100%;box-sizing:border-box;min-height:48px;padding:12px 16px;border:1px solid #e7e1d2;border-radius:14px;font-size:16px;background:#fff;font-family:inherit;margin:0 0 6px}" +
    ".rl-cat-month{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin:18px 4px 8px}.rl-cat-month b{font-size:15px;color:#101828}.rl-cat-month span{font-size:13px;color:#5b6475}" +
    ".rl-cat-list{background:#fff;border:1px solid #ebe5d8;border-radius:18px;overflow:hidden}" +
    ".rl-rr+.rl-rr{border-top:1px solid #f0ebe0}.rl-rr.open{background:#fbfaf6}" +
    ".rl-rr-main{all:unset;box-sizing:border-box;cursor:pointer;width:100%;min-height:68px;display:flex;align-items:center;gap:12px;padding:10px 14px;transition:background .15s}" +
    ".rl-rr-main:active{background:#f3efe6}.rl-rr-main:focus-visible{outline:2px solid #101828;outline-offset:-2px}" +
    ".rl-rr-pic{flex:none;width:48px;height:48px;border-radius:14px;background:#f1ecdf;display:grid;place-items:center;overflow:hidden;font-weight:800;font-size:15px;color:#46601b}.rl-rr-pic.rl-has-photo img{width:100%;height:100%;object-fit:cover}" +
    ".rl-rr-mid{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.rl-rr-mid b{font-size:15.5px;color:#101828;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rl-rr-mid span{font-size:13.5px;color:#5b6475;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".rl-rr-end{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:4px;text-align:right}.rl-rr-end b{font-size:15.5px;color:#101828}" +
    ".rl-rr-chip{font-size:12px;font-weight:800;padding:3px 8px;border-radius:999px}.rl-rr-chip.green{background:#e3f4c8;color:#3f5a17}.rl-rr-chip.amber{background:#ffefc9;color:#77520a}.rl-rr-chip.red{background:#fde0dd;color:#b3261e}" +
    ".rl-rr-detail{padding:0 14px 14px}.rl-rr-items{font-size:14px;color:#344054;margin:0 0 8px}.rl-rr-acts{display:flex;gap:8px;margin:10px 0 0}.rl-rr-move{margin-top:10px;width:100%;min-height:44px}.rl-rr-note{display:block;font-size:13px;color:#5b6475;margin-top:4px}" +
    ".rl-cat-more{display:block;margin:14px auto 0;width:auto;min-height:44px;padding:0 20px}" +
    "@media(max-width:420px){.rl-cat-hero h3{font-size:24px}.rl-rr-main{padding:10px 12px;gap:10px}.rl-rr-pic{width:44px;height:44px}}" +
    // The phone keyboard never covers what you're typing in a sheet: the sheet sits above it.
    ".rl-back{padding-bottom:var(--rl-kb,0px);transition:padding-bottom .15s}.rl-sheet{max-height:calc(88dvh - var(--rl-kb,0px))}";
  document.head.appendChild(css);
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) { if (k === "text") n.textContent = props[k]; else n[k] = props[k]; });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }
  // Receipt group icons: simple line drawings on a soft tile, one colour pair per group (no emoji, which look different on every phone).
  var CAT_ICONS = {
    fashion: ["#FCE7F3", "#9D174D", '<path d="M9 3.5 4 5.8 2.5 10l3.2 1.3L7 10v10.5h10V10l1.3 1.3 3.2-1.3L20 5.8 15 3.5c-.4 1.5-1.6 2.5-3 2.5s-2.6-1-3-2.5Z"/>'],
    electronics: ["#E0F2FE", "#075985", '<rect x="4.5" y="5" width="15" height="10.5" rx="1.5"/><path d="M2.5 19h19"/>'],
    food: ["#FEF3C7", "#92400E", '<path d="M4.5 9.5h12v4.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5Z"/><path d="M16.5 11h1.25a2.25 2.25 0 0 1 0 4.5H16"/><path d="M8.5 3.5c-.6.8-.6 1.7 0 2.5M12.5 3.5c-.6.8-.6 1.7 0 2.5"/>'],
    home: ["#ECFCCB", "#3F6212", '<path d="M3.5 10.5 12 4l8.5 6.5"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-5.5h4V20"/>'],
    beauty: ["#FAE8FF", "#86198F", '<path d="M11 3.5c.5 3.6 2.4 5.5 6 6-3.6.5-5.5 2.4-6 6-.5-3.6-2.4-5.5-6-6 3.6-.5 5.5-2.4 6-6Z"/><path d="M18 14.5c.3 1.6 1 2.3 2.5 2.5-1.5.2-2.2.9-2.5 2.5-.3-1.6-1-2.3-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5Z"/>'],
    travel: ["#E0E7FF", "#3730A3", '<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5v-2A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5v2"/><path d="M3.5 12.5h17"/>'],
    digital: ["#CCFBF1", "#115E59", '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M10 9.2v5.6l4.6-2.8Z"/>'],
    other: ["#F1F5F9", "#334155", '<path d="M6.5 3.5h11v17l-1.85-1.2-1.85 1.2-1.8-1.2-1.85 1.2-1.8-1.2-1.85 1.2Z"/><path d="M9.5 8h5M9.5 11.5h5M9.5 15h3"/>'],
    shop: ["rgba(199,245,103,.16)", "#c7f567", '<path d="M5 8h14l-1.2 12.5H6.2Z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>']
  };
  function catIcon(k, size) {
    var c = CAT_ICONS[k] || CAT_ICONS.other, px = size || 44;
    var tile = el("span", { className: "rl-cat-ico", style: "display:inline-grid;place-items:center;flex:none;width:" + px + "px;height:" + px + "px;border-radius:" + Math.round(px * 0.32) + "px;background:" + c[0] + ";color:" + c[1] });
    tile.setAttribute("aria-hidden", "true");
    var g = Math.round(px * 0.55);
    tile.innerHTML = '<svg viewBox="0 0 24 24" width="' + g + '" height="' + g + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + c[2] + "</svg>";
    return tile;
  }

  // ---- Your name and photo. Only you see them: Relay never shows them to shops or other members. ----
  var PHOTO_SHAPE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/]+={0,2}$/;
  function profileNow() {
    var s = load(); if (!s || !s.token) return null;
    var p = null; try { p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"); } catch (e) {}
    if (!p || p.email !== s.email) p = {};
    return { email: s.email || "", name: typeof p.name === "string" ? p.name : null, photo: PHOTO_SHAPE.test(p.photo || "") ? p.photo : null };
  }
  function keepProfile(p) {
    var s = load();
    try { if (s && p) localStorage.setItem(PROFILE_KEY, JSON.stringify({ email: s.email, name: p.name || null, photo: p.photo || null })); } catch (e) {}
  }
  var profileWatchers = [];
  function profileChanged() {
    paintAvatars();
    // Each screen showing the name or photo redraws itself; one that has been closed drops out.
    profileWatchers = profileWatchers.filter(function (f) { try { return f() !== false; } catch (e) { return false; } });
  }
  // Both initials, like the top of Spotify or Apple Music: "Connor Gamble" is CG. With no name yet, the email's
  // own parts are used (connor.gamble@ is CG); a single word gives its first letter.
  function firstLetter(p) {
    function first(w) { return Array.from(w)[0].toUpperCase(); }
    var name = String((p && p.name) || "").trim();
    var words = name ? name.split(/[\s\-]+/) : String((p && p.email) || "").split("@")[0].split(/[._+\-\d]+/);
    words = words.filter(function (w) { return /^\p{L}/u.test(w); });
    if (words.length > 1) return first(words[0]) + first(words[words.length - 1]);
    if (words.length) return first(words[0]);
    var t = name || String((p && p.email) || "").trim();
    return t ? first(t) : "R";
  }
  // A round picture of the shopper: their photo, or the first letter of their name (or email).
  function face(p, px) {
    var n = el("span", { className: "rl-face", style: "width:" + px + "px;height:" + px + "px;font-size:" + Math.round(px * 0.38) + "px" });
    n.setAttribute("aria-hidden", "true");
    if (p && p.photo) n.appendChild(el("img", { src: p.photo, alt: "" })); else n.textContent = firstLetter(p);
    return n;
  }
  // The round button at the top of every page.
  function paintAvatars() {
    var p = profileNow();
    Array.prototype.forEach.call(document.querySelectorAll(".avatar"), function (a) {
      var photo = Boolean(p && p.photo);
      a.classList.toggle("rl-has-photo", photo);
      a.style.backgroundImage = photo ? 'url("' + p.photo + '")' : "";
      a.textContent = photo ? "" : p ? firstLetter(p) : "R";
    });
  }
  var profileLoading = null;
  function loadProfile() {
    var s = load(); if (!s || !s.token) return Promise.resolve(null);
    if (!profileLoading) profileLoading = api("/relay/my/profile").then(function (r) {
      profileLoading = null;
      if (r.ok && r.body && r.body.email === (load() || {}).email) { keepProfile(r.body); profileChanged(); }
      return profileNow();
    }, function () { profileLoading = null; return profileNow(); });
    return profileLoading;
  }
  // Cuts the chosen photo to a centred square and shrinks it to 256 × 256 on this device. Re-drawing it also leaves the
  // camera's details (like where it was taken) behind. Only this small copy is sent to Relay.
  function squarePhoto(file) {
    return new Promise(function (resolve, reject) {
      if (file.type && !/^image\//.test(file.type)) return reject(new Error("not a picture"));
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight, side = Math.min(w, h);
          if (!side) throw new Error("empty");
          var c = document.createElement("canvas"); c.width = c.height = 256;
          var g = c.getContext("2d"); g.fillStyle = "#ffffff"; g.fillRect(0, 0, 256, 256); g.imageSmoothingQuality = "high";
          g.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 256, 256);
          var out = c.toDataURL("image/jpeg", 0.86);
          if (out.length > 180000) out = c.toDataURL("image/jpeg", 0.7);
          URL.revokeObjectURL(url);
          if (!PHOTO_SHAPE.test(out)) throw new Error("couldn't make a picture");
          resolve(out);
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
      img.src = url;
    });
  }
  function profileView(sheet, onBack, backLabel) {
    var p = profileNow() || { email: "" };
    var photo = p.photo, photoChanged = false;
    var msg = el("div", { className: "rl-msg" });
    var nameIn = el("input", { type: "text", id: "rl-name", maxLength: 40, autocomplete: "name", placeholder: "Your name", value: p.name || "" });
    nameIn.setAttribute("aria-label", "Your name");
    var holder = el("div", { style: "display:flex;justify-content:center;margin:4px 0 12px" });
    var file = el("input", { type: "file", accept: "image/*", style: "display:none" });
    file.setAttribute("aria-label", "Choose a profile photo");
    var pick = el("button", { type: "button", className: "rl-btn ghost", style: "margin-top:0", onclick: function () { file.click(); } });
    var drop = el("button", { type: "button", className: "rl-btn ghost", text: "Remove photo", onclick: function () { photo = null; photoChanged = true; draw(); } });
    function draw() {
      holder.textContent = "";
      holder.appendChild(el("button", { type: "button", ariaLabel: photo ? "Change your photo" : "Add a photo", style: "all:unset;cursor:pointer;border-radius:50%", onclick: function () { file.click(); } },
        [face({ email: p.email, name: nameIn.value.trim() || p.name, photo: photo }, 96)]));
      pick.textContent = photo ? "Choose a different photo" : "Add a photo";
      drop.style.display = photo ? "" : "none";
    }
    file.onchange = function () {
      var f = file.files && file.files[0]; file.value = "";
      if (!f) return;
      say(msg, "Getting your photo ready…");
      squarePhoto(f).then(function (d) { photo = d; photoChanged = true; draw(); say(msg, ""); },
        function () { say(msg, "That photo couldn't be opened. Try a JPEG or PNG photo.", true); });
    };
    nameIn.addEventListener("input", function () { if (!photo) draw(); });
    var saveBtn = el("button", { type: "button", className: "rl-btn", text: "Save" });
    saveBtn.onclick = function () {
      var body = { name: nameIn.value.trim() || null };
      if (photoChanged) body.photo = photo;
      saveBtn.disabled = true; say(msg, "Saving…");
      api("/relay/my/profile", { method: "POST", body: body }).then(function (r) {
        saveBtn.disabled = false;
        if (r.ok) { keepProfile(r.body); profileChanged(); say(msg, "Saved."); if (onBack) onBack(); return; }
        say(msg, r.body && r.body.error === "bad_name" ? "Use letters, spaces, hyphens or apostrophes, up to 40 characters." :
          r.body && (r.body.error === "bad_photo" || r.body.error === "photo_too_big") ? "That photo couldn't be used. Try a different one." : "Couldn't save. Try again.", true);
      }).catch(function () { saveBtn.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
    };
    sheet.appendChild(el("h2", { text: "Your profile" }));
    sheet.appendChild(el("p", { text: "Add your name and a photo. Only you can see them." }));
    sheet.appendChild(holder); sheet.appendChild(file); sheet.appendChild(pick); sheet.appendChild(drop);
    sheet.appendChild(el("label", { htmlFor: "rl-name", text: "Your name", style: "display:block;font-weight:700;font-size:14px;margin:16px 0 6px" }));
    sheet.appendChild(nameIn); sheet.appendChild(saveBtn); sheet.appendChild(msg);
    sheet.appendChild(el("button", { type: "button", className: "rl-btn ghost", text: backLabel || "Back", onclick: function () { if (onBack) onBack(); else close(); } }));
    draw();
  }
  function editProfile() { open(function (sheet) { profileView(sheet, close, "Cancel"); }); }
  // The top of the Profile page: photo, name and email, and a way to change them.
  function mountProfile(host, actions) {
    if (!host) return;
    function draw() {
      if (!document.body.contains(host)) return false;
      host.textContent = "";
      var p = profileNow();
      if (!p) return;
      host.appendChild(el("div", { style: "display:flex;gap:16px;align-items:center;margin:0 0 12px" }, [
        el("button", { type: "button", ariaLabel: p.photo ? "Change your photo" : "Add a photo", style: "all:unset;cursor:pointer;border-radius:50%;flex:none", onclick: editProfile }, [face(p, 64)]),
        el("div", { style: "min-width:0" }, [
          el("h2", { text: p.name || p.email, style: "margin:0 0 2px;word-break:break-word" }),
          el("div", { className: "small muted", text: p.name ? p.email : "Add your name and a photo so Relay feels like yours.", style: "word-break:break-all" })])]));
      var edit = el("button", { type: "button", className: "outline", text: p.name || p.photo ? "Edit profile" : "Add name and photo", onclick: editProfile });
      if (actions && document.body.contains(actions)) {
        var old = actions.querySelector("[data-rl-edit]"); if (old) old.remove();
        edit.setAttribute("data-rl-edit", "1"); actions.insertBefore(edit, actions.firstChild);
      } else host.appendChild(edit);
    }
    profileWatchers.push(draw);
    draw();
    loadProfile();
  }
  function askBox(message, yesLabel, withText, onYes) {
    var input = withText ? el("textarea", { rows: 3, style: "width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #ddd6c6;border-radius:16px;font:inherit;font-size:15px;margin-bottom:6px" }) : null;
    var card = el("div", { className: "rl-sheet", role: "alertdialog", ariaModal: "true" }, [el("p", { text: message, style: "color:#0f1b33;font-size:16px" })]);
    var layer = el("div", { className: "rl-back", style: "z-index:10000" }, [card]);
    function done() { layer.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") done(); }
    if (input) card.appendChild(input);
    card.appendChild(el("button", { className: "rl-btn", text: yesLabel || "Yes, continue", onclick: function () { var v = input ? input.value : true; done(); onYes(v); } }));
    card.appendChild(el("button", { className: "rl-btn ghost", text: "Cancel", onclick: done }));
    layer.addEventListener("click", function (e) { if (e.target === layer) done(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(layer);
    (input || card.querySelector("button")).focus();
  }
  function ask(message, yesLabel, onYes) { askBox(message, yesLabel, false, onYes); }
  function askText(message, yesLabel, onText) { askBox(message, yesLabel, true, onText); }
  var back = null;
  function close() { if (back) { back.remove(); back = null; } if (pageLaunchers) pageLaunchers(); }
  var pageLaunchers = null;
  function open(build) {
    close();
    var sheet = el("div", { className: "rl-sheet", role: "dialog" });
    back = el("div", { className: "rl-back" }, [sheet]);
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    document.body.appendChild(back);
    build(sheet);
  }
  var errors = { invalid_email: "That doesn't look like an email address.", too_many_requests: "Too many attempts. Please try again later.",
    sign_in_not_configured: "Sign-in isn't switched on yet.", email_send_failed: "We couldn't send the email. Please try again.",
    no_deadline: "There's no return deadline to remind you about.", deadline_passed: "That deadline has already passed.", consent_required: "Please agree to the permission step first.", invalid_or_expired_code: "That code is wrong or has expired. Check it, or request a new one.", invalid_or_expired_link: "That sign-in link has expired or was already used. Request a new one.", origin_not_allowed: "Sign-in isn't available from this address.", invalid_code: "That code isn't right. Check your authenticator app, or type a recovery code.", sign_in_expired: "That sign-in timed out or was cancelled. Please start again." };
  function say(node, text, bad) { node.textContent = text; node.className = "rl-msg" + (bad ? " err" : ""); }

  // ---- Getting started: one journey from "Welcome" to "You're all set" ----
  // Google and Microsoft sign you in AND bring your email in, in one visit (after you've read what Relay does). An email
  // link signs you in, and then you connect your inbox once. Either way the first scan starts at once and you see it
  // counting while you add your name, so the first screen after is full, not empty.
  var JI = {
    check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
    mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m3.8 7 8.2 6 8.2-6"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    trash: '<path d="M4.5 7h15M10 7V5h4v2M6.5 7l1 13h9l1-13"/>',
    face: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9.5v1M15 9.5v1M12 9.5V13h-1M9.5 16c1.5 1.2 3.5 1.2 5 0"/>',
    back: '<path d="m15 6-6 6 6 6"/>'
  };
  function jIc(n, px) {
    var s = el("span", { className: "rl-jic" }); s.setAttribute("aria-hidden", "true");
    s.innerHTML = '<svg viewBox="0 0 24 24" width="' + (px || 20) + '" height="' + (px || 20) + '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + JI[n] + "</svg>";
    return s;
  }
  // The frame of every step: progress dots (when there is more than one step), Back or Close, then the step itself.
  function jFrame(sheet, o) {
    sheet.textContent = ""; sheet.classList.add("rl-full", "rl-jr"); sheet.setAttribute("aria-label", "Getting started");
    try { sheet.scrollTop = 0; } catch (e) {}
    var top = el("div", { className: "rl-jtop" });
    top.appendChild(o.back ? el("button", { type: "button", className: "rl-abtn", ariaLabel: "Back", onclick: o.back }, [jIc("back"), el("span", { text: "Back" })]) : el("span"));
    if (o.of > 1) {
      var dots = el("div", { className: "rl-dots" }); dots.setAttribute("role", "img"); dots.setAttribute("aria-label", "Step " + o.at + " of " + o.of);
      for (var i = 1; i <= o.of; i++) dots.appendChild(el("span", { className: i < o.at ? "done" : i === o.at ? "on" : "" }));
      top.appendChild(dots);
    } else top.appendChild(el("span"));
    top.appendChild(o.noClose ? el("span") : el("button", { type: "button", className: "rl-abtn done", text: o.closeText || "Close", onclick: o.onClose || close }));
    sheet.appendChild(top);
    var body = el("div", { className: "rl-jbody" });
    if (o.kicker) body.appendChild(el("div", { className: "rl-jkick", text: o.kicker }));
    body.appendChild(el("h2", { className: "rl-jh", text: o.title }));
    if (o.sub) body.appendChild(el("p", { className: "rl-jsub", text: o.sub }));
    sheet.appendChild(body);
    return body;
  }
  // Which inbox an address most likely lives in, so the right button comes first.
  function mailKindOf(email) {
    var d = String(email || "").split("@")[1] || "";
    if (/^(gmail|googlemail)\.com$/.test(d)) return "google";
    if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(d)) return "microsoft";
    return "";
  }
  // Steps someone chose to leave for later, kept per account on this device so later sign-ins don't ask again.
  var ONBOARD_KEY = "relay.onboard.v1";
  function obKey(email) { var h = 0, s = String(email || ""); for (var i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0; return "a" + h.toString(36); }
  function obGet(email) { try { var all = JSON.parse(localStorage.getItem(ONBOARD_KEY) || "{}"); return all[obKey(email)] || {}; } catch (e) { return {}; } }
  function obSet(email, patch) {
    try { var all = JSON.parse(localStorage.getItem(ONBOARD_KEY) || "{}"), k = obKey(email); all[k] = Object.assign({}, all[k] || {}, patch); localStorage.setItem(ONBOARD_KEY, JSON.stringify(all)); } catch (e) {}
  }

  // Step 1, signed out: welcome, and how to continue.
  function signedOutView(sheet) {
    signInExtra = {};
    var body = jFrame(sheet, { kicker: "WELCOME TO RELAY", title: "Everything you buy, in one place.", sub: "Relay finds your receipts in your email, keeps track of return deadlines and tells you when prices drop. No password needed." });
    var msg = el("div", { className: "rl-msg" });
    var gBtn = el("button", { type: "button", className: "rl-btn rl-prov", text: "Continue with Google", onclick: function () { providerStep(sheet, "google"); } });
    var mBtn = el("button", { type: "button", className: "rl-btn rl-prov", text: "Continue with Microsoft", onclick: function () { providerStep(sheet, "microsoft"); } });
    var mHint = el("p", { className: "rl-jnote", text: "Microsoft works with Outlook, Hotmail and Live addresses." });
    gBtn.style.display = mBtn.style.display = mHint.style.display = "none";
    var eBtn = el("button", { type: "button", className: "rl-btn ghost", text: "Continue with email", onclick: function () { emailStep(sheet); } });
    [gBtn, mBtn, mHint, eBtn].forEach(function (n) { body.appendChild(n); });
    if (passkeysSupported()) body.appendChild(passkeyButton(msg));
    body.appendChild(msg);
    var legal = el("p", { className: "rl-jlegal" });
    legal.appendChild(document.createTextNode("By continuing you agree to Relay's "));
    legal.appendChild(el("a", { href: "./terms.html", text: "Terms of use" }));
    legal.appendChild(document.createTextNode(" and "));
    legal.appendChild(el("a", { href: "./privacy.html", text: "Privacy policy" }));
    legal.appendChild(document.createTextNode("."));
    body.appendChild(legal);
    signInProviders().then(function (p) {
      if (!document.body.contains(body)) return;
      if (p && p.google) gBtn.style.display = "";
      if (p && p.microsoft) { mBtn.style.display = ""; mHint.style.display = ""; }
      if (!p) say(msg, "Couldn't reach Relay. Check your connection.", true);
    });
  }
  // Step 2 for Google or Microsoft: what Relay will do with your email, agreed once, before going there.
  function providerStep(sheet, kind) {
    var g = kind === "google", who = g ? "Google" : "Microsoft", box = g ? "Gmail" : "Outlook";
    var body = jFrame(sheet, { back: function () { signedOutView(sheet); }, of: 3, at: 1,
      title: "Sign in and bring in your receipts", sub: "One visit to " + who + " signs you in and connects your " + box + ", so Relay can start finding your receipts straight away." });
    var points = el("div", { className: "rl-jcard" });
    [["eye", "Reads only order confirmations, receipts and return emails"], ["lock", "Read-only: never sends, deletes or changes anything in your inbox"], ["check", "Never sells or shares what it finds"], ["trash", "Disconnect and delete everything at any time"]]
      .forEach(function (x) { points.appendChild(el("div", { className: "rl-jpt" }, [jIc(x[0]), el("span", { text: x[1] })])); });
    body.appendChild(points);
    var words = el("div", { className: "rl-jwords", role: "region", tabIndex: 0 }, [el("b", { text: "What you're agreeing to" })]);
    words.setAttribute("aria-label", "Relay's permission wording");
    body.appendChild(words);
    var note = el("div", { className: "rl-msg" });
    var agree = el("button", { type: "button", className: "rl-btn", text: "Agree and continue with " + who, disabled: true });
    var just = el("button", { type: "button", className: "rl-btn ghost", text: "Just sign in for now" });
    body.appendChild(agree); body.appendChild(just); body.appendChild(note);
    body.appendChild(el("p", { className: "rl-jnote", text: "Already use Relay? “Just sign in” skips the permission step." }));
    var consent = null;
    signInProviders().then(function (p) {
      consent = p && p.consent;
      if (consent && consent.text) { consent.text.forEach(function (t) { words.appendChild(el("p", { text: t })); }); agree.disabled = false; }
      else { agree.style.display = "none"; words.style.display = "none"; }
    });
    function go(button, withMail) {
      if (agree.dataset.busy) return;
      agree.dataset.busy = "1"; agree.disabled = just.disabled = true; say(note, "Opening " + who + "…");
      var free = function () { delete agree.dataset.busy; agree.disabled = !consent; just.disabled = false; };
      var nonce = newNonce();
      try { localStorage.setItem("relay_gnonce", nonce); } catch (e) { free(); return say(note, "Your browser is blocking storage, so " + who + " sign-in can't work here. Continue with email instead.", true); }
      var body2 = { nonce: nonce }; if (withMail && consent) body2.consentVersion = consent.version;
      var host = g ? /^https:\/\/accounts\.google\.com\// : /^https:\/\/login\.microsoftonline\.com\//;
      api("/relay/auth/" + (g ? "google" : "microsoft") + "/start", { method: "POST", body: body2 }).then(function (r) {
        if (r.ok && r.body && host.test(r.body.url || "")) { location.href = r.body.url; return; }
        free();
        if (r.body && r.body.error === "consent_version_mismatch") providersAsked = null;
        say(note, r.status === 503 ? who + " sign-in isn't switched on yet. Continue with email instead." : r.body && r.body.error === "consent_version_mismatch" ? "Relay's wording has just changed. Go back and try again." : "Couldn't open " + who + ". Please try again.", true);
      }).catch(function () { free(); say(note, "Couldn't reach Relay. Check your connection.", true); });
    }
    agree.onclick = function () { go(agree, true); };
    just.onclick = function () { go(just, false); };
  }
  // Step 2 by email: a one-time link or code.
  function emailStep(sheet, typed) {
    var body = jFrame(sheet, { back: function () { signedOutView(sheet); }, title: "Continue with email", sub: "We'll email you a link and a 6-digit code. No password." });
    var input = el("input", { type: "email", id: "rl-signin-email", placeholder: "you@example.com", autocomplete: "email", inputMode: "email", value: typed || "" });
    input.setAttribute("aria-label", "Your email address");
    var hint = el("div", { className: "rl-jhint" });
    var msg = el("div", { className: "rl-msg" });
    var go = el("button", { type: "button", className: "rl-btn", text: "Email me a sign-in link" });
    // Gmail and Outlook addresses: one step through Google or Microsoft saves signing in and then connecting separately.
    function showHint() {
      var k = mailKindOf(input.value.trim()); hint.textContent = "";
      if (!k) return;
      var who = k === "google" ? "Google" : "Microsoft";
      hint.appendChild(el("p", { text: "Using " + (k === "google" ? "Gmail" : "Outlook") + "? Continue with " + who + " instead and you'll be signed in with your receipts on their way, in one step." }));
      hint.appendChild(el("button", { type: "button", className: "rl-btn rl-prov", text: "Continue with " + who, onclick: function () { providerStep(sheet, k); } }));
    }
    input.addEventListener("input", showHint);
    go.onclick = function () {
      go.disabled = true; say(msg, "Sending…");
      api("/relay/auth/request", { method: "POST", body: { email: input.value } }).then(function (r) {
        go.disabled = false;
        if (r.ok) return codeStep(sheet, input.value.trim());
        say(msg, errors[r.body.error] || "Something went wrong. Please try again.", true);
      }).catch(function () { go.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
    };
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") go.click(); });
    [input, go, msg, hint].forEach(function (n) { body.appendChild(n); });
    showHint();
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
  }
  function codeStep(sheet, email) {
    var body = jFrame(sheet, { back: function () { emailStep(sheet, email); }, title: "Check your inbox", sub: "We sent a sign-in link to " + email + ". Open it on this device, or type the 6-digit code from the same email. It works once, for 15 minutes." });
    var codeIn = el("input", { type: "text", id: "rl-signin-code", placeholder: "6-digit code", autocomplete: "one-time-code", inputMode: "numeric", maxLength: 7 });
    codeIn.setAttribute("aria-label", "6-digit code");
    var msg = el("div", { className: "rl-msg" });
    var codeGo = el("button", { type: "button", className: "rl-btn", text: "Continue" });
    codeGo.onclick = function () {
      codeGo.disabled = true; say(msg, "Checking…");
      api("/relay/auth/verify-code", { method: "POST", body: { email: email, code: codeIn.value } }).then(function (r) {
        codeGo.disabled = false;
        if (!r.ok) return say(msg, errors[r.body.error] || "Something went wrong. Please try again.", true);
        if (r.body.needsSecondStep) return secondStepView(sheet, r.body.pendingToken);
        signedIn(r.body);
      }).catch(function () { codeGo.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
    };
    codeIn.addEventListener("keydown", function (e) { if (e.key === "Enter") codeGo.click(); });
    [codeIn, codeGo, msg, el("button", { type: "button", className: "rl-btn ghost", text: "Use a different email", onclick: function () { emailStep(sheet); } })].forEach(function (n) { body.appendChild(n); });
    setTimeout(function () { try { codeIn.focus(); } catch (e) {} }, 50);
  }
  // Every way of signing in ends here: keep the session, then carry on with what's still needed.
  var signInExtra = {};
  function signedIn(b) {
    save({ token: b.sessionToken, email: b.email, expiresAt: b.expiresAt });
    keepStorage(); paintAvatars(); loadProfile();
    var extra = Object.assign({}, signInExtra, b); signInExtra = {};
    if (extra.mailConnected || extra.outlookConnected) {
      rememberMailbox({ connected: true, provider: extra.mailConnected === "google" ? "google" : "microsoft" });
      memo.consent = null; memo.gmail = null; memo.receipts = null;
    }
    var connected = Boolean(extra.mailConnected || extra.outlookConnected);
    startJourney({ suggestedName: extra.suggestedName || "", justConnected: connected, viaProvider: connected });
  }
  // After signing in: only the steps this person still needs. Someone already set up goes straight to Home.
  function startJourney(info) {
    var s = load(); if (!s || !s.token) return open(signedOutView);
    var email = s.email || "";
    open(function (sheet) {
      sheet.classList.add("rl-full", "rl-jr");
      sheet.appendChild(el("div", { className: "rl-skel", style: "min-height:60px;border-radius:16px;margin:56px 0 14px" }));
      sheet.appendChild(el("div", { className: "rl-skel", style: "min-height:200px;border-radius:18px" }));
      Promise.all([loadProfile(), api("/relay/my/consent"), api("/relay/my/gmail")]).then(function (r) {
        if (!document.body.contains(sheet)) return;
        if (r[1].status === 401) { save(null); return open(signedOutView); }
        var p = r[0] || {}, c = r[1].ok ? r[1].body : {}, g = r[2].ok ? r[2].body : {};
        if (g && g.connected) rememberMailbox(g);
        var fl = obGet(email);
        var st = { email: email, consent: c, connected: Boolean(g && g.connected), provider: g && g.provider, scan: g && g.scan, suggested: info.suggestedName || "", justConnected: Boolean(info.justConnected), viaProvider: Boolean(info.viaProvider), mailNote: info.mailNote || null };
        var steps = [];
        if (!p.name && !fl.nameSkipped) steps.push("name");
        if (!st.connected && !fl.mailLater) steps.push("mail");
        if (!steps.length && !st.justConnected) { close(); if (window.go) window.go("profile"); return; }
        steps.push("done");
        runJourney(sheet, st, steps, 0);
      }).catch(function () {
        if (!document.body.contains(sheet)) return;
        sheet.textContent = "";
        var body = jFrame(sheet, { title: "Couldn't reach Relay", sub: "You're signed in. Check your connection, then carry on." });
        body.appendChild(el("button", { type: "button", className: "rl-btn", text: "Try again", onclick: function () { startJourney(info); } }));
      });
    });
  }
  // Reads the inbox from the very start (Relay's own job does the work; asking for rounds just makes it quicker and shows
  // progress). The count shows on every step until the shopper leaves the journey.
  function journeyScan(sheet, st) {
    if (st.scanner) return st.scanner;
    var listeners = [], last = st.scan || null, stopped = false, done = false;
    function tell() { listeners.forEach(function (f) { try { f(last, done); } catch (e) {} }); }
    function step() {
      if (stopped || !document.body.contains(sheet)) return;
      api("/relay/my/gmail/scan", { method: "POST", body: {} }).then(function (x) {
        if (stopped || !document.body.contains(sheet)) return;
        if (!x.ok) return setTimeout(step, 5000);
        last = x.body.job || last;
        if (last && last.state === "failed") { done = true; tell(); return; }
        if (x.body.busy) { tell(); return setTimeout(step, x.body.retryAfterMs || 4000); }
        if (x.body.more) { tell(); return step(); }
        done = true; memo.receipts = null; memo.gmail = null; tell();
      }, function () { setTimeout(step, 5000); });
    }
    st.scanner = { on: function (f) { listeners.push(f); f(last, done); }, stop: function () { stopped = true; } };
    step();
    return st.scanner;
  }
  // The live count: what's been found, and how far back it has read (the first scan covers about the last 16 months).
  function scanCard(sheet, st) {
    var box = mailNameOf(st.provider);
    var card = el("div", { className: "rl-jscan", role: "status" });
    var line = el("b", { text: "Reading your " + box + "…" }), sub = el("span", { text: "Looking for receipts and order confirmations" });
    var bar = el("div", { className: "rl-jbar" }, [el("i")]);
    card.appendChild(el("div", { className: "rl-jscan-t" }, [jIc("mail"), el("div", {}, [line, sub])]));
    card.appendChild(bar);
    journeyScan(sheet, st).on(function (job, done) {
      if (!document.body.contains(card)) return;
      var found = (job && job.found) || 0;
      var m = /^(\d{4})-(\d{2})/.exec((job && job.scannedBack) || ""), pct = 6;
      if (m) { var months = (Date.now() - Date.UTC(+m[1], +m[2] - 1, 1)) / (30.4 * 864e5); pct = Math.max(6, Math.min(96, Math.round(months / 16 * 100))); }
      if (job && job.state === "failed") { line.textContent = "Relay will keep reading in the background"; sub.textContent = "Your receipts will appear as they're found."; pct = 100; }
      else if (done) { line.textContent = found ? found + " receipt" + (found === 1 ? "" : "s") + " found" : "All read"; sub.textContent = found ? "They're ready in Receipts." : "Nothing yet. New receipts will appear as they arrive."; pct = 100; }
      else { line.textContent = found ? found + " receipt" + (found === 1 ? "" : "s") + " found so far" : "Reading your " + box + "…"; sub.textContent = m ? "Read back to " + new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : "Looking for receipts and order confirmations"; }
      bar.firstChild.style.width = pct + "%";
      card.classList.toggle("done", Boolean(done));
    });
    return card;
  }
  function mailNameOf(provider) { return provider === "microsoft" ? "Outlook" : "Gmail"; }
  function runJourney(sheet, st, steps, i) {
    // Through Google or Microsoft the permission step was step 1, so the count carries on from there.
    var off = st.justConnected && st.viaProvider ? 1 : 0, kind = steps[i], of = steps.length + off, at = i + 1 + off;
    var next = function () { runJourney(sheet, st, steps, i + 1); };
    var back = i > 0 ? function () { runJourney(sheet, st, steps, i - 1); } : null;
    var leave = function () { if (st.scanner) st.scanner.stop(); close(); };
    if (kind === "name") {
      var body = jFrame(sheet, { back: back, of: of, at: at, closeText: "Skip", onClose: function () { obSet(st.email, { nameSkipped: true }); next(); },
        title: "What should we call you?", sub: "Your first name is fine. Only you see it." });
      if (st.connected) body.appendChild(scanCard(sheet, st));
      var input = el("input", { type: "text", id: "rl-onboard-name", maxLength: 40, autocomplete: "name", placeholder: "Your name", value: st.name || st.suggested || "" });
      input.setAttribute("aria-label", "Your name");
      var note = el("div", { className: "rl-msg" });
      var go = el("button", { type: "button", className: "rl-btn", text: "Continue" });
      go.onclick = function () {
        var v = input.value.trim();
        if (!v) { obSet(st.email, { nameSkipped: true }); return next(); }
        go.disabled = true; say(note, "Saving…");
        api("/relay/my/profile", { method: "POST", body: { name: v } }).then(function (r) {
          go.disabled = false;
          if (r.ok) { keepProfile(r.body); profileChanged(); st.name = r.body.name; return next(); }
          say(note, r.body && r.body.error === "bad_name" ? "Use letters, spaces, hyphens or apostrophes, up to 40 characters." : "Couldn't save your name. Please try again.", true);
        }).catch(function () { go.disabled = false; say(note, "Couldn't reach Relay. Check your connection.", true); });
      };
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") go.click(); });
      [el("label", { htmlFor: "rl-onboard-name", className: "rl-jlabel", text: "Your name" }), input, go, note].forEach(function (n) { body.appendChild(n); });
      if (st.suggested && !st.name) body.appendChild(el("p", { className: "rl-jnote", text: "Filled in from your " + (st.provider === "microsoft" ? "Microsoft" : "Google") + " account. Change it if you like." }));
      return;
    }
    if (kind === "mail") {
      var c = st.consent || {}, first = mailKindOf(st.email) || (c.gmailAvailable ? "google" : "microsoft");
      var body2 = jFrame(sheet, { back: back, of: of, at: at, closeText: "Later", onClose: function () { obSet(st.email, { mailLater: true }); next(); },
        title: "Bring in your receipts", sub: "Connect the email you shop with. Relay reads it once now, then keeps up with new receipts by itself." });
      var pts = el("div", { className: "rl-jcard" });
      [["eye", "Reads only order confirmations, receipts and return emails"], ["lock", "Read-only: never sends, deletes or changes anything"], ["trash", "Disconnect and delete everything at any time"]]
        .forEach(function (x) { pts.appendChild(el("div", { className: "rl-jpt" }, [jIc(x[0]), el("span", { text: x[1] })])); });
      body2.appendChild(pts);
      var needAgree = !c.accepted && c.text;
      if (needAgree) {
        var words = el("div", { className: "rl-jwords", role: "region", tabIndex: 0 }, [el("b", { text: "What you're agreeing to" })]);
        words.setAttribute("aria-label", "Relay's permission wording");
        c.text.forEach(function (t) { words.appendChild(el("p", { text: t })); });
        body2.appendChild(words);
      }
      var note2 = el("div", { className: "rl-msg" });
      var connect = function (provider, label, host, button) {
        button.disabled = true; say(note2, "Opening " + (provider ? "Microsoft" : "Google") + "…");
        var agreed = needAgree ? api("/relay/my/consent", { method: "POST", body: { version: c.version } }) : Promise.resolve({ ok: true });
        agreed.then(function (a) {
          if (!a.ok) throw new Error("consent");
          memo.consent = null;
          return api("/relay/my/gmail/connect", { method: "POST", body: provider ? { provider: provider } : undefined });
        }).then(function (x) {
          // Coming back from Google or Microsoft carries on here, at "You're all set".
          if (x.ok && x.body && host.test(x.body.url || "")) { obSet(st.email, { back: "done" }); location.href = x.body.url; return; }
          button.disabled = false; say(note2, "Couldn't start the " + label + " connection. Please try again.", true);
        }).catch(function () { button.disabled = false; say(note2, "Couldn't reach Relay. Check your connection.", true); });
      };
      var verb = needAgree ? "Agree and connect " : "Connect ";
      var gb = el("button", { type: "button", className: "rl-btn", text: verb + "Gmail" }), ob = el("button", { type: "button", className: "rl-btn", text: verb + "Outlook" });
      gb.onclick = function () { connect(null, "Gmail", /^https:\/\/accounts\.google\.com\//, gb); };
      ob.onclick = function () { connect("microsoft", "Outlook", /^https:\/\/login\.microsoftonline\.com\//, ob); };
      var order = first === "microsoft" ? [ob, gb] : [gb, ob];
      order.forEach(function (b, k) { if (k) b.className = "rl-btn ghost"; if ((b === gb && c.gmailAvailable !== false) || (b === ob && c.outlookAvailable)) body2.appendChild(b); });
      body2.appendChild(note2);
      if (c.outlookAvailable) body2.appendChild(el("p", { className: "rl-jnote", text: "Outlook works with Outlook.com, Hotmail and Live addresses." }));
      if (st.mailNote) say(note2, st.mailNote.text, st.mailNote.bad);
      return;
    }
    // Done: a short welcome, the scan still counting, and where to go first.
    var p = profileNow() || {}, first2 = p.name ? String(p.name).split(/\s+/)[0] : "";
    var body3 = jFrame(sheet, { of: of, at: at, closeText: "Close", onClose: function () { leave(); if (window.go) window.go("profile"); },
      kicker: "YOU'RE IN", title: first2 ? "You're all set, " + first2 + "." : "You're all set.",
      sub: st.connected ? "Relay is bringing in your receipts now. It carries on even if you close the app." : "You can connect your email any time from Account, under Receipts." });
    if (st.connected) body3.appendChild(scanCard(sheet, st));
    var tips = el("div", { className: "rl-jcard" });
    [["check", "Return deadlines from your receipts, counted down for you"], ["eye", "Price drops on things you watch, sent to your phone"]].forEach(function (x) { tips.appendChild(el("div", { className: "rl-jpt" }, [jIc(x[0]), el("span", { text: x[1] })])); });
    body3.appendChild(tips);
    if (st.connected) {
      body3.appendChild(el("button", { type: "button", className: "rl-btn", text: "See my receipts", onclick: function () { leave(); if (window.go) { window.__relayAutoScan = true; window.go("receipts"); } } }));
      body3.appendChild(el("button", { type: "button", className: "rl-btn ghost", text: "Go to Home", onclick: function () { leave(); if (window.go) window.go("profile"); } }));
    } else body3.appendChild(el("button", { type: "button", className: "rl-btn", text: "Go to Home", onclick: function () { leave(); if (window.go) window.go("profile"); } }));
  }
  var providersAsked = null;
  function signInProviders() {
    if (!providersAsked) providersAsked = api("/relay/auth/providers").then(function (r) { if (!r.ok) providersAsked = null; return r.ok ? r.body : null; }, function () { providersAsked = null; return null; });
    return providersAsked;
  }
  function newNonce() {
    var bytes = new Uint8Array(32); (window.crypto || window.msCrypto).getRandomValues(bytes);
    return btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  // ---- Face ID / passkeys (WebAuthn). The phone keeps the private key; Relay stores only the public key. ----
  function passkeysSupported() { try { return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create && navigator.credentials.get); } catch (e) { return false; } }
  function b64uToBytes(t) { t = String(t).replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "="; var b = atob(t), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function bytesToB64u(buf) { var u = new Uint8Array(buf), s = ""; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function passkeyProblem(e) {
    var n = e && e.name;
    if (n === "NotAllowedError" || n === "AbortError") return "That was cancelled or timed out. Try again when you're ready.";
    if (n === "InvalidStateError") return "This device already has a passkey for Relay.";
    return "Face ID / passkey isn't working on this device or browser. Use the email link instead.";
  }
  function passkeyButton(msg) {
    var b = el("button", { type: "button", className: "rl-btn ghost", text: "Sign in with Face ID or a passkey" });
    b.onclick = function () {
      b.disabled = true; say(msg, "Waiting for Face ID…");
      api("/relay/auth/passkey/options", { method: "POST" }).then(function (o) {
        if (!o.ok) { b.disabled = false; return say(msg, o.status === 503 ? "Passkey sign-in isn't switched on yet. Use the email link instead." : (errors[o.body.error] || "Couldn't start passkey sign-in. Try again."), true); }
        return navigator.credentials.get({ publicKey: { challenge: b64uToBytes(o.body.challenge), rpId: o.body.rpId, timeout: o.body.timeout, userVerification: "required", allowCredentials: [] } }).then(function (cred) {
          var r = cred.response;
          return api("/relay/auth/passkey/verify", { method: "POST", body: { id: cred.id, response: {
            clientDataJSON: bytesToB64u(r.clientDataJSON), authenticatorData: bytesToB64u(r.authenticatorData), signature: bytesToB64u(r.signature),
            userHandle: r.userHandle ? bytesToB64u(r.userHandle) : undefined } } });
        }).then(function (v) {
          b.disabled = false;
          if (!v.ok) return say(msg, "That passkey wasn't accepted. If you haven't added one yet, sign in another way first and add it from your account.", true);
          signedIn(v.body);
        });
      }).catch(function (e) { b.disabled = false; say(msg, passkeyProblem(e), true); });
    };
    return b;
  }
  // ---- Card for swaps that cost more (Stripe TEST MODE only: no real money moves). ----
  // Saved with a £0.00 check through Apple Pay / Google Pay where the device offers it, or a typed card.
  // Stripe keeps the card; Relay only ever sees the brand and last 4 digits.
  var stripeLoading = null;
  function loadStripe(pk) {
    if (window.Stripe) return Promise.resolve(window.Stripe(pk));
    if (!stripeLoading) stripeLoading = new Promise(function (ok, bad) {
      var sc = document.createElement("script"); sc.src = "https://js.stripe.com/v3/"; sc.onload = ok; sc.onerror = bad; document.head.appendChild(sc);
    });
    return stripeLoading.then(function () { return window.Stripe(pk); });
  }
  function cardText(c) {
    var w = c.wallet === "apple_pay" ? "Apple Pay · " : c.wallet === "google_pay" ? "Google Pay · " : "";
    return w + (c.brand ? c.brand.charAt(0).toUpperCase() + c.brand.slice(1) : "Card") + " ending " + c.last4;
  }
  function addCard(box, onSaved) {
    var note = el("div", { className: "rl-msg" });
    var holder = el("div", { style: "margin:10px 0" });
    box.appendChild(holder); box.appendChild(note);
    say(note, "Loading…");
    api("/relay/my/card/setup", { method: "POST", body: {} }).then(function (r) {
      if (!r.ok) return say(note, "Couldn't start. Please try again.", true);
      var secret = r.body.clientSecret;
      return loadStripe(r.body.publishableKey).then(function (stripe) {
        note.textContent = ""; note.className = "rl-msg";
        var finish = function (setupIntent) {
          api("/relay/my/card/confirm", { method: "POST", body: { setupIntentId: setupIntent.id } }).then(function (x) {
            if (x.ok) { say(note, "Card saved. Nothing was charged."); if (onSaved) onSaved(x.body.card); }
            else say(note, "Couldn't save the card. Please try again.", true);
          });
        };
        // Apple Pay / Google Pay sheet showing £0.00.
        var pr = stripe.paymentRequest({ country: "GB", currency: "gbp", total: { label: "Relay card check (nothing charged)", amount: 0 } });
        var elements = stripe.elements();
        var typeNote = el("p", { className: "small muted", text: "Type a card. Test mode: use 4242 4242 4242 4242, any future date, any 3 digits." });
        pr.canMakePayment().then(function (can) {
          if (can) {
            typeNote.textContent = "Or type a card. Test mode: use 4242 4242 4242 4242, any future date, any 3 digits.";
            var btnBox = el("div", { style: "margin-bottom:10px" }); holder.insertBefore(btnBox, holder.firstChild);
            elements.create("paymentRequestButton", { paymentRequest: pr }).mount(btnBox);
          }
        });
        pr.on("paymentmethod", function (ev) {
          stripe.confirmCardSetup(secret, { payment_method: ev.paymentMethod.id }, { handleActions: false }).then(function (res) {
            if (res.error || !res.setupIntent) { ev.complete("fail"); return say(note, (res.error && res.error.message) || "That didn't work.", true); }
            ev.complete("success"); finish(res.setupIntent);
          });
        });
        // Typed card (test mode: 4242 4242 4242 4242, any future date, any CVC).
        var cardBox = el("div", { style: "padding:12px 14px;border:1px solid #ddd6c6;border-radius:14px;background:#fff" });
        holder.appendChild(typeNote);
        holder.appendChild(cardBox);
        var cardEl = elements.create("card", { hidePostalCode: true }); cardEl.mount(cardBox);
        var save = el("button", { className: "rl-btn", text: "Save card (£0.00)", style: "margin-top:10px" });
        save.onclick = function () {
          save.disabled = true; say(note, "Checking the card…");
          stripe.confirmCardSetup(secret, { payment_method: { card: cardEl } }).then(function (res) {
            save.disabled = false;
            if (res.error || !res.setupIntent) return say(note, (res.error && res.error.message) || "That didn't work.", true);
            finish(res.setupIntent);
          });
        };
        holder.appendChild(save);
      });
    }).catch(function () { say(note, "Couldn't load the card form. Check your connection and try again.", true); });
  }
  function cardSection(box) {
    api("/relay/my/card").then(function (r) {
      if (!r.ok || !r.body || !r.body.enabled) return;
      var test = r.body.testMode !== false;
      if (test && !testingOn() && !r.body.card) return;
      box.textContent = "";
      box.appendChild(el("h2", { text: "Card for swaps", style: "font-size:18px;margin-top:8px" }));
      if (test) box.appendChild(el("span", { text: "TEST MODE · no real money", style: "display:inline-block;margin-bottom:6px;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800;background:#fff3d7;color:#7a540c" }));
      box.appendChild(el("p", { text: "Used only when you swap to a size or colour that costs more: you pay the difference, after you've agreed it. Saving it charges nothing." }));
      var note = el("div", { className: "rl-msg" });
      if (r.body.card) {
        box.appendChild(el("p", { text: cardText(r.body.card) }));
        box.appendChild(el("button", { className: "rl-btn ghost", text: "Remove card", onclick: function () {
          ask("Remove " + cardText(r.body.card) + " from Relay?", "Remove card", function () {
            api("/relay/my/card/remove", { method: "POST", body: {} }).then(function (x) { if (x.ok) cardSection(box); else say(note, "Couldn't remove it. Try again.", true); });
          }); } }));
        box.appendChild(note);
      } else {
        var add = el("button", { className: "rl-btn ghost", text: "Add a card (£0.00 check)" });
        add.onclick = function () { add.remove(); addCard(box, function () { setTimeout(function () { cardSection(box); }, 900); }); };
        box.appendChild(add);
      }
    });
  }
  function passkeySection(box, msg) {
    if (!passkeysSupported()) return;
    var list = el("div"), note = el("div", { className: "rl-msg" });
    box.appendChild(el("h2", { text: "Face ID sign-in", style: "font-size:18px;margin-top:8px" }));
    box.appendChild(el("p", { text: "Sign in with Face ID, Touch ID or your phone's screen lock. No email needed." }));
    box.appendChild(list);
    var add = el("button", { className: "rl-btn ghost", text: "Add Face ID / passkey on this device" });
    box.appendChild(add); box.appendChild(note);
    function refresh() {
      api("/relay/my/passkeys").then(function (r) {
        list.textContent = "";
        if (!r.ok) return;
        ((r.body && r.body.passkeys) || []).forEach(function (k) {
          var rm = el("button", { className: "rl-btn ghost", text: "Remove", style: "width:auto;display:inline-block;margin:6px 0 0;padding:8px 14px;font-size:14px" });
          rm.onclick = function () {
            ask("Remove this passkey? You can still sign in with an email link.", "Remove passkey", function () {
              api("/relay/my/passkeys/remove", { method: "POST", body: { id: k.id } }).then(function (x) { if (x.ok) refresh(); else say(note, "Couldn't remove it. Try again.", true); });
            });
          };
          list.appendChild(el("div", { className: "rl-order" }, [el("b", { text: k.name || "Passkey" }),
            el("span", { text: "Added " + new Date(k.createdAt).toLocaleDateString("en-GB") + (k.lastUsedAt ? " · last used " + new Date(k.lastUsedAt).toLocaleDateString("en-GB") : "") }), rm]));
        });
      }).catch(function () {});
    }
    add.onclick = function () {
      add.disabled = true; say(note, "Waiting for Face ID…");
      api("/relay/my/passkeys/options", { method: "POST" }).then(function (o) {
        if (!o.ok) { add.disabled = false; return say(note, o.body.error === "too_many_passkeys" ? "You've reached the limit of 5 passkeys. Remove one first." : "Couldn't start. Try again.", true); }
        var p = o.body;
        return navigator.credentials.create({ publicKey: { challenge: b64uToBytes(p.challenge), rp: p.rp, user: { id: b64uToBytes(p.user.id), name: p.user.name, displayName: p.user.displayName },
          pubKeyCredParams: p.pubKeyCredParams, authenticatorSelection: p.authenticatorSelection, attestation: "none", timeout: p.timeout,
          excludeCredentials: (p.excludeCredentials || []).map(function (c) { return { type: "public-key", id: b64uToBytes(c.id) }; }) } }).then(function (cred) {
          var ua = navigator.userAgent || "", name = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android phone" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : "This device";
          return api("/relay/my/passkeys/register", { method: "POST", body: { id: cred.id, name: name, response: {
            clientDataJSON: bytesToB64u(cred.response.clientDataJSON), attestationObject: bytesToB64u(cred.response.attestationObject) } } });
        }).then(function (x) {
          add.disabled = false;
          if (x.ok) { say(note, "Added. Next time you can sign in with Face ID."); refresh(); }
          else say(note, "That passkey couldn't be saved. Try again.", true);
        });
      }).catch(function (e) { add.disabled = false; say(note, passkeyProblem(e), true); });
    };
    refresh();
  }

  // ---- Authenticator-app 2-step ----
  function secondStepView(sheet, pendingToken) {
    sheet.textContent = "";
    var input = el("input", { type: "text", placeholder: "6-digit code or recovery code", autocomplete: "one-time-code", maxLength: 20 });
    var msg = el("div", { className: "rl-msg" });
    var go = el("button", { className: "rl-btn", text: "Confirm" });
    go.onclick = function () {
      go.disabled = true; say(msg, "Checking…");
      api("/relay/auth/2fa/verify", { method: "POST", body: { pendingToken: pendingToken, code: input.value } }).then(function (r) {
        go.disabled = false;
        if (!r.ok) return say(msg, errors[r.body.error] || "Something went wrong. Please try again.", true);
        signedIn(r.body);
      }).catch(function () { go.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
    };
    [el("h2", { text: "One more step" }),
     el("p", { text: "Open your authenticator app and type the 6-digit code for Relay. Lost your phone? Type one of your saved recovery codes instead." }),
     input, go, msg, el("button", { className: "rl-btn ghost", text: "Cancel", onclick: close })].forEach(function (n) { sheet.appendChild(n); });
  }
  function twoStepSection(box) {
    var body = el("div"), note = el("div", { className: "rl-msg" });
    box.appendChild(el("h2", { text: "Two-step sign-in", style: "font-size:18px;margin-top:8px" }));
    box.appendChild(body); box.appendChild(note);
    function codeInput(ph) { return el("input", { type: "text", placeholder: ph, autocomplete: "one-time-code", maxLength: 20 }); }
    function render() {
      body.textContent = "";
      api("/relay/my/2fa").then(function (r) {
        if (!r.ok) return;
        if (!r.body.enabled) {
          body.appendChild(el("p", { text: "Add an authenticator app (Google Authenticator, 1Password, Authy…) so signing in by email or Google also needs a code. Face ID sign-in is not affected." }));
          body.appendChild(el("button", { className: "rl-btn ghost", text: "Set up authenticator app", onclick: setup }));
        } else {
          var left = r.body.recoveryCodesLeft;
          body.appendChild(el("p", { text: "On. " + left + " recovery code" + (left === 1 ? "" : "s") + " left." + (left <= 2 ? " You're running low, so turn this off and on again to get a fresh set." : "") }));
          var off = codeInput("App code or recovery code");
          var offBtn = el("button", { className: "rl-btn ghost", text: "Turn off two-step sign-in" });
          offBtn.onclick = function () {
            offBtn.disabled = true;
            api("/relay/my/2fa/disable", { method: "POST", body: { code: off.value } }).then(function (x) {
              offBtn.disabled = false;
              if (x.ok) { say(note, "Two-step sign-in is off."); render(); } else say(note, errors[x.body.error] || "Couldn't turn it off. Try again.", true);
            }).catch(function () { offBtn.disabled = false; say(note, "Couldn't reach Relay.", true); });
          };
          body.appendChild(off); body.appendChild(offBtn);
        }
      }).catch(function () {});
    }
    function setup() {
      say(note, "");
      api("/relay/my/2fa/setup", { method: "POST", body: {} }).then(function (r) {
        if (!r.ok) return say(note, "Couldn't start setup. Try again.", true);
        body.textContent = "";
        body.appendChild(el("p", { text: "1. In your authenticator app, add a new account and enter this key (or tap the link on your phone):" }));
        body.appendChild(el("div", { className: "rl-order", style: "font-family:monospace;font-size:16px;word-break:break-all;user-select:all", text: r.body.secret }));
        if (/^otpauth:\/\//.test(r.body.otpauthUrl || "")) body.appendChild(el("a", { href: r.body.otpauthUrl, text: "Open in authenticator app", style: "display:block;margin:0 0 12px;color:#0f1b33" }));
        body.appendChild(el("p", { text: "2. Type the 6-digit code it shows:" }));
        var c = codeInput("6-digit code");
        var on = el("button", { className: "rl-btn", text: "Turn on" });
        on.onclick = function () {
          on.disabled = true;
          api("/relay/my/2fa/enable", { method: "POST", body: { code: c.value } }).then(function (x) {
            on.disabled = false;
            if (!x.ok) return say(note, errors[x.body.error] || "Couldn't turn it on. Try again.", true);
            body.textContent = ""; say(note, "");
            body.appendChild(el("p", { text: "Two-step sign-in is on. Save these recovery codes somewhere safe, like a password manager. Each works once if you lose your phone. You won't see them again." }));
            body.appendChild(el("div", { className: "rl-order", style: "font-family:monospace;font-size:16px;line-height:1.8;user-select:all", text: (x.body.recoveryCodes || []).join("\n") }));
            body.lastChild.style.whiteSpace = "pre-line";
            body.appendChild(el("button", { className: "rl-btn", text: "I've saved them", onclick: render }));
          }).catch(function () { on.disabled = false; say(note, "Couldn't reach Relay.", true); });
        };
        body.appendChild(c); body.appendChild(on);
        body.appendChild(el("button", { className: "rl-btn ghost", text: "Cancel", onclick: render }));
      }).catch(function () { say(note, "Couldn't reach Relay.", true); });
    }
    render();
  }
  function money(minor, cur) { var n = (minor / 100).toFixed(2).split("."); return (minor < 0 ? "−" : "") + (cur === "GBP" || !cur ? "£" : cur + " ") + n[0].replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + n[1]; }
  function receiptView(sheet, back) {
    var box = el("textarea", { placeholder: "Paste the whole order-confirmation email here (including the From and Subject lines if you can)", rows: 7, maxLength: 200000,
      style: "width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #ddd6c6;border-radius:16px;font-size:14px;margin-bottom:12px;font-family:inherit" });
    var out = el("div"), msg = el("div", { className: "rl-msg" });
    var go = el("button", { className: "rl-btn", text: "Read this receipt" });
    go.onclick = function () {
      go.disabled = true; out.textContent = ""; say(msg, "Reading…");
      api("/relay/my/receipts/parse", { method: "POST", body: { email: box.value } }).then(function (r) {
        go.disabled = false;
        if (r.status === 401) { save(null); close(); return; }
        if (!r.ok || !r.body.receipt) return say(msg, "Paste the full email text and try again.", true);
        var x = r.body.receipt;
        if (!x.ok) return say(msg, "This doesn't look like an order confirmation, so Relay didn't read it.", true);
        say(msg, x.needsShopperConfirmation ? "Please check these details, some may be missing or wrong." : "Here's what Relay found. Please check it.");
        var who = (x.retailer && (x.retailer.name || x.retailer.domain)) || "Unknown store";
        var rows = [["Store", who], ["Order", x.orderRef || "not found"], ["Date", x.orderDate || "not found"],
          ["Total", x.totalPence == null ? "not found" : money(x.totalPence, x.currency)]];
        rows.forEach(function (p) { out.appendChild(el("div", { className: "rl-order" }, [el("span", { text: p[0] }), el("b", { text: p[1] })])); });
        (x.items || []).forEach(function (i) { out.appendChild(el("div", { className: "rl-order" }, [el("b", { text: i.qty + " × " + i.name }), el("span", { text: i.pricePence == null ? "" : money(i.pricePence, x.currency) })])); });
        out.appendChild(el("p", { text: "This is read from the email you pasted and isn't saved yet. Because it comes from you rather than the store, it can't start an automatic refund." }));
      }).catch(function () { go.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
    };
    [el("h2", { text: "Add a receipt" }), el("p", { text: "Paste an order-confirmation email from any store. Relay reads the details on this device's request and doesn't keep the email." }), box, go, msg, out,
      el("button", { className: "rl-btn ghost", text: "Back", onclick: back })].forEach(function (n) { sheet.appendChild(n); });
  }
  function consentView(sheet, email, c) {
    var msg = el("div", { className: "rl-msg" });
    var agree = el("button", { className: "rl-btn", text: "I agree and continue" });
    agree.onclick = function () {
      agree.disabled = true; say(msg, "Saving…");
      api("/relay/my/consent", { method: "POST", body: { version: c.version } }).then(function (r) { memo.consent = null; memo.gmail = null;
        if (r.status === 401) { save(null); close(); return; }
        if (!r.ok) { agree.disabled = false; return say(msg, "Couldn't save your choice. Please try again.", true); }
        open(function (s) { gate(s, email); });
      }).catch(function () { agree.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
    };
    sheet.appendChild(el("h2", { text: c.acceptedEarlier ? "We've updated this" : "Before you start" }));
    sheet.appendChild(el("p", { text: c.acceptedEarlier ? "Relay can now read Outlook as well as Gmail, so the wording below changed to say so. What Relay reads and keeps is the same. Please agree again to keep your receipts updating."
      : "Relay is only useful if it can see your receipts, so this is needed to use it." }));
    c.text.forEach(function (t) { sheet.appendChild(el("p", { text: t })); });
    sheet.appendChild(agree); sheet.appendChild(msg);
    sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Sign out", onclick: function () {
      api("/relay/auth/logout", { method: "POST" }).finally(function () { save(null); close(); }); } }));
  }
  function gate(sheet, email, notice) {
    sheet.textContent = "";
    sheet.appendChild(el("div", { className: "rl-skel", style: "min-height:56px;border-radius:16px;margin-bottom:12px" })); sheet.appendChild(el("div", { className: "rl-skel", style: "min-height:180px;border-radius:16px" }));
    api("/relay/my/consent").then(function (r) {
      sheet.textContent = "";
      if (r.status === 401) { save(null); close(); return; }
      if (!r.ok) { sheet.appendChild(el("p", { text: "Couldn't reach Relay." })); sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Close", onclick: close })); return; }
      if (!r.body.accepted) return consentView(sheet, email, r.body);
      signedInView(sheet, email, notice, r.body);
    }).catch(function () { sheet.textContent = ""; sheet.appendChild(el("p", { text: "Couldn't reach Relay." })); });
  }
  function receiptCard(x, refresh, slim) {
    var who = (x.retailer && (x.retailer.name || x.retailer.domain)) || "Unknown store";
    var names = (x.items || []).map(function (i) { return i.qty + " × " + i.name + (i.variant ? " (" + i.variant + ")" : ""); }).join(", ");
    var card = el("div", { className: "rl-order" }, [el("b", { text: who + (x.orderRef ? " · " + x.orderRef : "") }),
      el("span", { text: (names ? names + " · " : "") + (x.totalPence == null ? "total not found" : money(x.totalPence, x.currency)) + (x.orderDate ? " · " + x.orderDate : "") })]);
    if (slim) { card.removeChild(card.firstChild); card.removeChild(card.firstChild); card.style.margin = "0"; card.style.padding = "0"; card.style.border = "0"; card.style.boxShadow = "none"; card.style.background = "none"; }
    if (!slim && x.hasImage && x.id) {
      var ph = el("img", { alt: "", style: "float:right;width:64px;height:64px;object-fit:cover;border-radius:12px;margin:0 0 8px 10px;background:#f1ecdf" });
      card.insertBefore(ph, card.firstChild);
      apiBlob("/relay/my/receipts/" + x.id + "/image").then(function (u) { if (u) ph.src = u; else ph.remove(); });
    }
    var dv = x.delivery;
    if (!slim && dv && dv.status && (dv.status === "delivered" || freshDelivery(x))) {
      var day = function (d) { return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); };
      var today = new Date().toISOString().slice(0, 10);
      var said = dv.status === "delivered" ? "Delivered" + (dv.at ? " " + (dv.at === today ? "today" : day(dv.at)) : "") :
        dv.status === "out_for_delivery" ? "Out for delivery" : dv.status === "due" ? (dv.at && dv.at !== today ? "Due " + day(dv.at) : "Due today") : "On its way";
      var dl = el("div", { style: "clear:both;margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px" }, [
        el("span", { text: (dv.status === "delivered" ? "✓ " : "") + said + (dv.carrier ? " · " + dv.carrier : ""),
          style: "font-weight:700;padding:4px 10px;border-radius:999px;background:" + (dv.status === "delivered" ? "#e3f4c8;color:#46601b" : "#e7eefc;color:#1d3f8a") })]);
      if (dv.trackUrl && /^https:\/\//.test(dv.trackUrl)) dl.appendChild(el("a", { href: dv.trackUrl, target: "_blank", rel: "noopener noreferrer", text: "Track parcel →", style: "font-weight:600" }));
      card.appendChild(dl);
    }
    if (x.returnable === false) card.appendChild(el("span", { text: "Usually can't be returned", style: "display:inline-block;margin:6px 6px 0 0;padding:4px 10px;border-radius:999px;font-weight:700;font-size:13px;background:#ece8dd;color:#5b6475" }));
    var left = daysLeft(deadlineOf(x));
    if (left !== null) {
      var pill = left < 0 ? ["Deadline passed", "#ece8dd", "#5b6475"] : left === 0 ? ["Return today", "#fde0dd", "#b3261e"] :
        left <= 2 ? [left + " day" + (left === 1 ? "" : "s") + " left", "#fde0dd", "#b3261e"] :
        left <= 7 ? [left + " days left", "#ffefc9", "#77520a"] : [left + " days left", "#e3f4c8", "#46601b"];
      card.appendChild(el("span", { text: pill[0], style: "display:inline-block;margin-top:6px;padding:4px 10px;border-radius:999px;font-weight:700;font-size:13px;background:" + pill[1] + ";color:" + pill[2] }));
      if (left >= 0 && x.id && x.reminder && !(x.returnBy && deadlineOf(x) === x.returnBy.date)) {
        var rem = el("button", { className: "rl-btn ghost", style: "margin-top:8px;padding:9px 14px;font-size:14px", disabled: x.reminder === "sent",
          text: x.reminder === "on" ? "Reminder set · turn off" : x.reminder === "sent" ? "Reminder sent" : "Remind me 3 days before",
          onclick: function () { rem.disabled = true;
            api("/relay/my/receipts/" + x.id + "/remind", { method: "POST", body: { on: x.reminder === "off" } }).then(refresh); } });
        card.appendChild(rem);
        if (x.reminder === "off") card.appendChild(el("span", { text: "We'll email you once, at your sign-in address.", style: "display:block;font-size:12px;opacity:.7;margin-top:4px" }));
      }
    }
    if (left !== null && left < 0 && x.id && x.kind !== "return_instructions" && (x.items || []).length && openResale && marketOn()) {
      card.appendChild(el("button", { className: "rl-btn ghost", text: "Missed the window? Sell or swap it", style: "margin-top:8px;padding:9px 14px;font-size:14px", onclick: function () { openResale(x.id); } }));
    }
    if (x.id && mailRef(x) && openOriginal) {
      card.appendChild(el("button", { className: "rl-btn ghost", text: "View original receipt", style: "margin-top:8px;padding:9px 14px;font-size:14px", onclick: function () { openOriginal(x.id); } }));
    }
    var legal = x.returnBy && x.returnable !== false && x.returnBy.basis === "uk_law" ? x.returnBy.date : null;
    var rt = x.returns || (legal ? {} : null);
    if (rt) {
      var rb = el("div", { style: "margin-top:8px;padding:10px;border-radius:10px;background:rgba(127,127,127,.12);font-size:14px" });
      rb.appendChild(el("b", { text: "Returns", style: "display:block;margin-bottom:4px" }));
      var line = function (t) { rb.appendChild(el("span", { text: t, style: "display:block;margin-top:2px" })); };
      if (rt.deadline) line("Return by " + new Date(rt.deadline + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }));
      else if (rt.windowDays) line(rt.windowDays + " days to return" + (rt.windowFrom === "delivery" ? " from delivery (check your delivery date)" : ""));
      else if (legal) {
        rb.appendChild(el("span", { text: "Tell " + who + " by " + new Date(legal + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) + " if you want to send it back",
          style: "display:block;margin-top:2px;font-weight:600" }));
        rb.appendChild(el("span", { text: "The email doesn't give a return window, so this is the least UK law allows for online orders: 14 days from delivery. " + who + " may allow longer.",
          style: "display:block;margin-top:2px;font-size:13px;opacity:.8" }));
      }
      if (rt.address) line("Send to: " + rt.address);
      (rt.instructions || []).forEach(function (t) { line("“" + t + "”"); });
      if (rt.qrMentioned) line("This email mentions a QR code. Tap “View original receipt” to see it.");
      else if (rt.labelMentioned) line("A label or drop-off option is mentioned. Tap “View original receipt” to see it.");
      if (rt.portalUrl && /^https:\/\//.test(rt.portalUrl)) {
        rb.appendChild(el("a", { href: rt.portalUrl, target: "_blank", rel: "noopener noreferrer", text: "Start a return with " + who + " →", style: "display:block;margin-top:6px;font-weight:600" }));
      }
      rb.appendChild(el("span", { text: "From your order email.", style: "display:block;margin-top:6px;opacity:.7;font-size:12px" }));
      card.appendChild(rb);
    }
    var rp = x.returnPlan || (x.kind === "return_instructions" ? x : null);
    var prog = x.returnProgress || null;
    if (!rp && prog) rp = {};
    if (rp) {
      var pb = el("div", { style: "margin-top:8px;padding:10px;border-radius:10px;background:rgba(127,127,127,.12);font-size:14px" });
      pb.appendChild(el("b", { text: "Your return", style: "display:block;margin-bottom:4px" }));
      var pl = function (t, st) { pb.appendChild(el("span", { text: t, style: "display:block;margin-top:2px;" + (st || "") })); };
      if (rp.deadline) {
        var past = rp.deadline < new Date().toISOString().slice(0, 10);
        pl((past ? "Deadline passed: " : "Return by ") + new Date(rp.deadline + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }), past ? "opacity:.7" : "font-weight:600");
      }
      if (prog) {
        // Where the return has got to, step by step. Each step comes from an email; Relay can't confirm the refund itself.
        var shortDay = function (d) { return d ? " · " + new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : ""; };
        var pc = prog.parcel, arrived = Boolean(prog.receivedAt || prog.refundedAt || (pc && pc.status === "delivered"));
        var steps = [
          ["Sent back", Boolean(pc || arrived), pc && pc.status !== "delivered" ? shortDay(pc.at) : ""],
          ["Arrived at " + who, arrived, shortDay(prog.receivedAt || (pc && pc.status === "delivered" ? pc.at : null))],
          [prog.refundPence != null ? "Refund of " + money(prog.refundPence, prog.currency || "GBP") + " processed" : "Refund processed", Boolean(prog.refundedAt), shortDay(prog.refundedAt)]
        ];
        var track = el("div", { style: "margin:6px 0 4px" });
        steps.forEach(function (st) {
          track.appendChild(el("span", { text: (st[1] ? "✓ " : "○ ") + st[0] + (st[1] ? st[2] : ""), style: "display:block;margin-top:2px;" + (st[1] ? "font-weight:600;color:#46601b" : "opacity:.65") }));
        });
        pb.appendChild(track);
        if (prog.trackUrl && !rp.trackUrl && /^https:\/\//.test(prog.trackUrl)) pb.appendChild(el("a", { href: prog.trackUrl, target: "_blank", rel: "noopener noreferrer", text: "Track your return parcel →", style: "display:block;margin:2px 0 4px;font-weight:600" }));
        if (prog.refundedAt) pl("The refund comes from " + who + "'s email. Allow a few days for it to show on your statement.", "font-size:13px;opacity:.8");
      }
      if (rp.carrier) pl("Drop off with " + rp.carrier);
      if (rp.returnId) pl("Return ID: " + rp.returnId);
      (rp.steps || []).forEach(function (t) { pl("• " + t); });
      if (rp.estimatedRefundPence != null) pl("Estimated refund: " + money(rp.estimatedRefundPence, rp.currency) + " (an estimate from the email, not a confirmed refund)");
      if (rp.id && mailRef(rp) && openOriginal) {
        pb.appendChild(el("button", { className: "rl-btn", text: "Show my QR code / return email", style: "margin-top:8px;padding:10px 14px;font-size:14px", onclick: function () { openOriginal(rp.id); } }));
      } else if (/^[A-Za-z0-9]{6,40}$/.test(rp.gmailId || "")) {
        pb.appendChild(el("a", { href: "https://mail.google.com/mail/u/0/#all/" + rp.gmailId, target: "_blank", rel: "noopener noreferrer", text: "Open the email with your QR code", style: "display:block;margin-top:6px;font-weight:600" }));
      }
      if (rp.trackUrl && /^https:\/\//.test(rp.trackUrl)) {
        pb.appendChild(el("a", { href: rp.trackUrl, target: "_blank", rel: "noopener noreferrer", text: "Track your return", style: "display:block;margin-top:6px;font-weight:600" }));
      }
      pb.appendChild(el("span", { text: "Read from the store's email. Relay can't confirm the refund.", style: "display:block;margin-top:6px;opacity:.7;font-size:12px" }));
      card.appendChild(pb);
    }
    if (x.status === "confirmed") { card.appendChild(el("span", { text: " · Confirmed by you", style: "display:block;margin-top:4px" })); return card; }
    card.appendChild(el("span", { text: x.needsShopperConfirmation ? "Some details may be missing or wrong. Please check." : "Please check this is right.", style: "display:block;margin-top:4px" }));
    [["Looks right", "confirm", "rl-btn", null], ["Not mine / ignore", "dismiss", "rl-btn ghost", null], ["Just a promotion, hide it", "dismiss", "rl-btn ghost", "promo"]].forEach(function (b) {
      if (b[3] && !slim) return;
      card.appendChild(el("button", { className: b[2], text: b[0], style: "margin-top:8px;padding:10px 14px;font-size:14px", onclick: function () {
        api("/relay/my/receipts/" + x.id + "/" + b[1], { method: "POST", body: b[3] ? { reason: b[3] } : {} }).then(refresh); } }));
    });
    return card;
  }
  function disconnectGmail(done, msg) {
    ask("Disconnect " + mailName() + " and delete every receipt Relay captured from it?", "Disconnect and delete", function () {
      api("/relay/my/gmail/disconnect", { method: "POST" }).then(function (x) { if (x.ok) { memo.gmail = null; memo.receipts = null; memo.walletPurchases = null; memo.openCat = null; try { localStorage.removeItem("relay.cache.v1"); } catch (e) {} rememberMailbox({ connected: false }); done(); } else say(msg, "Couldn't disconnect. Try again.", true); });
    });
  }
  function gmailSection(box, c, msg, onPage) {
    box.textContent = "";
    if (!onPage) box.appendChild(el("h2", { text: "Your receipts", style: "font-size:18px;margin-top:8px" }));
    var list = el("div");
    var shopRows = [];
    // Placeholder squares while the first load is on its way, so the page is never blank.
    if (onPage && !memo.receipts) {
      var sk = el("div", { className: "rl-cats", style: "margin-top:52px" });
      for (var si = 0; si < 6; si++) sk.appendChild(el("div", { className: "rl-po rl-skel", style: "min-height:150px;margin:0" }));
      list.appendChild(sk); box.appendChild(list);
    }
    cachedGet("gmail", "/relay/my/gmail").then(function (r) {
      if (r.status === 401) { save(null); close(); return; }
      if (!r.ok || !r.body.connected) list.textContent = "";
      if (!r.ok) { box.appendChild(el("p", { text: "Couldn't load your email connection." })); return; }
      if (!r.body.connected) {
        var both = c.gmailAvailable && c.outlookAvailable;
        box.appendChild(el("p", { text: both ? "Connect the email you shop with, Gmail or Outlook, so Relay can find your order confirmations and receipts for you."
          : c.gmailAvailable ? "Connect Gmail so Relay can find your order confirmations and receipts for you."
          : c.outlookAvailable ? "Connect Outlook so Relay can find your order confirmations and receipts for you."
          : "Email connection isn't switched on yet. You can still add a receipt by pasting it below." }));
        var connectBtn = function (label, provider, start, name) {
          var b = el("button", { className: "rl-btn", text: label, style: "margin-top:8px" });
          b.onclick = function () {
            b.disabled = true;
            api("/relay/my/gmail/connect", { method: "POST", body: provider ? { provider: provider } : undefined }).then(function (x) {
              if (x.ok && x.body && start.test(x.body.url || "")) { location.href = x.body.url; return; }
              b.disabled = false; say(msg, "Couldn't start the " + name + " connection. Please try again.", true);
            }).catch(function () { b.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
          };
          return b;
        };
        if (c.gmailAvailable) box.appendChild(connectBtn("Connect Gmail", null, /^https:\/\/accounts\.google\.com\//, "Gmail"));
        if (c.outlookAvailable) box.appendChild(connectBtn("Connect Outlook", "microsoft", /^https:\/\/login\.microsoftonline\.com\//, "Outlook"));
        if (c.outlookAvailable) box.appendChild(el("p", { text: "Outlook works with Outlook.com, Hotmail and Live addresses.", style: "font-size:13px;opacity:.75;margin-top:8px" }));
        return;
      }
      var MB = r.body.provider === "microsoft" ? "Outlook" : "Gmail", owner = MB === "Outlook" ? "Microsoft" : "Google";
      if (!onPage) box.appendChild(el("p", { text: MB + " connected" + (r.body.googleEmail ? ": " + r.body.googleEmail : "") + ". Relay only looks for order confirmations, receipts and return emails." }));
      var lastScan = r.body.lastScanAt ? new Date(r.body.lastScanAt) : null;
      var scanBtn = el("button", { className: "rl-btn", text: lastScan ? "Check for new receipts" : "Scan my " + MB + " for receipts" });
      var status = el("div", { className: "rl-msg" });
      var autoAt = r.body.autoAt ? new Date(r.body.autoAt) : null;
      var checked = autoAt && (!lastScan || autoAt > lastScan) ? autoAt : lastScan;
      var when = function (d) { return d.toDateString() === new Date().toDateString() ? "today at " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }); };
      status.textContent = onPage ? MB + " connected" + (checked ? " · checked " + when(checked) : "") + " · new receipts arrive automatically"
        : "Relay checks your " + MB + " for new receipts and parcel updates every 15 minutes" + (checked ? ". Last checked " + when(checked) + "." : ".");
      if (onPage) { scanBtn.className = "rl-po-secondary"; scanBtn.style.cssText = "flex:0 0 auto;padding:6px 14px;font-size:13px"; scanBtn.textContent = "Check now"; }
      var query = "";
      var search = el("input", { type: "search", placeholder: "Search your receipts (store, item, order number)", style: "margin-top:12px" });
      search.addEventListener("input", function () { var was = Boolean(query); query = search.value.trim().toLowerCase(); if (was !== Boolean(query)) drawList(); else applyFilter(); });
      function applyFilter() {
        var shown = 0;
        Array.prototype.forEach.call(list.children, function (c) {
          if (!c.getAttribute("data-find")) return;
          var hit = !query || c.getAttribute("data-find").indexOf(query) !== -1;
          c.style.display = hit ? "" : "none"; if (hit) shown++;
        });
        var none = list.querySelector(".rl-none");
        if (none) none.style.display = query && !shown ? "" : "none";
      }
      var GROUP_KEYS = ["fashion", "electronics", "food", "home", "beauty", "travel", "digital", "other"];
      var allRows = memo.receipts ? memo.receipts.rows : [];
      function pill(text, bg, fg) { return el("span", { text: text, style: "display:inline-block;margin-top:4px;padding:3px 9px;border-radius:999px;font-weight:700;font-size:12px;background:" + bg + ";color:" + fg }); }
      // One tidy line per receipt: picture (the item's photo, or the shop's logo), what was bought, the shop and date,
      // and the price. The whole line opens the details underneath; nothing in it looks like a link.
      function receiptRow(row) {
        var who = (row.retailer && (row.retailer.name || row.retailer.domain)) || "Unknown store";
        var named = (row.items || []).filter(function (i) { return i.name; });
        var names = named.map(function (i) { return i.name + (i.variant && named.length === 1 ? " · " + i.variant : ""); }).join(", ");
        var ref = row.orderRef && /^[#A-Za-z0-9-]{3,14}$/.test(row.orderRef) ? "Order " + (row.orderRef.charAt(0) === "#" ? "" : "#") + row.orderRef : null;
        var title = named.length ? named[0].name + (named.length > 1 ? " + " + (named.length - 1) + " more" : "") : who;
        var sub = [named.length ? who : ref, row.orderDate ? shortDate(row.orderDate + "T12:00:00Z") : null].filter(Boolean).join(" · ") || "Receipt";
        var wrap = el("div", { className: "rl-rr" });
        var btn = el("button", { type: "button", className: "rl-rr-main" });
        btn.setAttribute("aria-expanded", "false");
        var thumb = el("span", { className: "rl-rr-pic", text: initials(who) });
        thumb.setAttribute("aria-hidden", "true");
        if (named.length <= 1 && row.hasImage && row.id) apiBlob("/relay/my/receipts/" + row.id + "/image").then(function (u) { if (u) { thumb.textContent = ""; thumb.classList.add("rl-has-photo"); thumb.appendChild(el("img", { src: u, alt: "" })); } else shopLogo(thumb, row.retailer && row.retailer.domain, 32); });
        else shopLogo(thumb, row.retailer && row.retailer.domain, 32);
        var end = el("span", { className: "rl-rr-end" }, [el("b", { text: row.totalPence == null ? "" : money(row.totalPence, row.currency) })]);
        var left = daysLeft(deadlineOf(row));
        if (left !== null && left >= 0) end.appendChild(el("span", { className: "rl-rr-chip " + (left <= 2 ? "red" : left <= 7 ? "amber" : "green"), text: left === 0 ? "Return today" : left + " day" + (left === 1 ? "" : "s") + " left" }));
        btn.appendChild(thumb);
        btn.appendChild(el("span", { className: "rl-rr-mid" }, [el("b", { text: title }), el("span", { text: sub })]));
        btn.appendChild(end);
        wrap.appendChild(btn);
        var detail = null;
        btn.onclick = function () {
          if (detail) { delete memo.openIds[row.id]; detail.remove(); detail = null; btn.setAttribute("aria-expanded", "false"); wrap.classList.remove("open"); return; }
          detail = el("div", { className: "rl-rr-detail" });
          if (names && named.length > 1) detail.appendChild(el("p", { className: "rl-rr-items", text: names }));
          detail.appendChild(receiptCard(row, loadList, true));
          var acts = el("div", { className: "rl-rr-acts" });
          if (row.id && mailRef(row) && openOriginal) acts.appendChild(el("button", { type: "button", className: "rl-po-secondary", text: "Open the original email", onclick: function () { openOriginal(row.id); } }));
          if (acts.childNodes.length) detail.appendChild(acts);
          var pick = el("select", { ariaLabel: "Move to another group", className: "rl-rr-move" }, [el("option", { value: "", text: "Wrong group? Move it to…" })]);
          GROUP_KEYS.forEach(function (k) { pick.appendChild(el("option", { value: k, text: groupNames[k] || k })); });
          pick.onchange = function () { if (!pick.value) return;
            api("/relay/my/receipts/" + row.id + "/category", { method: "POST", body: { category: pick.value } }).then(function () { say(status, "Thanks, Relay will remember this for " + who + "."); loadList(); }); };
          detail.appendChild(pick);
          if (row.categoryLearned) detail.appendChild(el("span", { text: "Grouped the way you taught Relay.", className: "rl-rr-note" }));
          wrap.appendChild(detail); memo.openIds[row.id] = true; btn.setAttribute("aria-expanded", "true"); wrap.classList.add("open");
        };
        var find = [row.retailer && row.retailer.name, row.retailer && row.retailer.domain, row.orderRef, names].filter(Boolean).join(" ").toLowerCase();
        wrap.setAttribute("data-find", find);
        if (memo.openIds[row.id]) btn.onclick();
        return wrap;
      }
      var groupNames = { fashion: "Fashion", electronics: "Electronics", food: "Food & drink", home: "Home & garden", beauty: "Beauty & health", travel: "Travel & transport", digital: "Digital & subscriptions", other: "Other" };
      // One group's page: a header in the group's colour with what's in it, filters, then receipts by month (newest first)
      // with each month's total. Long groups show 40 at a time.
      var GBP = function (rs) { return rs.reduce(function (n, r) { return n + (Number.isInteger(r.totalPence) && (!r.currency || r.currency === "GBP") ? r.totalPence : 0); }, 0); };
      function drawCategory(k, rowsIn) {
        var rows = rowsIn.slice().sort(function (a, b) { return String(b.orderDate || "").localeCompare(String(a.orderDate || "")); });
        var today = new Date().toISOString().slice(0, 10);
        var canReturn = function (r) { var dl = deadlineOf(r); return Boolean(dl && dl >= today); };
        var years = []; rows.forEach(function (r) { var y = String(r.orderDate || "").slice(0, 4); if (/^\d{4}$/.test(y) && years.indexOf(y) === -1) years.push(y); });
        var c = CAT_ICONS[k] || CAT_ICONS.other;
        list.appendChild(el("button", { type: "button", className: "rl-cat-back", onclick: function () { memo.openCat = null; memo.catFilter = null; drawList(); window.scrollTo && window.scrollTo(0, 0); } }, [el("span", { text: "\u2039", className: "rl-cat-back-i" }), el("span", { text: "All groups" })]));
        list.lastChild.firstChild.setAttribute("aria-hidden", "true");
        var oldest = rows.filter(function (r) { return r.orderDate; }).slice(-1)[0];
        var spent = GBP(rows);
        var hero = el("div", { className: "rl-cat-hero", style: "background:" + c[0] + ";color:" + c[1] }, [catIcon(k, 52),
          el("div", { className: "rl-cat-hero-t" }, [el("h3", { text: groupNames[k] }),
            el("span", { text: [rows.length + (rows.length === 1 ? " receipt" : " receipts"), spent ? money(spent, "GBP") + " spent" : null, oldest ? "since " + new Date(oldest.orderDate + "T12:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : null].filter(Boolean).join(" · ") })])]);
        hero.firstChild.style.background = "rgba(255,255,255,.7)";
        list.appendChild(hero);
        if (rows[0] && rows[0].returnable === false && rows[0].notReturnableReason) list.appendChild(el("p", { className: "rl-cat-note", text: rows[0].notReturnableReason }));
        // Filters: all, what can still go back (when there is any), and each year.
        var filters = [["all", "All"]];
        if (rows.some(canReturn)) filters.push(["return", "Can still return"]);
        if (years.length > 1) years.forEach(function (y) { filters.push([y, y]); });
        var f = memo.catFilter && filters.some(function (x) { return x[0] === memo.catFilter; }) ? memo.catFilter : "all";
        var chips = el("div", { className: "rl-cat-chips", role: "group" });
        chips.setAttribute("aria-label", "Show");
        if (filters.length > 1) filters.forEach(function (x) {
          var b = el("button", { type: "button", className: x[0] === f ? "on" : "", text: x[1], onclick: function () { memo.catFilter = x[0]; draw(); } });
          b.setAttribute("aria-pressed", x[0] === f ? "true" : "false");
          chips.appendChild(b);
        });
        var cq = el("input", { type: "search", className: "rl-cat-search", placeholder: "Search " + groupNames[k].toLowerCase() + ": shop, item or order number" });
        cq.setAttribute("aria-label", "Search " + groupNames[k].toLowerCase());
        var body = el("div");
        list.appendChild(chips); list.appendChild(cq); list.appendChild(body);
        var shown = 40;
        function draw() {
          f = memo.catFilter && filters.some(function (x) { return x[0] === memo.catFilter; }) ? memo.catFilter : "all";
          Array.prototype.forEach.call(chips.children, function (b, i) { var on = filters[i][0] === f; b.className = on ? "on" : ""; b.setAttribute("aria-pressed", on ? "true" : "false"); });
          var q = cq.value.trim().toLowerCase();
          var pick = rows.filter(function (r) {
            if (f === "return" && !canReturn(r)) return false;
            if (/^\d{4}$/.test(f) && String(r.orderDate || "").slice(0, 4) !== f) return false;
            if (!q) return true;
            var names = (r.items || []).map(function (i) { return i.name; }).join(" ");
            return [r.retailer && r.retailer.name, r.retailer && r.retailer.domain, r.orderRef, names].filter(Boolean).join(" ").toLowerCase().indexOf(q) !== -1;
          });
          body.textContent = "";
          if (!pick.length) { body.appendChild(el("div", { className: "rl-empty" }, [el("h3", { text: q ? "Nothing matches that search" : "Nothing here" }), el("p", { text: q ? "Try a shop name, an item or an order number." : "Try another filter." })])); return; }
          var month = null, card = null;
          pick.slice(0, shown).forEach(function (r) {
            var m = r.orderDate ? r.orderDate.slice(0, 7) : "none";
            if (m !== month) {
              month = m;
              var inMonth = pick.filter(function (x) { return (x.orderDate ? x.orderDate.slice(0, 7) : "none") === m; }), tot = GBP(inMonth);
              body.appendChild(el("div", { className: "rl-cat-month" }, [el("b", { text: m === "none" ? "No date" : new Date(m + "-01T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric" }) }),
                el("span", { text: inMonth.length + (inMonth.length === 1 ? " receipt" : " receipts") + (tot ? " · " + money(tot, "GBP") : "") })]));
              card = el("div", { className: "rl-cat-list" }); body.appendChild(card);
            }
            card.appendChild(receiptRow(r));
          });
          if (pick.length > shown) body.appendChild(el("button", { type: "button", className: "rl-po-secondary rl-cat-more", text: "Show " + Math.min(40, pick.length - shown) + " more of " + (pick.length - shown), onclick: function () { shown += 40; draw(); } }));
        }
        cq.addEventListener("input", function () { shown = 40; draw(); });
        draw();
      }
      function drawList() {
        list.textContent = "";
        var rows = allRows;
        // An email from a shop on Relay is the same purchase as its shop order, which is already under "Shop orders".
        if (onPage && shopRows.length) { var dup = {}; shopRows.forEach(function (x) { dup[label(x[0].store) + "|" + x[0].amountMinor] = true; });
          rows = rows.filter(function (r) { return !dup[label(r.retailer && r.retailer.name) + "|" + r.totalPence]; }); }
        if (!rows.length && !shopRows.length) { list.appendChild(el("p", { text: "No receipts found yet." })); return; }
        // Soonest deadline first, then no deadline, then expired.
        var rank = function (r) { var d = daysLeft(deadlineOf(r)); return d === null ? [1, 0] : d < 0 ? [2, -d] : [0, d]; };
        var sorted = rows.slice().sort(function (a, b) { var A = rank(a), B = rank(b); return A[0] - B[0] || A[1] - B[1]; });
        if (query) { sorted.forEach(function (r) { list.appendChild(receiptRow(r)); }); list.appendChild(el("p", { className: "rl-none", text: "No receipts match that search.", style: "display:none" })); applyFilter(); return; }
        var by = {}; sorted.forEach(function (r) { var k = r.category || "other"; (by[k] = by[k] || []).push(r); });
        var keys = Object.keys(by).sort(function (a, b) { var na = by[a][0].returnable === false ? 1 : 0, nb = by[b][0].returnable === false ? 1 : 0; return na - nb || by[b].length - by[a].length; });
        if (memo.openCat === "shop" && shopRows.length) {
          list.appendChild(el("button", { className: "rl-po-secondary", text: "‹ All groups", style: "flex:none;padding:7px 14px;font-size:14px", onclick: function () { memo.openCat = null; drawList(); } }));
          list.appendChild(el("h3", { style: "font-size:20px;margin:14px 0 8px;color:#0f1b33;display:flex;align-items:center;gap:10px" }, [catIcon("shop", 32), el("span", { text: "Shop orders (" + shopRows.length + ")" })]));
          list.lastChild.firstChild.style.background = "#101828";
          var sq = el("input", { type: "search", placeholder: "Search shop orders", style: "margin:0 0 12px;width:100%;box-sizing:border-box;padding:12px 16px;border:1px solid #e7e1d2;border-radius:14px;font-size:15px;background:#fff;font-family:inherit" });
          var sh = el("div", { className: "rl-po-grid" });
          shopRows.forEach(function (x) { var c = confirmedCard(x[0], x[1], function () { memo.purchases = null; loadList(); }); c.setAttribute("data-find", [x[0].store, x[1].title, x[1].variant].join(" ").toLowerCase()); sh.appendChild(c); });
          sq.addEventListener("input", function () { var q = sq.value.trim().toLowerCase(); Array.prototype.forEach.call(sh.children, function (c) { c.style.display = !q || c.getAttribute("data-find").indexOf(q) !== -1 ? "" : "none"; }); });
          list.appendChild(sq); list.appendChild(sh);
          return;
        }
        if (memo.openCat && by[memo.openCat]) {
          drawCategory(memo.openCat, by[memo.openCat]);
          return;
        }
        memo.openCat = null;
        var grid = el("div", { className: "rl-cats" });
        if (shopRows.length) grid.appendChild(el("button", { type: "button", ariaLabel: "Shop orders, " + shopRows.length, onclick: function () { memo.openCat = "shop"; drawList(); window.scrollTo && window.scrollTo(0, 0); },
          style: "all:unset;cursor:pointer;box-sizing:border-box;min-height:150px;height:100%;border-radius:22px;padding:16px;display:flex;flex-direction:column;justify-content:space-between;background:#101828;color:#fff;border:1px solid #101828" },
          [catIcon("shop"), el("span", {}, [el("b", { text: "Shop orders", style: "display:block;font-size:17px" }),
            el("span", { text: shopRows.length + " item" + (shopRows.length === 1 ? "" : "s") + " · swap & return", style: "display:block;font-size:13px;opacity:.75;margin-top:2px" })])]));
        keys.forEach(function (k) {
          var soon = by[k].filter(function (r) { var d = daysLeft(deadlineOf(r)); return d !== null && d >= 0 && d <= 7; }).length;
          var check = by[k].filter(function (r) { return r.status !== "confirmed" && r.needsShopperConfirmation; }).length;
          var sub = soon ? soon + " return deadline" + (soon === 1 ? "" : "s") + " soon" : by[k][0].returnable === false ? "Usually can't be returned" : check ? check + " to check" : "All looks fine";
          grid.appendChild(el("button", { type: "button", ariaLabel: groupNames[k] + ", " + by[k].length + " receipts", onclick: function () { memo.openCat = k; drawList(); window.scrollTo && window.scrollTo(0, 0); },
            style: "all:unset;cursor:pointer;box-sizing:border-box;min-height:150px;height:100%;border-radius:22px;padding:16px;display:flex;flex-direction:column;justify-content:space-between;background:#fff;border:1px solid #e7e1d2;box-shadow:0 2px 10px rgba(15,27,51,.06)" },
            [catIcon(k),
             el("span", {}, [el("b", { text: groupNames[k], style: "display:block;font-size:17px;color:#0f1b33" }), el("span", { text: by[k].length + (by[k].length === 1 ? " receipt" : " receipts"), style: "display:block;font-size:14px;opacity:.8;margin-top:2px" }), el("span", { text: sub, style: "display:block;font-size:13px;margin-top:6px;color:" + (soon ? "#b3261e" : "#5b6475") + ";font-weight:" + (soon ? "700" : "400") })])]));
        });
        list.appendChild(grid);
      }
      var drawnSig = null;
      function loadList() {
        // Show what was loaded last time straight away, then quietly update if anything changed.
        if (onPage && !shopRows.length && memo.shopRows) shopRows = memo.shopRows;
        if (drawnSig === null && memo.receipts) { allRows = memo.receipts.rows; drawnSig = memo.receipts.sig; drawList(); }
        var sk = list.firstChild; if (sk && sk.className === "rl-cats" && sk.style.marginTop) sk.style.marginTop = "8px";
        // Shop orders and email receipts are drawn together, so the page never redraws itself a moment later.
        var shopsLoaded = !onPage ? Promise.resolve() : (memo.purchases || api("/relay/my/purchases")).then(function (pr) {
          var rows = []; ((pr.ok && pr.body && pr.body.purchases) || []).forEach(function (o) { (o.items || []).forEach(function (it) { rows.push([o, it]); }); });
          var sig = JSON.stringify(rows.map(function (x) { return [x[0].id, x[1].lineId, x[1].exchange && x[1].exchange.status, x[1].returnInfo && x[1].returnInfo.status]; }));
          var changed = sig !== memo.shopSig; shopRows = rows; memo.shopRows = rows; memo.shopSig = sig;
          return changed;
        }, function () { return false; });
        Promise.all([api("/relay/my/receipts" + (onPage ? "?all=1" : "")), shopsLoaded]).then(function (both) {
          var x = both[0], shopsChanged = both[1];
          if (!x.ok) { if (drawnSig === null || shopsChanged) drawList(); return; }
          if (!x.ok) { if (drawnSig === null) drawList(); return; }
          var rows = (x.body && x.body.receipts) || [], sig = JSON.stringify(rows);
          memo.receipts = { rows: rows, sig: sig, at: Date.now() }; diskWrite("receipts", rows);
          if (sig === drawnSig && !shopsChanged) return;
          if (sig !== drawnSig) memoDrop("wrapped");
          allRows = rows; drawnSig = sig; drawList();
        });
      }
      // Reading happens on Relay's side as a job, so it carries on if the shopper leaves the app (or the phone locks).
      // While this page is open the app asks for the rounds itself (quicker, with progress on screen); if Relay is already
      // busy with them, the app just shows how far it has got.
      var scanning = false;
      try { localStorage.removeItem("relay_scan_cursor"); } catch (e) {}
      var monthOf = function (sb) { var m = /^(\d{4})[\/-](\d{2})/.exec(sb || ""); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : ""; };
      var progress = function (job) {
        var found = (job && job.found) || 0, label = monthOf(job && job.scannedBack);
        say(status, (label ? "Reading back to " + label : "Reading your " + MB) + "… " + found + " found so far. You can close Relay, it carries on.");
      };
      var doScan = function (full) {
        if (scanning) return;
        scanning = true; scanBtn.disabled = true; say(status, lastScan && !full ? "Checking for new mail…" : "Scanning…");
        var rounds = 0, tries = 0;
        function finish(text, bad) { scanning = false; scanBtn.disabled = false; memo.gmail = null; if (text) say(status, text, bad); }
        // A round that fails (the mailbox or Relay busy for a moment) is tried again a few seconds later; Relay also carries on by itself.
        function retry() {
          tries++;
          if (tries > 3) return finish(MB + " is busy right now. Relay will carry on by itself and your receipts will appear here.");
          say(status, MB + " is busy, trying again…");
          return new Promise(function (res) { setTimeout(res, 3000 * tries); }).then(function () { return step(true); });
        }
        function step(small) {
          // The shopper went to another page: Relay carries on by itself.
          if (!document.body.contains(status)) { scanning = false; return; }
          return api("/relay/my/gmail/scan", { method: "POST", body: Object.assign({}, full ? { full: true } : {}, small ? { small: true } : {}) }).then(function (x) {
            if (x.status === 401) return finish(owner + " needs you to reconnect " + MB + ". Disconnect and connect again.", true);
            if (!x.ok) return retry();
            tries = 0;
            var job = x.body.job;
            if (job && job.state === "failed") return finish(job.error === "gmail_reconnect_needed" ? owner + " needs you to reconnect " + MB + ". Disconnect and connect again." : "Couldn't finish reading " + MB + ". Please try again later.", true);
            // Relay is reading this mailbox right now: show its progress and look again in a moment.
            if (x.body.busy) { progress(job); loadList(); return new Promise(function (res) { setTimeout(res, x.body.retryAfterMs || 4000); }).then(function () { return step(); }); }
            rounds++;
            loadList();
            if (x.body.more && rounds < 150) { progress(job); return step(); }
            if (x.body.more) return finish("Still reading in the background. New receipts will appear here as they're found.");
            // "Connected. Scanning for receipts…" is out of date once the scan has finished.
            if (onPage && msg.textContent && !/\berr\b/.test(msg.className)) say(msg, "");
            try { if (job && job.finishedAt) localStorage.setItem("relay.scanSeen", String(job.finishedAt)); } catch (e) {}
            var found = job ? job.found : (x.body.added || 0) + (x.body.updated || 0);
            finish(found ? "Found or updated " + found + " receipt or return email" + (found === 1 ? "" : "s") + ". Please check them below." : "Nothing new found.");
          // A dropped connection is treated like a busy round: wait, then carry on.
          }, function () { return retry(); });
        }
        Promise.resolve(step()).catch(function () { finish("Couldn't reach Relay. Check your connection and try again.", true); });
      };
      // Coming back to the app: carry on showing a scan Relay kept going, or say it finished while the shopper was away.
      var resume = function (job) {
        if (!job || scanning || !document.body.contains(status)) return;
        if (job.state === "running") { progress(job); doScan(job.full); return; }
        var seen = ""; try { seen = localStorage.getItem("relay.scanSeen") || ""; } catch (e) {}
        if (job.state === "done" && job.finishedAt && String(job.finishedAt) !== seen && Date.now() - job.finishedAt < 24 * 3600e3) {
          try { localStorage.setItem("relay.scanSeen", String(job.finishedAt)); } catch (e) {}
          say(status, "Finished reading your " + MB + " while you were away: " + job.found + " found.");
        }
      };
      window.__relayScanResume = function () {
        if (scanning || !document.body.contains(status)) return;
        api("/relay/my/gmail").then(function (g) { if (g.ok && g.body && g.body.scan) { loadList(); resume(g.body.scan); } });
      };
      if (!window.__relayScanVisBound) {
        window.__relayScanVisBound = true;
        document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && window.__relayScanResume) window.__relayScanResume(); });
      }
      scanBtn.onclick = function () { doScan(false); };
      if (onPage) {
        status.style.cssText = "margin:0;font-size:13px;color:#667085";
        box.appendChild(el("div", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 14px" }, [status, scanBtn]));
        box.appendChild(list);
        // A shop missing from the list can be looked for directly (Relay reads only the email the shopper picks).
        box.appendChild(el("button", { type: "button", className: "rl-find-link", text: "Missing a receipt? Search " + MB + " for it",
          style: "all:unset;cursor:pointer;box-sizing:border-box;display:block;min-height:44px;line-height:44px;margin:12px auto 0;font-size:15px;font-weight:700;color:#3f5a17;text-decoration:underline;text-underline-offset:3px",
          onclick: function () { open(function (sheet) { findView(sheet, close); }); } }));
      } else { box.appendChild(scanBtn); box.appendChild(status); box.appendChild(search); box.appendChild(list); }
      loadList();
      // On the Receipts page these housekeeping options stay out of the way; they live under the account button (top right).
      if (!onPage) {
        if (lastScan) box.appendChild(el("button", { className: "rl-btn ghost", text: "Re-scan all my email (slower)", onclick: function () { doScan(true); } }));
        if (openFind) box.appendChild(el("button", { className: "rl-btn ghost", text: "Can't find a receipt? Search " + MB + " for it", onclick: function () { openFind(); } }));
        box.appendChild(el("button", { className: "rl-btn ghost", text: "Disconnect " + MB + " and delete captured receipts", onclick: function () { disconnectGmail(function () { gmailSection(box, c, msg, onPage); }, msg); } }));
      }
      if (window.__relayAutoFull) { window.__relayAutoFull = false; window.__relayAutoScan = false; doScan(true); }
      else if (window.__relayAutoScan) { window.__relayAutoScan = false; scanBtn.onclick(); }
      else resume(r.body.scan);
    }).catch(function () { box.appendChild(el("p", { text: "Couldn't reach Relay." })); });
  }

  // ---- View original receipt: fetched live from Gmail or Outlook when opened; nothing is stored ----
  var openOriginal = null;
  function originalView(sheet, receiptId, onBack) {
    var msg = el("div", { className: "rl-msg" });
    var body = el("div");
    var MB = mailName();
    [el("h2", { text: "Original receipt" }), el("p", { text: "Loading it from your " + MB + "…", style: "opacity:.7" }), body, msg,
      el("button", { className: "rl-btn ghost", text: "Back", onclick: onBack })].forEach(function (n) { sheet.appendChild(n); });
    var note = sheet.children[1];
    api("/relay/my/receipts/" + encodeURIComponent(receiptId) + "/original").then(function (r) {
      if (!r.ok) {
        note.textContent = r.body && r.body.error === "gmail_reconnect_needed" ? MB + " needs to be reconnected. Go back, disconnect it and connect again."
          : r.status === 404 ? "That email is no longer in your " + MB + ", so it can't be shown."
          : r.status === 409 ? "Connect your email again to open the original."
          : "Couldn't load the original email. Try again in a moment.";
        return;
      }
      note.textContent = "Shown straight from your " + MB + ". Relay doesn't keep a copy.";
      note.style.fontSize = "13px";
      var b = r.body || {};
      (b.links || []).forEach(function (l) {
        if (!/^https:\/\//.test(l.url || "")) return;
        body.appendChild(el("a", { href: l.url, target: "_blank", rel: "noopener noreferrer", text: String(l.label), className: "rl-btn", style: "display:block;text-align:center;text-decoration:none;margin-bottom:8px" }));
      });
      (b.extraImages || []).forEach(function (u) {
        if (!/^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+\/=]+$/.test(u)) return;
        body.appendChild(el("img", { src: u, alt: "Picture attached to the email", style: "display:block;max-width:100%;margin:8px auto;background:#fff;border-radius:8px" }));
      });
      var frame = el("iframe", { title: "Original receipt email", style: "width:100%;height:60vh;border:1px solid #ece4d3;border-radius:12px;background:#fff;margin-top:8px" });
      // No scripts, no same-origin: the email can show itself but cannot run code or touch Relay.
      frame.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.srcdoc = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: data:; style-src \'unsafe-inline\'; font-src https:">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>body{margin:8px;font-family:-apple-system,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>' + String(b.html || "");
      body.appendChild(frame);
    }).catch(function () { note.textContent = "Couldn't reach Relay."; });
  }

  // ---- Find a missing receipt: search the shopper's mailbox by store name, pick the right email, add it ----
  var openFind = null;
  function findView(sheet, onBack) {
    var input = el("input", { type: "search", placeholder: "Store name, e.g. lululemon", style: "margin-top:8px" });
    var MB = mailName();
    var go = el("button", { className: "rl-btn", text: "Search my " + MB });
    var msg = el("div", { className: "rl-msg" }), out = el("div");
    [el("h2", { text: "Find a missing receipt" }),
     el("p", { text: "Search your " + MB + " for a store, then pick the order confirmation email. Relay only reads the one you pick.", style: "font-size:14px;opacity:.8" }),
     input, go, msg, out, el("button", { className: "rl-btn ghost", text: "Back", onclick: onBack })].forEach(function (n) { sheet.appendChild(n); });
    function search() {
      var q = input.value.trim();
      if (q.length < 2) return say(msg, "Type at least 2 letters of the store name.", true);
      go.disabled = true; out.textContent = ""; say(msg, "Searching…");
      api("/relay/my/gmail/find", { method: "POST", body: { query: q } }).then(function (r) {
        go.disabled = false;
        if (!r.ok) return say(msg, r.body && r.body.error === "gmail_reconnect_needed" ? MB + " needs to be reconnected first." : r.status === 409 ? "Connect your email first." : "Couldn't search " + MB + " right now. Try again.", true);
        var list = (r.body && r.body.results) || [];
        say(msg, list.length ? "Tap Add on the order confirmation." : "Nothing found for that name. Try a shorter name.");
        list.forEach(function (x) {
          var add = el("button", { className: "rl-btn", text: x.added ? "Added" : "Add", disabled: !!x.added, style: "margin-top:8px;padding:9px 14px;font-size:14px" });
          add.onclick = function () {
            add.disabled = true; add.textContent = "Adding…";
            api("/relay/my/gmail/add", { method: "POST", body: { messageId: x.id } }).then(function (a) {
              if (a.ok && a.body && a.body.ok) { add.textContent = "Added"; say(msg, "Added" + (a.body.store ? " " + a.body.store : "") + (a.body.orderRef ? " · " + a.body.orderRef : "") + ". Go back to see it in your purchases."); return; }
              add.disabled = false; add.textContent = "Add";
              if (a.ok && a.body && a.body.reason === "not_recognised") {
                var sg = a.body.signals || {};
                say(msg, "Relay couldn't read that email as an order or a return. (Subject looked like an order: " + (sg.subject ? "yes" : "no") + ", order details found: " + (sg.body ? "yes" : "no") + ".) Try another one.", true);
              } else say(msg, "Couldn't add that email. Try again.", true);
            }).catch(function () { add.disabled = false; add.textContent = "Add"; say(msg, "Couldn't reach Relay.", true); });
          };
          out.appendChild(el("div", { className: "rl-order" }, [el("b", { text: x.subject || "(no subject)" }),
            el("span", { text: (x.from || "") + (x.date ? " · " + x.date : "") }), add]));
        });
      }).catch(function () { go.disabled = false; say(msg, "Couldn't reach Relay.", true); });
    }
    go.onclick = search;
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") search(); });
  }

  // ---- Swap & resell (v1: matches members; no payments or postage through Relay yet) ----
  // ---- Report review (only shown to the Relay admin; the server refuses everyone else) ----
  function adminView(sheet, onBack) {
    var list = el("div"), msg = el("div", { className: "rl-msg" });
    [el("h2", { text: "Reports to review" }),
     el("p", { text: "You see the conversation only, never who the members are. Dismiss, take the listing down, or block the member." }),
     list, msg, el("button", { className: "rl-btn ghost", text: "Back", onclick: onBack })].forEach(function (n) { sheet.appendChild(n); });
    function act(id, outcome, question) {
      if (question) return ask(question, "Yes, do it", function () { act(id, outcome, null); });
      api("/relay/my/admin/reports/" + id + "/review", { method: "POST", body: { outcome: outcome } }).then(function (r) {
        if (r.ok) { say(msg, "Done."); load(); }
        else say(msg, r.body.error === "conflict_of_interest" ? "You're part of this conversation, so another admin has to review it." : "That didn't work. Try again.", true);
      }).catch(function () { say(msg, "Couldn't reach Relay.", true); });
    }
    function load() {
      list.textContent = "";
      api("/relay/my/admin/reports").then(function (r) {
        if (!r.ok) return say(msg, "You can't review reports from this account.", true);
        var rows = r.body.reports || [];
        if (!rows.length) list.appendChild(el("p", { text: "No reports waiting. Nice and quiet." }));
        rows.forEach(function (x) {
          var card = el("div", { className: "rl-order" });
          card.appendChild(el("b", { text: x.reason || "(no reason given)" }));
          card.appendChild(el("span", { text: x.item.title + (x.item.store ? " · " + x.item.store : "") + " · " + new Date(x.createdAt).toLocaleDateString("en-GB") }));
          card.appendChild(el("span", { style: "display:block;margin-top:4px", text: "Reported by the " + x.reporterRole + " about the " + x.reportedRole + ". Reports against this member: " + x.reportsAgainstReported + (x.reportedAlreadyBlocked ? " (already blocked)" : "") + "." }));
          var log = el("div", { style: "margin:8px 0;max-height:180px;overflow:auto;border-top:1px solid #ece4d3;padding-top:6px" });
          (x.messages || []).forEach(function (m) {
            log.appendChild(el("div", { style: "font-size:13px;margin:4px 0" }, [el("b", { text: m.from + ": " }), el("span", { text: m.body })]));
          });
          if (!(x.messages || []).length) log.appendChild(el("span", { text: "No messages in this conversation." }));
          card.appendChild(log);
          var small = "padding:9px 14px;font-size:14px;margin:4px 6px 0 0;width:auto;display:inline-block";
          card.appendChild(el("button", { className: "rl-btn ghost", text: "Dismiss", style: small, onclick: function () { act(x.id, "dismiss"); } }));
          if (x.canRemoveListing) card.appendChild(el("button", { className: "rl-btn ghost", text: "Take listing down", style: small, onclick: function () { act(x.id, "remove_listing", "Take this listing down?"); } }));
          card.appendChild(el("button", { className: "rl-btn ghost", text: "Block member", style: small, onclick: function () { act(x.id, "block", "Block this member? Their listings come down and they can't list, ask or message again."); } }));
          list.appendChild(card);
        });
      }).catch(function () { say(msg, "Couldn't reach Relay.", true); });
    }
    load();
  }
  var openResale = null;
  var CONDITION = { new_with_tags: "New with tags", like_new: "Like new", good: "Good", fair: "Fair" };
  var resaleErrors = { area_needed: "Add your postcode area (like SW11) so buyers know where to collect, or choose Post only.", invalid_area: "That doesn't look like a postcode area. Use the first part, like SW11 or M1.", invalid_handover: "Choose how the item changes hands.", not_resellable: "Only physical items can be listed. Food, travel and digital purchases can't be resold.", account_restricted: "Your account can't use the swap and resell board right now.", agreement_required: "Please tick the box to agree.", already_listed: "That item is already listed.", too_many_listings: "You have the maximum number of listings.",
    already_asked: "You've already asked about this one.", offer_one_of_your_listings: "Choose one of your own listings to offer.", swap_not_offered: "The seller isn't open to swaps.",
    not_found: "That's no longer available.", invalid_price: "Enter a price between £0 and £5,000.", too_many_requests: "Too many requests today. Try again tomorrow." };

  // A conversation between a seller and the member whose request they accepted.
  var chatErrors = { no_contact_details: "Please keep emails, phone numbers and links out of messages for now.", too_many_messages: "That's a lot of messages. Try again in a bit.",
    thread_full: "This conversation has reached its limit.", conversation_closed: "This conversation has ended.", empty_message: "Write a message first." };
  function chatView(sheet, requestId, onBack) {
    var log = el("div", { style: "margin:10px 0;max-height:42vh;overflow:auto" }), msg = el("div", { className: "rl-msg" });
    var head = el("h2", { text: "Messages" }), sub = el("p", { text: "" });
    var input = el("input", { placeholder: "Write a message", maxLength: 500 });
    var send = el("button", { className: "rl-btn", text: "Send" });
    var tools = el("div");
    // How to do the deal safely. Relay doesn't take payments yet, so this is what keeps both sides safe.
    var tips = el("details", { style: "background:#f7f5ef;border-radius:14px;padding:10px 14px;margin:6px 0;font-size:14px;color:#344054" }, [
      el("summary", { text: "Doing the deal safely", style: "font-weight:800;cursor:pointer" }),
      el("p", { text: "Collecting: meet somewhere public in daylight, check the item, then pay on the spot (cash, or a bank transfer you can see arrive).", style: "margin:8px 0 4px" }),
      el("p", { text: "Posting: Relay doesn't handle payments yet, so never pay a stranger in advance by bank transfer. Collection is the safe option for now.", style: "margin:4px 0" }),
      el("p", { text: "Keep chatting here. Relay hides phone numbers and emails to protect you both.", style: "margin:4px 0 0" })]);
    [head, sub, tips, log, input, send, msg, tools, el("button", { className: "rl-btn ghost", text: "Back", onclick: function () { stop(); onBack(); } })].forEach(function (n) { sheet.appendChild(n); });
    var timer = null, isOpen = false;
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function load() {
      if (!document.body.contains(sheet)) return stop();
      api("/relay/my/resale/requests/" + requestId + "/messages").then(function (r) {
        if (!r.ok) return say(msg, "Couldn't load this conversation.", true);
        var b = r.body; isOpen = b.open;
        head.textContent = b.title; sub.textContent = "Chatting with the " + b.with.toLowerCase() + ". Names and contact details stay private. Payment and postage aren't built yet.";
        log.textContent = "";
        if (!b.messages.length) log.appendChild(el("p", { text: "No messages yet. Say hello and agree how this will work." }));
        b.messages.forEach(function (m) {
          log.appendChild(el("div", { text: m.body, style: "margin:6px 0;padding:8px 12px;border-radius:14px;max-width:85%;font-size:15px;" +
            (m.mine ? "margin-left:auto;background:#c7f567;color:#0f1b33" : "background:#f1ecdf;color:#0f1b33") }));
        });
        log.scrollTop = log.scrollHeight;
        input.style.display = send.style.display = isOpen ? "" : "none";
        if (!isOpen) say(msg, "This conversation has ended.");
        tools.textContent = "";
        if (isOpen) {
          tools.appendChild(el("button", { className: "rl-btn ghost", text: "End conversation", style: "padding:9px 14px;font-size:14px", onclick: function () {
            ask("End this conversation? The item goes back on sale.", "End conversation", function () {
              api("/relay/my/resale/requests/" + requestId + "/end", { method: "POST", body: {} }).then(load); }); } }));
          tools.appendChild(el("button", { className: "rl-btn ghost", text: "Report a problem", style: "padding:9px 14px;font-size:14px", onclick: function () {
            askText("What went wrong? (for example: asked me to pay outside Relay). Reporting lets the Relay team read this conversation to review it. They won't see who either of you is.", "Send report", function (why) {
              api("/relay/my/resale/requests/" + requestId + "/report", { method: "POST", body: { reason: why } }).then(function (x) { if (x.ok) { say(msg, "Reported and ended. Thank you."); load(); } else say(msg, "Couldn't send the report. Try again.", true); }); }); } }));
        }
      });
    }
    send.onclick = function () {
      var t = input.value.trim(); if (!t) return;
      send.disabled = true;
      api("/relay/my/resale/requests/" + requestId + "/messages", { method: "POST", body: { body: t } }).then(function (r) {
        send.disabled = false;
        if (r.ok) { input.value = ""; say(msg, ""); load(); } else say(msg, chatErrors[r.body && r.body.error] || "Couldn't send. Try again.", true);
      });
    };
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") send.onclick(); });
    load(); timer = setInterval(load, 8000);
  }
  function resaleView(sheet, onBack, focusReceipt, startTab) {
    var body = el("div"), msg = el("div", { className: "rl-msg" });
    var tabs = el("div", { style: "display:flex;gap:6px;margin:10px 0" });
    var cur = startTab || (focusReceipt ? "sell" : "browse");
    function openChat(id) { sheet.textContent = ""; chatView(sheet, id, function () { sheet.textContent = ""; resaleView(sheet, onBack, null, "mine"); }); }
    [["browse", "Browse"], ["mine", "Mine"], ["sell", "Sell"]].forEach(function (t) {
      var b = el("button", { className: "rl-btn ghost", text: t[1], style: "margin:0;padding:9px 6px;font-size:14px", onclick: function () { cur = t[0]; focusReceipt = null; draw(); } });
      b.setAttribute("data-tab", t[0]); tabs.appendChild(b);
    });
    // On the Market page (no onBack) the page supplies its own heading and there is nothing to go back to.
    [onBack ? el("h2", { text: "Swap & resell" }) : null,
     onBack ? el("p", { text: "Passed your return window? Sell or swap with other Relay members. Relay puts you in touch, and you agree payment and postage between you." }) : null,
     tabs, body, msg,
     onBack ? el("button", { className: "rl-btn ghost", text: "Back", onclick: onBack }) : null].forEach(function (n) { if (n) sheet.appendChild(n); });
    function tell(t, bad) { say(msg, t, bad); }
    function fail(r) { tell(resaleErrors[r.body && r.body.error] || "Something went wrong. Please try again.", true); }
    function photo(card, id, has) {
      if (!has) return;
      var ph = el("img", { alt: "", style: "float:right;width:72px;height:72px;object-fit:cover;border-radius:12px;margin:0 0 8px 10px;background:#f1ecdf" });
      card.insertBefore(ph, card.firstChild);
      apiBlob("/relay/my/resale/listings/" + id + "/image").then(function (u) { if (u) ph.src = u; else ph.remove(); });
    }
    function facts(l) {
      return [l.store, l.size ? "Size " + l.size : null, CONDITION[l.condition] || null,
        l.askPence == null ? "Price: open to offers" : l.askPence === 0 ? "Free" : money(l.askPence, l.currency), l.swapOk ? "Open to swaps" : null,
        l.handover === "collect" ? "Collection in " + l.area : l.handover === "either" ? "Collect in " + l.area + " or post" : l.handover === "post" ? "Posted" : null].filter(Boolean).join(" · ");
    }
    function draw() {
      Array.prototype.forEach.call(tabs.children, function (b) { b.style.background = b.getAttribute("data-tab") === cur ? "#c7f567" : "transparent"; });
      body.textContent = ""; tell("");
      if (cur === "browse") return drawBrowse();
      if (cur === "mine") return drawMine();
      drawSell();
    }
    function drawBrowse() {
      body.appendChild(el("p", { text: "Loading…" }));
      Promise.all([api("/relay/my/resale/feed"), api("/relay/my/resale/mine")]).then(function (rs) {
        body.textContent = "";
        if (!rs[0].ok) return body.appendChild(el("p", { text: "Couldn't load listings." }));
        var mine = ((rs[1].body && rs[1].body.listings) || []).filter(function (l) { return l.status === "active"; });
        var rows = rs[0].body.listings || [];
        // Like a local marketplace: put things you could collect near you first. Only the postcode area is used.
        var near = ""; try { near = localStorage.getItem("relay-market-area") || ""; } catch (e) {}
        var nearBox = el("input", { placeholder: "Your postcode area, e.g. SW11", value: near, maxLength: 8, style: "flex:1;min-width:0;padding:10px 14px;border:1px solid #e7e1d2;border-radius:12px;font-size:15px;background:#fff" });
        nearBox.addEventListener("change", function () { try { localStorage.setItem("relay-market-area", nearBox.value.trim().toUpperCase().split(" ")[0]); } catch (e) {} drawBrowse(); });
        if (rows.length) body.appendChild(el("div", { style: "display:flex;gap:8px;align-items:center;margin:12px 0" }, [el("span", { text: "📍", ariaHidden: "true" }), nearBox]));
        var mineArea = near.toUpperCase().split(" ")[0], letters = mineArea.replace(/[0-9].*$/, "");
        var score = function (l) { if (!mineArea || !l.area || l.handover === "post") return 0; return l.area === mineArea ? 2 : l.area.replace(/[0-9].*$/, "") === letters ? 1 : 0; };
        rows = rows.slice().sort(function (a, b) { return score(b) - score(a); });
        if (!rows.length) body.appendChild(el("div", { className: "rl-empty", style: "margin-top:14px" }, [el("h3", { text: "Nothing listed yet" }), el("p", { text: "When other Relay members list something they no longer need, it shows up here. Got something past its return window? List it from the Sell tab." })]));
        rows.forEach(function (l) {
          var card = el("div", { className: "rl-order" }, [el("b", { text: l.title }), el("span", { text: facts(l) })]);
          if (score(l)) card.appendChild(el("span", { text: score(l) === 2 ? "📍 Near you" : "📍 In your area", style: "display:inline-block;margin-top:6px;background:#e3f4c8;color:#2f4a10;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:800" }));
          photo(card, l.id, l.hasImage);
          if (l.note) card.appendChild(el("span", { text: "“" + l.note + "”", style: "display:block;margin-top:4px" }));
          if (l.myRequest) {
            card.appendChild(el("span", { text: "You asked about this (" + l.myRequest.status + ")", style: "display:block;margin-top:6px;font-weight:600" }));
            if (l.myRequest.status === "accepted") card.appendChild(el("button", { className: "rl-btn", text: "Message the seller", style: "margin-top:8px;padding:10px 14px;font-size:14px", onclick: function () { openChat(l.myRequest.id); } }));
          } else {
            var add = function (label, kind, extra) {
              card.appendChild(el("button", { className: "rl-btn" + (kind === "buy" ? "" : " ghost"), text: label, style: "margin-top:8px;padding:10px 14px;font-size:14px", onclick: function () {
                var pick = card.querySelector("select");
                var b = { kind: kind };
                if (kind === "swap") { if (!pick) return tell("List something of your own first (Sell tab), then offer it in a swap.", true); b.offeredListingId = pick.value; }
                api("/relay/my/resale/listings/" + l.id + "/ask", { method: "POST", body: b }).then(function (r) { if (r.ok) { tell("Sent. The seller will see your request as “Member”, not your name."); drawBrowse(); } else fail(r); }); } }));
            };
            add("I'd like this", "buy");
            if (l.swapOk) {
              if (mine.length) {
                var sel = el("select", { style: "width:100%;margin-top:8px;padding:10px;border-radius:12px;border:1px solid #ddd6c6;font-size:14px" });
                mine.forEach(function (m) { sel.appendChild(el("option", { value: m.id, text: "Offer my " + m.title })); });
                card.appendChild(sel);
              }
              add("Offer a swap", "swap");
            }
          }
          body.appendChild(card);
        });
      });
    }
    function drawMine() {
      body.appendChild(el("p", { text: "Loading…" }));
      api("/relay/my/resale/mine").then(function (r) {
        body.textContent = "";
        if (!r.ok) return body.appendChild(el("p", { text: "Couldn't load your listings." }));
        var ls = r.body.listings || [];
        if (!ls.length) body.appendChild(el("p", { text: "You haven't listed anything yet. Use the Sell tab." }));
        ls.forEach(function (l) {
          var card = el("div", { className: "rl-order" }, [el("b", { text: l.title + (l.status === "matched" ? " · matched" : "") }), el("span", { text: facts(l) })]);
          photo(card, l.id, l.hasImage);
          (l.requests || []).forEach(function (q) {
            var row = el("div", { style: "margin-top:8px;padding:8px 10px;border-radius:10px;background:rgba(127,127,127,.12);font-size:14px" });
            row.appendChild(el("b", { text: q.who + (q.kind === "swap" ? " offers a swap" : " would like to buy"), style: "display:block" }));
            if (q.offered) row.appendChild(el("span", { text: "Offering: " + q.offered.title + (q.offered.size ? " (size " + q.offered.size + ")" : ""), style: "display:block" }));
            if (q.message) row.appendChild(el("span", { text: "“" + q.message + "”", style: "display:block" }));
            if (q.status === "pending" && l.status === "active") {
              [["Accept", "accept", "rl-btn"], ["Decline", "decline", "rl-btn ghost"]].forEach(function (a) {
                row.appendChild(el("button", { className: a[2], text: a[0], style: "margin-top:6px;padding:8px 12px;font-size:14px", onclick: function () {
                  api("/relay/my/resale/requests/" + q.id + "/" + a[1], { method: "POST" }).then(function (x) { if (x.ok) drawMine(); else fail(x); }); } }));
              });
            } else {
              row.appendChild(el("span", { text: q.status === "accepted" ? "Accepted. Payment and postage aren't built yet, so agree the handover by message." : q.status, style: "display:block;margin-top:4px;opacity:.75" }));
              if (q.status === "accepted") row.appendChild(el("button", { className: "rl-btn", text: "Open messages", style: "margin-top:6px;padding:8px 12px;font-size:14px", onclick: function () { openChat(q.id); } }));
            }
            card.appendChild(row);
          });
          card.appendChild(el("button", { className: "rl-btn ghost", text: "Take this down", style: "margin-top:8px;padding:8px 12px;font-size:14px", onclick: function () {
            api("/relay/my/resale/listings/" + l.id + "/withdraw", { method: "POST" }).then(drawMine); } }));
          body.appendChild(card);
        });
        var mr = r.body.myRequests || [];
        if (mr.length) {
          body.appendChild(el("h2", { text: "Your requests", style: "font-size:18px;margin-top:14px" }));
          mr.forEach(function (q) {
            var c = el("div", { className: "rl-order" }, [el("b", { text: q.title }), el("span", { text: (q.kind === "swap" ? "Swap offered" : "You'd like to buy") + " · " + q.status })]);
            if (q.status === "accepted") c.appendChild(el("button", { className: "rl-btn", text: "Message the seller", style: "margin-top:8px;padding:10px 14px;font-size:14px", onclick: function () { openChat(q.id); } }));
            body.appendChild(c); });
        }
      });
    }
    function drawSell() {
      body.appendChild(el("p", { text: "Loading your items…" }));
      api("/relay/my/resale/items").then(function (r) {
        body.textContent = "";
        if (!r.ok) return body.appendChild(el("p", { text: "Couldn't load your items." }));
        var items = (r.body.items || []).filter(function (i) { return !i.alreadyListed && (!focusReceipt || i.receiptId === focusReceipt); });
        if (!items.length) body.appendChild(el("p", { text: focusReceipt ? "That item is already listed." : "Nothing to list yet. Items come from the receipts Relay found in your email." }));
        items.forEach(function (i) { body.appendChild(sellCard(i)); });
        if (focusReceipt) body.appendChild(el("button", { className: "rl-btn ghost", text: "Show all my items", onclick: function () { focusReceipt = null; draw(); } }));
      });
    }
    function sellCard(i) {
      var card = el("div", { className: "rl-order" }, [el("b", { text: i.title }), el("span", { text: [i.store, i.pricePence != null ? "Paid " + money(i.pricePence, i.currency) : null, i.orderDate].filter(Boolean).join(" · ") })]);
      if (i.returnWindowOpen === true) card.appendChild(el("span", { text: "Heads up: you can still return this to the store for a refund until " + i.returnDeadline + ".", style: "display:block;margin-top:4px;color:#77520a" }));
      card.appendChild(el("button", { className: "rl-btn", text: "List this", style: "margin-top:8px;padding:10px 14px;font-size:14px", onclick: function () {
        card.querySelector("button").remove();
        var cond = el("select", { style: "width:100%;margin:8px 0;padding:10px;border-radius:12px;border:1px solid #ddd6c6;font-size:15px" });
        Object.keys(CONDITION).forEach(function (k) { cond.appendChild(el("option", { value: k, text: CONDITION[k] })); });
        cond.value = "like_new";
        var size = el("input", { placeholder: "Size (optional)", maxLength: 20 });
        var price = el("input", { placeholder: "Asking price in £ (leave empty for open to offers)", inputMode: "decimal" });
        var note = el("input", { placeholder: "Note for buyers (optional, no contact details)", maxLength: 200 });
        var swap = el("input", { type: "checkbox", style: "width:auto;margin:0 8px 0 0" });
        var hand = el("select", { style: "width:100%;margin:8px 0;padding:10px;border-radius:12px;border:1px solid #ddd6c6;font-size:15px" });
        [["either", "Collection or post"], ["collect", "Collection only"], ["post", "Post only"]].forEach(function (o) { hand.appendChild(el("option", { value: o[0], text: o[1] })); });
        var savedArea = ""; try { savedArea = localStorage.getItem("relay-market-area") || ""; } catch (e) {}
        var area = el("input", { placeholder: "Postcode area for collection, e.g. SW11", maxLength: 8, value: savedArea });
        var areaNote = el("span", { text: "Only the first part of your postcode is shown, never your address.", style: "display:block;font-size:12px;color:#667085;margin:-4px 0 6px" });
        hand.onchange = function () { var c = hand.value !== "post"; area.style.display = areaNote.style.display = c ? "" : "none"; };
        var agree = el("input", { type: "checkbox", style: "width:auto;margin:0 8px 0 0" });
        var go = el("button", { className: "rl-btn", text: "Put it on Relay", style: "margin-top:10px", onclick: function () {
          var p = price.value.trim(), pence = null;
          if (p) { var n = Number(p.replace(/[£,\s]/g, "")); if (!isFinite(n) || n < 0 || n > 5000) return tell(resaleErrors.invalid_price, true); pence = Math.round(n * 100); }
          go.disabled = true;
          api("/relay/my/resale/listings", { method: "POST", body: { receiptId: i.receiptId, itemIndex: i.itemIndex, condition: cond.value, size: size.value, askPence: pence, swapOk: swap.checked, note: note.value, agree: agree.checked, handover: hand.value, area: hand.value === "post" ? null : area.value.trim() || null } })
            .then(function (r) { go.disabled = false; if (r.ok) { cur = "mine"; focusReceipt = null; draw(); tell("Listed. Other members can now see it."); } else fail(r); });
        } });
        [cond, size, price, note, hand, area, areaNote,
         el("label", { style: "display:block;font-size:14px;margin:4px 0" }, [swap, document.createTextNode("I'm open to swaps")]),
         el("label", { style: "display:block;font-size:13px;margin:8px 0;color:#5b6475" }, [agree, document.createTextNode("I agree Relay shows this item's name, store, size, condition, price, note and photo to other Relay members. My name, email, order number and address are never shown.")]),
         go].forEach(function (n) { card.appendChild(n); });
      } }));
      return card;
    }
    draw();
  }
  // ---- The Account page. Laid out like a phone's Settings: a few short groups, each row opening a page of its own,
  // and Back returns here. Detail that used to crowd one long sheet now sits one tap away. ----
  var ACC_IC = {
    mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m3.8 7 8.2 6 8.2-6"/>',
    paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9.5 4V3h5v1M9.5 10h5M9.5 14h5"/>',
    bag: '<path d="M5 8h14l-1.2 12.5H6.2Z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    face: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9.5v1M15 9.5v1M12 9.5V13h-1M9.5 16c1.5 1.2 3.5 1.2 5 0"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    card: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/>',
    shield: '<path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6Z"/><path d="m9 12 2 2 4-4"/>',
    trash: '<path d="M4.5 7h15M10 7V5h4v2M6.5 7l1 13h9l1-13"/>',
    doc: '<path d="M7 3.5h7l4 4v13H7Z"/><path d="M14 3.5v4h4M10 12h5M10 16h5"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2-2.4 3.5M12 17h.01"/>',
    swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    out: '<path d="M14 4.5h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>',
    chev: '<path d="m9 6 6 6-6 6"/>', back: '<path d="m15 6-6 6 6 6"/>',
    ext: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10"/>'
  };
  function accIc(n, px, cls) {
    var s = el("span", { className: cls || "rl-ai" }); s.setAttribute("aria-hidden", "true");
    s.innerHTML = '<svg viewBox="0 0 24 24" width="' + (px || 20) + '" height="' + (px || 20) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ACC_IC[n] + "</svg>";
    return s;
  }
  // One row: icon, label, an optional line underneath, and a chevron (or an arrow for pages that open outside the app).
  function accRow(icon, label, detail, onclick, opts) {
    opts = opts || {};
    var sub = el("span", { className: "rl-arow-d", text: detail || "" });
    if (!detail) sub.style.display = "none";
    var tag = opts.href ? "a" : "button";
    var props = { className: "rl-arow" + (opts.danger ? " danger" : "") };
    if (opts.href) { props.href = opts.href; } else { props.type = "button"; props.onclick = onclick; }
    var row = el(tag, props, [accIc(icon), el("span", { className: "rl-arow-t" }, [el("b", { text: label }), sub]), accIc(opts.href ? "ext" : "chev", 18, "rl-arow-c")]);
    row.setDetail = function (t) { sub.textContent = t || ""; sub.style.display = t ? "" : "none"; };
    return row;
  }
  function accGroup(title, rows) {
    var card = el("div", { className: "rl-acard" }, rows);
    return el("section", { className: "rl-agroup" }, (title ? [el("h3", { text: title })] : []).concat([card]));
  }
  // The bar across the top: Back on the left (on inner pages), the page name, and Done on the right.
  function accBar(sheet, title, onBack) {
    var bar = el("div", { className: "rl-abar" }, [
      onBack ? el("button", { type: "button", className: "rl-abtn", ariaLabel: "Back to Account", onclick: onBack }, [accIc("back", 20, "rl-ab-i"), el("span", { text: "Account" })]) : el("span"),
      el("b", { className: "rl-abar-t", text: onBack ? title : "" }),
      el("button", { type: "button", className: "rl-abtn done", text: "Done", onclick: close })]);
    sheet.appendChild(bar);
    if (!onBack) sheet.appendChild(el("h2", { className: "rl-atitle", text: title }));
  }
  var HELP = [
    ["How does Relay find my receipts?", "With your permission, Relay reads your Gmail or Outlook in read-only mode and picks out order confirmations, receipts and return emails. It keeps the details it needs (store, items, total, return deadline) and a link back to the original email, not the email itself."],
    ["A receipt is missing. What can I do?", "Open Account, then Email connection, and choose Find a missing receipt to search your inbox for that store. You can also paste a receipt in, or run a full re-scan."],
    ["Can Relay refund me automatically?", "No. Relay finds your purchases and return deadlines from your email, so it can remind you and show you how to return something, but the refund itself always comes from the shop."],
    ["Will Relay ever email from my account?", "Never. Relay can't send, delete or change anything in your inbox. The only emails it sends are sign-in emails and, if you ask for one, a single return reminder to your sign-in address."],
    ["How do I stop Relay reading my email?", "Open Account, then Email connection, and choose Disconnect. Relay deletes every receipt it captured from that inbox. You can also withdraw your permission under Privacy & data."],
    ["How do I delete my account?", "Open Account, then Delete my account under Privacy & data. Your sign-in and everything linked to it are deleted, and it can't be undone."]
  ];
  var CONSENT_FALLBACK = ["Relay reads your email in read-only mode and looks only for order confirmations, receipts and return emails.", "It never sends email from your account, never deletes or changes anything in your inbox, and never sells or shares what it finds."];
  function signedInView(sheet, email, notice, c) {
    sheet.textContent = "";
    sheet.classList.add("rl-full");
    sheet.setAttribute("aria-label", "Account");
    try { sheet.scrollTop = 0; } catch (e) {}
    var msg = el("div", { className: "rl-msg" });
    function home() { signedInView(sheet, email, null, c); }
    // An inner page with the top bar. Each section keeps its own heading out of the way: the bar already names it.
    function page(title, build) {
      sheet.textContent = ""; try { sheet.scrollTop = 0; } catch (e) {}
      accBar(sheet, title, home);
      var body = el("div", { className: "rl-asub" }); sheet.appendChild(body);
      build(body);
    }
    // Screens that bring their own heading and Back button.
    function screen(view) { sheet.textContent = ""; try { sheet.scrollTop = 0; } catch (e) {} view(sheet); }
    openFind = function () { screen(function (sh) { findView(sh, home); }); };
    openOriginal = function (id) { screen(function (sh) { originalView(sh, id, home); }); };
    openResale = function (rid) { screen(function (sh) { resaleView(sh, home, rid); }); };
    function editHere() { screen(function (sh) { profileView(sh, home); }); }

    accBar(sheet, "Account");
    var head = el("button", { type: "button", className: "rl-ahead", ariaLabel: "Edit your name and photo", onclick: editHere });
    function drawHead() {
      if (!document.body.contains(head)) return false;
      var p = profileNow() || { email: email };
      head.textContent = "";
      head.appendChild(face(p, 60));
      head.appendChild(el("span", { className: "rl-ahead-t" }, [el("b", { text: p.name || "Add your name" }), el("span", { text: email }), el("em", { text: p.name || p.photo ? "Edit profile" : "Add your name and photo" })]));
      head.appendChild(accIc("chev", 18, "rl-arow-c"));
    }
    sheet.appendChild(head); sheet.appendChild(msg);
    drawHead(); profileWatchers.push(drawHead); loadProfile();
    if (notice) say(msg, notice.text, notice.bad);

    // Receipts
    var mailRow = accRow("mail", "Email connection", "Checking…", function () { page("Email connection", mailPage); });
    var receiptRows = [mailRow, accRow("paste", "Add a receipt by pasting it", "", function () { screen(function (sh) { receiptView(sh, home); }); })];
    var ordersRow = accRow("bag", "Shop orders", "", function () { page("Shop orders", ordersPage); }); ordersRow.style.display = "none";
    receiptRows.push(ordersRow);
    if (marketOn()) receiptRows.push(accRow("swap", "Swap & resell", "", function () { openResale(); }));
    sheet.appendChild(accGroup("Receipts", receiptRows));
    var mailState = null;
    api("/relay/my/gmail").then(function (g) {
      if (g.ok) rememberMailbox(g.body);
      mailState = g.ok && g.body ? g.body : null;
      mailRow.setDetail(!mailState ? "" : mailState.connected ? mailName() + " · connected" : "Not connected yet");
    }).catch(function () { mailRow.setDetail(""); });
    var orders = [];
    api("/relay/my/purchases").then(function (r) {
      if (r.status === 401) { save(null); close(); return; }
      orders = (r.ok && r.body && r.body.purchases) || [];
      if (orders.length) { ordersRow.style.display = ""; ordersRow.setDetail(orders.length + " confirmed by the shop"); }
    }).catch(function () {});

    // Alerts (only where the app's pages are here to open)
    if (window.go) {
      var alertRow = accRow("bell", "Price alerts", "", function () { close(); window.go("radar"); });
      sheet.appendChild(accGroup("Alerts", [alertRow]));
      alertStatus().then(function (st) {
        var n = st && st.watches ? st.watches.length : 0;
        alertRow.setDetail(n ? "Watching " + n + " product" + (n === 1 ? "" : "s") : "Get told when prices drop");
      });
    }

    // Sign-in & security
    var secRows = [];
    if (passkeysSupported()) secRows.push(accRow("face", "Face ID & passkeys", "Sign in without an email", function () { page("Face ID & passkeys", function (b) { passkeySection(b, el("div")); }); }));
    var twoRow = accRow("lock", "Two-step sign-in", "", function () { page("Two-step sign-in", function (b) { twoStepSection(b); }); });
    secRows.push(twoRow);
    var cardRow = accRow("card", "Card for swaps", "", function () { page("Card for swaps", function (b) { var cb = el("div"); b.appendChild(cb); cardSection(cb); }); });
    cardRow.style.display = "none"; secRows.push(cardRow);
    sheet.appendChild(accGroup("Sign-in & security", secRows));
    api("/relay/my/2fa").then(function (r) { if (r.ok && r.body) twoRow.setDetail(r.body.enabled ? "On" : "Off"); }).catch(function () {});
    api("/relay/my/card").then(function (r) {
      if (!r.ok || !r.body || !r.body.enabled) return;
      if (r.body.testMode !== false && !testingOn() && !r.body.card) return;
      cardRow.style.display = ""; cardRow.setDetail(r.body.card ? cardText(r.body.card) : "None saved");
    }).catch(function () {});

    // Privacy & data
    sheet.appendChild(accGroup("Privacy & data", [
      accRow("shield", "Email permission", "What Relay reads and keeps", function () { page("Email permission", permissionPage); }),
      accRow("trash", "Delete my account", "", function () { page("Delete my account", deletePage); }, { danger: true })]));

    // Help & legal
    sheet.appendChild(accGroup("Help & legal", [
      accRow("help", "Help", "Common questions", function () { page("Help", helpPage); }),
      accRow("doc", "Terms of use", "", null, { href: "./terms.html" }),
      accRow("doc", "Privacy policy", "", null, { href: "./privacy.html" })]));

    // Reviewing member reports: only for the people who do that.
    var abox = el("div"); sheet.appendChild(abox);
    api("/relay/my/admin/me").then(function (r) {
      if (!r.ok || !r.body || r.body.admin !== true) return;
      abox.appendChild(accGroup("Team", [accRow("flag", "Review reports", (r.body.openReports || 0) + " open", function () { screen(function (sh) { adminView(sh, home); }); })]));
    }).catch(function () {});

    var outBtn = el("button", { type: "button", className: "rl-aout", text: "Sign out" });
    outBtn.onclick = function () { outBtn.disabled = true; api("/relay/auth/logout", { method: "POST" }).finally(function () { save(null); close(); }); };
    sheet.appendChild(outBtn);
    sheet.appendChild(el("p", { className: "rl-afoot", text: "Signed in as " + email }));

    function mailPage(b) {
      if (!window.go) return gmailSection(b, c || {}, msg);
      var note = el("div", { className: "rl-msg" });
      var on = mailState && mailState.connected;
      b.appendChild(el("p", { text: on ? "Relay is reading your " + mailName() + " in read-only mode and sorting your receipts for you." : "Connect the email you shop with, Gmail or Outlook, and Relay brings your receipts in for you." }));
      b.appendChild(el("button", { className: "rl-btn", text: on ? "Open my receipts" : "Connect your email", onclick: function () { close(); window.go("receipts"); } }));
      if (on) {
        b.appendChild(el("button", { className: "rl-btn ghost", text: "Find a missing receipt", onclick: function () { openFind(); } }));
        b.appendChild(el("button", { className: "rl-btn ghost", text: "Re-scan all my email", onclick: function () { window.__relayAutoFull = true; close(); window.go("receipts"); } }));
        b.appendChild(el("p", { className: "rl-anote", text: "A full re-scan looks through every email again. It can take a few minutes." }));
        b.appendChild(el("button", { className: "rl-btn ghost rl-red", text: "Disconnect " + mailName(), onclick: function () { disconnectGmail(home, note); } }));
        b.appendChild(el("p", { className: "rl-anote", text: "Disconnecting deletes every receipt Relay captured from this inbox." }));
      }
      b.appendChild(note);
    }
    function ordersPage(b) {
      b.appendChild(el("p", { text: "Orders the shop itself confirmed to Relay." }));
      orders.forEach(function (o) {
        var names = o.items.map(function (i) { return i.quantity + " × " + i.title; }).join(", ");
        b.appendChild(el("div", { className: "rl-order" }, [el("b", { text: names || "Order" }),
          el("span", { text: (o.store ? o.store + " · " : "") + money(o.amountMinor, o.currency) + " · " + new Date(o.orderedAt).toLocaleDateString("en-GB") })]));
      });
    }
    function permissionPage(b) {
      var note = el("div", { className: "rl-msg" });
      b.appendChild(el("p", { text: "This is what you agreed to when you connected your email." }));
      ((c && c.text) || CONSENT_FALLBACK).forEach(function (t) { b.appendChild(el("p", { className: "rl-aterm", text: t })); });
      var w = el("button", { className: "rl-btn ghost rl-red", text: "Withdraw my permission" });
      w.onclick = function () {
        ask("Withdraw permission? Relay will disconnect your email and delete everything it captured. You'll be asked again next time you open your account.", "Withdraw permission", function () {
          w.disabled = true;
          api("/relay/my/consent/withdraw", { method: "POST" }).then(function (x) { if (x.ok) { memoReset(); gate(sheet, email); } else { w.disabled = false; say(note, "Couldn't withdraw. Try again.", true); } })
            .catch(function () { w.disabled = false; say(note, "Couldn't reach Relay. Check your connection.", true); });
        });
      };
      b.appendChild(w); b.appendChild(note);
    }
    function deletePage(b) {
      var note = el("div", { className: "rl-msg" });
      b.appendChild(el("p", { text: "This removes your sign-in, your email connection, every receipt Relay captured, your profile, price alerts, passkeys, two-step sign-in and any saved card. If you connected Gmail, Relay also cancels its access at Google." }));
      b.appendChild(el("p", { text: "Records of returns and swaps you made through Relay are kept, because the shops involved rely on them. Deleting can't be undone." }));
      var d = el("button", { className: "rl-btn rl-danger", text: "Delete my account" });
      d.onclick = function () {
        ask("Delete your Relay account and everything linked to it? This can't be undone.", "Delete my account", function () {
          d.disabled = true;
          api("/relay/my/delete", { method: "POST" }).then(function (r) { if (r.ok) { memoReset(); save(null); close(); } else { d.disabled = false; say(note, "Couldn't delete your account. Try again.", true); } })
            .catch(function () { d.disabled = false; say(note, "Couldn't reach Relay. Check your connection.", true); });
        });
      };
      b.appendChild(d); b.appendChild(note);
    }
    function helpPage(b) {
      HELP.forEach(function (q) {
        b.appendChild(el("details", { className: "rl-faq" }, [el("summary", { text: q[0] }), el("p", { text: q[1] })]));
      });
      b.appendChild(el("p", { className: "rl-anote", text: "Read the full terms and privacy policy under Help & legal." }));
    }
  }
  function show() {
    var s = load();
    if (!s || !s.token) return open(signedOutView);
    open(function (sheet) { gate(sheet, s.email || ""); });
  }
  function bind() {
    var a = document.querySelector(".avatar");
    if (!a) return;
    a.style.cursor = "pointer"; a.setAttribute("role", "button"); a.setAttribute("tabindex", "0");
    a.setAttribute("aria-label", "Account");
    a.addEventListener("click", show);
    a.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(); } });
    paintAvatars(); loadProfile();
  }
  function completeLinkSignIn() {
    var m = /(?:^|[#&])signin=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash || "");
    if (!m) return;
    signInExtra = {};
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    open(function (sheet) {
      sheet.classList.add("rl-full", "rl-jr");
      jFrame(sheet, { noClose: true, title: "Signing you in…", sub: "Just a moment." });
      sheet.appendChild(el("div", { className: "rl-skel", style: "min-height:160px;border-radius:18px" }));
    });
    var gn = ""; try { gn = localStorage.getItem("relay_gnonce") || ""; localStorage.removeItem("relay_gnonce"); } catch (e) {}
    api("/relay/auth/verify", { method: "POST", body: gn ? { token: m[1], nonce: gn } : { token: m[1] } }).then(function (r) {
      if (!r.ok) return open(function (sheet) { sheet.appendChild(el("h2", { text: "Sign-in failed" }));
        sheet.appendChild(el("p", { text: errors[r.body.error] || "Something went wrong." }));
        sheet.appendChild(el("button", { className: "rl-btn", text: "Try again", onclick: show })); });
      // Signed in (and, through Google or Microsoft, the inbox connected and its first scan started): on to what's still needed.
      if (r.body.needsSecondStep) { signInExtra = { mailConnected: r.body.mailConnected, outlookConnected: r.body.outlookConnected, suggestedName: r.body.suggestedName }; return open(function (sheet) { secondStepView(sheet, r.body.pendingToken); }); }
      signedIn(r.body);
    }).catch(function () { open(function (sheet) { sheet.appendChild(el("h2", { text: "Couldn't reach Relay" })); sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Close", onclick: close })); }); });
  }
  // What to say when Google or Microsoft sends the shopper back after "Connect Gmail" / "Connect Outlook".
  function mailNote(result, name) {
    var notes = { connected: [name + " connected. Scanning for receipts…", false], denied: ["You chose not to connect " + name + ". Relay needs a way to see your receipts, so you can try again or paste one.", true],
      failed: ["Couldn't connect " + name + ". Please try again.", true], consent_needed: ["Please agree to the permission step first, then connect " + name + ".", true], not_configured: [name + " connection isn't switched on yet.", true] };
    return { text: notes[result][0], bad: notes[result][1] };
  }
  function completeGmail() {
    var m = /(?:^|[#&])(gmail|outlook)=(connected|denied|failed|consent_needed|not_configured)(?:&|$)/.exec(location.hash || "");
    if (!m) return;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    var s = load(); if (!s || !s.token) return open(signedOutView);
    memo.gmail = null; memo.receipts = null;
    if (m[2] === "connected") rememberMailbox({ connected: true, provider: m[1] === "outlook" ? "microsoft" : "google" });
    var note = mailNote(m[2], m[1] === "outlook" ? "Outlook" : "Gmail");
    if (obGet(s.email).back) { obSet(s.email, { back: null }); return startJourney(m[2] === "connected" ? { justConnected: true } : { mailNote: note }); }
    window.__relayAutoScan = m[2] === "connected";
    if (window.go) { window.__relayReceiptsNote = note; window.go("receipts"); return; }
    open(function (sheet) { gate(sheet, s.email || "", note); });
  }
  function completeGoogleNote() {
    var m = /(?:^|[#&])(gsignin|msignin)=(denied|failed|other_address)(?:&|$)/.exec(location.hash || "");
    if (!m) return;
    try { history.replaceState(null, "", location.pathname + location.search); localStorage.removeItem("relay_gnonce"); } catch (e) {}
    var who = m[1] === "msignin" ? "Microsoft" : "Google";
    open(function (sheet) {
      sheet.appendChild(el("h2", { text: m[2] === "denied" ? who + " sign-in cancelled" : who + " sign-in didn't work" }));
      sheet.appendChild(el("p", { text: m[2] === "denied" ? "No problem. You can try again or use an email link instead."
        : m[2] === "other_address" ? "Microsoft sign-in works with Outlook, Hotmail and Live addresses. For any other address, use the email link or code instead."
        : "Please try again, or use an email link instead." }));
      sheet.appendChild(el("button", { className: "rl-btn", text: "Back to sign in", onclick: show }));
    });
  }
  // The Receipts page: the same Gmail/receipt tools as before, on a page of their own. Detail screens open over it and Back returns to it.
  function mountReceipts(host, notice) {
    host.textContent = "";
    var s = load();
    var msg = el("div", { className: "rl-msg" });
    if (!s || !s.token) {
      host.appendChild(el("p", { text: "Sign in to bring your receipts in from your email. Relay only reads order confirmations, receipts and return emails." }));
      host.appendChild(el("button", { className: "rl-btn", text: "Sign in", style: "max-width:260px", onclick: show }));
      return;
    }
    pageLaunchers = function () {
      openFind = function () { open(function (sh) { findView(sh, function () { close(); mountReceipts(host); }); }); };
      openOriginal = function (id) { open(function (sh) { originalView(sh, id, close); }); };
      openResale = function (rid) { open(function (sh) { resaleView(sh, close, rid); }); };
    };
    pageLaunchers();
    if (memo.receipts) { var sk0 = el("div", { className: "rl-cats" }); for (var k0 = 0; k0 < 4; k0++) sk0.appendChild(el("div", { className: "rl-po rl-skel", style: "min-height:150px;margin:0" })); host.appendChild(sk0); }
    else host.appendChild(el("div", { className: "rl-skel", style: "min-height:150px;border-radius:22px" }));
    cachedGet("consent", "/relay/my/consent").then(function (r) {
      host.textContent = "";
      if (r.status === 401) { save(null); mountReceipts(host); return; }
      if (!r.ok) { host.appendChild(el("p", { text: "Couldn't reach Relay." })); return; }
      if (!r.body.accepted) {
        host.appendChild(el("p", { text: r.body.acceptedEarlier ? "Relay's permission wording changed: it now works with Outlook as well as Gmail. Agree again to keep your receipts updating."
          : "Relay needs your OK before it looks at your receipts. It takes a moment." }));
        host.appendChild(el("button", { className: "rl-btn", text: "Review and agree", style: "max-width:260px", onclick: show }));
        return;
      }
      var box = el("div");
      host.appendChild(box); host.appendChild(msg);
      if (notice) say(msg, notice.text, notice.bad);
      gmailSection(box, r.body, msg, true);
    }).catch(function () { host.textContent = ""; host.appendChild(el("p", { text: "Couldn't reach Relay." })); });
  }
  // The Market page: swap and resell with other members, on a page of its own.
  function mountMarket(host) {
    host.textContent = "";
    var s = load();
    if (!s || !s.token) {
      host.appendChild(el("p", { text: "Sign in to see what other Relay members are swapping and selling, or to list something of your own." }));
      host.appendChild(el("button", { className: "rl-btn", text: "Sign in", style: "max-width:260px", onclick: show }));
      return;
    }
    host.appendChild(el("p", { text: "Loading…" }));
    cachedGet("consent", "/relay/my/consent").then(function (r) {
      host.textContent = "";
      if (r.status === 401) { save(null); mountMarket(host); return; }
      if (!r.ok) { host.appendChild(el("p", { text: "Couldn't reach Relay." })); return; }
      if (!r.body.accepted) {
        host.appendChild(el("p", { text: "Relay needs your OK before it can list anything from your receipts. It takes a moment." }));
        host.appendChild(el("button", { className: "rl-btn", text: "Review and agree", style: "max-width:260px", onclick: show }));
        return;
      }
      resaleView(host, null, null, "browse");
    }).catch(function () { host.textContent = ""; host.appendChild(el("p", { text: "Couldn't reach Relay." })); });
  }

  // ---- Wrapped: a year of purchases, built only from the shopper's own captured receipts ----
  function memoDrop(prefix) { Object.keys(memo).forEach(function (k) { if (k.indexOf(prefix) === 0) delete memo[k]; }); }
  // Words for a Wrapped about one kind of shopping, so every list and title stays about that one thing.
  var IND = {
    fashion: { chip: "Fashion", inn: "in fashion", go: "Your go-to for fashion", shops: "Your top fashion shops", things: "Your top 5 pieces", one: "Top piece", buys: "Your biggest fashion buys", treat: "Your biggest fashion buy" },
    food: { chip: "Food & drink", inn: "in food & drink", go: "Your go-to for food & drink", shops: "Your top food & drink spots", things: "What you ordered most", one: "Ordered most", buys: "Your biggest food & drink orders", treat: "Your biggest food & drink order" },
    electronics: { chip: "Electronics", inn: "in electronics", go: "Your go-to for tech", shops: "Your top tech shops", things: "Your top 5 gadgets", one: "Top gadget", buys: "Your biggest tech buys", treat: "Your biggest tech buy" },
    home: { chip: "Home", inn: "for your home", go: "Your go-to for the home", shops: "Your top home shops", things: "Your top 5 home buys", one: "Top home buy", buys: "Your biggest home buys", treat: "Your biggest home buy" },
    beauty: { chip: "Beauty", inn: "in beauty", go: "Your go-to for beauty", shops: "Your top beauty shops", things: "Your top 5 beauty picks", one: "Top pick", buys: "Your biggest beauty buys", treat: "Your biggest beauty buy" },
    travel: { chip: "Travel", inn: "in travel", go: "Your go-to for getting about", shops: "Your top travel companies", things: "Your top 5 journeys", one: "Top journey", buys: "Your biggest trips", treat: "Your biggest trip" },
    digital: { chip: "Digital", inn: "in apps & subscriptions", go: "Your top app or service", shops: "Your top apps & services", things: "Your top 5 apps & subscriptions", one: "Top app", buys: "Your biggest digital buys", treat: "Your biggest digital buy" }
  };
  function mountWrapped(host, year, industry) {
    host.textContent = "";
    if (!IND[industry]) industry = null;
    var words = industry ? IND[industry] : null;
    var s = load();
    if (!s || !s.token) {
      host.appendChild(el("div", { className: "rl-wr-cover" }, [
        el("div", { className: "rl-wr-kicker", text: "RELAY WRAPPED" }),
        el("h2", { text: "Your year in purchases, as a story." }),
        el("p", { text: "Sign in and connect your email, and Relay builds your Wrapped from your real receipts." }),
        el("button", { className: "rl-wr-play", text: "Sign in", onclick: show })]));
      return;
    }
    var thisYear = new Date().getFullYear();
    year = year || thisYear;
    var yrs = el("div", { className: "rl-wr-years" }), kinds = el("div", { className: "rl-wr-kinds", role: "group", ariaLabel: "Wrapped for one kind of shopping" });
    var kicker = "RELAY WRAPPED " + year + (words ? " · " + words.chip.toUpperCase() : "");
    var cover = el("div", { className: "rl-wr-cover" }, [el("div", { className: "rl-wr-kicker", text: kicker }), el("h2", { text: "Adding up your " + year + (words ? " " + words.inn : "") + "…" })]);
    var extra = el("div");
    host.appendChild(yrs); host.appendChild(kinds); host.appendChild(cover); host.appendChild(extra);
    // Building Wrapped is heavy work for the server, so one failed try is retried once before showing an error.
    var getW = function () { return cachedGet("wrapped" + year + (industry ? ":" + industry : ""), "/relay/my/wrapped?year=" + year + (industry ? "&industry=" + industry : "")); };
    getW().catch(function () { return { ok: false }; }).then(function (r) { return r.ok || r.status === 401 ? r : new Promise(function (ok) { setTimeout(ok, 1200); }).then(getW); }).then(function (r) {
      if (r.status === 401) { save(null); mountWrapped(host, year); return; }
      if (!r.ok) { cover.textContent = ""; cover.appendChild(el("p", { text: "Couldn't build Wrapped just now. Please try again." })); return; }
      var w = r.body;
      // Another year with none of this kind of shopping: show that year's whole Wrapped instead.
      if (industry && !w.receipts && (w.industries || []).length) { mountWrapped(host, year, null); return; }
      var list = (w.years || []).map(function (y) { return y.year; });
      if (list.indexOf(year) < 0) list.push(year);
      if (list.indexOf(thisYear) < 0) list.push(thisYear);
      list.sort(function (a, b) { return b - a; }).forEach(function (y) {
        yrs.appendChild(el("button", { type: "button", text: String(y), ariaPressed: y === year ? "true" : "false", className: y === year ? "on" : "", onclick: function () { mountWrapped(host, y, industry); } }));
      });
      // One Wrapped per kind of shopping the year has (biggest spend first). "Other" isn't a kind anyone wants a story about.
      var own = (w.industries || []).filter(function (k) { return IND[k.category] && k.receipts > 0; });
      if (own.length && (w.industries || []).length > 1) {
        [{ category: null }].concat(own).forEach(function (k) {
          var on = (k.category || null) === industry;
          kinds.appendChild(el("button", { type: "button", text: k.category ? IND[k.category].chip : "All", ariaPressed: on ? "true" : "false", className: on ? "on" : "",
            onclick: function () { if (!on) mountWrapped(host, year, k.category); } }));
        });
      } else kinds.remove();
      cover.textContent = "";
      cover.appendChild(el("div", { className: "rl-wr-kicker", text: kicker }));
      if (!w.receipts) {
        cover.appendChild(el("h2", { text: "Nothing to wrap for " + year + " yet." }));
        cover.appendChild(el("p", { text: year < thisYear ? "Relay hasn't read your " + year + " emails. Add earlier years below and Relay will look for that year's receipts." : "Connect your email on the Receipts tab and Relay will find your order emails." }));
      } else {
        cover.appendChild(el("h2", { text: "Your " + year + (words ? " " + words.inn : " in purchases") + "." }));
        cover.appendChild(el("p", { text: w.receipts + (w.receipts === 1 ? " receipt · " : " receipts · ") + w.shops + (w.shops === 1 ? " shop" : " shops") + (w.coverage.withTotal ? " · " + money(w.spentPence, "GBP") : "") }));
        var play = el("button", { className: "rl-wr-play", onclick: function () { playStory(w); } });
        play.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="vertical-align:-3px;margin-right:8px"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>';
        play.appendChild(document.createTextNode("Play your " + (words ? words.chip.toLowerCase() + " " : "") + "story"));
        cover.appendChild(play);
      }
      if (w.receipts) extra.appendChild(wrappedGlance(w));
      var hb = el("div"); extra.appendChild(hb);
      mountHistory(hb, w, function (firstYear) { Object.keys(memo).forEach(function (k) { if (/^wrapped/.test(k)) memoDrop(k); }); mountWrapped(host, firstYear || year, industry); });
    }).catch(function () { cover.textContent = ""; cover.appendChild(el("p", { text: "Couldn't reach Relay." })); });
  }
  // Opt-in: read past years of order emails so Wrapped works for them too. Same email permission, same rules: only receipts and order emails.
  function mountHistory(host, w, done) {
    host.textContent = "";
    var thisYear = new Date().getFullYear();
    var card = el("div", { className: "rl-wr-glance" });
    host.appendChild(card);
    card.appendChild(el("h3", { text: "Add earlier years" }));
    card.appendChild(el("p", { text: "Pick a year and Relay finds its order emails, so you can play that year's Wrapped too.", style: "color:#475467;font-size:14px;margin:0 0 12px;line-height:1.5" }));
    var chips = el("div", { className: "rl-wr-years" }), picked = {}, status = el("p", { className: "rl-wr-note", style: "font-size:13px" });
    var go = el("button", { className: "rl-po-primary", text: "Read these years", style: "max-width:260px", disabled: true });
    card.appendChild(chips); card.appendChild(go); card.appendChild(status);
    var have = {}; (w.years || []).forEach(function (y) { have[y.year] = y.receipts; });
    api("/relay/my/gmail/history").then(function (r) {
      var doneYears = {}; ((r.ok && r.body.years) || []).forEach(function (y) { doneYears[y.year] = true; });
      var earliest = (r.ok && r.body.earliest) || thisYear - 10;
      for (var y = thisYear - 1; y >= Math.max(earliest, thisYear - 8); y--) (function (y) {
        var b = el("button", { type: "button", text: doneYears[y] ? y + " ✓" : String(y), title: doneYears[y] ? "Already read" + (have[y] ? " · " + have[y] + " receipts" : "") : "", ariaPressed: "false",
          onclick: function () { picked[y] = !picked[y]; b.className = picked[y] ? "on" : ""; b.ariaPressed = picked[y] ? "true" : "false"; go.disabled = !Object.keys(picked).some(function (k) { return picked[k]; }); } });
        chips.appendChild(b);
      })(y);
    });
    go.onclick = function () {
      var years = Object.keys(picked).filter(function (k) { return picked[k]; }).map(Number).sort(function (a, b) { return b - a; });
      if (!years.length) return;
      go.disabled = true; Array.prototype.forEach.call(chips.children, function (b) { b.disabled = true; });
      var found = 0, errors = 0;
      function oneYear(k) {
        if (k >= years.length) { status.textContent = "Done. Relay found " + found + " receipts in " + years.join(", ") + "."; setTimeout(function () { done(years[0]); }, 900); return; }
        var y = years[k];
        function round(cursor) {
          status.textContent = "Reading " + y + (cursor ? " · back to " + cursor.replace(/^(\d{4})\/(\d{2})\/(\d{2})$/, "$3/$2") : "") + "… " + found + " receipts found so far. Keep this page open.";
          api("/relay/my/gmail/scan", { method: "POST", body: Object.assign({ year: y }, cursor ? { cursor: cursor } : {}) }).then(function (x) {
            if (!x.ok) {
              if (x.status === 401) { status.textContent = mailOwner() + " needs you to reconnect " + mailName() + " on the Receipts tab."; return; }
              if (++errors > 8) { status.textContent = mailName() + " is busy. Relay saved its place: press the button again in a few minutes to carry on."; go.disabled = false; return; }
              return setTimeout(function () { round(cursor); }, 4000 * Math.min(errors, 4));
            }
            errors = 0; found += (x.body.added || 0);
            if (x.body.more && x.body.cursor) setTimeout(function () { round(x.body.cursor); }, 800); else oneYear(k + 1);
          }, function () { if (++errors > 8) { status.textContent = "Couldn't reach Relay. Try again in a moment."; go.disabled = false; return; } setTimeout(function () { round(cursor); }, 4000); });
        }
        round("");
      }
      oneYear(0);
    };
  }
  // The same numbers as the story, on one card, for a quick look.
  function wrappedGlance(w) {
    var box = el("div", { className: "rl-wr-glance" });
    function stat(label, big, small) { return el("div", {}, [el("span", { text: label }), el("strong", { text: big }), el("small", { text: small || "" })]); }
    var cat = w.categories[0], top = w.topShops[0], words = IND[w.industry], first = (w.topItems || [])[0];
    box.appendChild(el("h3", { text: "At a glance" }));
    box.appendChild(el("div", { className: "rl-wr-stats" }, [
      stat("Spent", w.coverage.withTotal ? money(w.spentPence, "GBP") : "—", w.coverage.withTotal < w.receipts ? "from " + w.coverage.withTotal + " of " + w.receipts + " receipts" : w.receipts + (w.receipts === 1 ? " receipt" : " receipts")),
      stat("Top shop", top ? top.name : "—", top ? top.receipts + (top.receipts === 1 ? " order" : " orders") : ""),
      words ? stat(words.one, first ? first.name : "—", first && first.times > 1 ? first.times + " orders" : "")
        : stat("Favourite kind", cat ? cat.label : "—", cat ? cat.receipts + (cat.receipts === 1 ? " receipt" : " receipts") : ""),
      stat("Busiest month", w.busiestMonth || "—", "")]));
    if ((w.photos || []).length) { box.appendChild(el("h3", { text: "Things you bought", style: "margin:16px 0 8px;font-size:15px" })); box.appendChild(photoGrid(w.photos, "rl-wr-strip")); }
    return box;
  }
  var MONTH_FULL = { Jan: "January", Feb: "February", Mar: "March", Apr: "April", May: "May", Jun: "June", Jul: "July", Aug: "August", Sep: "September", Oct: "October", Nov: "November", Dec: "December" };
  // Counts a number up from zero, so the big figure on a slide lands with a bit of drama.
  function countUp(node, to, fmt, ms) {
    var t0 = null; ms = ms || 1200;
    function step(t) { if (!t0) t0 = t; var k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); node.textContent = fmt(Math.round(to * e)); if (k < 1 && node.isConnected) requestAnimationFrame(step); }
    node.textContent = fmt(0); requestAnimationFrame(step);
  }
  // Real photos from the shopper's own receipts (only ones Relay checked are of the item). Never a stand-in picture.
  function photoGrid(list, cls) {
    var g = el("div", { className: cls + " n" + list.length });
    var gone = function (f) { f.remove(); g.className = cls + " n" + g.children.length; };
    list.forEach(function (p, i) {
      var f = el("figure", { style: "animation-delay:" + (0.2 + i * 0.12) + "s" }), cap = p.item ? p.item + (p.more ? " +" + p.more : "") : p.shop;
      if (cls === "rl-wr-strip") { var box = el("div", { className: "im" }); f.appendChild(box); f.appendChild(el("figcaption", { text: cap })); apiBlob("/relay/my/receipts/" + p.id + "/image").then(function (u) { if (u) box.appendChild(el("img", { src: u, alt: cap })); else gone(f); }); }
      else { f.appendChild(el("figcaption", { text: cap })); apiBlob("/relay/my/receipts/" + p.id + "/image").then(function (u) { if (u) f.insertBefore(el("img", { src: u, alt: cap }), f.firstChild); else gone(f); }); }
      g.appendChild(f);
    });
    return g;
  }
  // The style slide is worked out from the year's things (clothes, shoes, homeware) with the same rules as Discover.
  function wrappedStyle(w) {
    var E = window.RelayRecommendationEngine;
    if (!E || !(w.things || []).length) return null;
    var pr = E.profile(w.things.map(function (t) { return { item: t.name, detail: t.variant || t.name, merchant: t.shop, price: t.pricePence ? t.pricePence / 100 : 0, verified: true }; }), []);
    // One or two items aren't enough to call it a style.
    if (pr.bought < 3 || !pr.headline || (!pr.styles.length && !pr.sizes.clothing && !pr.sizes.footwear && !pr.sizes.bed)) return null;
    return pr;
  }
  var SW = { white: "#fff", black: "#111", grey: "#9aa0a6", gray: "#9aa0a6", cream: "#f3ead6", navy: "#1d2b55", blue: "#3b6fd8", green: "#3f9b4f", pink: "#f2a7c3", red: "#d33a2f", brown: "#7a4e2d", beige: "#e6d5b8", oat: "#e2d6bf", olive: "#6b7034", purple: "#7c4dbd", lilac: "#c8a2c8", lavender: "#b9a7e0", sage: "#a3b18a", charcoal: "#36393f", stone: "#c9c1b1", khaki: "#b3a26b" };
  function longDate(d) { return new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long" }); }
  function storySlides(w) {
    var S = [], cat = w.categories[0], top = w.topShops[0], gbp = function (p) { return money(p, "GBP"); };
    // A Wrapped about one kind of shopping (fashion, food & drink…) keeps every list to that kind. The whole year's
    // Wrapped has no top-5 lists of things or buys, so a coat is never ranked against a coffee.
    var words = IND[w.industry] || null, kind = words ? words.chip.toLowerCase() : "";
    var kinds = Array.isArray(w.industries) ? w.industries : null, oneKind = !kinds || kinds.length <= 1, lists = !!words || oneKind;
    var photos = (w.photos || []).slice(0, 9);
    var style = w.industry === "fashion" || (!words && (!kinds || (kinds.length === 1 && kinds[0].category === "fashion"))) ? wrappedStyle(w) : null;
    S.push({ bg: "#101828", fg: "#fff", accent: "#c7f567", build: function (b) {
      b.appendChild(el("div", { className: "k", text: "RELAY WRAPPED" + (words ? " · " + words.chip.toUpperCase() : "") }));
      b.appendChild(el("h1", { text: words ? "Your " + w.year + " " + words.inn + "." : "Your " + w.year + ", one receipt at a time." }));
      var fb = w.firstBuy;
      if (fb && fb.date) b.appendChild(el("p", { text: "It started on " + longDate(fb.date) + (fb.item ? " with " + fb.item : "") + (fb.shop ? (fb.item ? " from " : " at ") + fb.shop : "") + "." }));
      b.appendChild(el("p", { text: w.receipts + " receipts and " + w.shops + (w.shops === 1 ? " shop" : " shops") + " later, here's what Relay saw." }));
    } });
    var st = w.shoppingTime;
    if (st && st.days) S.push({ bg: "#0b3b5c", fg: "#fff", accent: "#7dd3fc", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "Your shopping time" }));
      var n = el("div", { className: "big" }); b.appendChild(n); countUp(n, st.days, function (v) { return v + (v === 1 ? " day" : " days"); }, 1100);
      b.appendChild(el("p", { text: "You bought something on " + st.days + " days of " + w.year + "." + (st.favouriteDay && st.favouriteDayCount > 1 ? " " + st.favouriteDay + " was your day (" + st.favouriteDayCount + " of them)." : "") }));
      if (st.longestMonthStreak >= 3) b.appendChild(el("p", { className: "pill", text: st.longestMonthStreak + " months in a row with a purchase" }));
    } });
    if (w.coverage.withTotal) S.push({ bg: "#14532d", fg: "#fff", accent: "#c7f567", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "In " + w.year + " you spent" }));
      var n = el("div", { className: "big" }); b.appendChild(n); countUp(n, w.spentPence, gbp, 1400);
      b.appendChild(el("p", { text: (words ? "on " + w.industryLabel.toLowerCase() + ", " : "") + "across " + w.shops + (w.shops === 1 ? " shop" : " shops") + (w.activeMonths ? " in " + w.activeMonths + (w.activeMonths === 1 ? " month" : " months") : "") + "." }));
      if (w.coverage.noTotal) b.appendChild(el("p", { className: "fine", text: "Added up from " + w.coverage.withTotal + " of " + w.receipts + " receipts. " + w.coverage.noTotal + " had no amount Relay could read." }));
    } });
    if (top) S.push({ bg: "#c7f567", fg: "#16210a", accent: "#16210a", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: words ? words.go : "Your number one shop" }));
      b.appendChild(el("div", { className: "big name", text: top.name }));
      b.appendChild(el("p", { text: top.receipts + (top.receipts === 1 ? " order" : " orders") + (top.spentPence ? " · " + gbp(top.spentPence) : "") }));
      if (w.topShopShare && w.topShopShare < 100) b.appendChild(el("p", { className: "pill", text: "That's " + w.topShopShare + "% of " + (words ? "your " + kind + " spending" : "everything you spent") }));
    } });
    if (w.topShops.length > 1) S.push({ bg: "#172554", fg: "#fff", accent: "#93c5fd", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: words ? words.shops : "Your top shops" }));
      var ol = el("ol", { className: "rank" });
      w.topShops.forEach(function (sh, i) {
        ol.appendChild(el("li", { style: "animation-delay:" + (0.15 + i * 0.18) + "s" }, [el("b", { text: String(i + 1) }), el("span", { text: sh.name }), el("em", { text: sh.spentPence ? gbp(sh.spentPence) : sh.receipts + " orders" })]));
      });
      b.appendChild(ol);
    } });
    var spr = (w.sprint || []).filter(function (x) { return x.months.some(Boolean); }).slice(0, 5);
    if (spr.length > 1) S.push({ bg: "#111827", fg: "#fff", accent: "#c7f567", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "Your shop sprint" }));
      b.appendChild(el("p", { text: "When you shopped at your top shops, month by month." }));
      var g = el("div", { className: "sprint" }), max = Math.max.apply(null, spr.map(function (x) { return Math.max.apply(null, x.months); })) || 1;
      var head = el("div", { className: "row head" }, [el("span", { text: "" })]); "JFMAMJJASOND".split("").forEach(function (m) { head.appendChild(el("i", { text: m })); }); g.appendChild(head);
      spr.forEach(function (x, r) { var row = el("div", { className: "row" }, [el("span", { text: x.name })]);
        x.months.forEach(function (n, i) { row.appendChild(el("i", { title: n + " in " + Object.keys(MONTH_FULL)[i], style: "--o:" + (n ? 0.25 + 0.75 * n / max : 0.06) + ";animation-delay:" + (0.2 + r * 0.12 + i * 0.03) + "s" })); });
        g.appendChild(row); });
      b.appendChild(g);
    } });
    var ti = lists ? (w.topItems || []).filter(function (x) { return x.name; }) : [];
    if (ti.length >= 3) S.push({ bg: "#7c2d12", fg: "#fff", accent: "#fdba74", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: words ? words.things : "Your top 5 things" }));
      var ol = el("ol", { className: "rank" });
      ti.forEach(function (x, i) { ol.appendChild(el("li", { style: "animation-delay:" + (0.15 + i * 0.18) + "s" }, [el("b", { text: String(i + 1) }), el("span", { text: x.name }), el("em", { text: x.times > 1 ? x.times + "×" : x.spentPence ? gbp(x.spentPence) : (x.shop || "") })])); });
      b.appendChild(ol);
    } });
    var subs = w.subscriptions || [];
    if (subs.length) S.push({ bg: "#134e4a", fg: "#fff", accent: "#99f6e4", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: subs.length === 1 ? "Your regular" : "Your regulars" }));
      b.appendChild(el("p", { text: "Things you paid for month after month." }));
      var ol = el("ol", { className: "rank" });
      subs.forEach(function (x, i) { ol.appendChild(el("li", { style: "animation-delay:" + (0.15 + i * 0.18) + "s" }, [el("b", { text: String(i + 1) }), el("span", { text: x.item && x.item !== x.name ? x.name + " · " + x.item : x.name }), el("em", { text: x.months + " months" + (x.spentPence ? " · " + gbp(x.spentPence) : "") })])); });
      b.appendChild(ol);
    } });
    if (cat && !words) S.push({ bg: "#f6c7e2", fg: "#3f1430", accent: "#3f1430", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "Your favourite kind of shopping" }));
      b.appendChild(el("div", { className: "big name", text: cat.label }));
      b.appendChild(el("p", { text: cat.receipts + " of your " + w.receipts + " receipts" + (cat.topShop && cat.topShop.receipts > 1 ? ", and your go-to was " + cat.topShop.name + " (" + cat.topShop.receipts + ")" : "") + "." }));
      var bars = el("div", { className: "bars" });
      w.categories.slice(0, 4).forEach(function (c, i) {
        var pct = Math.max(4, Math.round(c.receipts / w.receipts * 100));
        bars.appendChild(el("div", { className: "bar" }, [el("span", { text: c.label }), el("i", { style: "--w:" + pct + "%;animation-delay:" + (0.2 + i * 0.15) + "s" }), el("em", { text: Math.round(c.receipts / w.receipts * 100) + "%" })]));
      });
      b.appendChild(bars);
    } });
    if (photos.length) S.push({ bg: "#f6f3ec", fg: "#101828", accent: "#101828", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: photos.length === 1 ? "One thing you brought home" : "Some things you brought home" }));
      b.appendChild(photoGrid(photos.length > 6 ? photos.slice(0, 6) : photos, "ph"));
    } });
    if (style) S.push({ bg: "#1f3d2b", fg: "#fff", accent: "#c7f567", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "Your style in " + w.year }));
      b.appendChild(el("p", { text: style.headline, style: "font-size:24px;line-height:1.3;font-weight:800;opacity:1" }));
      var ch = el("div", { className: "chips" });
      style.styles.forEach(function (x) { ch.appendChild(el("span", { text: x.name })); });
      style.colours.slice(0, 3).forEach(function (x) { ch.appendChild(el("span", {}, [el("i", { style: "background:" + (SW[x.name] || "#ccc") }), document.createTextNode(x.name.charAt(0).toUpperCase() + x.name.slice(1))])); });
      b.appendChild(ch);
    } });
    if (w.topItem) S.push({ bg: "#ff8a5b", fg: "#2b0d00", accent: "#2b0d00", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "On repeat" }));
      b.appendChild(el("div", { className: "big name", text: w.topItem.name }));
      var n = el("div", { className: "big" }); b.appendChild(n); countUp(n, w.topItem.times, function (v) { return v + "×"; }, 900);
      var t = w.topItem.times, weeks = w.activeMonths ? w.activeMonths * 4.3 : 52;
      b.appendChild(el("p", { text: "You kept coming back for it" + (w.topItem.shop ? " at " + w.topItem.shop : "") + "." + (t >= weeks ? " That's more than once a week." : t >= 12 ? " That's about " + Math.round(t / Math.max(1, w.activeMonths || 12)) + " a month." : "") }));
    } });
    if (w.busiestMonth) S.push({ bg: "#0f3d5c", fg: "#fff", accent: "#bae6fd", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "Your busiest month" }));
      b.appendChild(el("div", { className: "big name", text: MONTH_FULL[w.busiestMonth] || w.busiestMonth }));
      var max = Math.max.apply(null, w.byMonth.map(function (m) { return m.receipts; })) || 1;
      var chart = el("div", { className: "months" });
      w.byMonth.forEach(function (m, i) { chart.appendChild(el("div", {}, [el("i", { className: m.month === w.busiestMonth ? "hot" : "", style: "--h:" + Math.max(4, Math.round(m.receipts / max * 100)) + "%;animation-delay:" + (0.1 + i * 0.05) + "s" }), el("span", { text: m.month.slice(0, 1) })])); });
      b.appendChild(chart);
      var bm = w.byMonth.filter(function (m) { return m.month === w.busiestMonth; })[0];
      if (bm) b.appendChild(el("p", { text: bm.receipts + " receipts" + (bm.spentPence ? " · " + gbp(bm.spentPence) : "") + "." }));
    } });
    if (w.biggest) S.push({ bg: "#0f5132", fg: "#fff", accent: "#b7f0cf", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: words ? words.treat : "Your biggest treat" }));
      var n = el("div", { className: "big" }); b.appendChild(n); countUp(n, w.biggest.totalPence, gbp, 1100);
      b.appendChild(el("p", { text: (w.biggest.item ? w.biggest.item + ", " : "") + "at " + w.biggest.shop + (w.biggest.date ? " on " + longDate(w.biggest.date) : "") + "." }));
      if (w.biggest.photoId) b.appendChild(photoGrid([{ id: w.biggest.photoId, item: w.biggest.item, shop: w.biggest.shop }], "ph"));
    } });
    var tb = lists ? w.topBuys || [] : [];
    if (tb.length >= 3) S.push({ bg: "#064e3b", fg: "#fff", accent: "#6ee7b7", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: words ? words.buys : "Your biggest buys" }));
      var ol = el("ol", { className: "rank" });
      tb.forEach(function (x, i) { ol.appendChild(el("li", { style: "animation-delay:" + (0.15 + i * 0.18) + "s" }, [el("b", { text: String(i + 1) }), el("span", { text: (x.item || (x.items > 1 ? x.items + " things" : "Order")) + " · " + x.shop }), el("em", { text: gbp(x.totalPence) })])); });
      b.appendChild(ol);
    } });
    var bd = w.badges || [];
    if (bd.length) S.push({ bg: "#c7f567", fg: "#16210a", accent: "#16210a", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: bd.length === 1 ? "Your badge" : "Your badges" }));
      var g = el("div", { className: "badges" });
      bd.slice(0, 4).forEach(function (x, i) { g.appendChild(el("div", { style: "animation-delay:" + (0.2 + i * 0.2) + "s" }, [el("b", { text: x.label }), el("small", { text: x.why })])); });
      b.appendChild(g);
    } });
    if (w.returnsStarted || w.refundedPence) S.push({ bg: "#fde68a", fg: "#3a2a00", accent: "#3a2a00", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "Changed your mind?" }));
      if (w.refundedPence) { var n = el("div", { className: "big" }); b.appendChild(n); countUp(n, w.refundedPence, gbp, 1000); b.appendChild(el("p", { text: "came back to you in refunds Relay tracked." })); }
      else b.appendChild(el("div", { className: "big", text: String(w.returnsStarted) }));
      if (w.returnsStarted) b.appendChild(el("p", { text: w.returnsStarted + (w.returnsStarted === 1 ? " return" : " returns") + " started from your orders." }));
    } });
    if (w.personality) S.push({ bg: "#9a3412", fg: "#fff", accent: "#fed7aa", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "Your shopping style" }));
      b.appendChild(el("div", { className: "big name", text: w.personality.label }));
      b.appendChild(el("p", { text: w.personality.why }));
    } });
    S.push({ bg: "#101828", fg: "#fff", accent: "#c7f567", summary: true, build: function (b, again, close) {
      var title = "My " + w.year + (words ? " " + words.inn : "") + " on Relay", firstThing = (w.topItems || [])[0];
      var card = el("div", { className: "sum" }, [el("div", { className: "k", text: title.toUpperCase() })]);
      var rows = [["Spent", w.coverage.withTotal ? gbp(w.spentPence) : "—"], ["Top shop", top ? top.name : "—"], words ? [words.one, firstThing ? firstThing.name : "—"] : ["Favourite kind", cat ? cat.label : "—"], ["Busiest month", w.busiestMonth ? MONTH_FULL[w.busiestMonth] : "—"], ["Receipts", String(w.receipts)], [style && style.styles[0] ? "Style" : "Shops", style && style.styles[0] ? style.styles.slice(0, 2).map(function (x) { return x.name; }).join(" & ") : String(w.shops)]];
      var g = el("div", { className: "sumgrid" }); rows.forEach(function (r) { g.appendChild(el("div", {}, [el("span", { text: r[0] }), el("strong", { text: r[1] })])); }); card.appendChild(g);
      b.appendChild(card);
      var text = title + ": " + rows.map(function (r) { return r[0] + " " + r[1]; }).join(" · ");
      var msg = el("p", { className: "fine" });
      b.appendChild(el("div", { className: "acts" }, [
        el("button", { type: "button", text: "Share", onclick: function (e) { e.stopPropagation();
          if (navigator.share) navigator.share({ title: title, text: text }).catch(function () {});
          else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { msg.textContent = "Copied. Paste it anywhere."; }, function () {}); } }),
        lists && (w.yearList || []).length ? el("button", { type: "button", className: "ghost", text: "Save my list", onclick: function (e) { e.stopPropagation();
          var q = function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
          var csv = "Rank,Item,Shop,Orders,Spent\n" + w.yearList.map(function (x, i) { return [i + 1, x.name, x.shop || "", x.times, x.spentPence ? (x.spentPence / 100).toFixed(2) : ""].map(q).join(","); }).join("\n");
          var a = el("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })) }); a.download = "relay-" + w.year + (w.industry ? "-" + w.industry : "") + "-top-things.csv"; document.body.appendChild(a); a.click(); a.remove();
          msg.textContent = "Saved your top " + w.yearList.length + " things."; } }) : null,
        el("button", { type: "button", className: "ghost", text: "Watch again", onclick: function (e) { e.stopPropagation(); again(); } }),
        el("button", { type: "button", className: "ghost", text: "Done", onclick: function (e) { e.stopPropagation(); close(); } })].filter(Boolean)));
      b.appendChild(msg);
    } });
    return S;
  }
  function playStory(w) {
    var slides = storySlides(w), i = 0, timer = null, paused = false, DUR = 6500;
    var root = el("div", { className: "rl-story", role: "dialog", ariaLabel: "Your " + w.year + (IND[w.industry] ? " " + IND[w.industry].chip : "") + " Wrapped" });
    var frame = el("div", { className: "rl-story-frame" });
    var bars = el("div", { className: "rl-story-bars" });
    slides.forEach(function () { bars.appendChild(el("div", {}, [el("i")])); });
    var closeBtn = el("button", { type: "button", className: "rl-story-x", ariaLabel: "Close", text: "×" });
    var body = el("div", { className: "rl-story-body" });
    frame.appendChild(bars); frame.appendChild(closeBtn); frame.appendChild(body); root.appendChild(frame);
    document.body.appendChild(root); document.body.style.overflow = "hidden";
    function close() { clearTimeout(timer); document.removeEventListener("keydown", key); root.remove(); document.body.style.overflow = ""; }
    function show(n) {
      i = Math.max(0, Math.min(slides.length - 1, n)); clearTimeout(timer);
      var sl = slides[i];
      frame.style.background = sl.bg; frame.style.color = sl.fg; frame.style.setProperty("--accent", sl.accent);
      Array.prototype.forEach.call(bars.children, function (b, k) { b.className = k < i ? "done" : k === i ? "now" : ""; b.firstChild.style.animationDuration = DUR + "ms"; });
      body.textContent = ""; var inner = el("div", { className: "rl-story-slide" }); body.appendChild(inner);
      sl.build(inner, function () { show(0); }, close);
      if (!sl.summary) timer = setTimeout(function () { if (!paused) show(i + 1); }, DUR);
    }
    function key(e) { if (e.key === "Escape") close(); else if (e.key === "ArrowRight") show(i + 1); else if (e.key === "ArrowLeft") show(i - 1); }
    document.addEventListener("keydown", key);
    closeBtn.onclick = function (e) { e.stopPropagation(); close(); };
    // Tap the right side to go on, the left side to go back; press and hold to pause.
    frame.addEventListener("click", function (e) { if (e.target.closest("button")) return; var r = frame.getBoundingClientRect(); if (e.clientX - r.left < r.width * 0.33) show(i - 1); else if (!slides[i].summary) show(i + 1); });
    frame.addEventListener("pointerdown", function () { paused = true; frame.classList.add("paused"); });
    frame.addEventListener("pointerup", function () { if (!paused) return; paused = false; frame.classList.remove("paused"); });
    show(0);
  }

  // ---- Investor/shop demo of the Market (only with ?demo=1). Everything here is made up and stays in this browser:
  // nothing is sent to Relay, and real members never see it. It shows how buying and selling works end to end. ----
  function mountDemoMarket(host) {
    host.textContent = "";
    var D = [
      { id: "d1", title: "Waterproof Rain Shell", store: "Fieldhouse", size: "M", cond: "Like new", price: 4500, paid: 12000, ago: "5 weeks ago", area: "SW11", how: "either", who: "Priya", img: "ltd-rain-shell.png" },
      { id: "d2", title: "Court Classic Trainers", store: "Kick Lane", size: "UK 8", cond: "Good", price: 3500, paid: 8500, ago: "2 months ago", area: "SW4", how: "collect", who: "Tom", img: "court-classic-sneakers.png", swap: true },
      { id: "d3", title: "Oversized Hoodie", store: "Studio North", size: "L", cond: "New with tags", price: 3000, paid: 5500, ago: "3 weeks ago", area: "SW11", how: "either", who: "Maya", img: "studio-oversized-hoodie.png" },
      { id: "d4", title: "Wool Coat", store: "Harlow & Co", size: "UK 10", cond: "Like new", price: 9000, paid: 22000, ago: "6 weeks ago", area: "N1", how: "post", who: "Ellie", img: "wool-coat.png" },
      { id: "d5", title: "Yoga Leggings", store: "Relay Demo Store", size: "S", cond: "Like new", price: 1800, paid: 4800, ago: "1 month ago", area: "SE15", how: "collect", who: "Aisha", img: "rd-yoga-leggings.png", swap: true },
      { id: "d6", title: "Leather Crossbody Bag", store: "Harlow & Co", size: null, cond: "Good", price: 4000, paid: 9500, ago: "4 months ago", area: "SW11", how: "collect", who: "Sam", img: "leather-crossbody.png" },
      { id: "d7", title: "Trail Grip Boots", store: "Fieldhouse", size: "UK 9", cond: "Good", price: 5500, paid: 14000, ago: "2 months ago", area: "M1", how: "post", who: "Josh", img: "trail-grip-boots.png" },
      { id: "d8", title: "Wireless Earbuds", store: "Voltline", size: null, cond: "Like new", price: 3500, paid: 7900, ago: "3 weeks ago", area: "SW12", how: "either", who: "Leo", img: "wireless-earbuds.png" }];
    var MINE = [{ id: "s1", title: "Linen Shirt", store: "Studio North", paid: 4500, ago: "Bought 7 weeks ago", img: "linen-shirt.png" },
      { id: "s2", title: "Retro High Trainers", store: "Kick Lane", paid: 9500, ago: "Bought 3 months ago", img: "ltd-retro-high.png" },
      { id: "s3", title: "Steel Water Bottle", store: "Fieldhouse", paid: 2200, ago: "Bought 5 weeks ago", img: "steel-water-bottle.png" }];
    var listed = [], cur = "browse", near = "SW11";
    var pic = function (f) { return el("img", { src: "pics/products/" + f, alt: "", style: "width:100%;aspect-ratio:1;object-fit:contain;background:#f4f1ea;border-radius:16px" }); };
    var howText = function (l) { return l.how === "collect" ? "Collection in " + l.area : l.how === "post" ? "Posted" : "Collect in " + l.area + " or post"; };
    host.appendChild(el("div", { style: "background:#fff4d6;border:1px solid #f2d27b;color:#5c4400;border-radius:14px;padding:10px 14px;font-size:13px;margin:0 0 12px" }, [
      el("b", { text: "Demo: " }), document.createTextNode("made-up members and listings to show how the Market works. Nothing here is real or sent anywhere.")]));
    var tabs = el("div", { style: "display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px" }), body = el("div");
    host.appendChild(tabs); host.appendChild(body);
    [["browse", "Browse"], ["mine", "Mine"], ["sell", "Sell"]].forEach(function (t) {
      var b = el("button", { className: "rl-btn ghost", text: t[1], style: "margin:0;padding:9px 6px;font-size:14px", onclick: function () { cur = t[0]; draw(); } });
      b.setAttribute("data-tab", t[0]); tabs.appendChild(b);
    });
    function draw() {
      Array.prototype.forEach.call(tabs.children, function (b) { b.style.background = b.getAttribute("data-tab") === cur ? "#c7f567" : "transparent"; });
      body.textContent = "";
      if (cur === "browse") browse(); else if (cur === "mine") mine(); else sell();
    }
    function browse() {
      var box = el("input", { value: near, maxLength: 8, placeholder: "Your postcode area", style: "flex:1;padding:10px 14px;border:1px solid #e7e1d2;border-radius:12px;font-size:15px" });
      box.onchange = function () { near = box.value.trim().toUpperCase(); draw(); };
      body.appendChild(el("div", { style: "display:flex;gap:8px;align-items:center;margin:0 0 12px" }, [el("span", { text: "📍" }), box]));
      var letters = near.replace(/[0-9].*$/, "");
      var score = function (l) { return l.how === "post" ? 0 : l.area === near ? 2 : l.area.replace(/[0-9].*$/, "") === letters ? 1 : 0; };
      var grid = el("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px" });
      D.slice().sort(function (a, b) { return score(b) - score(a); }).forEach(function (l) {
        var c = el("div", { className: "rl-po", style: "padding:12px" }, [pic(l.img),
          el("div", { style: "display:flex;justify-content:space-between;gap:8px;margin-top:10px" }, [el("b", { text: l.title, style: "font-size:15px;color:#101828" }), el("b", { text: money(l.price, "GBP"), style: "color:#101828" })]),
          el("div", { text: [l.size ? "Size " + l.size : null, l.cond, howText(l)].filter(Boolean).join(" · "), style: "font-size:13px;color:#475467;margin-top:4px" }),
          el("div", { text: "✓ Bought at " + l.store + " " + l.ago + " for " + money(l.paid, "GBP") + ". Receipt checked by Relay.", style: "font-size:12px;color:#2f4a10;background:#eef7df;border-radius:10px;padding:6px 8px;margin-top:8px" })]);
        if (score(l)) c.appendChild(el("span", { text: score(l) === 2 ? "📍 Near you" : "📍 In your area", style: "display:inline-block;margin-top:8px;background:#e3f4c8;color:#2f4a10;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:800" }));
        c.appendChild(el("div", { style: "display:flex;gap:6px;margin-top:10px" }, [
          el("button", { className: "rl-po-primary", text: "I'd like this", onclick: function () { chat(l, "Hi! Is the " + l.title.toLowerCase() + " still available?", [
            "Yes, it is! " + (l.how === "post" ? "I can post it this week." : "I'm in " + l.area + ". Could you collect on Saturday morning?"),
            l.how === "post" ? "Great. Once Relay payments are live you'll pay through the app; for now we'd arrange it safely here." : "Perfect, see you then. I'll message the exact spot here."]); } }),
          l.swap ? el("button", { className: "rl-po-secondary", text: "Offer a swap", onclick: function () { chat(l, "Hi! Would you swap for my Linen Shirt (M)?", ["Ooh, maybe! What colour is it?", "Sounds good, let's swap when we meet."]); } }) : null].filter(Boolean)));
        grid.appendChild(c);
      });
      body.appendChild(grid);
    }
    function chat(l, opener, replies) {
      var back = el("div", { className: "rl-back", style: "z-index:10000" });
      var sheet = el("div", { className: "rl-sheet", role: "dialog" });
      back.appendChild(sheet); document.body.appendChild(back);
      var log = el("div", { style: "display:flex;flex-direction:column;gap:8px;margin:12px 0;max-height:40vh;overflow:auto" });
      var bubble = function (t, me) { log.appendChild(el("div", { text: t, style: "max-width:80%;padding:10px 14px;border-radius:16px;font-size:15px;" + (me ? "align-self:flex-end;background:#101828;color:#fff" : "align-self:flex-start;background:#f1ecdf;color:#101828") })); log.scrollTop = 1e6; };
      var n = 0, reply = function () { if (n < replies.length) { var t = replies[n++]; setTimeout(function () { bubble(t, false); }, 1100); } };
      var input = el("input", { placeholder: "Write a message", maxLength: 300 });
      var send = el("button", { className: "rl-btn", text: "Send", onclick: function () { var t = input.value.trim(); if (!t) return; if (/@|(?:\d[\s-]*){9,}/.test(t)) { note.textContent = "Relay keeps phone numbers and emails out of chats, to protect you both."; return; } note.textContent = ""; bubble(t, true); input.value = ""; reply(); } });
      var note = el("div", { className: "rl-msg" });
      [el("h2", { text: l.title }), el("p", { text: "Chatting with " + l.who + " (made-up demo member) · " + money(l.price, "GBP") + " · " + howText(l), style: "color:#475467;margin:0" }),
       el("details", { style: "background:#f7f5ef;border-radius:14px;padding:10px 14px;margin:10px 0 0;font-size:14px" }, [el("summary", { text: "Doing the deal safely", style: "font-weight:800;cursor:pointer" }),
         el("p", { text: "Meet somewhere public, check the item, pay on the spot. Don't pay a stranger in advance by bank transfer.", style: "margin:8px 0 0" })]),
       log, input, send, note, el("button", { className: "rl-btn ghost", text: "Close", onclick: function () { back.remove(); } })].forEach(function (x) { sheet.appendChild(x); });
      bubble(opener, true); reply();
    }
    function sell() {
      body.appendChild(el("p", { text: "Things Relay found in this demo shopper's receipts. Pick one to list it: the name, shop and price paid come from the receipt, so buyers know it's genuine.", style: "color:#475467;margin:0 0 12px;font-size:14px" }));
      MINE.filter(function (m) { return !listed.some(function (x) { return x.id === m.id; }); }).forEach(function (m) {
        var c = el("div", { className: "rl-po", style: "display:flex;gap:12px;align-items:center;padding:12px;margin-bottom:10px" }, [el("div", { style: "width:72px;flex:none" }, [pic(m.img)]),
          el("div", { style: "flex:1" }, [el("b", { text: m.title }), el("div", { text: m.store + " · " + m.ago + " · paid " + money(m.paid, "GBP"), style: "font-size:13px;color:#475467" })]),
          el("button", { className: "rl-po-primary", text: "List it", style: "flex:none;width:auto;padding:10px 16px", onclick: function () {
            listed.push({ id: m.id, title: m.title, img: m.img, price: Math.round(m.paid * 0.45 / 100) * 100, state: "listed" }); cur = "mine"; draw();
            setTimeout(function () { var x = listed.filter(function (q) { return q.id === m.id; })[0]; if (x) { x.state = "asked"; if (cur === "mine") draw(); } }, 2500);
          } })]);
        body.appendChild(c);
      });
    }
    function mine() {
      if (!listed.length) { body.appendChild(el("div", { className: "rl-empty" }, [el("h3", { text: "Nothing listed yet" }), el("p", { text: "Use the Sell tab to list something from your receipts." })])); return; }
      listed.forEach(function (x) {
        var c = el("div", { className: "rl-po", style: "display:flex;gap:12px;align-items:center;padding:12px;margin-bottom:10px" }, [el("div", { style: "width:72px;flex:none" }, [pic(x.img)]),
          el("div", { style: "flex:1" }, [el("b", { text: x.title + " · " + money(x.price, "GBP") }),
            el("div", { text: x.state === "listed" ? "Listed · waiting for interest…" : x.state === "asked" ? "🔔 Jordan (demo member, SW11) would like this" : "✓ Deal agreed with Jordan", style: "font-size:13px;color:" + (x.state === "asked" ? "#2f4a10;font-weight:800" : "#475467") })])]);
        if (x.state === "asked") c.appendChild(el("button", { className: "rl-po-primary", text: "Accept", style: "flex:none;width:auto;padding:10px 16px", onclick: function () { x.state = "agreed"; draw();
          chat({ title: x.title, who: "Jordan", price: x.price, how: "collect", area: "SW11" }, "Hi Jordan, it's yours! I'm in SW11. Does Sunday work?", ["Sunday's great! Outside the station at 11?", "See you then 👍"]); } }));
        body.appendChild(c);
      });
    }
    draw();
  }
  // ---- Phone alerts: price drops sent to this device. Nothing is sent unless the shopper turns it on here. ----
  function pushOk() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
  function keyBytes(t) { var s = t.replace(/-/g, "+").replace(/_/g, "/"); s += "=".repeat((4 - s.length % 4) % 4); return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
  function race(p, ms, fallback) { return new Promise(function (res) { var t = setTimeout(function () { res(fallback); }, ms); p.then(function (v) { clearTimeout(t); res(v); }, function () { clearTimeout(t); res(fallback); }); }); }
  function swReady() { return race(navigator.serviceWorker.ready, 10000, null).then(function (r) { if (!r) throw new Error("sw_not_ready"); return r; }); }
  function thisDevice() { return pushOk() ? race(swReady().then(function (r) { return r.pushManager.getSubscription(); }), 12000, null) : Promise.resolve(null); }
  function alertStatus() { memoDrop("alerts"); return race(cachedGet("alerts", "/relay/my/alerts/status").then(function (r) { return r.ok ? r.body : null; }), 20000, null); }
  function syncWatch(p, on) {
    var s = load(); if (!s || !s.token || !p || !p.sku) return Promise.resolve();
    memoDrop("alerts");
    return api("/relay/my/alerts/watch", { method: "POST", body: on === false ? { sku: String(p.sku), on: false } : { sku: String(p.sku), product: p.product, variant: p.variation, store: p.store, priceMinor: Math.round(Number(p.priceMinor)) } }).catch(function () {});
  }
  function syncStore(store, on, items) {
    memoDrop("alerts");
    return api("/relay/my/alerts/store", { method: "POST", body: on === false ? { store: store, on: false } : { store: store, items: (items || []).map(function (p) { return { sku: String(p.sku), product: p.product, variant: p.variation, priceMinor: Math.round(Number(p.priceMinor)) }; }) } });
  }
  function enablePush() {
    if (!pushOk()) return Promise.resolve({ ok: false, reason: "unsupported" });
    return Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") return { ok: false, reason: "denied" };
      return Promise.all([swReady(), api("/relay/my/push/key")]).then(function (x) {
        if (!x[1].ok) return { ok: false, reason: "server" };
        return x[0].pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(x[1].body.publicKey) }).then(function (sub) {
          var j = sub.toJSON();
          return api("/relay/my/push/subscribe", { method: "POST", body: { endpoint: j.endpoint, keys: j.keys } }).then(function (r) {
            if (!r.ok) return { ok: false, reason: "server" };
            // Anything already on the watchlist starts being watched by the server too.
            var local = (window.relayLocalWatches && window.relayLocalWatches()) || [];
            return Promise.all(local.map(function (p) { return syncWatch(p, true); })).then(function () { memoDrop("alerts"); return { ok: true }; });
          });
        });
      });
    }).catch(function () { return { ok: false, reason: "failed" }; });
  }
  function disablePush() {
    return thisDevice().then(function (sub) {
      if (!sub) return;
      var ep = sub.endpoint;
      return sub.unsubscribe().catch(function () {}).then(function () { return api("/relay/my/push/unsubscribe", { method: "POST", body: { endpoint: ep } }); });
    }).then(function () { memoDrop("alerts"); });
  }
  // ---- Purchases the shop confirmed (orders placed with the shopper's Relay email), with exchanges done through Relay. ----
  var RETURN_REASONS = [["wrong_size", "Wrong size or fit"], ["changed_mind", "Changed my mind"], ["faulty", "Faulty or damaged"], ["not_as_described", "Not as described"]];
  var RETURN_ERR = { outside_return_window: "This order is outside the 7-day return window.", already_returned: "A return has already been started for this item.", already_exchanged: "This item was exchanged — it can't also be returned.", retailer_not_supported: "This retailer doesn't support Relay returns yet.", not_your_order: "We couldn't find this order on your account." };

  function openReturn(o, it, done) {
    // Shown as a proper sheet over the page (same look as the other Relay sheets), above the bottom bar on phones.
    var sheet = el("div", { className: "rl-sheet", role: "dialog" });
    var layer = el("div", { className: "rl-back" }, [sheet]);
    layer.addEventListener("click", function (e) { if (e.target === layer) close(); });
    document.body.appendChild(layer);
    function close() { if (layer.parentNode) layer.parentNode.removeChild(layer); }
    var msg = el("div", { className: "rl-msg" });
    var step = "reason";
    var selectedReason = null;

    // A Royal Mail label is shown only when Royal Mail actually made one (the shop connected its own Click & Drop account).
    function showLabel(result) {
      sheet.textContent = "";
      var shop = o.store || "the shop";
      var inner = el("div", { className: "sheet-inner" });
      var msg2 = el("div", { className: "rl-msg" });
      inner.appendChild(el("div", { className: "eyebrow", text: "ROYAL MAIL RETURN LABEL" }));
      inner.appendChild(el("h2", { text: "Your return label is ready" }));
      inner.appendChild(el("p", { className: "small", text: shop + " has sent you a Royal Mail " + (result.serviceName || "returns") + " label for " + (result.item || it.title) + "." }));
      if (result.qrImage) inner.appendChild(el("div", { className: "card", style: "text-align:center;margin:12px 0" }, [
        el("img", { src: result.qrImage, alt: "Royal Mail QR code for your return", style: "width:200px;height:200px;image-rendering:pixelated" }),
        el("p", { className: "small", style: "margin:8px 0 0", text: "Pack the item, then show this QR code at a Post Office counter. They'll print the label for you." })
      ]));
      inner.appendChild(el("div", { className: "card", style: "margin:0 0 12px" }, [
        el("div", { className: "eyebrow", text: "TRACKING NUMBER" }),
        el("div", { style: "font-family:monospace;font-size:18px;letter-spacing:1px;margin:4px 0", text: result.trackingNumber }),
        el("div", { className: "small muted", text: "Relay reference " + result.returnRef + ". Your refund comes from " + shop + " once they receive the item." })
      ]));
      if (result.hasPdf) inner.appendChild(el("button", { className: "rl-btn ghost", text: "Download label to print (PDF)", style: "margin-bottom:8px", onclick: function() {
        var s0 = load(), h = {}; if (s0 && s0.token) h.Authorization = "Bearer " + s0.token;
        fetch(API + "/relay/my/return/label?kind=pdf&id=" + encodeURIComponent(result.returnId), { headers: h })
          .then(function(r) { return r.ok ? r.blob() : null; })
          .then(function(b) {
            if (!b || b.type !== "application/pdf") return say(msg2, "Couldn't download the label just now. The QR code still works.", true);
            var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "royal-mail-return-label.pdf"; document.body.appendChild(a); a.click(); a.remove();
          }).catch(function() { say(msg2, "Connection error. Please try again.", true); });
      } }));
      inner.appendChild(msg2);
      inner.appendChild(el("p", { className: "small muted", text: result.shopNotified ? "We've emailed " + shop + " to say this return is coming." : "Relay hasn't been able to email " + shop + ", but the label is on their Royal Mail account." }));
      inner.appendChild(el("button", { className: "rl-btn", text: "Done", onclick: function() { close(); if (done) done(); } }));
      sheet.appendChild(inner);
    }

    // No Royal Mail label (the shop hasn't set that up, or Royal Mail didn't make one): there is no QR code to show.
    // Say exactly what happened (a request saved in Relay) and what the shopper should do.
    function showSaved(result) {
      if (result.labelAvailable && result.trackingNumber) return showLabel(result);
      sheet.textContent = "";
      var shop = o.store || "the shop";
      var inner = el("div", { className: "sheet-inner" });
      inner.appendChild(el("div", { className: "eyebrow", text: "RETURN REQUEST SAVED" }));
      inner.appendChild(el("h2", { text: "Saved in Relay" }));
      inner.appendChild(el("p", { className: "small", text: "Relay has noted that you're returning " + (result.item || it.title) + ", so it won't be offered for exchange." }));
      inner.appendChild(el("div", { className: "card", style: "background:var(--surface2,#f7f7f7);margin:12px 0 16px" }, [
        el("div", { className: "eyebrow", text: "WHAT TO DO NEXT" }),
        el("p", { className: "small", style: "margin:6px 0 0", text: (result.shopNotified ? "We've emailed " + shop + " to say this return is coming. " : "Relay hasn't been able to contact " + shop + " about this. ") +
          (result.inStore ? "Take the item back to " + shop + " and show them your Relay reference, or send it using their own returns process. Your refund comes from " + shop + ", and Relay will show it here once they've refunded it."
            : shop + " hasn't set up Royal Mail labels in Relay, so to send the item back, use " + shop + "'s own returns process (usually in your order confirmation email or on their website). Your refund comes from " + shop + ".") })
      ]));
      inner.appendChild(el("div", { className: "card", style: "margin:0 0 16px" }, [
        el("div", { className: "eyebrow", text: "RELAY REFERENCE" }),
        el("div", { style: "font-family:monospace;font-size:18px;letter-spacing:2px;margin:4px 0", text: result.returnRef }),
        el("div", { className: "small muted", text: "For your records. This is not a postage label or tracking number." })
      ]));
      inner.appendChild(el("button", { className: "rl-btn", text: "Done", onclick: function() { close(); if (done) done(); } }));
      sheet.appendChild(inner);
    }

    function showReasonPicker() {
      sheet.textContent = "";
      var inner = el("div", { className: "sheet-inner" });
      inner.appendChild(el("div", { className: "eyebrow", text: "RETURN" }));
      inner.appendChild(el("h2", { text: "Return: " + it.title }));
      inner.appendChild(el("p", { className: "small muted", text: "What's the reason for the return?" }));
      RETURN_REASONS.forEach(function(r) {
        var btn = el("button", { className: "rl-btn ghost", text: r[1], style: "width:100%;text-align:left;margin-bottom:8px;padding:12px 16px;border-radius:10px",
          onclick: function() {
            selectedReason = r[0];
            // Confirm step
            sheet.textContent = "";
            var inner2 = el("div", { className: "sheet-inner" });
            inner2.appendChild(el("div", { className: "eyebrow", text: "CONFIRM RETURN" }));
            inner2.appendChild(el("h2", { text: it.title }));
            inner2.appendChild(el("p", { className: "small muted", text: "Relay will note this return on your account. If " + (o.store || "the shop") + " has set up Royal Mail returns in Relay, you'll get a return label straight away; if not, you'll send it back using their own returns process." }));
            inner2.appendChild(el("p", { className: "small", text: "Reason: " + r[1] }));
            inner2.appendChild(el("p", { className: "small", text: "Item price: " + money(it.priceMinor, it.currency) }));
            inner2.appendChild(msg);
            var confirmBtn = el("button", { className: "rl-btn", text: "Start return →", onclick: function() {
              confirmBtn.disabled = true; msg.textContent = "";
              api("/relay/my/return", { method: "POST", body: { orderId: o.id, lineId: it.lineId, reason: selectedReason } }).then(function(res) {
                confirmBtn.disabled = false;
                if (res.ok) { showSaved(res.body); }
                else { say(msg, RETURN_ERR[res.body && res.body.error] || "Couldn't start the return. Please try again.", true); }
              }).catch(function() { confirmBtn.disabled = false; say(msg, "Connection error. Please try again.", true); });
            }});
            inner2.appendChild(confirmBtn);
            inner2.appendChild(el("button", { className: "rl-btn ghost", text: "← Back", style: "margin-top:8px", onclick: showReasonPicker }));
            sheet.appendChild(inner2);
          }
        });
        inner.appendChild(btn);
      });
      inner.appendChild(el("button", { className: "rl-btn ghost", text: "Cancel", onclick: close }));
      sheet.appendChild(inner);
    }
    showReasonPicker();
  }

  var EXCHANGE_ERR = { out_of_stock: "That one has just sold out. Pick another.", already_sent: "This order has already been sent, so it can't be changed here. Use the shop's returns process instead.",
    different_price: "That option costs a different amount, which Relay can't handle yet.", shop_not_connected: "This shop isn't connected to Relay any more.",
    already_exchanged: "This item has already been exchanged.", already_returned: "You've started a return for this item, so it can't also be swapped.", not_your_order: "Relay couldn't match this order to you.", order_cancelled: "This order was cancelled.",
    card_needed: "Add a card first to pay the difference.", card_declined: "Your card didn't go through, so nothing changed. Try another card.",
    price_changed: "The price has just changed. Close this and look again.", outside_window: "It's more than 7 days since you bought this, so it can't be swapped through Relay.",
    order_not_complete: "This order isn't finished at the shop yet, so it can't be swapped." };
  function absPounds(m) { return "£" + (Math.abs(m) / 100).toFixed(2); }
  function openExchange(o, it, done) {
    open(function (sheet) {
      sheet.appendChild(el("h2", { text: "Exchange " + it.title, style: "margin:0 0 4px" }));
      sheet.appendChild(el("p", { className: "small muted", text: (o.store || "The shop") + " · you have " + (it.variant || "this item") + ". Choose what you'd like instead." }));
      var list = el("div", {}, [el("p", { text: "Checking what the shop has in stock…" })]); sheet.appendChild(list);
      var msg = el("div", { className: "rl-msg" }); sheet.appendChild(msg);
      api("/relay/my/exchange/options?orderId=" + encodeURIComponent(o.id) + "&lineId=" + encodeURIComponent(it.lineId)).then(function (r) {
        list.textContent = "";
        var opts = (r.ok && r.body && r.body.options) || [];
        if (!opts.length) { list.appendChild(el("p", { text: r.ok ? "This product has no other sizes or colours." : "Couldn't load the options." })); return; }
        var shop = o.store || "The shop", card = r.body.card;
        opts.forEach(function (x) {
          var d = x.priceDiffMinor || 0;
          var price = d > 0 ? " · " + absPounds(d) + " more" : d < 0 ? " · " + absPounds(d) + " less" : "";
          var b = el("button", { className: x.available ? "rl-btn" : "rl-btn ghost", disabled: !x.available && !x.needsCard, style: "margin:6px 0;text-align:left",
            text: x.title + (x.available ? price + (Number(x.quantity) <= 5 ? " · only " + x.quantity + " left" : " · in stock") : " · " + x.reason) });
          b.onclick = function () {
            if (x.needsCard) {
              list.textContent = ""; list.appendChild(el("p", { text: "Add a card to pay the " + absPounds(d) + " difference. Saving it charges nothing." }));
              addCard(list, function () { setTimeout(function () { close(); openExchange(o, it, done); }, 900); });
              return;
            }
            var viaShop = d > 0 && (x.payBy === "shopify" || x.payBy === "square");
            var what = d === 0 ? "Same price, nothing to pay or refund."
              : d > 0 && x.payBy === "square" ? "It costs " + absPounds(d) + " more. You'll pay the " + absPounds(d) + " to " + shop + " on Square's secure payment page, and the swap is confirmed once it's paid."
              : viaShop ? "It costs " + absPounds(d) + " more. " + shop + " will update your order and send you a link to pay the " + absPounds(d) + ", using any way of paying " + shop + " accepts. Your new " + (x.title || "item") + " is kept for you."
              : d > 0 ? "It costs " + absPounds(d) + " more. We'll take " + absPounds(d) + " from your " + (card ? cardText(card) : "card") + " only once the shop has updated your order. (Test mode: no real money.)"
              : "It costs " + absPounds(d) + " less. " + shop + " will refund the " + absPounds(d) + " to how you paid.";
            ask("Swap " + (it.variant || it.title) + " for " + x.title + "? " + what, viaShop ? "Swap, then pay " + absPounds(d) : d > 0 ? "Swap and pay " + absPounds(d) : "Yes, swap it", function () {
              list.querySelectorAll("button").forEach(function (n) { n.disabled = true; });
              say(msg, "Asking " + (o.store || "the shop") + " to update your order…");
              api("/relay/my/exchange", { method: "POST", body: { orderId: o.id, lineId: it.lineId, variantKey: x.key, agreedDiffMinor: d } }).then(function (res) {
                if (res.ok) {
                  say(msg, res.body.message); list.textContent = "";
                  // Shopify's own payment page for the extra, on the shop's checkout (opens in a new tab).
                  if (res.body.payUrl && /^https:\/\//.test(res.body.payUrl))
                    list.appendChild(el("a", { className: "rl-btn", href: res.body.payUrl, target: "_blank", rel: "noopener noreferrer", text: "Pay " + absPounds(d) + " to " + shop + " →", style: "text-align:center;text-decoration:none;margin-bottom:8px" }));
                  list.appendChild(el("button", { className: res.body.payUrl ? "rl-btn ghost" : "rl-btn", text: "Done", onclick: function () { close(); if (done) done(); } }));
                  return;
                }
                say(msg, EXCHANGE_ERR[res.body && res.body.error] || "The shop didn't accept the change. Please try again, or contact the shop.", true);
                list.querySelectorAll("button").forEach(function (n) { n.disabled = false; });
              });
            });
          };
          list.appendChild(b);
        });
      });
      sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Close", style: "margin-top:10px", onclick: close }));
    });
  }
  // Test shop tools (Square sandbox test orders, test refunds, card-only test payments) only for people testing Relay:
  // switched on from Profile → Testing, or with ?testing=1. Shoppers never see them.
  // The Market isn't part of the launch: it shows for people testing Relay and in the ?demo=1 walkthrough.
  function marketOn() { try { return testingOn() || /[?&]demo=1(&|$)/.test(location.search); } catch (e) { return false; } }
  function testingOn() {
    try { return /[?&]testing=1(&|$)/.test(location.search) || localStorage.getItem("relay-testing-tools") === "1"; } catch (e) { return false; }
  }
  function shortDate(d) {
    var t = new Date(d); if (isNaN(t)) return "";
    var o = { day: "numeric", month: "short" }; if (t.getFullYear() !== new Date().getFullYear()) o.year = "numeric";
    return t.toLocaleDateString("en-GB", o);
  }
  function initials(name) { return String(name || "Shop").split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join(""); }
  // One shop-confirmed item: picture, shop, what it is, price, where it's up to, and what you can do.
  function confirmedCard(o, it, redraw, deadline) {
    var card = el("div", { className: "rl-po" });
    var img = el("div", { className: "rl-po-img" });
    if (it.imageUrl && /^https:\/\//.test(it.imageUrl)) img.appendChild(el("img", { src: it.imageUrl, alt: "" })); else img.textContent = initials(o.store);
    var info = el("div", { className: "rl-po-info" }, [
      el("div", { className: "rl-po-shop", text: o.store || "Shop" }),
      el("h3", { text: it.title }),
      el("div", { className: "rl-po-meta", text: [it.variant, it.quantity > 1 ? "×" + it.quantity : null, shortDate(o.orderedAt)].filter(Boolean).join(" · ") })]);
    card.appendChild(el("div", { className: "rl-po-top" }, [img, info, el("div", { className: "rl-po-price", text: money(it.priceMinor, it.currency) })]));
    var status = function (text, done) { card.appendChild(el("div", { className: "rl-po-status" + (done ? "" : " wait"), text: text })); };
    var shopName = o.store || "the shop";
    if (deadline) card.appendChild(deadlineChip(deadline, "Swap or return by "));
    if (it.exchange && it.exchange.status === "awaiting_payment") status("Swapping" + (it.exchange.fromTitle ? " from " + it.exchange.fromTitle : "") + " to " + it.exchange.toTitle + " once you've paid the difference", false);
    else if (it.exchange) status("✓ Swapped" + (it.exchange.fromTitle ? " from " + it.exchange.fromTitle : "") + " to " + it.exchange.toTitle, true);
    var actions = el("div", { className: "rl-po-actions" });
    if (it.exchange && it.exchange.balance) {
      var bal = it.exchange.balance;
      if (bal.paid) status("✓ " + money(bal.owedMinor, it.currency) + " difference paid to " + shopName, true);
      else {
        status(money(bal.owedMinor, it.currency) + " still to pay " + shopName + " for the swap" + (bal.payUrl ? "." : ". Use the link in " + shopName + "'s email."), false);
        if (bal.payUrl && /^https:\/\//.test(bal.payUrl)) actions.appendChild(el("a", { className: "rl-po-primary", href: bal.payUrl, target: "_blank", rel: "noopener noreferrer", text: "Pay " + money(bal.owedMinor, it.currency) + " to " + shopName }));
      }
    }
    if (it.returnInfo) {
      var ri = it.returnInfo, refunded = ri.status === "refunded";
      status(refunded ? "✓ Refunded" + (ri.refundMinor ? " " + money(ri.refundMinor, it.currency) : "") + " by " + shopName + (ri.refundedAt ? " on " + shortDate(ri.refundedAt) : "")
        : "Return started · ref " + ri.ref + (ri.trackingNumber ? " · Royal Mail " + ri.trackingNumber : "") + ". Waiting for " + shopName + " to refund.", refunded);
      if (!refunded && o.testOrder && testingOn()) {
        var tm = el("div", { className: "rl-msg" });
        var tb = el("button", { className: "rl-po-secondary", text: "Test shop: refund it", onclick: function () {
          tb.disabled = true; say(tm, "Asking the test shop to refund it…");
          api("/relay/my/testing/square-refund", { method: "POST", body: { orderId: o.id, lineId: it.lineId } }).then(function (r) {
            tb.disabled = false;
            if (r.ok && r.body && r.body.refunded) { say(tm, "✓ Refunded by the test shop"); setTimeout(redraw, 1000); }
            else if (r.ok) say(tm, "The test shop has started the refund. Press again in a minute, or it'll show within the hour.");
            else say(tm, "The test shop couldn't refund it just now. Please try again in a minute.", true);
          }, function () { tb.disabled = false; say(tm, "Couldn't reach Relay. Please try again.", true); });
        } });
        actions.appendChild(tb); card.appendChild(tm);
      }
    }
    if (it.exchangeable) actions.appendChild(el("button", { className: "rl-po-primary", text: "Swap", title: "Swap for another size or colour", onclick: function () { openExchange(o, it, redraw); } }));
    if (it.returnable) actions.appendChild(el("button", { className: "rl-po-secondary", text: "Return", onclick: function () { openReturn(o, it, redraw); } }));
    if (actions.childNodes.length) card.appendChild(actions);
    return card;
  }
  // "Return by 14 Nov · 13 days left", red when it's close.
  function deadlineChip(dl, lead) {
    var d = daysLeft(dl), day = new Date(dl + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    var txt = (lead || "Return by ") + day + (d === null ? "" : d === 0 ? " · last day" : d === 1 ? " · 1 day left" : " · " + d + " days left");
    return el("div", { className: "rl-po-status " + (d !== null && d <= 3 ? "urgent" : "wait"), text: txt });
  }
  var label = function (t) { return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); };
  function receiptTitle(x) {
    var items = (x.items || []).filter(function (i) { return i.name; });
    if (!items.length) return "Order from " + ((x.retailer && x.retailer.name) || "this shop");
    return items[0].name + (items.length > 1 ? " + " + (items.length - 1) + " more" : "");
  }
  // A purchase found in an email receipt: the shop handles the return, so Relay links to it and shows the deadline and parcel.
  function emailCard(x, opts) {
    opts = opts || {};
    var who = (x.retailer && (x.retailer.name || x.retailer.domain)) || "Shop";
    var card = el("div", { className: "rl-po" });
    var img = el("div", { className: "rl-po-img", text: initials(who) });
    var logo = function () { shopLogo(img, x.retailer && x.retailer.domain, 44); };
    if ((x.items || []).length <= 1 && x.hasImage && x.id) apiBlob("/relay/my/receipts/" + x.id + "/image").then(function (u) { if (u) { img.textContent = ""; img.appendChild(el("img", { src: u, alt: "" })); } else logo(); });
    else logo();
    // One item of a multi-item order gets its own card (opts.item is its position on the receipt).
    var one = opts.item != null ? (x.items || [])[opts.item] : null;
    var first = one || (x.items || [])[0] || {};
    var date = x.orderDate ? new Date(x.orderDate + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null;
    var price = one ? (Number.isInteger(one.pricePence) ? money(one.pricePence * (Number(one.qty) > 1 && !one.lineTotal ? Number(one.qty) : 1), x.currency) : "") : x.totalPence == null ? "" : money(x.totalPence, x.currency);
    card.appendChild(el("div", { className: "rl-po-top" }, [img, el("div", { className: "rl-po-info" }, [
      el("div", { className: "rl-po-shop", text: who }), el("h3", { text: one ? one.name : receiptTitle(x) }),
      el("div", { className: "rl-po-meta", text: [first.variant, date, one && (x.items || []).length > 1 ? "1 of " + x.items.length + " in this order" : null].filter(Boolean).join(" · ") })]),
      el("div", { className: "rl-po-price", text: price })]));
    var dv = x.delivery;
    if (dv && dv.status && (dv.status === "delivered" || freshDelivery(x))) {
      var day = function (d) { return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }); };
      card.appendChild(el("div", { className: "rl-po-status" + (dv.status === "delivered" ? "" : " wait"), text: (dv.status === "delivered" ? "✓ Delivered" + (dv.at ? " " + day(dv.at) : "")
        : dv.status === "out_for_delivery" ? "Out for delivery" : dv.status === "due" ? "Due " + (dv.at ? day(dv.at) : "today") : "On its way") + (dv.carrier ? " · " + dv.carrier : "") }));
    }
    var dl = deadlineOf(x);
    if (opts.deadline !== false && dl) card.appendChild(deadlineChip(dl, x.returnBy && dl === x.returnBy.date ? "Return by at least " : "Return by "));
    if (opts.extra) opts.extra(card);
    var actions = el("div", { className: "rl-po-actions" });
    var portal = x.returns && x.returns.portalUrl;
    if (opts.actions !== false && portal && /^https:\/\//.test(portal))
      actions.appendChild(el("a", { className: "rl-po-primary", href: portal, target: "_blank", rel: "noopener noreferrer", text: "Return on " + (who.length <= 16 ? who + "'s site" : "the shop's site") + " ↗" }));
    actions.appendChild(el("button", { className: "rl-po-secondary", text: "Details", style: portal && opts.actions !== false ? "flex:0 0 96px" : "", onclick: function () {
      open(function (sheet) {
        sheet.appendChild(el("h2", { text: who, style: "margin:0 0 4px" }));
        sheet.appendChild(receiptCard(x, function () {}, true));
        if (dv && dv.trackUrl && /^https:\/\//.test(dv.trackUrl)) sheet.appendChild(el("a", { className: "rl-btn ghost", href: dv.trackUrl, target: "_blank", rel: "noopener noreferrer", text: "Track parcel ↗", style: "display:block;text-align:center;text-decoration:none;margin-top:10px" }));
        sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Close", style: "margin-top:10px", onclick: close }));
      });
    } }));
    card.appendChild(actions);
    // Many shops run their returns page through a returns company (Narvar, Loop, ZigZag…), so the address can look unfamiliar.
    if (opts.actions !== false && portal && /^https:\/\//.test(portal))
      card.appendChild(el("div", { text: "Opens the returns link from " + who + "'s own email. Some shops use a returns company, such as Narvar, to run this page.", style: "font-size:12px;color:#667085;margin-top:8px;line-height:1.4" }));
    // Tell Relay what's going back, so it moves to Returns & swaps and the rest of the order stays in the wallet.
    if (opts.markable && x.id) {
      var idxs = opts.item != null ? [opts.item] : (x.items || []).map(function (_, i) { return i; });
      if (!idxs.length) idxs = [0];
      card.appendChild(el("button", { type: "button", className: "rl-link", text: opts.markable === "undo" ? "Not sending this back" : "I'm sending this back", style: "all:unset;cursor:pointer;box-sizing:border-box;min-height:44px;line-height:44px;color:#46601b;font-weight:800;font-size:15px;margin-top:2px;display:inline-block;text-decoration:underline;text-underline-offset:3px",
        onclick: function (e) { var b = e.currentTarget; b.disabled = true; b.textContent = "Saving…";
          markItems(x, idxs, opts.markable === "undo" ? null : "returning").then(function (ok) { if (ok && opts.changed) opts.changed(); else { b.disabled = false; b.textContent = "Couldn't save. Try again"; } }); } }));
    }
    return card;
  }
  function markItems(x, idxs, status) {
    return api("/relay/my/receipts/" + x.id + "/items", { method: "POST", body: { items: idxs.map(function (i) { return { index: i, status: status }; }) } })
      .then(function (r) { memo.receipts = null; return r.ok; }, function () { return false; });
  }
  // The items of an email order, each with whether it's being sent back. Orders with one (or no) named item stay whole.
  function emailItems(x) {
    var named = (x.items || []).map(function (it, i) { return { it: it, i: i }; }).filter(function (e) { return e.it && e.it.name; });
    var marks = x.itemReturns || {};
    return named.map(function (e) { return { index: e.i, returning: marks[e.i] === "returning" }; });
  }
  function loadBoth() {
    var p = memo.purchases || api("/relay/my/purchases");
    return Promise.all([p.then(function (r) { return r.ok ? (r.body && r.body.purchases) || [] : null; }, function () { return null; }),
      api("/relay/my/receipts").then(function (r) { return r.ok ? (r.body && r.body.receipts) || [] : null; }, function () { return null; })]).then(function (both) {
      // Remember what came back, so the next visit shows it straight away.
      if (both[0]) { memo.walletPurchases = both[0]; diskWrite("purchases", both[0]); }
      if (both[1]) { memo.receipts = { rows: both[1], sig: JSON.stringify(both[1]), at: Date.now() }; diskWrite("receipts", both[1]); }
      return [both[0] || memo.walletPurchases || [], both[1] || (memo.receipts && memo.receipts.rows) || []];
    });
  }
  function orderRows(rows) { return rows.filter(function (x) { return x.kind !== "return_instructions" && x.kind !== "delivery_update" && x.kind !== "return_update"; }); }
  function notConfirmed(purchases) {
    var seen = {}; purchases.forEach(function (o) { seen[label(o.store) + "|" + o.amountMinor] = true; });
    return function (x) { return !seen[label(x.retailer && x.retailer.name) + "|" + x.totalPence]; };
  }
  function skeleton(host, n) { for (var i = 0; i < n; i++) host.appendChild(el("div", { className: "rl-po rl-skel" })); }
  // The wallet: everything you can still return or swap, newest deadline first, in one list. Everything else is in Receipts.
  function mountWallet(host, opts) {
    if (!host) return;
    opts = opts || {};
    host.textContent = "";
    var s = load();
    if (!s || !s.token) {
      host.appendChild(el("div", { className: "rl-empty" }, [el("h3", { text: "Sign in to see your purchases" }),
        el("p", { text: "Relay brings together what you've bought at shops on Relay and from your email receipts, so you can return or swap in a couple of taps." }),
        el("button", { className: "rl-po-primary", text: "Sign in", style: "max-width:220px", onclick: show })]));
      return;
    }
    var top = el("div"); host.appendChild(top);
    var refresh = function () { memo.purchases = null; memo.walletPurchases = null; memo.receipts = null; mountWallet(host, opts); };
    mountInstore(top, refresh, "suggest");
    var head = el("div", { className: "sectionhead" }, [el("h2", { text: opts.title || "Still returnable" })]);
    var grid = el("div", { className: "rl-po-grid" }); skeleton(grid, 3);
    host.appendChild(head);
    if (opts.sub) host.appendChild(el("p", { className: "small muted", text: opts.sub, style: "margin:-6px 0 12px" }));
    host.appendChild(grid);
    var foot = el("div"); host.appendChild(foot);
    // A new shopper with no email connected yet: the first thing they see is how to bring their receipts in.
    var start = el("div"); host.insertBefore(start, head);
    cachedGet("gmail", "/relay/my/gmail").then(function (g) {
      if (!g.ok || !g.body || g.body.connected || !document.body.contains(start)) return;
      start.appendChild(el("div", { className: "rl-po", style: "margin:0 0 16px;border:1.5px solid #cfe3a6;background:#fbfdf6" }, [
        el("h3", { text: "Bring in your receipts", style: "margin:0;font-size:19px" }),
        el("p", { text: "Connect Gmail or Outlook and Relay finds your order emails, keeps track of return deadlines and fills in your wallet.", style: "margin:0;color:#475467;font-size:15px;line-height:1.45" }),
        el("button", { className: "rl-po-primary", text: "Connect your email", style: "max-width:280px", onclick: function () { if (window.go) window.go("receipts"); } })]));
    }, function () {});
    // Draws what was loaded last time at once, then again only if something changed.
    var drawn = null;
    var sigOf = function (both) { try { return JSON.stringify(both); } catch (e) { return String(Math.random()); } };
    var drawBoth = function (both) {
      var sg = sigOf(both); if (sg === drawn) return; drawn = sg;
      var oldPill = head.querySelector(".pill"); if (oldPill) oldPill.remove();
      foot.textContent = "";
      var purchases = both[0], receipts = both[1], today = new Date().toISOString().slice(0, 10), items = [];
      purchases.forEach(function (o) { (o.items || []).forEach(function (it) {
        if (!it.returnable && !it.exchangeable) return;
        items.push({ deadline: new Date(Date.parse(o.orderedAt) + 7 * 864e5).toISOString().slice(0, 10), node: function () { return confirmedCard(o, it, refresh, this.deadline); } });
      }); });
      orderRows(receipts).filter(notConfirmed(purchases)).forEach(function (x) {
        if (x.returnable === false || isCarrier(x)) return;
        var dl = deadlineOf(x), onWay = freshDelivery(x);
        if (!((dl && dl >= today) || (onWay && !dl))) return;
        var parts = emailItems(x), anyMarked = parts.some(function (p) { return p.returning; });
        // A return is under way but Relay doesn't know which items: the Returns page asks, and nothing shows here meanwhile.
        if (x.returnProgress && !anyMarked) return;
        if (parts.length > 1) parts.forEach(function (p) { if (!p.returning) items.push({ deadline: dl, node: function () { return emailCard(x, { item: p.index, markable: true, changed: refresh }); } }); });
        else if (!anyMarked) items.push({ deadline: dl, node: function () { return emailCard(x, { markable: true, changed: refresh }); } });
      });
      items.sort(function (a, b) { return (a.deadline || "9999") < (b.deadline || "9999") ? -1 : 1; });
      grid.textContent = "";
      head.appendChild(el("span", { className: "pill", text: items.length + " item" + (items.length === 1 ? "" : "s") }));
      if (!items.length) grid.appendChild(el("div", { className: "rl-empty", style: "grid-column:1/-1" }, [el("h3", { text: "Nothing to return right now" }),
        el("p", { text: "Anything you can still return or swap shows up here. Everything you've bought is in Receipts." })]));
      items.forEach(function (i) { grid.appendChild(i.node()); });
      foot.appendChild(el("div", { className: "rl-po-actions", style: "margin:14px 0 6px;max-width:520px" }, [
        el("button", { className: "rl-po-secondary", text: "All receipts", onclick: function () { window.go && window.go("receipts"); } }),
        el("button", { className: "rl-po-secondary", text: "Returns & swaps", onclick: function () { window.go && window.go("returns"); } })]));
      var box = el("div", { style: "margin-top:10px" }); foot.appendChild(box); mountInstore(box, refresh, "box");
      if (testingOn()) { var t = el("div", { style: "margin-top:10px" }); foot.appendChild(t); mountSquareTest(t, refresh); }
    };
    if (memo.walletPurchases && memo.receipts) drawBoth([memo.walletPurchases, memo.receipts.rows]);
    loadBoth().then(function (both) { if (document.body.contains(grid)) drawBoth(both); });
  }
  function whichItems(x, parts, done) {
    var who = (x.retailer && x.retailer.name) || "this shop";
    var card = el("div", { className: "rl-po" }, [el("div", { className: "rl-po-shop", text: who }), el("h3", { text: "Which items did you send back?", style: "margin:4px 0 6px" }),
      el("p", { text: "Relay can see a return for this order but not which items were in it. Tick what you sent back and Relay will keep the rest in your wallet.", style: "font-size:14px;color:#475467;margin:0 0 10px" })]);
    var picks = {};
    parts.forEach(function (q) {
      var it = x.items[q.index];
      var box = el("input", { type: "checkbox", style: "width:20px;height:20px;accent-color:#101828" });
      box.onchange = function () { picks[q.index] = box.checked; save.disabled = !Object.keys(picks).some(function (k) { return picks[k]; }); };
      card.appendChild(el("label", { style: "display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid #eee;cursor:pointer;font-size:15px" }, [box,
        el("span", { text: it.name + (it.variant ? " · " + it.variant : ""), style: "flex:1" }), el("span", { text: Number.isInteger(it.pricePence) ? money(it.pricePence, x.currency) : "", style: "color:#667085" })]));
    });
    var save = el("button", { className: "rl-po-primary", text: "Save", disabled: true, style: "margin-top:10px", onclick: function () {
      save.disabled = true; save.textContent = "Saving…";
      markItems(x, Object.keys(picks).filter(function (k) { return picks[k]; }).map(Number), "returning").then(function (ok) { if (ok) done(); else { save.disabled = false; save.textContent = "Couldn't save. Try again"; } });
    } });
    card.appendChild(save);
    return card;
  }
  // Returns and swaps you've started, and where each one has got to.
  function mountReturns(host) {
    if (!host) return;
    host.textContent = "";
    var s = load(); if (!s || !s.token) { host.appendChild(el("p", { text: "Sign in to see your returns." })); return; }
    var grid = el("div", { className: "rl-po-grid" }); skeleton(grid, 2); host.appendChild(grid);
    var refresh = function () { memo.purchases = null; mountReturns(host); };
    loadBoth().then(function (both) {
      var items = [];
      both[0].forEach(function (o) { (o.items || []).forEach(function (it) { if (it.returnInfo || it.exchange) items.push({ at: o.orderedAt, node: function () { return confirmedCard(o, it, refresh); } }); }); });
      orderRows(both[1]).forEach(function (x) {
        var p = x.returnProgress, parts = emailItems(x), marked = parts.filter(function (q) { return q.returning; });
        if (!p && !marked.length) return;
        var step = !p ? "You're sending this back · Relay will update this when the shop's emails arrive"
          : p.refundedAt ? "✓ Refund processed" + (p.refundPence != null ? " · " + money(p.refundPence, p.currency || "GBP") : "")
          : p.receivedAt || (p.parcel && p.parcel.status === "delivered") ? "Arrived back at the shop · waiting for the refund" : "Sent back · on its way to the shop";
        var progress = function (card) { card.appendChild(el("div", { className: "rl-po-status" + (p && p.refundedAt ? "" : " wait"), text: step }));
          if (x.itemReturnsFrom === "refund") card.appendChild(el("div", { text: "Relay matched the refund amount to this item.", style: "font-size:12px;color:#667085;margin-top:6px" })); };
        // A return for an order with several items, and Relay can't tell which: ask once.
        if (p && parts.length > 1 && !marked.length) { items.push({ at: x.orderDate, node: function () { return whichItems(x, parts, refresh); } }); return; }
        if (parts.length > 1) marked.forEach(function (q) { items.push({ at: x.orderDate, node: function () { return emailCard(x, { item: q.index, deadline: false, actions: false, extra: progress, markable: p && p.refundedAt ? false : "undo", changed: refresh }); } }); });
        else items.push({ at: x.orderDate, node: function () { return emailCard(x, { deadline: false, actions: false, extra: progress, markable: p ? false : "undo", changed: refresh }); } });
      });
      items.sort(function (a, b) { return String(b.at || "").localeCompare(String(a.at || "")); });
      grid.textContent = "";
      if (!items.length) grid.appendChild(el("div", { className: "rl-empty", style: "grid-column:1/-1" }, [el("h3", { text: "No returns or swaps yet" }),
        el("p", { text: "When you start a return or swap, you can follow it here until the refund arrives." })]));
      items.forEach(function (i) { grid.appendChild(i.node()); });
    });
  }
  // Orders the shop confirmed. opts.limit: show only the newest few (the wallet), with a link to the rest.
  function mountConfirmed(host, opts) {
    if (!host) return;
    opts = opts || {};
    host.textContent = "";
    var s = load(); if (!s || !s.token) return;
    // The wallet can be drawn twice as the page settles: both share one request rather than asking the server twice.
    if (!memo.purchases) memo.purchases = api("/relay/my/purchases").then(function (r) { setTimeout(function () { memo.purchases = null; }, 1500); return r; }, function (e) { memo.purchases = null; throw e; });
    memo.purchases.then(function (r) {
      var rows = (r.ok && r.body && r.body.purchases) || [];
      var refresh = function () { memo.purchases = null; mountConfirmed(host, opts); };
      var inHost = el("div"); mountInstore(inHost, refresh);
      var testHost = el("div", { style: "margin-top:14px" });
      if (testingOn()) mountSquareTest(testHost, refresh);
      host.appendChild(inHost);
      if (rows.length) {
        var items = [];
        rows.forEach(function (o) { (o.items || []).forEach(function (it) { items.push([o, it]); }); });
        host.appendChild(el("div", { className: "sectionhead" }, [el("h2", { text: "Confirmed by the shop" }), el("span", { className: "pill", text: items.length + " item" + (items.length === 1 ? "" : "s") })]));
        host.appendChild(el("p", { className: "small muted", text: "Bought with your Relay email at shops on Relay, so you can swap or return them here." }));
        var grid = el("div", { className: "rl-po-grid" }); host.appendChild(grid);
        var shown = opts.limit ? items.slice(0, opts.limit) : items;
        shown.forEach(function (x) { grid.appendChild(confirmedCard(x[0], x[1], refresh)); });
        if (opts.limit && items.length > opts.limit && window.go)
          host.appendChild(el("button", { className: "rl-po-more", text: "See all " + items.length + " in Receipts →", onclick: function () { window.go("receipts"); } }));
      }
      host.appendChild(testHost);
    }).catch(function () {});
  }

  // ---- Bought in a shop: card-only purchases Relay thinks are yours ("Is this yours?"), and adding one from its receipt. ----
  function mountInstore(host, done, part) {
    api("/relay/my/instore/suggestions").then(function (r) {
      if (!r.ok) return;
      var list = part === "box" ? [] : (r.body && r.body.suggestions) || [];
      list.forEach(function (x) {
        var when = x.paidAt ? new Date(x.paidAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
        var card = el("div", { className: "rl-po", style: "margin:0 0 18px;border:2px solid #cfe3a6" });
        card.appendChild(el("div", { className: "eyebrow", text: "IS THIS YOURS?" }));
        card.appendChild(el("h3", { text: money(x.amountMinor, x.currency) + " at " + x.store, style: "margin:4px 0" }));
        card.appendChild(el("p", { className: "small muted", style: "margin:0 0 10px", text: when + (x.last4 ? " · " + (x.brand ? x.brand.charAt(0) + x.brand.slice(1).toLowerCase().replace(/_/g, " ") : "Card") + " ending " + x.last4 : "") +
          ". Paid in the shop with a card you've used there before. Say if it's yours and Relay adds it, with what you bought." }));
        var msg = el("div", { className: "rl-msg", style: "min-height:0;margin:0" });
        var send = function (ans) {
          yes.disabled = no.disabled = true;
          api("/relay/my/instore/suggestions/" + encodeURIComponent(x.id), { method: "POST", body: { answer: ans } }).then(function (a) {
            if (a.ok) { if (ans === "mine") { say(msg, "✓ Added to your purchases"); setTimeout(done, 900); } else card.remove(); }
            else { yes.disabled = no.disabled = false; say(msg, a.body && a.body.error === "already_claimed" ? "Someone else has already added this purchase." : "Couldn't save that. Please try again.", true); }
          }, function () { yes.disabled = no.disabled = false; say(msg, "Couldn't reach Relay. Please try again.", true); });
        };
        var yes = el("button", { className: "rl-po-primary", text: "Yes, it's mine", onclick: function () { send("mine"); } });
        var no = el("button", { className: "rl-po-secondary", text: "Not mine", onclick: function () { send("not_mine"); } });
        card.appendChild(el("div", { className: "rl-po-actions", style: "max-width:440px" }, [yes, no])); card.appendChild(msg);
        host.appendChild(card);
      });
      // Add a purchase from a shop receipt.
      var box = el("details", { className: "card", style: "padding:14px 16px;margin:0 0 12px" });
      box.appendChild(el("summary", { text: "Bought in a shop? Add it from the receipt", style: "font-weight:700;cursor:pointer" }));
      box.appendChild(el("p", { className: "small muted", style: "margin:8px 0 10px", text: "Pick the shop and enter what's on your receipt." }));
      var inp = function (ph, type, mode) { return el("input", { placeholder: ph, type: type || "text", inputMode: mode || "text", style: "width:100%;box-sizing:border-box;padding:10px;border-radius:12px;border:1px solid #ddd;font:inherit;margin-bottom:8px" }); };
      var shopSel = el("select", { style: "width:100%;padding:10px;border-radius:12px;border:1px solid #ddd;font:inherit;margin-bottom:8px" });
      var rn = inp("Receipt number (e.g. #A1b2)"), amt = inp("Amount paid, e.g. 29.99", "text", "decimal"), dt = inp("Date", "date"), l4 = inp("Last 4 digits of your card", "text", "numeric");
      var cmsg = el("div", { className: "rl-msg" });
      var go = el("button", { className: "darkbtn", text: "Find my purchase", onclick: function () {
        var pounds = Number(String(amt.value).replace(/[£,\s]/g, ""));
        if (!(pounds > 0) || !/^\d{4}$/.test(l4.value.trim()) || !dt.value || !rn.value.trim()) return say(cmsg, "Please fill in all four from your receipt.", true);
        go.disabled = true; say(cmsg, "Looking for it…");
        api("/relay/my/instore/claim", { method: "POST", body: { locationId: shopSel.value, receiptNumber: rn.value.trim(), amountMinor: Math.round(pounds * 100), date: dt.value, last4: l4.value.trim() } }).then(function (c) {
          go.disabled = false;
          if (c.ok) { say(cmsg, "✓ Found it and added it to your purchases"); setTimeout(done, 900); return; }
          var e = c.body && c.body.error;
          say(cmsg, e === "no_match" ? "No purchase matches all of those. Check the receipt number, amount, date and card." : e === "already_claimed" ? "That purchase is already in someone else's Relay."
            : e === "too_many_tries" ? "That's 10 tries today. Please try again tomorrow." : "Couldn't look just now. Please try again.", true);
        }, function () { go.disabled = false; say(cmsg, "Couldn't reach Relay. Please try again.", true); });
      } });
      [shopSel, rn, amt, dt, l4, go, cmsg].forEach(function (n) { box.appendChild(n); });
      // Only offered when there are real shops to find a purchase in (Square's test shops are for people testing Relay).
      if (part !== "suggest") cachedGet("instoreShops", "/relay/my/instore/shops").then(function (sh) {
        var list = (sh.ok && sh.body && sh.body.shops) || [];
        if (!list.length || !(sh.body.live || testingOn())) return;
        list.forEach(function (o) { shopSel.appendChild(el("option", { value: o.id, text: o.name })); });
        host.appendChild(box);
      }, function () {});
    }).catch(function () {});
  }

  // ---- Test orders at Relay's Square test shop (only while Relay uses Square's sandbox; no card, no real money). ----
  function mountSquareTest(host, done) {
    api("/relay/my/testing/square-items").then(function (r) {
      var items = (r.ok && r.body && r.body.items) || [];
      if (!items.length) return;
      var card = el("details", { className: "card", style: "padding:14px 16px" });
      card.appendChild(el("summary", { text: "Testing: place a test order", style: "font-weight:700;cursor:pointer" }));
      card.appendChild(el("p", { className: "small muted", style: "margin:8px 0 10px", text: "Places an order at " + (r.body.store || "Relay's test shop") +
        " (a Square test shop) under your Relay email, paid with Square's test payment. No card is needed and no real money moves. Up to 5 a day." }));
      var pick = el("select", { style: "width:100%;padding:10px;border-radius:12px;border:1px solid #ddd;font:inherit;margin-bottom:8px" });
      items.forEach(function (i) {
        pick.appendChild(el("option", { value: i.variationId, text: i.product + (i.variant && !/^(default|regular)$/i.test(i.variant) ? " · " + i.variant : "") + " · " + money(i.priceMinor, "GBP") +
          (i.inStock ? "" : " · out of stock") }));
      });
      var msg = el("div", { className: "rl-msg" });
      var go = el("button", { className: "darkbtn", text: "Place test order", onclick: function () {
        go.disabled = true; say(msg, "Placing your test order…");
        api("/relay/my/testing/square-order", { method: "POST", body: { variationId: pick.value } }).then(function (p) {
          go.disabled = false;
          if (p.ok && p.body && p.body.ok) { say(msg, "✓ " + p.body.message); setTimeout(done, 1200); return; }
          var e = p.body && p.body.error;
          say(msg, e === "too_many_test_orders" ? "That's 5 test orders today. Try again tomorrow." : "The test shop didn't take the order. Please try again in a minute.", true);
        }, function () { go.disabled = false; say(msg, "Couldn't reach Relay. Please try again.", true); });
      } });
      var tapBtn = el("button", { className: "ghostbtn", text: "Pay in the shop with a card (test)", style: "margin-left:8px", onclick: function () {
        tapBtn.disabled = true; say(msg, "Paying at the test shop's till…");
        api("/relay/my/testing/square-tap", { method: "POST", body: { variationId: pick.value } }).then(function (p) {
          tapBtn.disabled = false;
          if (p.ok && p.body && p.body.ok) { say(msg, p.body.message + (p.body.receiptNumber ? " Receipt number: " + p.body.receiptNumber + "." : "")); if (p.body.suggested) setTimeout(done, 1500); return; }
          say(msg, p.body && p.body.error === "too_many_test_orders" ? "That's 5 test orders today. Try again tomorrow." : "The test shop didn't take the payment. Please try again in a minute.", true);
        }, function () { tapBtn.disabled = false; say(msg, "Couldn't reach Relay. Please try again.", true); });
      } });
      card.appendChild(el("p", { className: "small muted", style: "margin:0 0 8px", text: "Or pay at the till with just a card (no email), like most shop purchases. Relay suggests it to you if it knows the card from an earlier order." }));
      card.appendChild(pick); card.appendChild(go); card.appendChild(tapBtn); card.appendChild(msg);
      host.appendChild(card);
    }).catch(function () {});
  }

  // ---- Offers: shops can send Relay watchers a lower price on an item. Shown here while they last (also sent as phone alerts). ----
  function pounds(m) { return "£" + (Number(m) / 100).toFixed(2); }
  function mountOffers(host) {
    var wrap = el("div", { style: "margin-top:16px" }); host.appendChild(wrap);
    api("/relay/my/alerts/offers").then(function (r) {
      var list = r.ok && r.body && r.body.offers || [];
      if (!list.length) return;
      var card = el("div", { className: "card" }); wrap.appendChild(card);
      card.appendChild(el("h3", { text: "Offers for you", style: "margin:0 0 4px" }));
      card.appendChild(el("p", { className: "small muted", style: "margin:0 0 10px", text: "Shops sent these to people watching their items. The shop honours the price; Relay doesn't take payment." }));
      list.forEach(function (o) {
        var ends = new Date(o.endsAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
        var row = el("div", { style: "display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px solid #eee" });
        if (o.imageUrl && /^https:\/\//.test(o.imageUrl)) row.appendChild(el("img", { src: o.imageUrl, alt: "", style: "width:56px;height:56px;border-radius:12px;object-fit:cover;flex:none;background:#f3f1ec" }));
        var txt = el("div", { style: "flex:1;min-width:0" });
        txt.appendChild(el("div", { className: "eyebrow", text: String(o.store || "").toUpperCase() }));
        txt.appendChild(el("strong", { text: o.product + (o.variant ? " · " + o.variant : "") }));
        txt.appendChild(el("div", { className: "small", text: pounds(o.offerMinor) + " (usually " + pounds(o.wasMinor) + ") · ends " + ends }));
        if (o.note) txt.appendChild(el("div", { className: "small muted", text: o.note }));
        row.appendChild(txt);
        card.appendChild(row);
      });
    }).catch(function () {});
  }
  function mountAlerts(host) {
    host.textContent = "";
    var box = el("div", { className: "card" }); host.appendChild(box);
    box.appendChild(el("h3", { text: "Phone alerts", style: "margin:0 0 6px" }));
    var s = load();
    if (!s || !s.token) {
      box.appendChild(el("p", { text: "Sign in to get a message on your phone when something you watch drops in price.", className: "sub" }));
      box.appendChild(el("button", { className: "rl-btn", text: "Sign in", style: "max-width:240px", onclick: show }));
      return;
    }
    mountOffers(host);
    if (!pushOk()) {
      box.appendChild(el("p", { className: "sub", text: "This browser can't receive alerts. On an iPhone: open Relay in Safari, tap Share, choose Add to Home Screen, then open Relay from your home screen and come back here." }));
      return;
    }
    var msg = el("p", { className: "small muted", style: "min-height:18px;margin:10px 0 0" });
    var body = el("div", {}, [el("div", { className: "rl-skel", style: "min-height:48px;border-radius:14px" })]);
    box.appendChild(body); box.appendChild(msg);
    function draw() {
      Promise.all([thisDevice(), alertStatus()]).then(function (r) {
        var sub = r[0], st = r[1]; body.textContent = "";
        if (Notification.permission === "denied") { body.appendChild(el("p", { className: "sub", text: "Alerts are blocked for Relay in this browser. Allow notifications for this site in your browser or phone settings, then come back." })); return; }
        var on = Boolean(sub) && st && st.devices > 0;
        if (!on) {
          body.appendChild(el("p", { className: "sub", text: "Get a message on this device when a product you watch (or any product at a shop you choose) drops in price. Nothing is sent unless you turn this on, and you can turn it off any time." }));
          body.appendChild(el("button", { className: "rl-btn", text: "Turn on alerts", style: "max-width:240px", onclick: function () {
            say(msg, "Asking your device…");
            enablePush().then(function (x) { if (x.ok) { say(msg, "Alerts are on. Send yourself a test to make sure they reach you."); draw(); } else say(msg, x.reason === "denied" ? "You said no, so nothing was turned on." : "Couldn't turn alerts on just now. Please try again.", true); });
          } }));
          return;
        }
        body.appendChild(el("p", { className: "sub", text: "✓ Alerts are on for this device. Watching " + st.watches.length + " item" + (st.watches.length === 1 ? "" : "s") + (st.stores.length ? " and every product at: " + st.stores.join(", ") : "") + "." }));
        // Two choices: just the watchlist, or price drops at every connected shop.
        var modes = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 12px" });
        [["watchlist", "Only my watchlist"], ["all", "Price drops at every shop"]].forEach(function (mode) {
          var on = (mode[0] === "all") === Boolean(st.allShops);
          modes.appendChild(el("button", { className: "toggle" + (on ? " on" : ""), text: (on ? "✓ " : "") + mode[1], onclick: function () {
            api("/relay/my/alerts/mode", { method: "POST", body: { mode: mode[0] } }).then(function (x) { if (x.ok) { memoDrop("alerts"); draw(); say(msg, mode[0] === "all" ? "You'll get an alert when anything drops in price at any shop connected to Relay." : "You'll only get alerts for items on your watchlist (and shops you follow)."); } });
          } }));
        });
        body.appendChild(modes);
        var row = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" });
        row.appendChild(el("button", { className: "rl-btn", text: "Send a test alert", style: "width:auto", onclick: function () {
          say(msg, "Sending…");
          api("/relay/my/push/test", { method: "POST" }).then(function (x) { say(msg, x.ok && x.body.sent ? "Sent. It should appear on this device in a few seconds." : x.status === 429 ? "Give it a few seconds, then try again." : "It couldn't be delivered. Try turning alerts off and on again.", !(x.ok && x.body.sent)); });
        } }));
        row.appendChild(el("button", { className: "rl-btn ghost", text: "Check prices now", style: "width:auto", onclick: function () {
          say(msg, "Checking the shops…");
          api("/relay/my/alerts/check", { method: "POST" }).then(function (x) {
            if (x.status === 429) return say(msg, "Just checked. Try again in a few seconds.");
            if (!x.ok) return say(msg, "Couldn't check just now.", true);
            say(msg, "Checked " + x.body.checked + " item" + (x.body.checked === 1 ? "" : "s") + ". " + (x.body.drops ? x.body.drops + " price drop" + (x.body.drops === 1 ? "" : "s") + ", " + x.body.sent + " alert" + (x.body.sent === 1 ? "" : "s") + " sent." : "No price drops."));
          });
        } }));
        row.appendChild(el("button", { className: "rl-btn ghost", text: "Turn off", style: "width:auto", onclick: function () { disablePush().then(function () { say(msg, "Alerts are off for this device."); draw(); }); } }));
        body.appendChild(row);
        body.appendChild(el("p", { className: "small muted", style: "margin-top:10px", text: "Prices are compared whenever a connected shop updates its catalogue, and every hour. Only shops connected to Relay have prices to watch." }));
      });
    }
    draw();
  }
  window.RelayAccount = { open: show, testingOn: testingOn, mountWallet: mountWallet, mountReturns: mountReturns, email: function () { var x = load(); return (x && x.email) || ""; }, mountConfirmed: mountConfirmed, mountAlerts: mountAlerts, enablePush: enablePush, syncWatch: syncWatch, syncStore: syncStore, alertStatus: alertStatus, tasteRows: function () { return cachedGet("taste", "/relay/my/style").then(function (r) { return r.ok ? (r.body.receipts || []) : []; }); }, mountWrapped: mountWrapped, mountMarket: mountMarket, mountDemoMarket: mountDemoMarket, mountReceipts: mountReceipts, mountProfile: mountProfile, editProfile: editProfile, profile: function () { return profileNow(); }, onProfile: function (f) { profileWatchers.push(f); loadProfile(); }, open: function () { show(); }, signedIn: function () { var s = load(); return Boolean(s && s.token); }, receipts: function () { return api("/relay/my/receipts"); },
    // Orders the shop confirmed (shares the wallet's request when one is already on its way).
    purchases: function () { return (memo.purchases || api("/relay/my/purchases")).then(function (r) { return (r.ok && r.body && r.body.purchases) || []; }, function () { return []; }); } };
  function keyboardWatch() {
    var vv = window.visualViewport; if (!vv || window.__rlKb) return; window.__rlKb = true;
    var fit = function () { var kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)); document.documentElement.style.setProperty("--rl-kb", (kb > 60 ? kb : 0) + "px"); };
    vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); fit();
    document.addEventListener("focusin", function (e) {
      var t = e.target; if (!t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      setTimeout(function () { try { t.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (x) {} }, 300);
    });
  }
  function start() { keyboardWatch(); if (load()) keepStorage(); bind(); completeGoogleNote(); completeLinkSignIn(); completeGmail(); window.addEventListener("hashchange", function () { completeGoogleNote(); completeLinkSignIn(); completeGmail(); }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();

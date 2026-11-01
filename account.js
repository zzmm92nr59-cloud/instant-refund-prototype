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
  function memoReset() { memo = { blobs: {}, consent: null, gmail: null, receipts: null, openCat: null, openIds: {} }; }
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
  function save(v) { if (!v) { memoReset(); try { localStorage.removeItem(MAILBOX_KEY); localStorage.removeItem(PROFILE_KEY); } catch (e) {} } try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (e) {} if (!v) paintAvatars(); }
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
    ".rl-po-img img{width:100%;height:100%;object-fit:cover}" +
    ".rl-po-shop{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#526549}" +
    ".rl-po h3{font-size:17px;line-height:1.25;margin:3px 0 2px;color:#101828}.rl-po-meta{font-size:13px;color:#667085}" +
    ".rl-po-price{font-weight:800;font-size:17px;white-space:nowrap;color:#101828}" +
    ".rl-po-status{font-size:13px;line-height:1.4;padding:8px 11px;border-radius:12px;background:#eef6df;color:#3f5a17}.rl-po-status.wait{background:#f4f2ec;color:#475467}" +
    ".rl-po-actions{display:flex;gap:8px;flex-wrap:wrap}" +
    ".rl-po-primary,.rl-po-secondary{flex:1 1 130px;padding:10px 14px;border-radius:999px;font-weight:700;font-size:14px;border:1.5px solid #101828;text-align:center;text-decoration:none;cursor:pointer}" +
    ".rl-po-primary{background:#101828;color:#fff}.rl-po-secondary{background:#fff;color:#101828}.rl-po-primary:disabled,.rl-po-secondary:disabled{opacity:.6}" +
    ".rl-wr-years{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}.rl-wr-years button{all:unset;cursor:pointer;padding:7px 16px;border-radius:999px;border:1px solid #d9d3c4;font-weight:800;font-size:14px;background:#fff;color:#101828}.rl-wr-years button.on{background:#101828;color:#c7f567;border-color:#101828}" +
    ".rl-wr-cover{position:relative;overflow:hidden;border-radius:28px;padding:30px 28px;background:radial-gradient(120% 140% at 100% 0%,#5b21b6 0%,#30255d 35%,#101828 75%);color:#fff;margin-bottom:16px}.rl-wr-cover h2{font-size:clamp(30px,4vw,44px);letter-spacing:-1.5px;line-height:1.05;margin:10px 0;color:#fff;max-width:560px}.rl-wr-cover p{color:#d4d4e5;margin:0 0 18px;font-size:15px}.rl-wr-kicker{color:#c7f567;font-size:12px;font-weight:900;letter-spacing:2px}" +
    ".rl-wr-play{all:unset;cursor:pointer;background:#c7f567;color:#16210a;font-weight:900;padding:14px 26px;border-radius:999px;font-size:16px;box-shadow:0 10px 30px rgba(199,245,103,.25)}.rl-wr-play:hover{transform:translateY(-1px)}" +
    ".rl-wr-glance{background:#fff;border:1px solid #ebe6da;border-radius:24px;padding:20px;margin-bottom:16px}.rl-wr-glance h3{margin:0 0 12px;font-size:18px;color:#101828}.rl-wr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}.rl-wr-stats div{background:#f7f5ef;border-radius:16px;padding:14px}.rl-wr-stats span{display:block;font-size:12px;color:#667085;font-weight:700}.rl-wr-stats strong{display:block;font-size:20px;color:#101828;margin:4px 0;word-break:break-word}.rl-wr-stats small{font-size:12px;color:#667085}.rl-wr-note{font-size:12px;color:#667085;margin:12px 0 0}" +
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
    ".rl-wr-strip{display:flex;gap:8px;overflow-x:auto;margin:4px 0 2px}.rl-wr-strip figure{margin:0;flex:none;width:96px}.rl-wr-strip .im{width:96px;height:96px;border-radius:14px;background:#f4f1ea;overflow:hidden}.rl-wr-strip img{width:100%;height:100%;object-fit:contain}.rl-wr-strip figcaption{font-size:11px;color:#475467;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".rl-story-slide .sum{background:linear-gradient(160deg,#5b21b6,#30255d 60%,#172554);border-radius:24px;padding:22px}.rl-story-slide .sumgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}.rl-story-slide .sumgrid span{display:block;font-size:12px;opacity:.75;font-weight:700}.rl-story-slide .sumgrid strong{display:block;font-size:20px;word-break:break-word}.rl-story-slide .acts{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}.rl-story-slide .acts button{all:unset;cursor:pointer;background:#c7f567;color:#16210a;font-weight:900;padding:12px 20px;border-radius:999px}.rl-story-slide .acts button.ghost{background:transparent;color:inherit;border:1px solid rgba(255,255,255,.4)}" +
    ".rl-po-status.urgent{background:#fde7e4;color:#a5281d}.rl-skel{min-height:132px;background:linear-gradient(90deg,#f4f2ec,#fbfaf6,#f4f2ec);background-size:200% 100%;animation:rlsk 1.2s infinite}@keyframes rlsk{to{background-position:-200% 0}}" +
    ".rl-empty{background:#fff;border:1px dashed #d9d3c4;border-radius:22px;padding:22px}.rl-empty h3{margin:0 0 6px;font-size:18px;color:#101828}.rl-empty p{margin:0 0 12px;color:#475467;font-size:14px}" +
    ".rl-cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));grid-auto-rows:1fr;gap:12px;margin-top:8px}" +
    ".rl-face{display:inline-grid;place-items:center;border-radius:50%;overflow:hidden;background:#e9efd6;color:#2b3d12;font-weight:900;line-height:1;flex:none;box-shadow:0 0 0 1px rgba(16,24,40,.06)}.rl-face img{width:100%;height:100%;object-fit:cover;display:block}" +
    ".avatar.rl-has-photo{width:38px;height:38px;padding:0;box-sizing:border-box;background-size:cover;background-position:center;background-repeat:no-repeat}" +
    ".rl-po-more{margin:6px 0 4px;padding:10px 16px;border-radius:999px;border:1.5px solid #101828;background:#fff;font-weight:700;cursor:pointer}" +
    ".rl-order b{display:block}.rl-order span{color:#5b6475;font-size:14px}";
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
  function firstLetter(p) { var t = String((p && (p.name || p.email)) || "").trim(); return t ? Array.from(t)[0].toUpperCase() : "R"; }
  // A round picture of the shopper: their photo, or the first letter of their name (or email).
  function face(p, px) {
    var n = el("span", { className: "rl-face", style: "width:" + px + "px;height:" + px + "px;font-size:" + Math.round(px * 0.42) + "px" });
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
  function mountProfile(host) {
    if (!host) return;
    function draw() {
      if (!document.body.contains(host)) return false;
      host.textContent = "";
      var p = profileNow();
      if (!p) return;
      host.appendChild(el("div", { style: "display:flex;gap:16px;align-items:center;margin:0 0 12px" }, [
        el("button", { type: "button", ariaLabel: p.photo ? "Change your photo" : "Add a photo", style: "all:unset;cursor:pointer;border-radius:50%;flex:none", onclick: editProfile }, [face(p, 64)]),
        el("div", { style: "min-width:0" }, [
          el("div", { className: "eyebrow", text: "SIGNED IN" }),
          el("h2", { text: p.name || p.email, style: "margin:2px 0 2px;word-break:break-word" }),
          el("div", { className: "small muted", text: p.name ? p.email : "Add your name and a photo so Relay feels like yours.", style: "word-break:break-all" })])]));
      host.appendChild(el("button", { type: "button", className: "outline", text: p.name || p.photo ? "Edit profile" : "Add name and photo", onclick: editProfile }));
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

  function signedOutView(sheet) {
    var input = el("input", { type: "email", placeholder: "you@example.com", autocomplete: "email", inputMode: "email" });
    var msg = el("div", { className: "rl-msg" });
    var go = el("button", { className: "rl-btn", text: "Email me a sign-in link" });
    go.onclick = function () {
      go.disabled = true; say(msg, "Sending…");
      api("/relay/auth/request", { method: "POST", body: { email: input.value } }).then(function (r) {
        go.disabled = false;
        if (r.ok) {
          say(msg, "Check your inbox. Open the link, or type the 6-digit code below. Both work once and expire in 15 minutes.");
          codeRow.style.display = "block";
        }
        else say(msg, errors[r.body.error] || "Something went wrong. Please try again.", true);
      }).catch(function () { go.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
    };
    var codeIn = el("input", { type: "text", placeholder: "6-digit code", autocomplete: "one-time-code", inputMode: "numeric", maxLength: 7 });
    var codeGo = el("button", { className: "rl-btn", text: "Sign in with code" });
    var codeRow = el("div", { style: "display:none;margin-top:12px" }, [codeIn, codeGo]);
    codeGo.onclick = function () {
      codeGo.disabled = true; say(msg, "Checking…");
      api("/relay/auth/verify-code", { method: "POST", body: { email: input.value, code: codeIn.value } }).then(function (r) {
        codeGo.disabled = false;
        if (!r.ok) return say(msg, errors[r.body.error] || "Something went wrong. Please try again.", true);
        if (r.body.needsSecondStep) return secondStepView(sheet, r.body.pendingToken);
        save({ token: r.body.sessionToken, email: r.body.email, expiresAt: r.body.expiresAt });
        keepStorage();
        paintAvatars(); loadProfile();
        show();
      }).catch(function () { codeGo.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
    };
    [el("h2", { text: "Sign in to Relay" }),
     el("p", { text: "No password. We email you a one-time link. Purchases you made with that email address appear in your wallet." }),
     input, go, codeRow, msg, el("button", { className: "rl-btn ghost", text: "Close", onclick: close })].forEach(function (n) { sheet.appendChild(n); });
    var gb = googleButton(msg);
    sheet.insertBefore(gb, sheet.children[2]);
    if (passkeysSupported()) sheet.insertBefore(el("div", { style: "margin-top:10px" }, [passkeyButton(msg)]), sheet.children[3]);
    sheet.insertBefore(el("p", { text: "or", style: "text-align:center;opacity:.6;margin:8px 0" }), sheet.children[passkeysSupported() ? 4 : 3]);
    // Outlook, Hotmail and Live users: shown only once Microsoft sign-in is switched on.
    signInProviders().then(function (p) {
      if (p && p.microsoft && gb.parentNode === sheet) sheet.insertBefore(el("div", { style: "margin-top:10px" }, [microsoftButton(msg, sheet, p.consent)]), gb.nextSibling);
    });
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
  // One step for Outlook users: Relay's wording is shown here first, and agreeing signs in and connects Outlook (read-only) together.
  // Without the wording (an older server), the button only signs in.
  function microsoftButton(msg, sheet, consent) {
    var b = el("button", { className: "rl-btn", text: "Continue with Microsoft", style: "background:#fff;color:#1f1f1f;border:1px solid #8c8c8c" });
    function go(button, note, body) {
      button.disabled = true; say(note, "Opening Microsoft…");
      var nonce = newNonce();
      try { localStorage.setItem("relay_gnonce", nonce); } catch (e) { button.disabled = false; return say(note, "Your browser is blocking storage, so Microsoft sign-in can't work here. Use the email link instead.", true); }
      api("/relay/auth/microsoft/start", { method: "POST", body: Object.assign({ nonce: nonce }, body) }).then(function (r) {
        if (r.ok && r.body && /^https:\/\/login\.microsoftonline\.com\//.test(r.body.url || "")) { location.href = r.body.url; return; }
        button.disabled = false; say(note, r.status === 503 ? "Microsoft sign-in isn't switched on yet. Use the email link instead." : "Couldn't start Microsoft sign-in. Try again, or use the email link.", true);
      }).catch(function () { button.disabled = false; say(note, "Couldn't reach Relay. Check your connection.", true); });
    }
    b.onclick = function () {
      if (!consent || !sheet || !consent.text) return go(b, msg, {});
      sheet.textContent = "";
      var note = el("div", { className: "rl-msg" });
      var agree = el("button", { className: "rl-btn", text: "Agree and continue with Microsoft" });
      agree.onclick = function () { go(agree, note, { consentVersion: consent.version }); };
      sheet.appendChild(el("h2", { text: "Continue with Microsoft" }));
      sheet.appendChild(el("p", { text: "Sign in with your Outlook account and Relay finds your receipts straight away, in one step." }));
      var words = el("div", { style: "background:#f7f5ef;border-radius:16px;padding:12px 14px;margin:0 0 14px;max-height:34vh;overflow:auto" });
      consent.text.forEach(function (t) { words.appendChild(el("p", { text: t, style: "font-size:13px;margin:0 0 8px" })); });
      sheet.appendChild(words); sheet.appendChild(agree); sheet.appendChild(note);
      sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Back", onclick: function () { open(signedOutView); } }));
    };
    return b;
  }
  // Identity only: Google tells Relay your verified email. Relay gets no access to Gmail from this button.
  function googleButton(msg) {
    var b = el("button", { className: "rl-btn", text: "Continue with Google", style: "background:#fff;color:#1f1f1f;border:1px solid #dadce0" });
    b.onclick = function () {
      b.disabled = true; say(msg, "Opening Google…");
      var nonce = newNonce();
      try { localStorage.setItem("relay_gnonce", nonce); } catch (e) { b.disabled = false; return say(msg, "Your browser is blocking storage, so Google sign-in can't work here. Use the email link instead.", true); }
      api("/relay/auth/google/start", { method: "POST", body: { nonce: nonce } }).then(function (r) {
        if (r.ok && r.body && /^https:\/\/accounts\.google\.com\//.test(r.body.url || "")) { location.href = r.body.url; return; }
        b.disabled = false; say(msg, r.status === 503 ? "Google sign-in isn't switched on yet. Use the email link instead." : "Couldn't start Google sign-in. Try again, or use the email link.", true);
      }).catch(function () { b.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
    };
    return b;
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
    var b = el("button", { className: "rl-btn", text: "Sign in with Face ID / passkey" });
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
          save({ token: v.body.sessionToken, email: v.body.email, expiresAt: v.body.expiresAt });
          keepStorage();
          paintAvatars(); loadProfile();
          show();
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
      box.textContent = "";
      box.appendChild(el("h2", { text: "Card for swaps", style: "font-size:18px;margin-top:8px" }));
      box.appendChild(el("span", { text: "TEST MODE · no real money", style: "display:inline-block;margin-bottom:6px;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800;background:#fff3d7;color:#7a540c" }));
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
        save({ token: r.body.sessionToken, email: r.body.email, expiresAt: r.body.expiresAt });
        keepStorage();
        paintAvatars(); loadProfile();
        show();
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
    sheet.appendChild(el("p", { text: "Loading…" }));
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
    if (!slim && dv && dv.status) {
      var day = function (d) { return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); };
      var today = new Date().toISOString().slice(0, 10);
      var said = dv.status === "delivered" ? "Delivered" + (dv.at ? " " + (dv.at === today ? "today" : day(dv.at)) : "") :
        dv.status === "out_for_delivery" ? "Out for delivery" : dv.status === "due" ? (dv.at && dv.at !== today ? "Due " + day(dv.at) : "Due today") : "On its way";
      var dl = el("div", { style: "clear:both;margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px" }, [
        el("span", { text: (dv.status === "delivered" ? "✓ " : "📦 ") + said + (dv.carrier ? " · " + dv.carrier : ""),
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
    if (left !== null && left < 0 && x.id && x.kind !== "return_instructions" && (x.items || []).length && openResale) {
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
      rb.appendChild(el("span", { text: "Read from the email. Check it matches the store's own policy.", style: "display:block;margin-top:6px;opacity:.7;font-size:12px" }));
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
      api("/relay/my/gmail/disconnect", { method: "POST" }).then(function (x) { if (x.ok) { memo.gmail = null; memo.receipts = null; memo.openCat = null; rememberMailbox({ connected: false }); done(); } else say(msg, "Couldn't disconnect. Try again.", true); });
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
      // One tidy line per receipt: picture, shop name (opens the original email), what was bought, price and date.
      function receiptRow(row) {
        var who = (row.retailer && (row.retailer.name || row.retailer.domain)) || "Unknown store";
        var names = (row.items || []).map(function (i) { return i.name + (i.variant && (row.items || []).length === 1 ? " · " + i.variant : ""); }).join(", ");
        var wrap = el("div", { className: "rl-order", style: "padding:12px" });
        var top = el("div", { style: "display:flex;gap:12px;align-items:center" });
        var thumb = el("div", { style: "flex:0 0 56px;width:56px;height:56px;border-radius:14px;background:#f1ecdf;display:flex;align-items:center;justify-content:center;overflow:hidden;font-weight:800;font-size:22px;color:#46601b" }, [el("span", { text: who.charAt(0).toUpperCase() })]);
        var single = (row.items || []).length <= 1;
        if (single && row.hasImage && row.id) {
          var im = el("img", { alt: "", style: "width:56px;height:56px;object-fit:cover" });
          apiBlob("/relay/my/receipts/" + row.id + "/image").then(function (u) { if (u) { thumb.textContent = ""; im.src = u; thumb.appendChild(im); } else showLogo(); });
        } else showLogo();
        // More than one product (or no photo): the store's own logo, fetched once from the store's website.
        function showLogo() {
          var dom = row.retailer && row.retailer.domain;
          if (!dom || !/^[A-Za-z0-9.-]{3,80}$/.test(dom)) return;
          var known = Object.keys(STORE_LOGOS).filter(function (k) { return dom === k || dom.slice(-(k.length + 1)) === "." + k; })[0];
          if (known) {
            var pic = el("img", { alt: "", style: "width:40px;height:40px;object-fit:contain" });
            pic.onerror = function () { pic.remove(); thumb.style.background = ""; thumb.style.border = ""; };
            pic.onload = function () { thumb.textContent = ""; thumb.style.background = "#fff"; thumb.style.border = "1px solid #e7e1d2"; thumb.appendChild(pic); };
            pic.src = "logos/" + known + "." + STORE_LOGOS[known];
            return;
          }
          apiBlob("/relay/my/logo/" + encodeURIComponent(dom)).then(function (u) {
            if (!u) return;
            thumb.textContent = ""; thumb.style.background = "#fff"; thumb.style.border = "1px solid #e7e1d2";
            thumb.appendChild(el("img", { alt: "", src: u, style: "width:40px;height:40px;object-fit:contain" }));
          });
        }
        var canOpen = row.id && mailRef(row) && openOriginal;
        var shop = canOpen ? el("button", { text: who, title: "Open the original receipt", style: "all:unset;cursor:pointer;font-weight:800;text-decoration:underline;text-underline-offset:3px;display:block;font-size:16px", onclick: function () { openOriginal(row.id); } })
          : el("b", { text: who, style: "display:block;font-size:16px" });
        // No item names in the email: a short order number is the next most useful thing to show.
        var ref = !names && row.orderRef && /^[#A-Za-z0-9-]{3,14}$/.test(row.orderRef) ? "Order " + (row.orderRef.charAt(0) === "#" ? "" : "#") + row.orderRef : null;
        var meta = [names ? (names.length > 60 ? names.slice(0, 57) + "…" : names) : ref, row.totalPence == null ? null : money(row.totalPence, row.currency), row.orderDate ? shortDate(row.orderDate + "T12:00:00Z") : null].filter(Boolean).join(" · ");
        var mid = el("div", { style: "flex:1;min-width:0" }, [shop, el("span", { text: meta || "Details not found", style: "display:block;font-size:13px;opacity:.75;margin-top:2px" })]);
        var left = daysLeft(deadlineOf(row));
        if (left !== null) mid.appendChild(left < 0 ? pill("Deadline passed", "#ece8dd", "#5b6475") : left <= 2 ? pill(left === 0 ? "Return today" : left + " day" + (left === 1 ? "" : "s") + " left", "#fde0dd", "#b3261e") : left <= 7 ? pill(left + " days left", "#ffefc9", "#77520a") : pill(left + " days left", "#e3f4c8", "#46601b"));
        else if (row.returnable === false) mid.appendChild(pill("Usually can't be returned", "#ece8dd", "#5b6475"));
        var more = el("button", { className: "rl-btn ghost", text: "Details", style: "flex:0 0 auto;padding:8px 12px;font-size:13px;width:auto" });
        top.appendChild(thumb); top.appendChild(mid); top.appendChild(more); wrap.appendChild(top);
        var detail = null;
        more.onclick = function () {
          if (detail) { delete memo.openIds[row.id]; detail.remove(); detail = null; more.textContent = "Details"; more.setAttribute("aria-expanded", "false"); return; }
          detail = el("div", { style: "margin-top:10px" });
          detail.appendChild(receiptCard(row, loadList, true));
          var pick = el("select", { ariaLabel: "Move to another group", style: "margin-top:10px;width:100%" }, [el("option", { value: "", text: "Wrong group? Move it to…" })]);
          GROUP_KEYS.forEach(function (k) { pick.appendChild(el("option", { value: k, text: groupNames[k] || k })); });
          pick.onchange = function () { if (!pick.value) return;
            api("/relay/my/receipts/" + row.id + "/category", { method: "POST", body: { category: pick.value } }).then(function () { say(status, "Thanks, Relay will remember this for " + who + "."); loadList(); }); };
          detail.appendChild(pick);
          if (row.categoryLearned) detail.appendChild(el("span", { text: "Grouped the way you taught Relay.", style: "display:block;font-size:12px;opacity:.7;margin-top:4px" }));
          wrap.appendChild(detail); memo.openIds[row.id] = true; more.textContent = "Hide"; more.setAttribute("aria-expanded", "true");
        };
        var find = [row.retailer && row.retailer.name, row.retailer && row.retailer.domain, row.orderRef, names].filter(Boolean).join(" ").toLowerCase();
        wrap.setAttribute("data-find", find);
        if (memo.openIds[row.id]) more.onclick();
        return wrap;
      }
      var groupNames = { fashion: "Fashion", electronics: "Electronics", food: "Food & drink", home: "Home & garden", beauty: "Beauty & health", travel: "Travel & transport", digital: "Digital & subscriptions", other: "Other" };
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
          list.appendChild(el("button", { className: "rl-btn ghost", text: "‹ All groups", style: "width:auto;padding:8px 14px;font-size:14px", onclick: function () { memo.openCat = null; drawList(); window.scrollTo && window.scrollTo(0, 0); } }));
          list.appendChild(el("h3", { style: "font-size:20px;margin:14px 0 4px;color:#0f1b33;display:flex;align-items:center;gap:10px" }, [catIcon(memo.openCat, 32), el("span", { text: groupNames[memo.openCat] + " (" + by[memo.openCat].length + ")" })]));
          if (by[memo.openCat][0].returnable === false && by[memo.openCat][0].notReturnableReason) list.appendChild(el("p", { text: by[memo.openCat][0].notReturnableReason, style: "font-size:13px;margin:0 0 8px" }));
          var cq = el("input", { type: "search", placeholder: "Search " + groupNames[memo.openCat].toLowerCase() + " (shop, item, order number)", style: "margin:0 0 12px;width:100%;box-sizing:border-box;padding:12px 16px;border:1px solid #e7e1d2;border-radius:14px;font-size:15px;background:#fff;font-family:inherit" });
          var ch = el("div");
          by[memo.openCat].forEach(function (r) { ch.appendChild(receiptRow(r)); });
          var none = el("p", { text: "No receipts match that search.", style: "display:none;color:#667085" });
          cq.addEventListener("input", function () { var q = cq.value.trim().toLowerCase(), n = 0;
            Array.prototype.forEach.call(ch.children, function (c) { var hit = !q || (c.getAttribute("data-find") || "").indexOf(q) !== -1; c.style.display = hit ? "" : "none"; if (hit) n++; });
            none.style.display = n ? "none" : ""; });
          list.appendChild(cq); list.appendChild(ch); list.appendChild(none);
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
             el("span", {}, [el("b", { text: groupNames[k], style: "display:block;font-size:17px;color:#0f1b33" }), el("span", { text: by[k].length + (by[k].length === 1 ? " receipt" : " receipts"), style: "display:block;font-size:14px;opacity:.8;margin-top:2px" }), el("span", { text: sub, style: "display:block;font-size:12px;margin-top:6px;color:" + (soon ? "#b3261e" : "#5b6475") + ";font-weight:" + (soon ? "700" : "400") })])]));
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
        Promise.all([api("/relay/my/receipts"), shopsLoaded]).then(function (both) {
          var x = both[0], shopsChanged = both[1];
          if (!x.ok) { if (drawnSig === null || shopsChanged) drawList(); return; }
          if (!x.ok) { if (drawnSig === null) drawList(); return; }
          var rows = (x.body && x.body.receipts) || [], sig = JSON.stringify(rows);
          memo.receipts = { rows: rows, sig: sig, at: Date.now() };
          if (sig === drawnSig && !shopsChanged) return;
          if (sig !== drawnSig) memoDrop("wrapped");
          allRows = rows; drawnSig = sig; drawList();
        });
      }
      var doScan = function (full) {
        scanBtn.disabled = true; say(status, lastScan && !full ? "Checking for new mail…" : "Scanning…");
        var added = 0, rounds = 0, saved = ""; try { saved = localStorage.getItem("relay_scan_cursor") || ""; } catch (e) {}
        var tries = 0;
        // A round that fails (the mailbox or Relay busy for a moment) is tried again a few seconds later from the same place.
        function retry(cursor) {
          tries++;
          if (tries > 3) {
            scanBtn.disabled = false;
            try { if (cursor) localStorage.setItem("relay_scan_cursor", cursor); } catch (e) {}
            return say(status, (added ? "Found or updated " + added + " so far. " : "") + MB + " is busy right now. Your place is saved: tap the button again in a minute to carry on.", true);
          }
          say(status, MB + " is busy, trying again…" + (added ? " " + added + " found so far" : ""));
          return new Promise(function (res) { setTimeout(res, 3000 * tries); }).then(function () { return step(cursor, true); });
        }
        function step(cursor, small) {
          return api("/relay/my/gmail/scan", { method: "POST", body: Object.assign(cursor ? { cursor: cursor } : {}, full ? { full: true } : {}, small ? { small: true } : {}) }).then(function (x) {
            if (x.status === 401) { scanBtn.disabled = false; return say(status, owner + " needs you to reconnect " + MB + ". Disconnect and connect again.", true); }
            if (!x.ok) return retry(cursor);
            tries = 0;
            added += (x.body.added || 0) + (x.body.updated || 0); rounds++;
            loadList();
            try { if (x.body.more && x.body.cursor) localStorage.setItem("relay_scan_cursor", x.body.cursor); else localStorage.removeItem("relay_scan_cursor"); } catch (e) {}
            if (x.body.more && x.body.cursor && rounds < 80) {
              var m = /^(\d{4})\/(\d{2})/.exec(x.body.scannedBack || "");
              var label = m ? new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : "";
              say(status, "Scanning" + (label ? " back to " + label : " older emails") + "… " + added + " found so far");
              return step(x.body.cursor);
            }
            scanBtn.disabled = false; memo.gmail = null;
            // "Connected. Scanning for receipts…" is out of date once the scan has finished.
            if (onPage && msg.textContent && !/\berr\b/.test(msg.className)) say(msg, "");
            say(status, (x.body.more ? "Stopped early. Scan again to carry on. " : "") + (added ? "Found or updated " + added + " receipt or return email" + (added === 1 ? "" : "s") + ". Please check them below." : "Nothing new found."));
          // A dropped connection is treated like a busy round: wait, then carry on from the same place.
          }, function () { return retry(cursor); });
        }
        step(full ? "" : saved).catch(function () { scanBtn.disabled = false; say(status, "Couldn't reach Relay. Check your connection and try again.", true); });
      };
      scanBtn.onclick = function () { doScan(false); };
      if (onPage) {
        status.style.cssText = "margin:0;font-size:13px;color:#667085";
        box.appendChild(el("div", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 14px" }, [status, scanBtn]));
        box.appendChild(list);
        // A shop missing from the list can be looked for directly (Relay reads only the email the shopper picks).
        box.appendChild(el("button", { type: "button", className: "rl-find-link", text: "Missing a receipt? Search " + MB + " for it",
          style: "all:unset;cursor:pointer;display:block;margin:20px auto 6px;font-size:14px;font-weight:700;color:#3f5a17;text-decoration:underline;text-underline-offset:3px",
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
  function signedInView(sheet, email, notice, c) {
    var list = el("div"), msg = el("div", { className: "rl-msg" });
    var gbox = el("div");
    var head = el("div", { style: "display:flex;gap:14px;align-items:center;margin:0 0 16px" });
    function editHere() { back.firstChild.textContent = ""; profileView(back.firstChild, function () { gate(back.firstChild, email); }); }
    function drawHead() {
      if (!document.body.contains(head)) return false;
      var p = profileNow() || { email: email };
      head.textContent = "";
      head.appendChild(el("button", { type: "button", ariaLabel: "Change your name and photo", style: "all:unset;cursor:pointer;border-radius:50%;flex:none", onclick: editHere }, [face(p, 52)]));
      head.appendChild(el("div", { style: "min-width:0;flex:1" }, [el("b", { text: p.name || "Add your name", style: "display:block;font-size:17px;color:" + (p.name ? "#0f1b33" : "#5b6475") }),
        el("span", { text: email, style: "display:block;font-size:14px;color:#5b6475;word-break:break-all" })]));
      head.appendChild(el("button", { type: "button", text: "Edit", onclick: editHere, style: "all:unset;cursor:pointer;font-weight:700;font-size:14px;padding:8px 14px;border:1px solid #ddd6c6;border-radius:999px" }));
    }
    [el("h2", { text: "Your account" }), head, gbox, el("h2", { text: "Your purchases", style: "font-size:18px;margin-top:8px" }), list, msg].forEach(function (n) { sheet.appendChild(n); });
    drawHead(); profileWatchers.push(drawHead); loadProfile();
    if (notice) say(msg, notice.text, notice.bad);
    var abox = el("div"); sheet.insertBefore(abox, gbox.nextSibling);
    api("/relay/my/admin/me").then(function (r) {
      if (!r.ok || !r.body || r.body.admin !== true) return;
      abox.appendChild(el("button", { className: "rl-btn ghost", text: "Review reports (" + (r.body.openReports || 0) + ")", style: "margin-bottom:8px",
        onclick: function () { back.firstChild.textContent = ""; adminView(back.firstChild, function () { gate(back.firstChild, email); }); } }));
    }).catch(function () {});
    openFind = function () { back.firstChild.textContent = ""; findView(back.firstChild, function () { gate(back.firstChild, email); }); };
    openOriginal = function (id) { back.firstChild.textContent = ""; originalView(back.firstChild, id, function () { gate(back.firstChild, email); }); };
    openResale = function (rid) { back.firstChild.textContent = ""; resaleView(back.firstChild, function () { gate(back.firstChild, email); }, rid); };
    if (window.go) {
      gbox.appendChild(el("h2", { text: "Your receipts", style: "font-size:18px;margin-top:8px" }));
      gbox.appendChild(el("p", { text: "Connect your email (Gmail or Outlook), scan for receipts and see them grouped by store type. Everything lives on the Receipts page." }));
      gbox.appendChild(el("button", { className: "rl-btn", text: "Open my receipts", onclick: function () { close(); window.go("receipts"); } }));
      api("/relay/my/gmail").then(function (g) {
        if (g.ok) rememberMailbox(g.body);
        if (!g.ok || !g.body || !g.body.connected) return;
        gbox.appendChild(el("button", { className: "rl-btn ghost", text: "Re-scan all my email (slower)", onclick: function () { window.__relayAutoFull = true; close(); window.go("receipts"); } }));
        gbox.appendChild(el("button", { className: "rl-btn ghost", text: "Can't find a receipt? Search " + mailName() + " for it", onclick: function () { openFind(); } }));
        gbox.appendChild(el("button", { className: "rl-btn ghost", text: "Disconnect " + mailName() + " and delete captured receipts", onclick: function () { disconnectGmail(function () { back.firstChild.textContent = ""; gate(back.firstChild, email); }, msg); } }));
      });
    } else gmailSection(gbox, c || {}, msg);
    var pbox = el("div"); sheet.insertBefore(pbox, list.previousSibling); passkeySection(pbox, msg);
    var cbox = el("div"); sheet.insertBefore(cbox, list.previousSibling); cardSection(cbox);
    var tbox = el("div"); sheet.insertBefore(tbox, list.previousSibling); twoStepSection(tbox);
    list.appendChild(el("p", { text: "Loading…" }));
    api("/relay/my/purchases").then(function (r) {
      list.textContent = "";
      if (r.status === 401) { save(null); close(); return; }
      var rows = (r.body && r.body.purchases) || [];
      if (!r.ok) { list.appendChild(el("p", { text: "Couldn't load your purchases." })); return; }
      if (!rows.length) { list.appendChild(el("p", { text: "No purchases matched this email yet. Only orders placed with this exact address, at stores connected to Relay, show up here." })); return; }
      rows.forEach(function (o) {
        var names = o.items.map(function (i) { return i.quantity + " × " + i.title; }).join(", ");
        list.appendChild(el("div", { className: "rl-order" }, [el("b", { text: names || "Order" }),
          el("span", { text: (o.store ? o.store + " · " : "") + money(o.amountMinor, o.currency) + " · " + new Date(o.orderedAt).toLocaleDateString("en-GB") + " · ✓ confirmed by the shop" })]));
      });
    }).catch(function () { list.textContent = ""; list.appendChild(el("p", { text: "Couldn't reach Relay." })); });
    sheet.appendChild(el("button", { className: "rl-btn", text: "Swap & resell", style: "margin-top:10px", onclick: function () { openResale(); } }));
    sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Add a receipt by pasting it", onclick: function () {
      if (back) back.firstChild.textContent = ""; receiptView(back.firstChild, function () { gate(back.firstChild, email); }); } }));
    sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Sign out", onclick: function () {
      api("/relay/auth/logout", { method: "POST" }).finally(function () { save(null); close(); }); } }));
    sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Delete my Relay account", onclick: function () {
      ask("Delete your Relay sign-in and everything linked to it? This can't be undone.", "Delete my account", function () {
        api("/relay/my/delete", { method: "POST" }).then(function (r) { if (r.ok) { save(null); close(); } else say(msg, "Couldn't delete. Try again.", true); }); }); } }));
    sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Withdraw my permission for Relay to read my receipts", onclick: function () {
      ask("Withdraw permission? Relay will disconnect your email and delete everything it captured. You'll be asked again next time you open your account.", "Withdraw permission", function () {
        api("/relay/my/consent/withdraw", { method: "POST" }).then(function (x) { if (x.ok) { memoReset(); gate(sheet, email); } else say(msg, "Couldn't withdraw. Try again.", true); }); }); } }));
    sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Close", onclick: close }));
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
    a.setAttribute("aria-label", "Account and sign in");
    a.addEventListener("click", show);
    a.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(); } });
    paintAvatars(); loadProfile();
  }
  function completeLinkSignIn() {
    var m = /(?:^|[#&])signin=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash || "");
    if (!m) return;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    open(function (sheet) { sheet.appendChild(el("h2", { text: "Signing you in…" })); });
    var gn = ""; try { gn = localStorage.getItem("relay_gnonce") || ""; localStorage.removeItem("relay_gnonce"); } catch (e) {}
    api("/relay/auth/verify", { method: "POST", body: gn ? { token: m[1], nonce: gn } : { token: m[1] } }).then(function (r) {
      if (!r.ok) return open(function (sheet) { sheet.appendChild(el("h2", { text: "Sign-in failed" }));
        sheet.appendChild(el("p", { text: errors[r.body.error] || "Something went wrong." }));
        sheet.appendChild(el("button", { className: "rl-btn", text: "Try again", onclick: show })); });
      if (r.body.outlookConnected) { rememberMailbox({ connected: true, provider: "microsoft" }); memo.consent = null; memo.gmail = null; memo.receipts = null; }
      if (r.body.needsSecondStep) return open(function (sheet) { secondStepView(sheet, r.body.pendingToken); });
      save({ token: r.body.sessionToken, email: r.body.email, expiresAt: r.body.expiresAt });
      keepStorage();
      paintAvatars(); loadProfile();
      // Signed in and Outlook connected together: straight to Receipts, where the first scan starts by itself.
      if (r.body.outlookConnected && window.go) { close(); window.__relayAutoScan = true; window.__relayReceiptsNote = mailNote("connected", "Outlook"); window.go("receipts"); return; }
      show();
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
    host.appendChild(el("p", { text: "Loading…" }));
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
  function mountWrapped(host, year) {
    host.textContent = "";
    var s = load();
    if (!s || !s.token) {
      host.appendChild(el("div", { className: "rl-wr-cover" }, [
        el("div", { className: "rl-wr-kicker", text: "✦ RELAY WRAPPED" }),
        el("h2", { text: "Your year in purchases, as a story." }),
        el("p", { text: "Sign in and connect your email, and Relay builds your Wrapped from your real receipts." }),
        el("button", { className: "rl-wr-play", text: "Sign in", onclick: show })]));
      return;
    }
    var thisYear = new Date().getFullYear();
    year = year || thisYear;
    var yrs = el("div", { className: "rl-wr-years" });
    var cover = el("div", { className: "rl-wr-cover" }, [el("div", { className: "rl-wr-kicker", text: "✦ RELAY WRAPPED " + year }), el("h2", { text: "Adding up your " + year + "…" })]);
    var extra = el("div");
    host.appendChild(yrs); host.appendChild(cover); host.appendChild(extra);
    // Building Wrapped is heavy work for the server, so one failed try is retried once before showing an error.
    var getW = function () { return cachedGet("wrapped" + year, "/relay/my/wrapped?year=" + year); };
    getW().catch(function () { return { ok: false }; }).then(function (r) { return r.ok || r.status === 401 ? r : new Promise(function (ok) { setTimeout(ok, 1200); }).then(getW); }).then(function (r) {
      if (r.status === 401) { save(null); mountWrapped(host, year); return; }
      if (!r.ok) { cover.textContent = ""; cover.appendChild(el("p", { text: "Couldn't build Wrapped just now. Please try again." })); return; }
      var w = r.body;
      var list = (w.years || []).map(function (y) { return y.year; });
      if (list.indexOf(year) < 0) list.push(year);
      if (list.indexOf(thisYear) < 0) list.push(thisYear);
      list.sort(function (a, b) { return b - a; }).forEach(function (y) {
        yrs.appendChild(el("button", { type: "button", text: String(y), ariaPressed: y === year ? "true" : "false", className: y === year ? "on" : "", onclick: function () { mountWrapped(host, y); } }));
      });
      cover.textContent = "";
      cover.appendChild(el("div", { className: "rl-wr-kicker", text: "✦ RELAY WRAPPED " + year }));
      if (!w.receipts) {
        cover.appendChild(el("h2", { text: "Nothing to wrap for " + year + " yet." }));
        cover.appendChild(el("p", { text: year < thisYear ? "Relay hasn't read your " + year + " emails. Add earlier years below and Relay will look for that year's receipts." : "Connect your email on the Receipts tab and Relay will find your order emails." }));
      } else {
        cover.appendChild(el("h2", { text: "Your " + year + " in purchases." }));
        cover.appendChild(el("p", { text: w.receipts + " receipts · " + w.shops + (w.shops === 1 ? " shop" : " shops") + (w.coverage.withTotal ? " · " + money(w.spentPence, "GBP") : "") }));
        cover.appendChild(el("button", { className: "rl-wr-play", text: "▶  Play your story", onclick: function () { playStory(w); } }));
      }
      if (w.receipts) extra.appendChild(wrappedGlance(w));
      var hb = el("div"); extra.appendChild(hb);
      mountHistory(hb, w, function (firstYear) { Object.keys(memo).forEach(function (k) { if (/^wrapped/.test(k)) memoDrop(k); }); mountWrapped(host, firstYear || year); });
    }).catch(function () { cover.textContent = ""; cover.appendChild(el("p", { text: "Couldn't reach Relay." })); });
  }
  // Opt-in: read past years of order emails so Wrapped works for them too. Same email permission, same rules: only receipts and order emails.
  function mountHistory(host, w, done) {
    host.textContent = "";
    var thisYear = new Date().getFullYear();
    var card = el("div", { className: "rl-wr-glance" });
    host.appendChild(card);
    card.appendChild(el("h3", { text: "Add earlier years" }));
    card.appendChild(el("p", { text: "Relay normally reads the last 16 months of your email. Pick earlier years and Relay will look through those years' order confirmations and receipts too, so you can play Wrapped for them. It only reads purchase emails, the same as now, and you can delete everything from Account & security.", style: "color:#475467;font-size:14px;margin:0 0 12px;line-height:1.5" }));
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
    var cat = w.categories[0], top = w.topShops[0];
    box.appendChild(el("h3", { text: "At a glance" }));
    box.appendChild(el("div", { className: "rl-wr-stats" }, [
      stat("Spent", w.coverage.withTotal ? money(w.spentPence, "GBP") : "—", "from " + w.coverage.withTotal + " of " + w.receipts + " receipts"),
      stat("Top shop", top ? top.name : "—", top ? top.receipts + (top.receipts === 1 ? " order" : " orders") : ""),
      stat("Favourite kind", cat ? cat.label : "—", cat ? cat.receipts + " receipts" : ""),
      stat("Busiest month", w.busiestMonth || "—", "")]));
    if ((w.photos || []).length) { box.appendChild(el("h3", { text: "Things you bought", style: "margin:16px 0 8px;font-size:15px" })); box.appendChild(photoGrid(w.photos, "rl-wr-strip")); }
    box.appendChild(el("p", { className: "rl-wr-note", text: w.note }));
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
    var photos = (w.photos || []).slice(0, 9), style = wrappedStyle(w);
    S.push({ bg: "#101828", fg: "#fff", accent: "#c7f567", build: function (b) {
      b.appendChild(el("div", { className: "k", text: "✦ RELAY WRAPPED" }));
      b.appendChild(el("h1", { text: "Your " + w.year + ", one receipt at a time." }));
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
    if (w.coverage.withTotal) S.push({ bg: "#30255d", fg: "#fff", accent: "#e4d8ff", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "In " + w.year + " you spent" }));
      var n = el("div", { className: "big" }); b.appendChild(n); countUp(n, w.spentPence, gbp, 1400);
      b.appendChild(el("p", { text: "across " + w.shops + (w.shops === 1 ? " shop" : " shops") + (w.activeMonths ? " in " + w.activeMonths + (w.activeMonths === 1 ? " month" : " months") : "") + "." }));
      if (w.coverage.noTotal) b.appendChild(el("p", { className: "fine", text: "Added up from " + w.coverage.withTotal + " of " + w.receipts + " receipts. " + w.coverage.noTotal + " had no amount Relay could read." }));
    } });
    if (top) S.push({ bg: "#c7f567", fg: "#16210a", accent: "#16210a", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "Your number one shop" }));
      b.appendChild(el("div", { className: "big name", text: top.name }));
      b.appendChild(el("p", { text: top.receipts + (top.receipts === 1 ? " order" : " orders") + (top.spentPence ? " · " + gbp(top.spentPence) : "") }));
      if (w.topShopShare) b.appendChild(el("p", { className: "pill", text: "That's " + w.topShopShare + "% of everything you spent" }));
    } });
    if (w.topShops.length > 1) S.push({ bg: "#172554", fg: "#fff", accent: "#93c5fd", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "Your top shops" }));
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
    var ti = (w.topItems || []).filter(function (x) { return x.name; });
    if (ti.length >= 3) S.push({ bg: "#7c2d12", fg: "#fff", accent: "#fdba74", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "Your top 5 things" }));
      var ol = el("ol", { className: "rank" });
      ti.forEach(function (x, i) { ol.appendChild(el("li", { style: "animation-delay:" + (0.15 + i * 0.18) + "s" }, [el("b", { text: String(i + 1) }), el("span", { text: x.name }), el("em", { text: x.times > 1 ? x.times + "×" : x.spentPence ? gbp(x.spentPence) : (x.shop || "") })])); });
      b.appendChild(ol);
      b.appendChild(el("p", { className: "fine", text: "Ranked by how many orders each was in, then by what you spent." }));
    } });
    var subs = w.subscriptions || [];
    if (subs.length) S.push({ bg: "#1e1b4b", fg: "#fff", accent: "#a5b4fc", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: subs.length === 1 ? "Your regular" : "Your regulars" }));
      b.appendChild(el("p", { text: "Things you paid for month after month." }));
      var ol = el("ol", { className: "rank" });
      subs.forEach(function (x, i) { ol.appendChild(el("li", { style: "animation-delay:" + (0.15 + i * 0.18) + "s" }, [el("b", { text: String(i + 1) }), el("span", { text: x.item && x.item !== x.name ? x.name + " · " + x.item : x.name }), el("em", { text: x.months + " months" + (x.spentPence ? " · " + gbp(x.spentPence) : "") })])); });
      b.appendChild(ol);
    } });
    if (cat) S.push({ bg: "#f6c7e2", fg: "#3f1430", accent: "#3f1430", build: function (b) {
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
    if (photos.length) S.push({ bg: "#f6f3ec", fg: "#101828", accent: "#30255d", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: photos.length === 1 ? "One thing you brought home" : "Some things you brought home" }));
      b.appendChild(photoGrid(photos.length > 6 ? photos.slice(0, 6) : photos, "ph"));
      b.appendChild(el("p", { className: "fine", text: "Photos from your own order emails." }));
    } });
    if (style) S.push({ bg: "#1f3d2b", fg: "#fff", accent: "#c7f567", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "Your style in " + w.year }));
      b.appendChild(el("p", { text: style.headline, style: "font-size:24px;line-height:1.3;font-weight:800;opacity:1" }));
      var ch = el("div", { className: "chips" });
      style.styles.forEach(function (x) { ch.appendChild(el("span", { text: x.name })); });
      style.colours.slice(0, 3).forEach(function (x) { ch.appendChild(el("span", {}, [el("i", { style: "background:" + (SW[x.name] || "#ccc") }), document.createTextNode(x.name.charAt(0).toUpperCase() + x.name.slice(1))])); });
      b.appendChild(ch);
      b.appendChild(el("p", { className: "fine", text: "Read from the sizes, colours and names on " + style.bought + (style.bought === 1 ? " item" : " items") + " you bought." }));
    } });
    if (w.topItem) S.push({ bg: "#ff8a5b", fg: "#2b0d00", accent: "#2b0d00", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "On repeat" }));
      b.appendChild(el("div", { className: "big name", text: w.topItem.name }));
      var n = el("div", { className: "big" }); b.appendChild(n); countUp(n, w.topItem.times, function (v) { return v + "×"; }, 900);
      var t = w.topItem.times, weeks = w.activeMonths ? w.activeMonths * 4.3 : 52;
      b.appendChild(el("p", { text: "You kept coming back for it" + (w.topItem.shop ? " at " + w.topItem.shop : "") + "." + (t >= weeks ? " That's more than once a week." : t >= 12 ? " That's about " + Math.round(t / Math.max(1, w.activeMonths || 12)) + " a month." : "") }));
    } });
    if (w.busiestMonth) S.push({ bg: "#263f8c", fg: "#fff", accent: "#d7e4ff", build: function (b) {
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
      b.appendChild(el("p", { className: "lead", text: "Your biggest treat" }));
      var n = el("div", { className: "big" }); b.appendChild(n); countUp(n, w.biggest.totalPence, gbp, 1100);
      b.appendChild(el("p", { text: (w.biggest.item ? w.biggest.item + ", " : "") + "at " + w.biggest.shop + (w.biggest.date ? " on " + longDate(w.biggest.date) : "") + "." }));
      if (w.biggest.photoId) b.appendChild(photoGrid([{ id: w.biggest.photoId, item: w.biggest.item, shop: w.biggest.shop }], "ph"));
    } });
    var tb = w.topBuys || [];
    if (tb.length >= 3) S.push({ bg: "#064e3b", fg: "#fff", accent: "#6ee7b7", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "Your biggest buys" }));
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
    if (w.personality) S.push({ bg: "#5b21b6", fg: "#fff", accent: "#e9d5ff", build: function (b) {
      b.appendChild(el("p", { className: "lead", text: "Your shopping style" }));
      b.appendChild(el("div", { className: "big name", text: w.personality.label }));
      b.appendChild(el("p", { text: w.personality.why }));
    } });
    S.push({ bg: "#101828", fg: "#fff", accent: "#c7f567", summary: true, build: function (b, again, close) {
      var card = el("div", { className: "sum" }, [el("div", { className: "k", text: "✦ MY " + w.year + " ON RELAY" })]);
      var rows = [["Spent", w.coverage.withTotal ? gbp(w.spentPence) : "—"], ["Top shop", top ? top.name : "—"], ["Favourite kind", cat ? cat.label : "—"], ["Busiest month", w.busiestMonth ? MONTH_FULL[w.busiestMonth] : "—"], ["Receipts", String(w.receipts)], [style && style.styles[0] ? "Style" : "Shops", style && style.styles[0] ? style.styles.slice(0, 2).map(function (x) { return x.name; }).join(" & ") : String(w.shops)]];
      var g = el("div", { className: "sumgrid" }); rows.forEach(function (r) { g.appendChild(el("div", {}, [el("span", { text: r[0] }), el("strong", { text: r[1] })])); }); card.appendChild(g);
      b.appendChild(card);
      var text = "My " + w.year + " on Relay: " + rows.map(function (r) { return r[0] + " " + r[1]; }).join(" · ");
      var msg = el("p", { className: "fine" });
      b.appendChild(el("div", { className: "acts" }, [
        el("button", { type: "button", text: "Share", onclick: function (e) { e.stopPropagation();
          if (navigator.share) navigator.share({ title: "My " + w.year + " on Relay", text: text }).catch(function () {});
          else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { msg.textContent = "Copied. Paste it anywhere."; }, function () {}); } }),
        (w.yearList || []).length ? el("button", { type: "button", className: "ghost", text: "Save my list", onclick: function (e) { e.stopPropagation();
          var q = function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
          var csv = "Rank,Item,Shop,Orders,Spent\n" + w.yearList.map(function (x, i) { return [i + 1, x.name, x.shop || "", x.times, x.spentPence ? (x.spentPence / 100).toFixed(2) : ""].map(q).join(","); }).join("\n");
          var a = el("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })) }); a.download = "relay-" + w.year + "-top-things.csv"; document.body.appendChild(a); a.click(); a.remove();
          msg.textContent = "Saved your top " + w.yearList.length + " things."; } }) : null,
        el("button", { type: "button", className: "ghost", text: "Watch again", onclick: function (e) { e.stopPropagation(); again(); } }),
        el("button", { type: "button", className: "ghost", text: "Done", onclick: function (e) { e.stopPropagation(); close(); } })].filter(Boolean)));
      b.appendChild(msg);
    } });
    return S;
  }
  function playStory(w) {
    var slides = storySlides(w), i = 0, timer = null, paused = false, DUR = 6500;
    var root = el("div", { className: "rl-story", role: "dialog", ariaLabel: "Your " + w.year + " Wrapped" });
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
                say(msg, EXCHANGE_ERR[res.body && res.body.error] || ("The shop didn't accept the change" + (res.body && res.body.detail ? ": " + res.body.detail : ".")), true);
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
    if ((x.items || []).length <= 1 && x.hasImage && x.id) apiBlob("/relay/my/receipts/" + x.id + "/image").then(function (u) { if (u) { img.textContent = ""; img.appendChild(el("img", { src: u, alt: "" })); } });
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
    if (dv && dv.status) {
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
      card.appendChild(el("button", { type: "button", className: "rl-link", text: opts.markable === "undo" ? "Not sending this back" : "I'm sending this back", style: "all:unset;cursor:pointer;color:#46601b;font-weight:800;font-size:14px;margin-top:10px;display:inline-block;text-decoration:underline;text-underline-offset:3px",
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
    return Promise.all([p.then(function (r) { return (r.ok && r.body && r.body.purchases) || []; }, function () { return []; }),
      api("/relay/my/receipts").then(function (r) { return (r.ok && r.body && r.body.receipts) || []; }, function () { return []; })]);
  }
  function orderRows(rows) { return rows.filter(function (x) { return x.kind !== "return_instructions" && x.kind !== "delivery_update" && x.kind !== "return_update"; }); }
  function notConfirmed(purchases) {
    var seen = {}; purchases.forEach(function (o) { seen[label(o.store) + "|" + o.amountMinor] = true; });
    return function (x) { return !seen[label(x.retailer && x.retailer.name) + "|" + x.totalPence]; };
  }
  function skeleton(host, n) { for (var i = 0; i < n; i++) host.appendChild(el("div", { className: "rl-po rl-skel" })); }
  // The wallet: everything you can still return or swap, newest deadline first, in one list. Everything else is in Receipts.
  function mountWallet(host) {
    if (!host) return;
    host.textContent = "";
    var s = load();
    if (!s || !s.token) {
      host.appendChild(el("div", { className: "rl-empty" }, [el("h3", { text: "Sign in to see your purchases" }),
        el("p", { text: "Relay brings together what you've bought at shops on Relay and from your email receipts, so you can return or swap in a couple of taps." }),
        el("button", { className: "rl-po-primary", text: "Sign in", style: "max-width:220px", onclick: show })]));
      return;
    }
    var top = el("div"); host.appendChild(top);
    var refresh = function () { memo.purchases = null; mountWallet(host); };
    mountInstore(top, refresh, "suggest");
    var head = el("div", { className: "sectionhead" }, [el("h2", { text: "Still returnable" })]);
    var grid = el("div", { className: "rl-po-grid" }); skeleton(grid, 3);
    host.appendChild(head); host.appendChild(grid);
    var foot = el("div"); host.appendChild(foot);
    loadBoth().then(function (both) {
      var purchases = both[0], receipts = both[1], today = new Date().toISOString().slice(0, 10), items = [];
      purchases.forEach(function (o) { (o.items || []).forEach(function (it) {
        if (!it.returnable && !it.exchangeable) return;
        items.push({ deadline: new Date(Date.parse(o.orderedAt) + 7 * 864e5).toISOString().slice(0, 10), node: function () { return confirmedCard(o, it, refresh, this.deadline); } });
      }); });
      orderRows(receipts).filter(notConfirmed(purchases)).forEach(function (x) {
        if (x.returnable === false) return;
        var dl = deadlineOf(x), onWay = x.delivery && x.delivery.status && x.delivery.status !== "delivered";
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
    });
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
      box.appendChild(el("p", { className: "small muted", style: "margin:8px 0 10px", text: "For shops on Relay that use Square. Enter what's on your receipt; all four must match one purchase." }));
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
      box.addEventListener("toggle", function () {
        if (!box.open || shopSel.options.length) return;
        api("/relay/my/instore/shops").then(function (sh) { ((sh.body && sh.body.shops) || []).forEach(function (o) { shopSel.appendChild(el("option", { value: o.id, text: o.name })); }); });
      });
      [shopSel, rn, amt, dt, l4, go, cmsg].forEach(function (n) { box.appendChild(n); });
      if (part !== "suggest") host.appendChild(box);
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
    var body = el("div", {}, [el("p", { text: "Checking…", className: "small muted" })]);
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
          api("/relay/my/push/test", { method: "POST" }).then(function (x) { say(msg, x.ok && x.body.sent ? "Sent. It should appear on this device in a few seconds." : x.status === 429 ? "Give it a few seconds, then try again." : "It couldn't be delivered" + (x.body && x.body.why ? " (" + x.body.why + ")" : "") + ". Try turning alerts off and on again.", !(x.ok && x.body.sent)); });
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
  window.RelayAccount = { open: show, testingOn: testingOn, mountWallet: mountWallet, mountReturns: mountReturns, email: function () { var x = load(); return (x && x.email) || ""; }, mountConfirmed: mountConfirmed, mountAlerts: mountAlerts, enablePush: enablePush, syncWatch: syncWatch, syncStore: syncStore, alertStatus: alertStatus, tasteRows: function () { return cachedGet("taste", "/relay/my/style").then(function (r) { return r.ok ? (r.body.receipts || []) : []; }); }, mountWrapped: mountWrapped, mountMarket: mountMarket, mountDemoMarket: mountDemoMarket, mountReceipts: mountReceipts, mountProfile: mountProfile, editProfile: editProfile, profile: function () { return profileNow(); }, open: function () { show(); }, signedIn: function () { var s = load(); return Boolean(s && s.token); }, receipts: function () { return api("/relay/my/receipts"); },
    // Orders the shop confirmed (shares the wallet's request when one is already on its way).
    purchases: function () { return (memo.purchases || api("/relay/my/purchases")).then(function (r) { return (r.ok && r.body && r.body.purchases) || []; }, function () { return []; }); } };
  function start() { bind(); completeGoogleNote(); completeLinkSignIn(); completeGmail(); window.addEventListener("hashchange", function () { completeGoogleNote(); completeLinkSignIn(); completeGmail(); }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();

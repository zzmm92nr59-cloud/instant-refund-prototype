/* Relay shopper sign-in: emailed one-time link, session kept in this browser only.
   All server data is written with textContent (never innerHTML). */
(function () {
  var API = "https://relay-square-api2.9pts72cy5j.workers.dev";
  var KEY = "relay.session.v1";
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function save(v) { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (e) {} }
  function api(path, opts) {
    opts = opts || {};
    var s = load(), headers = { "Content-Type": "application/json" };
    if (s && s.token) headers.Authorization = "Bearer " + s.token;
    return fetch(API + path, { method: opts.method || "GET", headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); });
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
    ".rl-order b{display:block}.rl-order span{color:#5b6475;font-size:14px}";
  document.head.appendChild(css);
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) { if (k === "text") n.textContent = props[k]; else n[k] = props[k]; });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }
  var back = null;
  function close() { if (back) { back.remove(); back = null; } }
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
    invalid_or_expired_link: "That sign-in link has expired or was already used. Request a new one.", origin_not_allowed: "Sign-in isn't available from this address." };
  function say(node, text, bad) { node.textContent = text; node.className = "rl-msg" + (bad ? " err" : ""); }

  function signedOutView(sheet) {
    var input = el("input", { type: "email", placeholder: "you@example.com", autocomplete: "email", inputMode: "email" });
    var msg = el("div", { className: "rl-msg" });
    var go = el("button", { className: "rl-btn", text: "Email me a sign-in link" });
    go.onclick = function () {
      go.disabled = true; say(msg, "Sending…");
      api("/relay/auth/request", { method: "POST", body: { email: input.value } }).then(function (r) {
        go.disabled = false;
        if (r.ok) say(msg, "Check your inbox. The link works once and expires in 15 minutes.");
        else say(msg, errors[r.body.error] || "Something went wrong. Please try again.", true);
      }).catch(function () { go.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
    };
    [el("h2", { text: "Sign in to Relay" }),
     el("p", { text: "No password. We email you a one-time link. Purchases you made with that email address appear in your wallet." }),
     input, go, msg, el("button", { className: "rl-btn ghost", text: "Close", onclick: close })].forEach(function (n) { sheet.appendChild(n); });
  }
  function money(minor, cur) { return (cur === "GBP" || !cur ? "£" : cur + " ") + (minor / 100).toFixed(2); }
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
      api("/relay/my/consent", { method: "POST", body: { version: c.version } }).then(function (r) {
        if (r.status === 401) { save(null); close(); return; }
        if (!r.ok) { agree.disabled = false; return say(msg, "Couldn't save your choice. Please try again.", true); }
        open(function (s) { gate(s, email); });
      }).catch(function () { agree.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
    };
    sheet.appendChild(el("h2", { text: "Before you start" }));
    sheet.appendChild(el("p", { text: "Relay is only useful if it can see your receipts, so this is needed to use it." }));
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
  function receiptCard(x, refresh) {
    var who = (x.retailer && (x.retailer.name || x.retailer.domain)) || "Unknown store";
    var names = (x.items || []).map(function (i) { return i.qty + " × " + i.name; }).join(", ");
    var card = el("div", { className: "rl-order" }, [el("b", { text: who + (x.orderRef ? " · " + x.orderRef : "") }),
      el("span", { text: (names ? names + " · " : "") + (x.totalPence == null ? "total not found" : money(x.totalPence, x.currency)) + (x.orderDate ? " · " + x.orderDate : "") })]);
    var rt = x.returns;
    if (rt) {
      var rb = el("div", { style: "margin-top:8px;padding:10px;border-radius:10px;background:rgba(127,127,127,.12);font-size:14px" });
      rb.appendChild(el("b", { text: "Returns", style: "display:block;margin-bottom:4px" }));
      var line = function (t) { rb.appendChild(el("span", { text: t, style: "display:block;margin-top:2px" })); };
      if (rt.deadline) line("Return by " + new Date(rt.deadline + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }));
      else if (rt.windowDays) line(rt.windowDays + " days to return" + (rt.windowFrom === "delivery" ? " from delivery (check your delivery date)" : ""));
      if (rt.address) line("Send to: " + rt.address);
      (rt.instructions || []).forEach(function (t) { line("“" + t + "”"); });
      if (rt.qrMentioned) line("This email mentions a QR code. Relay can't read it yet, so open the original email to use it.");
      else if (rt.labelMentioned) line("A label or drop-off option is mentioned. Check the original email.");
      if (rt.portalUrl && /^https:\/\//.test(rt.portalUrl)) {
        rb.appendChild(el("a", { href: rt.portalUrl, target: "_blank", rel: "noopener noreferrer", text: "Start a return on the store's site", style: "display:block;margin-top:6px;font-weight:600" }));
      }
      rb.appendChild(el("span", { text: "Read from the email. Check it matches the store's own policy.", style: "display:block;margin-top:6px;opacity:.7;font-size:12px" }));
      card.appendChild(rb);
    }
    if (x.status === "confirmed") { card.appendChild(el("span", { text: " · Confirmed by you", style: "display:block;margin-top:4px" })); return card; }
    card.appendChild(el("span", { text: x.needsShopperConfirmation ? "Some details may be missing or wrong. Please check." : "Please check this is right.", style: "display:block;margin-top:4px" }));
    [["Looks right", "confirm", "rl-btn"], ["Not mine / ignore", "dismiss", "rl-btn ghost"]].forEach(function (b) {
      card.appendChild(el("button", { className: b[2], text: b[0], style: "margin-top:8px;padding:10px 14px;font-size:14px", onclick: function () {
        api("/relay/my/receipts/" + x.id + "/" + b[1], { method: "POST" }).then(refresh); } }));
    });
    return card;
  }
  function gmailSection(box, c, msg) {
    box.textContent = "";
    box.appendChild(el("h2", { text: "Your receipts", style: "font-size:18px;margin-top:8px" }));
    var list = el("div");
    api("/relay/my/gmail").then(function (r) {
      if (r.status === 401) { save(null); close(); return; }
      if (!r.ok) { box.appendChild(el("p", { text: "Couldn't load your Gmail status." })); return; }
      if (!r.body.connected) {
        box.appendChild(el("p", { text: c.gmailAvailable ? "Connect Gmail so Relay can find your order confirmations and receipts for you." : "Gmail connection isn't switched on yet. You can still add a receipt by pasting it below." }));
        if (c.gmailAvailable) box.appendChild(el("button", { className: "rl-btn", text: "Connect Gmail", onclick: function () {
          api("/relay/my/gmail/connect", { method: "POST" }).then(function (x) {
            if (x.ok && /^https:\/\/accounts\.google\.com\//.test(x.body.url)) location.href = x.body.url;
            else say(msg, "Couldn't start the Gmail connection. Please try again.", true);
          }); } }));
        return;
      }
      box.appendChild(el("p", { text: "Gmail connected" + (r.body.googleEmail ? ": " + r.body.googleEmail : "") + ". Relay only looks for order confirmations and receipts." }));
      var scanBtn = el("button", { className: "rl-btn", text: "Scan my Gmail for receipts" });
      function loadList() {
        api("/relay/my/receipts").then(function (x) {
          list.textContent = "";
          var rows = (x.body && x.body.receipts) || [];
          if (!rows.length) list.appendChild(el("p", { text: "No receipts found yet." }));
          rows.forEach(function (row) { list.appendChild(receiptCard(row, loadList)); });
        });
      }
      scanBtn.onclick = function () {
        scanBtn.disabled = true; say(msg, "Scanning…");
        api("/relay/my/gmail/scan", { method: "POST" }).then(function (x) {
          scanBtn.disabled = false;
          if (x.status === 401) return say(msg, "Google needs you to reconnect Gmail. Disconnect and connect again.", true);
          if (!x.ok) return say(msg, "Couldn't scan Gmail right now. Please try again.", true);
          say(msg, x.body.added ? "Found " + x.body.added + " new receipt" + (x.body.added === 1 ? "" : "s") + ". Please check them below." : "No new receipts found.");
          loadList();
        }).catch(function () { scanBtn.disabled = false; say(msg, "Couldn't reach Relay.", true); });
      };
      box.appendChild(scanBtn); box.appendChild(list); loadList();
      box.appendChild(el("button", { className: "rl-btn ghost", text: "Disconnect Gmail and delete captured receipts", onclick: function () {
        if (!confirm("Disconnect Gmail and delete every receipt Relay captured from it?")) return;
        api("/relay/my/gmail/disconnect", { method: "POST" }).then(function (x) { if (x.ok) gmailSection(box, c, msg); else say(msg, "Couldn't disconnect. Try again.", true); }); } }));
      if (window.__relayAutoScan) { window.__relayAutoScan = false; scanBtn.onclick(); }
    }).catch(function () { box.appendChild(el("p", { text: "Couldn't reach Relay." })); });
  }
  function signedInView(sheet, email, notice, c) {
    var list = el("div"), msg = el("div", { className: "rl-msg" });
    var gbox = el("div");
    [el("h2", { text: "Your account" }), el("p", { text: email }), gbox, el("h2", { text: "Your purchases", style: "font-size:18px;margin-top:8px" }), list, msg].forEach(function (n) { sheet.appendChild(n); });
    if (notice) say(msg, notice.text, notice.bad);
    gmailSection(gbox, c || {}, msg);
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
          el("span", { text: money(o.amountMinor, o.currency) + " · " + new Date(o.orderedAt).toLocaleDateString("en-GB") })]));
      });
    }).catch(function () { list.textContent = ""; list.appendChild(el("p", { text: "Couldn't reach Relay." })); });
    sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Add a receipt by pasting it", onclick: function () {
      if (back) back.firstChild.textContent = ""; receiptView(back.firstChild, function () { gate(back.firstChild, email); }); } }));
    sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Sign out", onclick: function () {
      api("/relay/auth/logout", { method: "POST" }).finally(function () { save(null); close(); }); } }));
    sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Delete my Relay account", onclick: function () {
      if (!confirm("Delete your Relay sign-in and everything linked to it? This can't be undone.")) return;
      api("/relay/my/delete", { method: "POST" }).then(function (r) { if (r.ok) { save(null); close(); } else say(msg, "Couldn't delete. Try again.", true); }); } }));
    sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Withdraw my permission for Relay to read my receipts", onclick: function () {
      if (!confirm("Withdraw permission? Relay will disconnect Gmail and delete everything it captured. You'll be asked again next time you open your account.")) return;
      api("/relay/my/consent/withdraw", { method: "POST" }).then(function (x) { if (x.ok) gate(sheet, email); else say(msg, "Couldn't withdraw. Try again.", true); }); } }));
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
    var s = load(); if (s && s.email) a.textContent = s.email.charAt(0).toUpperCase();
  }
  function completeLinkSignIn() {
    var m = /(?:^|[#&])signin=([A-Za-z0-9_-]{43})(?:&|$)/.exec(location.hash || "");
    if (!m) return;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    open(function (sheet) { sheet.appendChild(el("h2", { text: "Signing you in…" })); });
    api("/relay/auth/verify", { method: "POST", body: { token: m[1] } }).then(function (r) {
      if (!r.ok) return open(function (sheet) { sheet.appendChild(el("h2", { text: "Sign-in failed" }));
        sheet.appendChild(el("p", { text: errors[r.body.error] || "Something went wrong." }));
        sheet.appendChild(el("button", { className: "rl-btn", text: "Try again", onclick: show })); });
      save({ token: r.body.sessionToken, email: r.body.email, expiresAt: r.body.expiresAt });
      var a = document.querySelector(".avatar"); if (a) a.textContent = r.body.email.charAt(0).toUpperCase();
      show();
    }).catch(function () { open(function (sheet) { sheet.appendChild(el("h2", { text: "Couldn't reach Relay" })); sheet.appendChild(el("button", { className: "rl-btn ghost", text: "Close", onclick: close })); }); });
  }
  var gmailNotes = { connected: ["Gmail connected. Scanning for receipts…", false], denied: ["You chose not to connect Gmail. Relay needs a way to see your receipts, so you can try again or paste one.", true],
    failed: ["Couldn't connect Gmail. Please try again.", true], consent_needed: ["Please agree to the permission step first, then connect Gmail.", true], not_configured: ["Gmail connection isn't switched on yet.", true] };
  function completeGmail() {
    var m = /(?:^|[#&])gmail=(connected|denied|failed|consent_needed|not_configured)(?:&|$)/.exec(location.hash || "");
    if (!m) return;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    var s = load(); if (!s || !s.token) return open(signedOutView);
    window.__relayAutoScan = m[1] === "connected";
    open(function (sheet) { gate(sheet, s.email || "", { text: gmailNotes[m[1]][0], bad: gmailNotes[m[1]][1] }); });
  }
  function start() { bind(); completeLinkSignIn(); completeGmail(); window.addEventListener("hashchange", function () { completeLinkSignIn(); completeGmail(); }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();

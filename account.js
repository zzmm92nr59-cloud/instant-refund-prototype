/* Relay shopper sign-in: emailed one-time link, session kept in this browser only.
   All server data is written with textContent (never innerHTML). */
(function () {
  var API = "https://relay-square-api2.9pts72cy5j.workers.dev";
  var KEY = "relay.session.v1";
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  // Ask the browser not to clear Relay's saved sign-in when it tidies up storage.
  function keepStorage() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {} }
  function save(v) { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (e) {} }
  function api(path, opts) {
    opts = opts || {};
    var s = load(), headers = { "Content-Type": "application/json" };
    if (s && s.token) headers.Authorization = "Bearer " + s.token;
    return fetch(API + path, { method: opts.method || "GET", headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); });
  }
  // Fetches a signed-in image and returns a local address for it (or null).
  function apiBlob(path) {
    var s = load(), headers = {};
    if (s && s.token) headers.Authorization = "Bearer " + s.token;
    return fetch(API + path, { headers: headers }).then(function (r) { return r.ok ? r.blob() : null; })
      .then(function (b) { return b && /^image\//.test(b.type) ? URL.createObjectURL(b) : null; }).catch(function () { return null; });
  }
  function deadlineOf(x) {
    return (x.returnPlan && x.returnPlan.deadline) || (x.kind === "return_instructions" && x.deadline) || (x.returns && x.returns.deadline) || null;
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
    no_deadline: "There's no return deadline to remind you about.", deadline_passed: "That deadline has already passed.", consent_required: "Please agree to the permission step first.", invalid_or_expired_code: "That code is wrong or has expired. Check it, or request a new one.", invalid_or_expired_link: "That sign-in link has expired or was already used. Request a new one.", origin_not_allowed: "Sign-in isn't available from this address." };
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
        save({ token: r.body.sessionToken, email: r.body.email, expiresAt: r.body.expiresAt });
        keepStorage();
        var a = document.querySelector(".avatar"); if (a) a.textContent = r.body.email.charAt(0).toUpperCase();
        show();
      }).catch(function () { codeGo.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
    };
    [el("h2", { text: "Sign in to Relay" }),
     el("p", { text: "No password. We email you a one-time link. Purchases you made with that email address appear in your wallet." }),
     input, go, codeRow, msg, el("button", { className: "rl-btn ghost", text: "Close", onclick: close })].forEach(function (n) { sheet.appendChild(n); });
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
    if (x.hasImage && x.id) {
      var ph = el("img", { alt: "", style: "float:right;width:64px;height:64px;object-fit:cover;border-radius:12px;margin:0 0 8px 10px;background:#f1ecdf" });
      card.insertBefore(ph, card.firstChild);
      apiBlob("/relay/my/receipts/" + x.id + "/image").then(function (u) { if (u) ph.src = u; else ph.remove(); });
    }
    var left = daysLeft(deadlineOf(x));
    if (left !== null) {
      var pill = left < 0 ? ["Deadline passed", "#ece8dd", "#5b6475"] : left === 0 ? ["Return today", "#fde0dd", "#b3261e"] :
        left <= 2 ? [left + " day" + (left === 1 ? "" : "s") + " left", "#fde0dd", "#b3261e"] :
        left <= 7 ? [left + " days left", "#ffefc9", "#77520a"] : [left + " days left", "#e3f4c8", "#46601b"];
      card.appendChild(el("span", { text: pill[0], style: "display:inline-block;margin-top:6px;padding:4px 10px;border-radius:999px;font-weight:700;font-size:13px;background:" + pill[1] + ";color:" + pill[2] }));
      if (left >= 0 && x.id && x.reminder) {
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
    var rp = x.returnPlan || (x.kind === "return_instructions" ? x : null);
    if (rp) {
      var pb = el("div", { style: "margin-top:8px;padding:10px;border-radius:10px;background:rgba(127,127,127,.12);font-size:14px" });
      pb.appendChild(el("b", { text: "Your return", style: "display:block;margin-bottom:4px" }));
      var pl = function (t, st) { pb.appendChild(el("span", { text: t, style: "display:block;margin-top:2px;" + (st || "") })); };
      if (rp.deadline) {
        var past = rp.deadline < new Date().toISOString().slice(0, 10);
        pl((past ? "Deadline passed: " : "Return by ") + new Date(rp.deadline + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }), past ? "opacity:.7" : "font-weight:600");
      }
      if (rp.carrier) pl("Drop off with " + rp.carrier);
      if (rp.returnId) pl("Return ID: " + rp.returnId);
      (rp.steps || []).forEach(function (t) { pl("• " + t); });
      if (rp.estimatedRefundPence != null) pl("Estimated refund: " + money(rp.estimatedRefundPence, rp.currency) + " (an estimate from the email, not a confirmed refund)");
      if (/^[A-Za-z0-9]{6,40}$/.test(rp.gmailId || "")) {
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
      box.appendChild(el("p", { text: "Gmail connected" + (r.body.googleEmail ? ": " + r.body.googleEmail : "") + ". Relay only looks for order confirmations, receipts and return emails." }));
      var scanBtn = el("button", { className: "rl-btn", text: "Scan my Gmail for receipts" });
      var status = el("div", { className: "rl-msg" });
      var query = "";
      var search = el("input", { type: "search", placeholder: "Search your receipts (store, item, order number)", style: "margin-top:12px" });
      search.addEventListener("input", function () { query = search.value.trim().toLowerCase(); applyFilter(); });
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
      function loadList() {
        api("/relay/my/receipts").then(function (x) {
          list.textContent = "";
          var rows = (x.body && x.body.receipts) || [];
          if (!rows.length) list.appendChild(el("p", { text: "No receipts found yet." }));
          // Soonest deadline first, then everything without one, then expired ones.
          var rank = function (r) { var d = daysLeft(deadlineOf(r)); return d === null ? [1, 0] : d < 0 ? [2, -d] : [0, d]; };
          rows.sort(function (a, b) { var A = rank(a), B = rank(b); return A[0] - B[0] || A[1] - B[1]; });
          rows.forEach(function (row) {
            var card = receiptCard(row, loadList);
            var find = [row.retailer && row.retailer.name, row.retailer && row.retailer.domain, row.orderRef,
              (row.items || []).map(function (i) { return i.name; }).join(" ")].filter(Boolean).join(" ").toLowerCase();
            card.setAttribute("data-find", find);
            list.appendChild(card);
          });
          if (rows.length) list.appendChild(el("p", { className: "rl-none", text: "No receipts match that search.", style: "display:none" }));
          applyFilter();
        });
      }
      scanBtn.onclick = function () {
        scanBtn.disabled = true; say(status, "Scanning…");
        var added = 0, rounds = 0, saved = ""; try { saved = localStorage.getItem("relay_scan_cursor") || ""; } catch (e) {}
        function step(cursor) {
          return api("/relay/my/gmail/scan", { method: "POST", body: cursor ? { cursor: cursor } : {} }).then(function (x) {
            if (x.status === 401) { scanBtn.disabled = false; return say(status, "Google needs you to reconnect Gmail. Disconnect and connect again.", true); }
            if (!x.ok) { scanBtn.disabled = false; return say(status, "Couldn't scan Gmail right now. Please try again.", true); }
            added += (x.body.added || 0) + (x.body.updated || 0); rounds++;
            loadList();
            try { if (x.body.more && x.body.cursor) localStorage.setItem("relay_scan_cursor", x.body.cursor); else localStorage.removeItem("relay_scan_cursor"); } catch (e) {}
            if (x.body.more && x.body.cursor && rounds < 80) {
              var m = /^(\d{4})\/(\d{2})/.exec(x.body.scannedBack || "");
              var label = m ? new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : "";
              say(status, "Scanning" + (label ? " back to " + label : " older emails") + "… " + added + " found so far");
              return step(x.body.cursor);
            }
            scanBtn.disabled = false;
            say(status, (x.body.more ? "Stopped early. Scan again to carry on. " : "") + (added ? "Found or updated " + added + " receipt or return email" + (added === 1 ? "" : "s") + ". Please check them below." : "Nothing new found."));
          });
        }
        step(saved).catch(function () { scanBtn.disabled = false; say(status, "Couldn't reach Relay.", true); });
      };
      box.appendChild(scanBtn); box.appendChild(status); box.appendChild(search); box.appendChild(list); loadList();
      box.appendChild(el("button", { className: "rl-btn ghost", text: "Disconnect Gmail and delete captured receipts", onclick: function () {
        if (!confirm("Disconnect Gmail and delete every receipt Relay captured from it?")) return;
        api("/relay/my/gmail/disconnect", { method: "POST" }).then(function (x) { if (x.ok) gmailSection(box, c, msg); else say(msg, "Couldn't disconnect. Try again.", true); }); } }));
      if (window.__relayAutoScan) { window.__relayAutoScan = false; scanBtn.onclick(); }
    }).catch(function () { box.appendChild(el("p", { text: "Couldn't reach Relay." })); });
  }

  // ---- Swap & resell (v1: matches members; no payments or postage through Relay yet) ----
  var openResale = null;
  var CONDITION = { new_with_tags: "New with tags", like_new: "Like new", good: "Good", fair: "Fair" };
  var resaleErrors = { agreement_required: "Please tick the box to agree.", already_listed: "That item is already listed.", too_many_listings: "You have the maximum number of listings.",
    already_asked: "You've already asked about this one.", offer_one_of_your_listings: "Choose one of your own listings to offer.", swap_not_offered: "The seller isn't open to swaps.",
    not_found: "That's no longer available.", invalid_price: "Enter a price between £0 and £5,000.", too_many_requests: "Too many requests today. Try again tomorrow." };
  function resaleView(sheet, onBack, focusReceipt) {
    var body = el("div"), msg = el("div", { className: "rl-msg" });
    var tabs = el("div", { style: "display:flex;gap:6px;margin:10px 0" });
    var cur = focusReceipt ? "sell" : "browse";
    [["browse", "Browse"], ["mine", "Mine"], ["sell", "Sell"]].forEach(function (t) {
      var b = el("button", { className: "rl-btn ghost", text: t[1], style: "margin:0;padding:9px 6px;font-size:14px", onclick: function () { cur = t[0]; focusReceipt = null; draw(); } });
      b.setAttribute("data-tab", t[0]); tabs.appendChild(b);
    });
    [el("h2", { text: "Swap & resell" }),
     el("p", { text: "Passed your return window? Sell or swap with other Relay members. For now Relay only matches people. Payment and postage aren't built yet, so nothing is bought or sent through Relay." }),
     tabs, body, msg,
     el("button", { className: "rl-btn ghost", text: "Back", onclick: onBack })].forEach(function (n) { sheet.appendChild(n); });
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
        l.askPence == null ? "Price: open to offers" : l.askPence === 0 ? "Free" : money(l.askPence, l.currency), l.swapOk ? "Open to swaps" : null].filter(Boolean).join(" · ");
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
        if (!rows.length) body.appendChild(el("p", { text: "Nothing listed by other members yet. List something yourself from the Sell tab." }));
        rows.forEach(function (l) {
          var card = el("div", { className: "rl-order" }, [el("b", { text: l.title }), el("span", { text: facts(l) })]);
          photo(card, l.id, l.hasImage);
          if (l.note) card.appendChild(el("span", { text: "“" + l.note + "”", style: "display:block;margin-top:4px" }));
          if (l.myRequest) {
            card.appendChild(el("span", { text: "You asked about this (" + l.myRequest.status + ")", style: "display:block;margin-top:6px;font-weight:600" }));
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
            } else row.appendChild(el("span", { text: q.status === "accepted" ? "Accepted. Arranging the handover isn't built yet." : q.status, style: "display:block;margin-top:4px;opacity:.75" }));
            card.appendChild(row);
          });
          card.appendChild(el("button", { className: "rl-btn ghost", text: "Take this down", style: "margin-top:8px;padding:8px 12px;font-size:14px", onclick: function () {
            api("/relay/my/resale/listings/" + l.id + "/withdraw", { method: "POST" }).then(drawMine); } }));
          body.appendChild(card);
        });
        var mr = r.body.myRequests || [];
        if (mr.length) {
          body.appendChild(el("h2", { text: "Your requests", style: "font-size:18px;margin-top:14px" }));
          mr.forEach(function (q) { body.appendChild(el("div", { className: "rl-order" }, [el("b", { text: q.title }), el("span", { text: (q.kind === "swap" ? "Swap offered" : "You'd like to buy") + " · " + q.status })])); });
        }
      });
    }
    function drawSell() {
      body.appendChild(el("p", { text: "Loading your items…" }));
      api("/relay/my/resale/items").then(function (r) {
        body.textContent = "";
        if (!r.ok) return body.appendChild(el("p", { text: "Couldn't load your items." }));
        var items = (r.body.items || []).filter(function (i) { return !i.alreadyListed && (!focusReceipt || i.receiptId === focusReceipt); });
        if (!items.length) body.appendChild(el("p", { text: focusReceipt ? "That item is already listed." : "Nothing to list yet. Items come from the receipts Relay found in your Gmail." }));
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
        var agree = el("input", { type: "checkbox", style: "width:auto;margin:0 8px 0 0" });
        var go = el("button", { className: "rl-btn", text: "Put it on Relay", style: "margin-top:10px", onclick: function () {
          var p = price.value.trim(), pence = null;
          if (p) { var n = Number(p.replace(/[£,\s]/g, "")); if (!isFinite(n) || n < 0 || n > 5000) return tell(resaleErrors.invalid_price, true); pence = Math.round(n * 100); }
          go.disabled = true;
          api("/relay/my/resale/listings", { method: "POST", body: { receiptId: i.receiptId, itemIndex: i.itemIndex, condition: cond.value, size: size.value, askPence: pence, swapOk: swap.checked, note: note.value, agree: agree.checked } })
            .then(function (r) { go.disabled = false; if (r.ok) { cur = "mine"; focusReceipt = null; draw(); tell("Listed. Other members can now see it."); } else fail(r); });
        } });
        [cond, size, price, note,
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
    [el("h2", { text: "Your account" }), el("p", { text: email }), gbox, el("h2", { text: "Your purchases", style: "font-size:18px;margin-top:8px" }), list, msg].forEach(function (n) { sheet.appendChild(n); });
    if (notice) say(msg, notice.text, notice.bad);
    openResale = function (rid) { back.firstChild.textContent = ""; resaleView(back.firstChild, function () { gate(back.firstChild, email); }, rid); };
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
    sheet.appendChild(el("button", { className: "rl-btn", text: "Swap & resell", style: "margin-top:10px", onclick: function () { openResale(); } }));
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
      keepStorage();
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

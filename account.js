/* Relay shopper sign-in: emailed one-time link, session kept in this browser only.
   All server data is written with textContent (never innerHTML). */
(function () {
  var API = "https://relay-square-api2.9pts72cy5j.workers.dev";
  var KEY = "relay.session.v1";
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
    return api(path).then(function (r) { if (r.ok) memo[kind] = { at: Date.now(), r: r }; return r; });
  }
  function save(v) { if (!v) memoReset(); try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (e) {} }
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
        var a = document.querySelector(".avatar"); if (a) a.textContent = r.body.email.charAt(0).toUpperCase();
        show();
      }).catch(function () { codeGo.disabled = false; say(msg, "Couldn't reach Relay. Check your connection.", true); });
    };
    [el("h2", { text: "Sign in to Relay" }),
     el("p", { text: "No password. We email you a one-time link. Purchases you made with that email address appear in your wallet." }),
     input, go, codeRow, msg, el("button", { className: "rl-btn ghost", text: "Close", onclick: close })].forEach(function (n) { sheet.appendChild(n); });
    sheet.insertBefore(googleButton(msg), sheet.children[2]);
    if (passkeysSupported()) sheet.insertBefore(el("div", { style: "margin-top:10px" }, [passkeyButton(msg)]), sheet.children[3]);
    sheet.insertBefore(el("p", { text: "or", style: "text-align:center;opacity:.6;margin:8px 0" }), sheet.children[passkeysSupported() ? 4 : 3]);
  }
  // Identity only: Google tells Relay your verified email. Relay gets no access to Gmail from this button.
  function googleButton(msg) {
    var b = el("button", { className: "rl-btn", text: "Continue with Google", style: "background:#fff;color:#1f1f1f;border:1px solid #dadce0" });
    b.onclick = function () {
      b.disabled = true; say(msg, "Opening Google…");
      var bytes = new Uint8Array(32); (window.crypto || window.msCrypto).getRandomValues(bytes);
      var nonce = btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
          var a = document.querySelector(".avatar"); if (a) a.textContent = v.body.email.charAt(0).toUpperCase();
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
        var a = document.querySelector(".avatar"); if (a) a.textContent = r.body.email.charAt(0).toUpperCase();
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
      api("/relay/my/consent", { method: "POST", body: { version: c.version } }).then(function (r) { memo.consent = null; memo.gmail = null;
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
  function receiptCard(x, refresh, slim) {
    var who = (x.retailer && (x.retailer.name || x.retailer.domain)) || "Unknown store";
    var names = (x.items || []).map(function (i) { return i.qty + " × " + i.name; }).join(", ");
    var card = el("div", { className: "rl-order" }, [el("b", { text: who + (x.orderRef ? " · " + x.orderRef : "") }),
      el("span", { text: (names ? names + " · " : "") + (x.totalPence == null ? "total not found" : money(x.totalPence, x.currency)) + (x.orderDate ? " · " + x.orderDate : "") })]);
    if (slim) { card.removeChild(card.firstChild); card.removeChild(card.firstChild); card.style.margin = "0"; card.style.padding = "0"; card.style.border = "0"; card.style.boxShadow = "none"; card.style.background = "none"; }
    if (!slim && x.hasImage && x.id) {
      var ph = el("img", { alt: "", style: "float:right;width:64px;height:64px;object-fit:cover;border-radius:12px;margin:0 0 8px 10px;background:#f1ecdf" });
      card.insertBefore(ph, card.firstChild);
      apiBlob("/relay/my/receipts/" + x.id + "/image").then(function (u) { if (u) ph.src = u; else ph.remove(); });
    }
    if (x.returnable === false) card.appendChild(el("span", { text: "Usually can't be returned", style: "display:inline-block;margin:6px 6px 0 0;padding:4px 10px;border-radius:999px;font-weight:700;font-size:13px;background:#ece8dd;color:#5b6475" }));
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
    if (x.id && /^[A-Za-z0-9]{6,40}$/.test(x.gmailId || "") && openOriginal) {
      card.appendChild(el("button", { className: "rl-btn ghost", text: "View original receipt", style: "margin-top:8px;padding:9px 14px;font-size:14px", onclick: function () { openOriginal(x.id); } }));
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
      if (rt.qrMentioned) line("This email mentions a QR code. Tap “View original receipt” to see it.");
      else if (rt.labelMentioned) line("A label or drop-off option is mentioned. Tap “View original receipt” to see it.");
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
      if (rp.id && /^[A-Za-z0-9]{6,40}$/.test(rp.gmailId || "") && openOriginal) {
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
    ask("Disconnect Gmail and delete every receipt Relay captured from it?", "Disconnect and delete", function () {
      api("/relay/my/gmail/disconnect", { method: "POST" }).then(function (x) { if (x.ok) { memo.gmail = null; memo.receipts = null; memo.openCat = null; done(); } else say(msg, "Couldn't disconnect. Try again.", true); });
    });
  }
  function gmailSection(box, c, msg, onPage) {
    box.textContent = "";
    box.appendChild(el("h2", { text: "Your receipts", style: "font-size:18px;margin-top:8px" }));
    var list = el("div");
    cachedGet("gmail", "/relay/my/gmail").then(function (r) {
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
      var lastScan = r.body.lastScanAt ? new Date(r.body.lastScanAt) : null;
      var scanBtn = el("button", { className: "rl-btn", text: lastScan ? "Check for new receipts" : "Scan my Gmail for receipts" });
      var status = el("div", { className: "rl-msg" });
      if (lastScan) status.textContent = "Your receipts are saved. Last checked " + lastScan.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ".";
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
      var glyphs = { fashion: "👕", electronics: "🔌", food: "🍽️", home: "🏠", beauty: "💄", travel: "🧳", digital: "☁️", other: "🧾" };
      var allRows = memo.receipts ? memo.receipts.rows : [];
      function pill(text, bg, fg) { return el("span", { text: text, style: "display:inline-block;margin-top:4px;padding:3px 9px;border-radius:999px;font-weight:700;font-size:12px;background:" + bg + ";color:" + fg }); }
      // One tidy line per receipt: picture, shop name (opens the original email), what was bought, price and date.
      function receiptRow(row) {
        var who = (row.retailer && (row.retailer.name || row.retailer.domain)) || "Unknown store";
        var names = (row.items || []).map(function (i) { return i.name; }).join(", ");
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
        var canOpen = row.id && /^[A-Za-z0-9]{6,40}$/.test(row.gmailId || "") && openOriginal;
        var shop = canOpen ? el("button", { text: who, title: "Open the original receipt", style: "all:unset;cursor:pointer;font-weight:800;text-decoration:underline;text-underline-offset:3px;display:block;font-size:16px", onclick: function () { openOriginal(row.id); } })
          : el("b", { text: who, style: "display:block;font-size:16px" });
        var meta = [names ? (names.length > 60 ? names.slice(0, 57) + "…" : names) : null, row.totalPence == null ? null : money(row.totalPence, row.currency), row.orderDate].filter(Boolean).join(" · ");
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
          Object.keys(glyphs).forEach(function (k) { pick.appendChild(el("option", { value: k, text: groupNames[k] || k })); });
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
        if (!rows.length) { list.appendChild(el("p", { text: "No receipts found yet." })); return; }
        // Soonest deadline first, then no deadline, then expired.
        var rank = function (r) { var d = daysLeft(deadlineOf(r)); return d === null ? [1, 0] : d < 0 ? [2, -d] : [0, d]; };
        var sorted = rows.slice().sort(function (a, b) { var A = rank(a), B = rank(b); return A[0] - B[0] || A[1] - B[1]; });
        if (query) { sorted.forEach(function (r) { list.appendChild(receiptRow(r)); }); list.appendChild(el("p", { className: "rl-none", text: "No receipts match that search.", style: "display:none" })); applyFilter(); return; }
        var by = {}; sorted.forEach(function (r) { var k = r.category || "other"; (by[k] = by[k] || []).push(r); });
        var keys = Object.keys(by).sort(function (a, b) { var na = by[a][0].returnable === false ? 1 : 0, nb = by[b][0].returnable === false ? 1 : 0; return na - nb || by[b].length - by[a].length; });
        if (memo.openCat && by[memo.openCat]) {
          list.appendChild(el("button", { className: "rl-btn ghost", text: "‹ All groups", style: "width:auto;padding:8px 14px;font-size:14px", onclick: function () { memo.openCat = null; drawList(); window.scrollTo && window.scrollTo(0, 0); } }));
          list.appendChild(el("h3", { text: (glyphs[memo.openCat] || "") + " " + groupNames[memo.openCat] + " (" + by[memo.openCat].length + ")", style: "font-size:20px;margin:14px 0 4px;color:#0f1b33" }));
          if (by[memo.openCat][0].returnable === false && by[memo.openCat][0].notReturnableReason) list.appendChild(el("p", { text: by[memo.openCat][0].notReturnableReason, style: "font-size:13px;margin:0 0 8px" }));
          by[memo.openCat].forEach(function (r) { list.appendChild(receiptRow(r)); });
          return;
        }
        memo.openCat = null;
        var grid = el("div", { style: "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:8px;max-width:520px" });
        keys.forEach(function (k) {
          var soon = by[k].filter(function (r) { var d = daysLeft(deadlineOf(r)); return d !== null && d >= 0 && d <= 7; }).length;
          var check = by[k].filter(function (r) { return r.status !== "confirmed" && r.needsShopperConfirmation; }).length;
          var sub = soon ? soon + " return deadline" + (soon === 1 ? "" : "s") + " soon" : by[k][0].returnable === false ? "Usually can't be returned" : check ? check + " to check" : "All looks fine";
          grid.appendChild(el("button", { type: "button", ariaLabel: groupNames[k] + ", " + by[k].length + " receipts", onclick: function () { memo.openCat = k; drawList(); window.scrollTo && window.scrollTo(0, 0); },
            style: "all:unset;cursor:pointer;box-sizing:border-box;aspect-ratio:1/1;border-radius:22px;padding:16px;display:flex;flex-direction:column;justify-content:space-between;background:#fff;border:1px solid #e7e1d2;box-shadow:0 2px 10px rgba(15,27,51,.06)" },
            [el("span", { text: glyphs[k] || "🧾", style: "font-size:34px" }),
             el("span", {}, [el("b", { text: groupNames[k], style: "display:block;font-size:17px;color:#0f1b33" }), el("span", { text: by[k].length + (by[k].length === 1 ? " receipt" : " receipts"), style: "display:block;font-size:14px;opacity:.8;margin-top:2px" }), el("span", { text: sub, style: "display:block;font-size:12px;margin-top:6px;color:" + (soon ? "#b3261e" : "#5b6475") + ";font-weight:" + (soon ? "700" : "400") })])]));
        });
        list.appendChild(grid);
      }
      var drawnSig = null;
      function loadList() {
        // Show what was loaded last time straight away, then quietly update if anything changed.
        if (drawnSig === null && memo.receipts) { allRows = memo.receipts.rows; drawnSig = memo.receipts.sig; drawList(); }
        api("/relay/my/receipts").then(function (x) {
          if (!x.ok) { if (drawnSig === null) drawList(); return; }
          var rows = (x.body && x.body.receipts) || [], sig = JSON.stringify(rows);
          memo.receipts = { rows: rows, sig: sig, at: Date.now() };
          if (sig === drawnSig) return;
          allRows = rows; drawnSig = sig; memoDrop("wrapped"); drawList();
        });
      }
      var doScan = function (full) {
        scanBtn.disabled = true; say(status, lastScan && !full ? "Checking for new mail…" : "Scanning…");
        var added = 0, rounds = 0, saved = ""; try { saved = localStorage.getItem("relay_scan_cursor") || ""; } catch (e) {}
        function step(cursor) {
          return api("/relay/my/gmail/scan", { method: "POST", body: Object.assign(cursor ? { cursor: cursor } : {}, full ? { full: true } : {}) }).then(function (x) {
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
            scanBtn.disabled = false; memo.gmail = null;
            say(status, (x.body.more ? "Stopped early. Scan again to carry on. " : "") + (added ? "Found or updated " + added + " receipt or return email" + (added === 1 ? "" : "s") + ". Please check them below." : "Nothing new found."));
          });
        }
        step(full ? "" : saved).catch(function () { scanBtn.disabled = false; say(status, "Couldn't reach Relay.", true); });
      };
      scanBtn.onclick = function () { doScan(false); };
      box.appendChild(scanBtn); box.appendChild(status); box.appendChild(search); box.appendChild(list); loadList();
      // On the Receipts page these housekeeping options stay out of the way; they live under the account button (top right).
      if (!onPage) {
        if (lastScan) box.appendChild(el("button", { className: "rl-btn ghost", text: "Re-scan all my email (slower)", onclick: function () { doScan(true); } }));
        if (openFind) box.appendChild(el("button", { className: "rl-btn ghost", text: "Can't find a receipt? Search Gmail for it", onclick: function () { openFind(); } }));
        box.appendChild(el("button", { className: "rl-btn ghost", text: "Disconnect Gmail and delete captured receipts", onclick: function () { disconnectGmail(function () { gmailSection(box, c, msg, onPage); }, msg); } }));
      }
      if (window.__relayAutoFull) { window.__relayAutoFull = false; window.__relayAutoScan = false; doScan(true); }
      else if (window.__relayAutoScan) { window.__relayAutoScan = false; scanBtn.onclick(); }
    }).catch(function () { box.appendChild(el("p", { text: "Couldn't reach Relay." })); });
  }

  // ---- View original receipt: fetched live from Gmail when opened; nothing is stored ----
  var openOriginal = null;
  function originalView(sheet, receiptId, onBack) {
    var msg = el("div", { className: "rl-msg" });
    var body = el("div");
    [el("h2", { text: "Original receipt" }), el("p", { text: "Loading it from your Gmail…", style: "opacity:.7" }), body, msg,
      el("button", { className: "rl-btn ghost", text: "Back", onclick: onBack })].forEach(function (n) { sheet.appendChild(n); });
    var note = sheet.children[1];
    api("/relay/my/receipts/" + encodeURIComponent(receiptId) + "/original").then(function (r) {
      if (!r.ok) {
        note.textContent = r.body && r.body.error === "gmail_reconnect_needed" ? "Gmail needs to be reconnected. Go back and tap Connect Gmail."
          : r.status === 404 ? "That email is no longer in your Gmail, so it can't be shown."
          : "Couldn't load the original email. Try again in a moment.";
        return;
      }
      note.textContent = "Shown straight from your Gmail. Relay doesn't keep a copy.";
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

  // ---- Find a missing receipt: search Gmail by store name, pick the right email, add it ----
  var openFind = null;
  function findView(sheet, onBack) {
    var input = el("input", { type: "search", placeholder: "Store name, e.g. lululemon", style: "margin-top:8px" });
    var go = el("button", { className: "rl-btn", text: "Search my Gmail" });
    var msg = el("div", { className: "rl-msg" }), out = el("div");
    [el("h2", { text: "Find a missing receipt" }),
     el("p", { text: "Search your Gmail for a store, then pick the order confirmation email. Relay only reads the one you pick.", style: "font-size:14px;opacity:.8" }),
     input, go, msg, out, el("button", { className: "rl-btn ghost", text: "Back", onclick: onBack })].forEach(function (n) { sheet.appendChild(n); });
    function search() {
      var q = input.value.trim();
      if (q.length < 2) return say(msg, "Type at least 2 letters of the store name.", true);
      go.disabled = true; out.textContent = ""; say(msg, "Searching…");
      api("/relay/my/gmail/find", { method: "POST", body: { query: q } }).then(function (r) {
        go.disabled = false;
        if (!r.ok) return say(msg, r.body && r.body.error === "gmail_reconnect_needed" ? "Gmail needs to be reconnected first." : r.status === 409 ? "Connect Gmail first." : "Couldn't search Gmail right now. Try again.", true);
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
  var resaleErrors = { not_resellable: "Only physical items can be listed. Food, travel and digital purchases can't be resold.", account_restricted: "Your account can't use the swap and resell board right now.", agreement_required: "Please tick the box to agree.", already_listed: "That item is already listed.", too_many_listings: "You have the maximum number of listings.",
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
    [head, sub, log, input, send, msg, tools, el("button", { className: "rl-btn ghost", text: "Back", onclick: function () { stop(); onBack(); } })].forEach(function (n) { sheet.appendChild(n); });
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
     onBack ? el("p", { text: "Passed your return window? Sell or swap with other Relay members. For now Relay only matches people. Payment and postage aren't built yet, so nothing is bought or sent through Relay." }) : null,
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
      gbox.appendChild(el("p", { text: "Connect Gmail, scan for receipts and see them grouped by store type. Everything lives on the Receipts page." }));
      gbox.appendChild(el("button", { className: "rl-btn", text: "Open my receipts", onclick: function () { close(); window.go("receipts"); } }));
      api("/relay/my/gmail").then(function (g) {
        if (!g.ok || !g.body || !g.body.connected) return;
        gbox.appendChild(el("button", { className: "rl-btn ghost", text: "Re-scan all my email (slower)", onclick: function () { window.__relayAutoFull = true; close(); window.go("receipts"); } }));
        gbox.appendChild(el("button", { className: "rl-btn ghost", text: "Can't find a receipt? Search Gmail for it", onclick: function () { openFind(); } }));
        gbox.appendChild(el("button", { className: "rl-btn ghost", text: "Disconnect Gmail and delete captured receipts", onclick: function () { disconnectGmail(function () { back.firstChild.textContent = ""; gate(back.firstChild, email); }, msg); } }));
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
      ask("Withdraw permission? Relay will disconnect Gmail and delete everything it captured. You'll be asked again next time you open your account.", "Withdraw permission", function () {
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
    var s = load(); if (s && s.email) a.textContent = s.email.charAt(0).toUpperCase();
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
      if (r.body.needsSecondStep) return open(function (sheet) { secondStepView(sheet, r.body.pendingToken); });
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
    memo.gmail = null; memo.receipts = null;
    window.__relayAutoScan = m[1] === "connected";
    if (window.go) { window.__relayReceiptsNote = { text: gmailNotes[m[1]][0], bad: gmailNotes[m[1]][1] }; window.go("receipts"); return; }
    open(function (sheet) { gate(sheet, s.email || "", { text: gmailNotes[m[1]][0], bad: gmailNotes[m[1]][1] }); });
  }
  function completeGoogleNote() {
    var m = /(?:^|[#&])gsignin=(denied|failed)(?:&|$)/.exec(location.hash || "");
    if (!m) return;
    try { history.replaceState(null, "", location.pathname + location.search); localStorage.removeItem("relay_gnonce"); } catch (e) {}
    open(function (sheet) {
      sheet.appendChild(el("h2", { text: m[1] === "denied" ? "Google sign-in cancelled" : "Google sign-in didn't work" }));
      sheet.appendChild(el("p", { text: m[1] === "denied" ? "No problem. You can try again or use an email link instead." : "Please try again, or use an email link instead." }));
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
        host.appendChild(el("p", { text: "Relay needs your OK before it looks at your receipts. It takes a moment." }));
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
    year = year || new Date().getFullYear();
    var s = load();
    var dark = "background:#101828;color:#fff;border-radius:24px;padding:22px;max-width:520px;margin:0 auto";
    var box = el("div", { style: dark }, []);
    host.appendChild(box);
    box.appendChild(el("div", { text: "✦ RELAY WRAPPED " + year, style: "color:#d6f9a8;font-size:12px;font-weight:900;letter-spacing:2px" }));
    box.appendChild(el("h2", { text: "Your " + year + ", in purchases.", style: "font-size:34px;letter-spacing:-1.5px;line-height:1.08;margin:12px 0" }));
    if (!s || !s.token) {
      box.appendChild(el("p", { text: "Sign in and connect Gmail, and Relay builds this from your real receipts.", style: "color:#d4d4e5;line-height:1.5" }));
      box.appendChild(el("button", { className: "rl-btn", text: "Sign in", style: "max-width:240px", onclick: show }));
      box.appendChild(el("p", { style: "font-size:12px;margin-top:16px" }, [el("a", { href: "wrapped.html", text: "See a sample with made-up numbers", style: "color:#d6f9a8" })]));
      return;
    }
    var yrs = el("div", { style: "display:flex;gap:8px;margin:0 0 14px" });
    [year === new Date().getFullYear() ? year : new Date().getFullYear(), new Date().getFullYear() - 1].forEach(function (y) {
      yrs.appendChild(el("button", { type: "button", text: String(y), "aria-pressed": y === year ? "true" : "false", style: "border:1px solid #5a5276;border-radius:20px;padding:6px 14px;font-weight:800;color:" + (y === year ? "#243113" : "#fff") + ";background:" + (y === year ? "#c7f567" : "transparent"), onclick: function () { mountWrapped(host, y); } }));
    });
    box.appendChild(yrs);
    var body = el("div", {}, [el("p", { text: "Adding it up…", style: "color:#d4d4e5" })]);
    box.appendChild(body);
    function draw(w) {
      body.textContent = "";
      if (!w.receipts) {
        body.appendChild(el("p", { text: "No receipts found for " + year + " yet. Connect Gmail on the Receipts tab and Relay will find your order emails.", style: "color:#d4d4e5;line-height:1.5" }));
        body.appendChild(el("button", { className: "rl-btn", text: "Go to Receipts", style: "max-width:240px", onclick: function () { if (window.go) window.go("receipts"); } }));
        return;
      }
      function tile(label, big, small, bg, fg) {
        return el("div", { style: "border-radius:20px;padding:16px;min-height:130px;display:flex;flex-direction:column;justify-content:space-between;background:" + bg + ";color:" + fg }, [
          el("span", { text: label, style: "font-size:12px;font-weight:700" }), el("strong", { text: big, style: "font-size:28px;letter-spacing:-1px;line-height:1.05;word-break:break-word" }), el("small", { text: small, style: "font-size:11px" })]);
      }
      var cat = w.categories[0];
      var grid = el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:10px" }, [
        tile("Total spent", w.coverage.withTotal ? money(w.spentPence, "GBP") : "—", w.coverage.withTotal ? "Across " + w.shops + (w.shops === 1 ? " shop" : " shops") : "No readable amounts yet", "#30255d", "#e4d8ff"),
        tile("Items bought", String(w.items), w.receipts + (w.receipts === 1 ? " receipt" : " receipts"), "#c7f567", "#243113"),
        tile("Favourite group", cat ? cat.label : "—", cat ? cat.receipts + (cat.receipts === 1 ? " receipt" : " receipts") : "", "#f6c7e2", "#57233f"),
        tile("Returns started", String(w.returnsStarted), "Return emails matched to a purchase", "#263f8c", "#d7e4ff")
      ]);
      body.appendChild(grid);
      var gaps = [];
      if (w.coverage.noTotal) gaps.push(w.coverage.noTotal + " with no readable amount");
      if (w.coverage.otherCurrency) gaps.push(w.coverage.otherCurrency + " not in pounds");
      body.appendChild(el("p", { text: "Spending is added up from " + w.coverage.withTotal + " of " + w.receipts + " receipts" + (gaps.length ? " (" + gaps.join(", ") + " left out)." : "."), style: "font-size:12px;color:#cfc9e4;margin:10px 0" }));
      if (w.personality) body.appendChild(el("div", { style: "background:#241c46;border-radius:20px;padding:18px;margin-top:6px" }, [
        el("div", { text: "WHAT YOUR RECEIPTS SAY", style: "color:#d9cbff;font-size:12px;font-weight:800;letter-spacing:1px" }),
        el("h3", { text: w.personality.label, style: "font-size:26px;margin:8px 0;color:#fff" }),
        el("p", { text: w.personality.why, style: "color:#e3dff0;font-size:14px;margin:0" })]));
      var facts = [];
      if (w.biggest) facts.push("Biggest single purchase: " + money(w.biggest.totalPence, "GBP") + " at " + w.biggest.shop + (w.biggest.date ? " on " + w.biggest.date : "") + ".");
      if (w.busiestMonth) facts.push("Busiest month: " + w.busiestMonth + ".");
      facts.forEach(function (f) { body.appendChild(el("p", { text: f, style: "color:#e3dff0;font-size:14px;margin:10px 0 0" })); });
      var tops = el("div", { style: "background:#171d37;border-radius:20px;padding:16px;margin-top:12px" }, [el("div", { text: "YOUR TOP SHOPS", style: "color:#d6f9a8;font-size:12px;font-weight:900;letter-spacing:1.3px;margin-bottom:8px" })]);
      w.topShops.forEach(function (sh, i) {
        tops.appendChild(el("div", { style: "display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid #2a3150;font-size:14px" }, [
          el("span", { text: (i + 1) + ". " + sh.name }), el("span", { text: (sh.spentPence ? money(sh.spentPence, "GBP") + " · " : "") + sh.receipts + (sh.receipts === 1 ? " receipt" : " receipts"), style: "color:#cfc9e4;white-space:nowrap" })]));
      });
      body.appendChild(tops);
      var max = Math.max.apply(null, w.byMonth.map(function (m) { return m.receipts; })) || 1;
      var bars = el("div", { style: "display:flex;align-items:flex-end;gap:5px;height:90px;margin-top:12px" });
      w.byMonth.forEach(function (m) { bars.appendChild(el("div", { title: m.month + ": " + m.receipts + (m.receipts === 1 ? " receipt" : " receipts"), style: "flex:1;background:#9d87ee;border-radius:6px 6px 0 0;min-height:4px;height:" + Math.max(4, Math.round(m.receipts / max * 100)) + "%" })); });
      var labels = el("div", { style: "display:flex;gap:5px;color:#c7c5d7;font-size:9px;margin-top:6px" });
      w.byMonth.forEach(function (m) { labels.appendChild(el("span", { text: m.month.slice(0, 1), style: "flex:1;text-align:center" })); });
      body.appendChild(el("div", { style: "background:#171d37;border-radius:20px;padding:16px;margin-top:12px" }, [el("div", { text: "RECEIPTS PER MONTH", style: "color:#d6f9a8;font-size:12px;font-weight:900;letter-spacing:1.3px" }), bars, labels]));
      body.appendChild(el("p", { text: w.note, style: "font-size:12px;color:#cfc9e4;margin-top:14px;border:1px solid #5a5276;border-radius:14px;padding:12px" }));
    }
    cachedGet("wrapped" + year, "/relay/my/wrapped?year=" + year).then(function (r) {
      if (r.status === 401) { save(null); mountWrapped(host, year); return; }
      if (!r.ok) { body.textContent = ""; body.appendChild(el("p", { text: "Couldn't build Wrapped just now. Please try again.", style: "color:#d4d4e5" })); return; }
      draw(r.body);
    }).catch(function () { body.textContent = ""; body.appendChild(el("p", { text: "Couldn't reach Relay.", style: "color:#d4d4e5" })); });
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
        el("p", { className: "small", style: "margin:6px 0 0", text: (result.shopNotified ? "We've emailed " + shop + " to say this return is coming. " : "Relay hasn't been able to contact " + shop + " about this. ") + shop + " hasn't set up Royal Mail labels in Relay, so to send the item back, use " + shop + "'s own returns process (usually in your order confirmation email or on their website). Your refund comes from " + shop + "." })
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
    price_changed: "The price has just changed. Close this and look again." };
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
            var viaShop = d > 0 && x.payBy === "shopify";
            var what = d === 0 ? "Same price, nothing to pay or refund."
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
  function mountConfirmed(host) {
    if (!host) return;
    host.textContent = "";
    var s = load(); if (!s || !s.token) return;
    api("/relay/my/purchases").then(function (r) {
      var rows = (r.ok && r.body && r.body.purchases) || [];
      if (!rows.length) return;
      host.appendChild(el("div", { className: "sectionhead" }, [el("h2", { text: "Confirmed by the shop" }), el("span", { className: "pill", text: rows.length + " order" + (rows.length === 1 ? "" : "s") })]));
      host.appendChild(el("p", { className: "small muted", text: "Orders placed with your Relay email at shops connected to Relay. The shop confirmed these, so you can exchange items here." }));
      var grid = el("div", { className: "purchase-grid" }); host.appendChild(grid);
      rows.forEach(function (o) {
        (o.items || []).forEach(function (it) {
          var card = el("div", { className: "card product" });
          var art = el("div", { className: "art" });
          if (it.imageUrl && /^https:\/\//.test(it.imageUrl)) art.appendChild(el("img", { src: it.imageUrl, alt: "", style: "width:100%;height:100%;object-fit:cover;border-radius:16px" })); else art.textContent = "🛍";
          card.appendChild(art);
          var d = el("div", { className: "details" });
          d.appendChild(el("div", { className: "eyebrow", text: String(o.store || "Shop").toUpperCase() + " · ✓ CONFIRMED BY THE SHOP" }));
          d.appendChild(el("h3", { text: it.title }));
          d.appendChild(el("div", { className: "small muted", text: (it.variant ? it.variant + " · " : "") + "Qty " + it.quantity + " · " + new Date(o.orderedAt).toLocaleDateString("en-GB") }));
          d.appendChild(el("div", { className: "price", text: money(it.priceMinor, it.currency) }));
          if (it.exchange) d.appendChild(el("p", { className: "small watch", text: "✓ Exchanged" + (it.exchange.fromTitle ? " from " + it.exchange.fromTitle : "") + " to " + it.exchange.toTitle + " through Relay" }));
          if (it.returnInfo) {
            var ri = it.returnInfo, refunded = ri.status === "refunded";
            d.appendChild(el("p", { className: "small " + (refunded ? "watch" : "muted"), text: refunded
              ? "✓ Refunded" + (ri.refundMinor ? " " + money(ri.refundMinor, it.currency) : "") + " by " + (o.store || "the shop") + (ri.refundedAt ? " on " + new Date(ri.refundedAt).toLocaleDateString("en-GB") : "")
              : "Return started · ref " + ri.ref + (ri.trackingNumber ? " · Royal Mail " + ri.trackingNumber : "") + " · waiting for " + (o.store || "the shop") + " to refund" }));
          }
          if (it.exchangeable) d.appendChild(el("button", { className: "darkbtn", text: "Exchange size or colour →", onclick: function () { openExchange(o, it, function () { mountConfirmed(host); }); } }));
          if (it.returnable) d.appendChild(el("button", { className: "ghostbtn", text: "Return →", style: "margin-top:6px", onclick: function () { openReturn(o, it, function () { mountConfirmed(host); }); } }));
          card.appendChild(d); grid.appendChild(card);
        });
      });
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
  window.RelayAccount = { mountConfirmed: mountConfirmed, mountAlerts: mountAlerts, enablePush: enablePush, syncWatch: syncWatch, syncStore: syncStore, alertStatus: alertStatus, tasteRows: function () { return cachedGet("taste", "/relay/my/receipts").then(function (r) { return r.ok ? (r.body.receipts || []) : []; }); }, mountWrapped: mountWrapped, mountMarket: mountMarket, mountReceipts: mountReceipts, open: function () { show(); }, signedIn: function () { var s = load(); return Boolean(s && s.token); }, receipts: function () { return api("/relay/my/receipts"); } };
  function start() { bind(); completeGoogleNote(); completeLinkSignIn(); completeGmail(); window.addEventListener("hashchange", function () { completeGoogleNote(); completeLinkSignIn(); completeGmail(); }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();

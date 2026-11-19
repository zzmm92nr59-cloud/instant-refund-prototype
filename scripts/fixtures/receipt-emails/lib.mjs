import { mailText } from "../../../worker/receipt-parser.js";
// Helpers for the receipt-email corpus (make-corpus.mjs). Every shop name in the corpus is a real UK sender, but every
// order, person, address, order number and card in it is MADE UP: there is no real customer's data here. The layouts are
// written to look like each sender's order emails as they are commonly laid out; real emails can differ, which is why
// the totals check exists (worker/receipt-check.js).

export const SHOPPER = { name: "Sam Taylor", first: "Sam", email: "sam.taylor@example.co.uk", address: "12 Example Road, Leeds, LS1 4AB", phone: "07700 900123" };

export const gbp = (p) => {
  const neg = p < 0, a = Math.abs(p);
  const pounds = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + "£" + pounds + "." + String(a % 100).padStart(2, "0");
};

// items: [{ name, qty, unit, extras?, unavailable?, substituted? }]. Sums worked out here, so what the email prints always
// adds up exactly as the shop's would.
export function order(items, { fees = [], discounts = [], tips = [], included = [] } = {}) {
  const lines = items.map((i) => ({ ...i, qty: i.qty || 1, line: (i.qty || 1) * i.unit }));
  const bought = lines.filter((i) => !i.unavailable);
  const subtotal = bought.reduce((n, i) => n + i.line, 0);
  const feeSum = fees.reduce((n, [, p]) => n + p, 0), discSum = discounts.reduce((n, [, p]) => n + p, 0), tipSum = tips.reduce((n, [, p]) => n + p, 0);
  return { lines, bought, subtotal, fees, discounts, tips, included, feeSum, discSum, tipSum, total: subtotal + feeSum - discSum + tipSum };
}

// The answer key for one fixture.
export function expected(shop, date, o, extra = {}) {
  return {
    shop, date, currency: "GBP",
    items: o.bought.map((i) => ({ name: i.name, qty: i.qty, linePence: i.line, ...(i.extras && i.extras.length ? { extras: i.extras } : {}) })),
    subtotalPence: o.subtotal, feesPence: o.feeSum, discountsPence: o.discSum, tipsPence: o.tipSum, totalPence: o.total,
    ...extra,
  };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/£/g, "&pound;").replace(/’/g, "&rsquo;").replace(/®/g, "&reg;").replace(/™/g, "&trade;");
export const h = esc;

// A shop's email page: header logo, rows, footer. Table layout, as email builders make it.
export function page({ brand, domain, rows, footer, preheader = "", jsonLd = "" }) {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8" /><meta name="viewport" content="width=device-width" />
<title>${esc(brand)}</title><style type="text/css">body{margin:0;padding:0}td{font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#222}.muted{color:#777}@media only screen and (max-width:600px){.w600{width:100%!important}}</style>${jsonLd}</head>
<body style="margin:0;padding:0;background-color:#f3f3f3">
<div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f3f3"><tr><td align="center">
<table role="presentation" class="w600" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff">
<tr><td style="padding:24px 24px 8px 24px"><a href="https://www.${domain}/?utm_source=email"><img src="https://www.${domain}/static/email/logo.png" alt="${esc(brand)}" width="140" height="40" border="0" /></a></td></tr>
${rows.map((r) => `<tr><td style="padding:6px 24px">${r}</td></tr>`).join("\n")}
<tr><td style="padding:24px;font-size:12px" class="muted">${footer || `&copy; 2026 ${esc(brand)}. All rights reserved.<br /><a href="https://www.${domain}/help">Help</a> | <a href="https://www.${domain}/privacy">Privacy</a> | <a href="https://www.${domain}/unsubscribe">Unsubscribe</a>`}</td></tr>
</table></td></tr></table>
<img src="https://click.${domain}/open/abc123.gif" width="1" height="1" alt="" />
</body></html>`;
}

// A table of rows, each a list of cells (strings are HTML already).
export const table = (rows, attrs = 'width="100%" cellpadding="4" cellspacing="0" border="0"') =>
  `<table role="presentation" ${attrs}>${rows.map((cells) => `<tr>${cells.map((c) => (typeof c === "object" && c && c.td ? `<td ${c.attrs || ""}>${c.td}</td>` : `<td>${c}</td>`)).join("")}</tr>`).join("")}</table>`;

// The money rows under the items, as most shops print them.
export function moneyRows(o, labels = {}) {
  const rows = [];
  if (labels.subtotal !== false) rows.push([esc(labels.subtotal || "Subtotal"), gbp(o.subtotal)]);
  for (const [l, p] of o.fees) rows.push([esc(l), p === 0 ? (labels.free || "FREE") : gbp(p)]);
  for (const [l, p] of o.discounts) rows.push([esc(l), gbp(-p)]);
  for (const [l, p] of o.tips) rows.push([esc(l), gbp(p)]);
  rows.push([`<strong>${esc(labels.total || "Total")}</strong>`, `<strong>${gbp(o.total)}</strong>`]);
  return rows;
}
export function moneyText(o, labels = {}, pad = " ") {
  const out = [];
  if (labels.subtotal !== false) out.push((labels.subtotal || "Subtotal") + pad + gbp(o.subtotal));
  for (const [l, p] of o.fees) out.push(l + pad + (p === 0 ? (labels.free || "FREE") : gbp(p)));
  for (const [l, p] of o.discounts) out.push(l + pad + gbp(-p));
  for (const [l, p] of o.tips) out.push(l + pad + gbp(p));
  out.push((labels.total || "Total") + pad + gbp(o.total));
  return out.join("\n");
}

export function fixture(id, sender, layout, { from, subject, date, html = "", text = "", to = SHOPPER.email }, exp) {
  return { id, sender, layout, headers: { from, to, subject, date }, html, text, expected: exp };
}

// A raw email (RFC 822, as Gmail's "raw" format gives it) made from a fixture: multipart/alternative when it has both parts.
// A fixture written as the exact bytes a mailbox gives (rawB64, round 4: MIME layouts, other character sets, attachments)
// goes through the same step the mailbox readers use to turn those bytes into text (mailText, worker/receipt-parser.js).
export function rawEmail(f) {
  if (f.rawB64) return mailText(Buffer.from(f.rawB64, "base64"));
  const H = f.headers;
  const head = `From: ${H.from}\r\nTo: ${H.to}\r\nSubject: ${H.subject}\r\nDate: ${H.date}\r\nMessage-ID: <${f.id}@corpus.relay.test>\r\nMIME-Version: 1.0\r\n`;
  const b64 = (s) => Buffer.from(s, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const qp = (s) => Buffer.from(s, "utf8").toString("binary").split("").map((c) => {
    const n = c.charCodeAt(0);
    return n > 126 || c === "=" ? "=" + n.toString(16).toUpperCase().padStart(2, "0") : c;
  }).join("").replace(/\r?\n/g, "\r\n").split("\r\n").map((line) => {
    const out = []; let l = line;
    while (l.length > 75) { let cut = 75; while (cut > 0 && /=[0-9A-F]?$/.test(l.slice(0, cut))) cut--; out.push(l.slice(0, cut) + "="); l = l.slice(cut); }
    out.push(l); return out.join("\r\n");
  }).join("\r\n");
  let body;
  if (f.html && f.text) {
    const b = "=_relay_" + f.id.replace(/[^a-z0-9]/gi, "");
    body = `Content-Type: multipart/alternative; boundary="${b}"\r\n\r\n--${b}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qp(f.text)}\r\n--${b}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(f.html)}\r\n--${b}--\r\n`;
  } else if (f.html) body = `Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qp(f.html)}`;
  else body = `Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qp(f.text)}`;
  // Files attached to the email (attach: [{ type, name }], round 4), which a forward carries with it: made-up bytes only.
  if (!f.attach || !f.attach.length) return head + body;
  const m = "=_relay_mix_" + f.id.replace(/[^a-z0-9]/gi, "");
  return head + `Content-Type: multipart/mixed; boundary="${m}"\r\n\r\n--${m}\r\n${body}\r\n` + f.attach.map((a) =>
    `--${m}\r\nContent-Type: ${a.type}; name="${a.name}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${a.name}"\r\n\r\n${Buffer.from("made-up attachment " + a.name).toString("base64")}\r\n`).join("") + `--${m}--\r\n`;
}

// The same email forwarded by the shopper from their own inbox, the way each email app writes a forward.
const fwdDate = (d) => { const t = new Date(d); return { gmail: t.toUTCString().replace(/^(\w{3}), (\d{2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}).*$/, "$1, $2 $3 $4 at $5:$6"),
  outlook: `${t.getUTCDate()} ${t.toLocaleString("en-GB", { month: "long", timeZone: "UTC" })} ${t.getUTCFullYear()} ${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`,
  apple: `${t.getUTCDate()} ${t.toLocaleString("en-GB", { month: "long", timeZone: "UTC" })} ${t.getUTCFullYear()} at ${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}:00 GMT` }; };
const bodyOf = (html) => (/<body[^>]*>([\s\S]*)<\/body>/i.exec(html) || [null, html])[1];
export function forwarded(f, app) {
  const H = f.headers, d = fwdDate(H.date);
  const fromName = (/^"?([^"<]+?)"?\s*</.exec(H.from) || [])[1] || "";
  const fromAddr = (/<([^>]+)>/.exec(H.from) || [])[1] || H.from;
  let textHead, htmlHead;
  if (app === "gmail") {
    textHead = `---------- Forwarded message ---------\nFrom: ${fromName} <${fromAddr}>\nDate: ${d.gmail}\nSubject: ${H.subject}\nTo: <${H.to}>\n\n\n`;
    htmlHead = `<div dir="ltr"><br><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: <strong class="gmail_sendername" dir="auto">${esc(fromName)}</strong> <span dir="auto">&lt;${fromAddr}&gt;</span><br>Date: ${d.gmail}<br>Subject: ${esc(H.subject)}<br>To: &lt;${H.to}&gt;<br></div><br><br>`;
  } else if (app === "outlook") {
    textHead = `\n\n________________________________\nFrom: ${fromName} <${fromAddr}>\nSent: ${d.outlook}\nTo: ${SHOPPER.name} <${H.to}>\nSubject: ${H.subject}\n\n`;
    htmlHead = `<div><br></div><hr style="display:inline-block;width:98%" tabindex="-1"><div id="divRplyFwdMsg" dir="ltr"><font face="Calibri, sans-serif" style="font-size:11pt" color="#000000"><b>From:</b> ${esc(fromName)} &lt;${fromAddr}&gt;<br><b>Sent:</b> ${d.outlook}<br><b>To:</b> ${SHOPPER.name} &lt;${H.to}&gt;<br><b>Subject:</b> ${esc(H.subject)}</font><div>&nbsp;</div></div>`;
  } else {
    textHead = `\n\nBegin forwarded message:\n\nFrom: ${fromName} <${fromAddr}>\nSubject: ${H.subject}\nDate: ${d.apple}\nTo: ${H.to}\n\n`;
    htmlHead = `<div><br><div><br><blockquote type="cite"><div>Begin forwarded message:</div><br><div style="margin:0px"><span><b>From: </b></span><span>${esc(fromName)} &lt;${fromAddr}&gt;<br></span></div><div style="margin:0px"><span><b>Subject: </b></span><span><b>${esc(H.subject)}</b><br></span></div><div style="margin:0px"><span><b>Date: </b></span><span>${d.apple}<br></span></div><div style="margin:0px"><span><b>To: </b></span><span>${H.to}<br></span></div><br>`;
  }
  const later = new Date(new Date(H.date).getTime() + 3 * 3600e3).toUTCString().replace("GMT", "+0000");
  return {
    // (A forward is written afresh by the shopper's email app from what it showed: the original's own bytes don't go with it.)
    ...f, rawB64: undefined, id: f.id + "~fwd-" + app, layout: f.layout + " (forwarded, " + app + ")",
    headers: { from: `${SHOPPER.name} <${app === "outlook" ? "sam.taylor@outlook.com" : app === "apple" ? "sam.taylor@icloud.com" : "sam.taylor@gmail.com"}>`, to: "receipts@example.com",
      subject: (app === "outlook" ? "FW: " : "Fwd: ") + H.subject, date: later },
    text: f.text ? textHead + f.text : "",
    html: f.html ? `<html><head><meta charset="utf-8"></head><body>${htmlHead}${bodyOf(f.html)}${app === "apple" ? "</blockquote></div></div>" : "</div></div>"}</body></html>` : "",
  };
}

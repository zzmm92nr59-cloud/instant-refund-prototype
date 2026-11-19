// A ninth set of made-up emails (see lib.mjs): ten more of the round 4 kind (how emails arrive), written AFTER holdout7 was
// fixed and run BEFORE any change for them (first-try scores in the round 4 commit). Character sets mixed within one email,
// iso-8859-15, folded MIME headers, hidden blocks written other ways ("DISPLAY: none !important", a hidden span), products
// recommended above the order, an Outlook "Original Message" reply, a clipped email missing an item, an invoice only in a
// PDF, and an email attached inside a forward with its own windows-1252 base64 body.
// Every shop, order, person, address and number here is made up.
import { order, expected, page, table, moneyRows, fixture, gbp, h, SHOPPER } from "./lib.mjs";
import { CRLF, utf8, cp1252, b64, qp, head, part, multi, FAKE_PDF, itemsTable, shopPage, shopText } from "./holdout7.mjs";

export default function holdout8() {
  const out = [];
  const add = (id, sender, layout, mail, o, shop, date, extra, raw) => {
    const f = fixture(id, sender, layout, mail, expected(shop, date, o, extra));
    if (raw) f.rawB64 = Buffer.from(raw(f.headers), "latin1").toString("base64");
    out.push(f);
    return f;
  };
  {
    // Plain text in iso-8859-15, quoted-printable: "£" =A3 (the euro sign would be =A4 in this set).
    const o = order([{ name: "Gardening Gloves Large", qty: 2, unit: 899 }, { name: "Pruning Shears Bypass", qty: 1, unit: 2450 }], { fees: [["Delivery", 450]] });
    const text = shopText("Potting Shed Supplies", "PS-40213", "13 November 2026", o);
    add("holdout8-iso8859-15-qp", "Potting Shed Supplies", "text/plain iso-8859-15 quoted-printable", { from: "Potting Shed Supplies <orders@pottingshedsupplies.co.uk>", subject: "Your order PS-40213", date: "Fri, 13 Nov 2026 10:00:00 +0000", text }, o, "Potting Shed Supplies", "2026-11-13", {},
      (H) => head(H, "h8-1") + part("text/plain; charset=ISO-8859-15", "quoted-printable", qp(text.replace(/\n/g, CRLF))));
  }
  {
    // Two character sets in one email, both sent as 8bit: the text part in UTF-8, the HTML part in windows-1252.
    const o = order([{ name: "Café Au Lait Bowl Set", qty: 1, unit: 3200 }, { name: "Espresso Cups Pair", qty: 1, unit: 1800 }], { fees: [["Delivery", 395]] });
    const html = shopPage("Blue Door Kitchen", "bluedoorkitchen.co.uk", "BD-5531", "12 November 2026", o).replace(/&pound;/g, "£");
    const text = shopText("Blue Door Kitchen", "BD-5531", "12 November 2026", o);
    add("holdout8-mixed-charsets-8bit", "Blue Door Kitchen", "8bit UTF-8 text + 8bit windows-1252 html", { from: "Blue Door Kitchen <orders@bluedoorkitchen.co.uk>", subject: "Order BD-5531 confirmed", date: "Thu, 12 Nov 2026 12:00:00 +0000", html, text }, o, "Blue Door Kitchen", "2026-11-12", {},
      (H) => head(H, "h8-2") + multi("multipart/alternative", "alt-BD", [part("text/plain; charset=utf-8", "8bit", utf8(text.replace(/\n/g, CRLF))), part("text/html; charset=windows-1252", "8bit", cp1252(html.replace(/\n/g, CRLF)))]));
  }
  {
    // Headers folded over lines, the encoding written "Base64", base64 wrapped at 64 characters.
    const o = order([{ name: "Wool Felt Slippers Grey", qty: 1, unit: 3500 }, { name: "Slipper Socks", qty: 2, unit: 900 }], { fees: [["Delivery", 0]] });
    const html = shopPage("Hygge House", "hyggehouse.co.uk", "HH-77120", "11 November 2026", o);
    add("holdout8-folded-headers-b64", "Hygge House", "folded Content-Type, 'Base64' wrapped at 64", { from: "Hygge House <orders@hyggehouse.co.uk>", subject: "Your Hygge House order HH-77120", date: "Wed, 11 Nov 2026 09:00:00 +0000", html }, o, "Hygge House", "2026-11-11", {},
      (H) => head(H, "h8-3") + `Content-Type: text/html;${CRLF}\tcharset="utf-8"${CRLF}Content-Transfer-Encoding: Base64${CRLF}${CRLF}` + Buffer.from(utf8(html), "latin1").toString("base64").replace(/(.{64})/g, "$1" + CRLF) + CRLF);
  }
  {
    // The mobile copy hidden with "DISPLAY: none !important" (capitals, spaces) on a <table>.
    const o = order([{ name: "Smart Plug Twin Pack", qty: 1, unit: 2499 }, { name: "LED Bulb E27 4 Pack", qty: 2, unit: 1199 }], { fees: [["Delivery", 299]] });
    const mob = `<table style="DISPLAY: none !important; mso-hide: all" width="100%">${o.lines.map((i) => `<tr><td>${h(i.name)} x${i.qty}</td><td>${gbp(i.line)}</td></tr>`).join("")}</table>`;
    const html = shopPage("Brightside Home Tech", "brightsidehometech.co.uk", "BH-3302", "10 November 2026", o).replace(itemsTable(o), itemsTable(o) + mob);
    add("holdout8-hidden-caps-important", "Brightside Home Tech", "mobile copy 'DISPLAY: none !important'", { from: "Brightside Home Tech <orders@brightsidehometech.co.uk>", subject: "Order BH-3302 confirmed", date: "Tue, 10 Nov 2026 18:00:00 +0000", html }, o, "Brightside Home Tech", "2026-11-10");
  }
  {
    // A hidden <span> preheader saying the order's total and naming an item with a price, plus a "Trending now" row after.
    const o = order([{ name: "Kids Rain Jacket Yellow", qty: 1, unit: 2800 }, { name: "Kids Wellies Frog", qty: 1, unit: 1600 }], { fees: [["Delivery", 350]] });
    const pre = `<span style="color:transparent;display:none!important;height:0;max-height:0;opacity:0;overflow:hidden;mso-hide:all;visibility:hidden;width:0">Kids Rain Jacket Yellow £28.00 and more. Total £47.50</span>`;
    const html = shopPage("Little Explorers", "littleexplorers.co.uk", "LE-60021", "9 November 2026", o, { after: [`<h3>Trending now</h3>`, table([[`Dino Backpack<br>${gbp(1800)}`, `Torch Keyring<br>${gbp(500)}`]])] }).replace("<body style=\"margin:0;padding:0;background-color:#f3f3f3\">", "<body style=\"margin:0;padding:0;background-color:#f3f3f3\">" + pre);
    add("holdout8-hidden-span-trending", "Little Explorers", "hidden span preheader with prices, 'Trending now' after", { from: "Little Explorers <orders@littleexplorers.co.uk>", subject: "Your Little Explorers order LE-60021", date: "Mon, 9 Nov 2026 08:00:00 +0000", html }, o, "Little Explorers", "2026-11-09");
  }
  {
    // "You may also love" products with prices ABOVE the order details, in a text email.
    const o = order([{ name: "Silk Pillowcase Blush", qty: 1, unit: 3900 }], { fees: [["Delivery", 395]] });
    const text = ["Sleep Studio", `Hi ${SHOPPER.first}, your order is confirmed.`, "", "You may also love", "Silk Eye Mask | £22.00", "Silk Scrunchies Set | £15.00", "",
      "Your order", "Order number: SS-11902", "Order date: 8 November 2026", ...o.lines.map((i) => `${i.name} | Qty ${i.qty} | ${gbp(i.line)}`), "", "Subtotal £39.00", "Delivery £3.95", "Total £42.95"].join("\n");
    add("holdout8-also-love-above-text", "Sleep Studio", "'You may also love' with prices above the order (text)", { from: "Sleep Studio <orders@sleepstudio.co.uk>", subject: "Order SS-11902 confirmed", date: "Sun, 8 Nov 2026 21:00:00 +0000", text }, o, "Sleep Studio", "2026-11-08");
  }
  {
    // An Outlook reply: the shopper's note (with money) on top, the receipt under "-----Original Message-----".
    const o = order([{ name: "Standing Desk Frame", qty: 1, unit: 22900 }, { name: "Desk Top Oak 140cm", qty: 1, unit: 12900 }], { fees: [["Two-person delivery", 2500]] });
    const g = shopText("Ergo Works", "EW-88310", "7 November 2026", o);
    const text = `Can you check this? The frame was meant to be £199 in the sale.\n\nSam\n\n-----Original Message-----\nFrom: Ergo Works <orders@ergoworks.co.uk>\nSent: 07 November 2026 14:02\nTo: ${SHOPPER.name} <${SHOPPER.email}>\nSubject: Your Ergo Works order EW-88310\n\n${g}`;
    add("holdout8-outlook-original-message", "Ergo Works", "Outlook reply, '-----Original Message-----', note with money", { from: `${SHOPPER.name} <sam.taylor@outlook.com>`, to: "receipts@example.com", subject: "RE: Your Ergo Works order EW-88310", date: "Sat, 7 Nov 2026 19:00:00 +0000", text }, o, "Ergo Works", "2026-11-07");
  }
  {
    // Clipped with an item left out: the items shown and the total don't agree, and it says it was clipped.
    const all = order([{ name: "Advent Calendar Tea", qty: 1, unit: 3000 }, { name: "Gift Tin Large", qty: 1, unit: 1200 }, { name: "Tea Infuser", qty: 1, unit: 800 }]);
    const shown = order(all.lines.slice(0, 2).map((i) => ({ name: i.name, qty: i.qty, unit: i.unit })));
    const html = page({ brand: "Leaf Lane", domain: "leaflane.co.uk", rows: [`<p>Order number: LL-2290</p>`, `<p>Order date: 6 November 2026</p>`, `<p>Order total: ${gbp(all.total)}</p>`, itemsTable(shown),
      `<div>[Message clipped]&nbsp; <a href="https://mail.google.com/mail/u/0?view=lg&amp;permmsgid=msg-f:9">View entire message</a></div>`] }).replace(/<tr><td style="padding:24px;font-size:12px"[\s\S]*?<\/td><\/tr>/, "");
    const f = add("holdout8-clipped-missing-item", "Leaf Lane", "clipped after 2 of 3 items, total at the top", { from: "Leaf Lane <orders@leaflane.co.uk>", subject: "Your Leaf Lane order LL-2290", date: "Fri, 6 Nov 2026 11:00:00 +0000", html }, shown, "Leaf Lane", "2026-11-06", { partial: true });
    f.expected.totalPence = all.total;
  }
  {
    // "Please find your invoice attached", the invoice total in the body, the items only in the PDF.
    const o = order([{ name: "(in the PDF)", qty: 1, unit: 24000 }]);
    const text = `Dear ${SHOPPER.name},\n\nPlease find your invoice attached for order WS-30019.\nInvoice date: 5 November 2026\nInvoice total: £240.00\n\nKind regards,\nWorkshop Supplies Direct`;
    const f = add("holdout8-invoice-attached", "Workshop Supplies Direct", "'Please find your invoice attached', invoice total in the body", { from: "Workshop Supplies Direct <accounts@workshopsuppliesdirect.co.uk>", subject: "Invoice for your order WS-30019", date: "Thu, 5 Nov 2026 16:00:00 +0000", text }, o, "Workshop Supplies Direct", "2026-11-05", {},
      (H) => head(H, "h8-9") + multi("multipart/mixed", "mix-WS", [part("text/plain; charset=utf-8", "quoted-printable", qp(utf8(text))),
        part('application/pdf; name="INV-WS-30019.pdf"', "base64", b64(FAKE_PDF), `Content-Disposition: attachment; filename="INV-WS-30019.pdf"${CRLF}`)]));
    f.expected.items = []; f.expected.attachmentOnly = "pdf"; f.attach = [{ type: "application/pdf", name: "INV-WS-30019.pdf" }];
  }
  {
    // Apple Mail forwarding an email as an attachment: inside it, the shop's HTML in windows-1252, base64.
    const o = order([{ name: "Vinyl Record Cleaning Kit", qty: 1, unit: 2900 }, { name: "Inner Sleeves 50 Pack", qty: 1, unit: 1200 }], { fees: [["Delivery", 399]] });
    const shopH = { from: "Groove Store <orders@groovestore.co.uk>", to: SHOPPER.email, subject: "Your Groove Store order GS-9902", date: "Wed, 4 Nov 2026 13:00:00 +0000" };
    const html = shopPage("Groove Store", "groovestore.co.uk", "GS-9902", "4 November 2026", o).replace(/&pound;/g, "£");
    const text = `Begin forwarded message:\n\nFrom: Groove Store <orders@groovestore.co.uk>\nSubject: ${shopH.subject}\nDate: 4 November 2026 at 13:00:00 GMT\nTo: ${SHOPPER.email}\n\n` + shopText("Groove Store", "GS-9902", "4 November 2026", o);
    add("holdout8-apple-attached-1252", "Groove Store", "message/rfc822 inside, its html base64 windows-1252", { from: `${SHOPPER.name} <sam.taylor@icloud.com>`, to: "receipts@example.com", subject: "Fwd: Your Groove Store order GS-9902", date: "Wed, 4 Nov 2026 20:00:00 +0000", text }, o, "Groove Store", "2026-11-04", {},
      (H) => head(H, "h8-10") + multi("multipart/mixed", "Apple-Mail=_OUTER", [part("text/plain; charset=us-ascii", "7bit", "Here you go" + CRLF),
        part("message/rfc822", "7bit", head(shopH, "groove-original") + part("text/html; charset=windows-1252", "base64", b64(cp1252(html))), `Content-Disposition: attachment; filename="Your Groove Store order.eml"${CRLF}`)]));
  }
  return out;
}

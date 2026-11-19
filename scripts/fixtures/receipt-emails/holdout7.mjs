// An eighth set of made-up emails (see lib.mjs), written for round 4 of the item reader (19 Nov 2026): the way emails
// ARRIVE, which the corpus so far mostly skipped. Each was run BEFORE any change for it (first-try scores are in the round 4
// commit). MIME layouts written as the exact bytes a mailbox gives (rawB64): quoted-printable soft line breaks splitting a
// pound sign or a price, bodies in windows-1252 and iso-8859-1 sent as 8bit, quoted-printable and base64, parts nested three
// deep, a forward sent as an attachment (message/rfc822), a terms file attached as text, a huge inline picture. Email
// builders' HTML: hidden preheaders that name items, Outlook-only (mso) copies, mobile and desktop copies of the same table,
// mojibake ("Â£"), entities, invisible characters inside prices. Forwards with the shopper's own note above, replies to
// forwards ("> " quoting, one and two levels), Outlook's forward header in French, German and Dutch, Gmail's
// "[Message clipped]". Receipts only in a PDF or a picture. "Recommended for you" carousels and "Customers also bought".
// Every shop, order, person, address and number here is made up.
import { order, expected, page, table, moneyRows, moneyText, fixture, gbp, h, SHOPPER } from "./lib.mjs";

const CRLF = "\r\n";
// Bytes are written as a "binary" string (one character per byte) and stored base64.
const utf8 = (s) => Buffer.from(s, "utf8").toString("latin1");
const CP1252 = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "–": 0x96, "—": 0x97, "™": 0x99 };
const cp1252 = (s) => [...s].map((c) => (CP1252[c] ? String.fromCharCode(CP1252[c]) : c.charCodeAt(0) < 256 ? c : "?")).join("");
const b64 = (bin) => Buffer.from(bin, "latin1").toString("base64").replace(/(.{76})/g, "$1" + CRLF);
// Quoted-printable, wrapped at 76 with soft line breaks the way senders wrap it. "\u0001" in the text is a soft break put
// exactly there (inside a price); splitPound puts one between the two bytes of every UTF-8 pound sign.
function qp(bin, { splitPound = false } = {}) {
  const enc = [...bin].map((c) => {
    const n = c.charCodeAt(0);
    if (c === "\u0001") return "\u0001";
    if (c === "\n" || c === "\r") return c;
    return n > 126 || c === "=" ? "=" + n.toString(16).toUpperCase().padStart(2, "0") : c;
  }).join("").replace(/=C2=A3/g, splitPound ? "=C2\u0001=A3" : "=C2=A3");
  return enc.replace(/\r?\n/g, "\n").split("\n").map((line) => {
    const out = []; let l = line;
    while (l.replace(/\u0001/g, "").length > 74 || l.includes("\u0001")) {
      const soft = l.indexOf("\u0001");
      if (soft !== -1 && soft <= 74) { out.push(l.slice(0, soft) + "="); l = l.slice(soft + 1); continue; }
      let cut = 74; while (cut > 0 && /=[0-9A-F]?$/.test(l.slice(0, cut))) cut--;
      out.push(l.slice(0, cut) + "="); l = l.slice(cut);
    }
    out.push(l); return out.join(CRLF);
  }).join(CRLF);
}
const head = (H, id, extra = "") => `From: ${H.from}${CRLF}To: ${H.to}${CRLF}Subject: ${H.subject}${CRLF}Date: ${H.date}${CRLF}Message-ID: <${id}@corpus.relay.test>${CRLF}MIME-Version: 1.0${CRLF}${extra}`;
const part = (type, cte, body, extra = "") => `Content-Type: ${type}${CRLF}Content-Transfer-Encoding: ${cte}${CRLF}${extra}${CRLF}${body}${CRLF}`;
const multi = (type, boundary, parts) => `Content-Type: ${type}; boundary="${boundary}"${CRLF}${CRLF}This is a multi-part message in MIME format.${CRLF}` + parts.map((p) => `--${boundary}${CRLF}${p}`).join("") + `--${boundary}--${CRLF}`;
// A made-up PDF's bytes (just enough to look like one; no real document) and a tiny picture.
const FAKE_PDF = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n" + "x".repeat(900) + "\n%%EOF\n";
const PIXEL_PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000100e221bc330000000049454e44ae426082", "hex").toString("latin1");

// A shop's usual order email (items in a table: name, quantity, line price; the money under it), in HTML and in text.
const itemsTable = (o) => table([["Item", "Qty", "Price"], ...o.lines.map((i) => [h(i.name), String(i.qty), gbp(i.line)])]);
const shopPage = (brand, domain, ref, when, o, { before = [], after = [], preheader = "", money = true } = {}) =>
  page({ brand, domain, preheader, rows: [`<p>Thanks for your order, ${SHOPPER.first}.</p>`, `<p>Order number: ${ref}</p>`, `<p>Order date: ${when}</p>`, ...before, itemsTable(o), ...(money ? [table(moneyRows(o))] : []), ...after] });
const shopText = (brand, ref, when, o, { after = [] } = {}) => [brand, `Thanks for your order, ${SHOPPER.first}.`, `Order number: ${ref}`, `Order date: ${when}`, "",
  ...o.lines.map((i) => `${i.name} | Qty ${i.qty} | ${gbp(i.line)}`), "", moneyText(o), ...after].join("\n");

export default function holdout7() {
  const out = [];
  const add = (id, sender, layout, mail, o, shop, date, extra, raw) => {
    const f = fixture(id, sender, layout, mail, expected(shop, date, o, extra));
    if (raw) f.rawB64 = Buffer.from(raw(f.headers), "latin1").toString("base64");
    out.push(f);
    return f;
  };

  // ---- MIME and character sets ------------------------------------------------------------------------------------------
  {
    // HTML in quoted-printable, wrapped by the sender so every pound sign's two bytes are split by a soft line break
    // ("=C2=\r\n=A3") and one price is split in the middle ("£12.=\r\n99").
    const o = order([{ name: "Merino Beanie Charcoal", qty: 1, unit: 1299 }, { name: "Cashmere Blend Scarf", qty: 1, unit: 3450 }], { fees: [["Delivery", 395]] });
    const html = shopPage("Fellside Knitwear", "fellsideknitwear.co.uk", "FK-30117", "18 November 2026", o);
    add("holdout7-qp-split-pound", "Fellside Knitwear", "QP html, soft breaks inside '£' and inside '12.99'", { from: "Fellside Knitwear <orders@fellsideknitwear.co.uk>", subject: "Your Fellside Knitwear order FK-30117", date: "Wed, 18 Nov 2026 09:00:00 +0000", html }, o, "Fellside Knitwear", "2026-11-18", {},
      (H) => head(H, "holdout7-qp-split-pound") + part("text/html; charset=utf-8", "quoted-printable", qp(utf8(html).replace("12.99", "12.\u000199"), { splitPound: true })));
  }
  {
    // Plain text in iso-8859-1 sent as 8bit: the pound sign is the single byte 0xA3.
    const o = order([{ name: "Brass Desk Lamp", qty: 1, unit: 4800 }, { name: "Linen Lampshade 30cm", qty: 2, unit: 1650 }], { fees: [["Standard delivery", 499]] });
    const text = shopText("Lumen & Oak", "LO-88213", "17 November 2026", o);
    add("holdout7-latin1-8bit", "Lumen & Oak", "text/plain iso-8859-1, 8bit, '£' as byte 0xA3", { from: "Lumen & Oak <orders@lumenandoak.co.uk>", subject: "Order confirmation LO-88213", date: "Tue, 17 Nov 2026 14:20:00 +0000", text }, o, "Lumen & Oak", "2026-11-17", {},
      (H) => head(H, "holdout7-latin1-8bit") + part("text/plain; charset=iso-8859-1", "8bit", text.replace(/\n/g, CRLF)));
  }
  {
    // HTML in windows-1252, quoted-printable: "£" is =A3, a curly apostrophe =92, a dash =96.
    const o = order([{ name: "Children’s Wellies Size 11", qty: 1, unit: 1800 }, { name: "Puddle Suit – Navy", qty: 1, unit: 2600 }], { fees: [["Delivery", 0]] });
    const html = shopPage("Little Puddles", "littlepuddles.co.uk", "LP-41120", "16 November 2026", o).replace(/&rsquo;/g, "’").replace("charset=UTF-8", "charset=windows-1252");
    add("holdout7-win1252-qp", "Little Puddles", "html windows-1252 quoted-printable (=A3, =92, =96)", { from: "Little Puddles <hello@littlepuddles.co.uk>", subject: "We’ve got your order LP-41120", date: "Mon, 16 Nov 2026 11:00:00 +0000", html }, o, "Little Puddles", "2026-11-16", {},
      (H) => head({ ...H, subject: "=?windows-1252?Q?We=92ve_got_your_order_LP-41120?=" }, "holdout7-win1252-qp") + part("text/html; charset=windows-1252", "quoted-printable", qp(cp1252(html.replace(/&pound;/g, "£")))));
  }
  {
    // Outlook-style: multipart/alternative, both parts base64 in windows-1252.
    const o = order([{ name: "Oak Chopping Board Large", qty: 1, unit: 3900 }, { name: "Board Oil 250ml", qty: 1, unit: 850 }, { name: "Linen Tea Towel", qty: 3, unit: 600 }], { fees: [["Courier", 595]] });
    const html = shopPage("Grain & Grove", "grainandgrove.co.uk", "GG-2207", "15 November 2026", o).replace(/&pound;/g, "£");
    const text = shopText("Grain & Grove", "GG-2207", "15 November 2026", o);
    add("holdout7-win1252-base64-alt", "Grain & Grove", "alternative, both parts base64 windows-1252", { from: "Grain & Grove <orders@grainandgrove.co.uk>", subject: "Your Grain & Grove order GG-2207", date: "Sun, 15 Nov 2026 16:45:00 +0000", html, text }, o, "Grain & Grove", "2026-11-15", {},
      (H) => head(H, "holdout7-win1252-base64-alt") + multi("multipart/alternative", "_000_GG2207_", [part('text/plain; charset="Windows-1252"', "base64", b64(cp1252(text.replace(/\n/g, CRLF)))), part('text/html; charset="Windows-1252"', "base64", b64(cp1252(html)))]));
  }
  {
    // Three levels deep: mixed > related > alternative (text + html), the logo as an inline picture, a PDF of the terms.
    const o = order([{ name: "Trail Running Shoe Men's 9", qty: 1, unit: 11000 }, { name: "Merino Running Socks", qty: 2, unit: 1400 }], { fees: [["Next day delivery", 695]] });
    const html = shopPage("Ridgeline Running", "ridgelinerunning.co.uk", "RR-500931", "14 November 2026", o).replace('src="https://www.ridgelinerunning.co.uk/static/email/logo.png"', 'src="cid:logo@ridgeline"');
    const text = shopText("Ridgeline Running", "RR-500931", "14 November 2026", o);
    add("holdout7-mixed-related-alt", "Ridgeline Running", "mixed > related > alternative, inline logo, PDF terms", { from: "Ridgeline Running <orders@ridgelinerunning.co.uk>", subject: "Order RR-500931 confirmed", date: "Sat, 14 Nov 2026 08:30:00 +0000", html, text }, o, "Ridgeline Running", "2026-11-14", {},
      (H) => head(H, "holdout7-mixed-related-alt") + multi("multipart/mixed", "mix-RR", [
        multi("multipart/related", "rel-RR", [
          multi("multipart/alternative", "alt-RR", [part("text/plain; charset=utf-8", "quoted-printable", qp(utf8(text))), part("text/html; charset=utf-8", "base64", b64(utf8(html)))]),
          part("image/png", "base64", b64(PIXEL_PNG), `Content-ID: <logo@ridgeline>${CRLF}Content-Disposition: inline; filename="logo.png"${CRLF}`)]),
        part('application/pdf; name="Terms-of-sale.pdf"', "base64", b64(FAKE_PDF), `Content-Disposition: attachment; filename="Terms-of-sale.pdf"${CRLF}`)]));
  }
  {
    // Outlook's "Forward as attachment": the shopper's note, and the shop's whole email attached as message/rfc822.
    const o = order([{ name: "Cast Iron Casserole 24cm", qty: 1, unit: 8900 }, { name: "Silicone Trivet", qty: 2, unit: 500 }], { fees: [["Delivery", 0]] });
    const shopH = { from: "Cookshed <orders@cookshed.co.uk>", to: SHOPPER.email, subject: "Your Cookshed order CS-77201", date: "Fri, 13 Nov 2026 19:10:00 +0000" };
    const html = shopPage("Cookshed", "cookshed.co.uk", "CS-77201", "13 November 2026", o);
    const text = shopText("Cookshed", "CS-77201", "13 November 2026", o);
    const fwdText = `Forwarding my Cookshed receipt.\n\n---------- Forwarded message ---------\nFrom: Cookshed <orders@cookshed.co.uk>\nDate: Fri, 13 Nov 2026 at 19:10\nSubject: ${shopH.subject}\nTo: <${SHOPPER.email}>\n\n\n` + text;
    add("holdout7-rfc822-attached", "Cookshed", "forward as attachment (message/rfc822)", { from: `${SHOPPER.name} <sam.taylor@outlook.com>`, to: "receipts@example.com", subject: "FW: Your Cookshed order CS-77201", date: "Fri, 13 Nov 2026 21:00:00 +0000", text: fwdText }, o, "Cookshed", "2026-11-13", {},
      (H) => head(H, "holdout7-rfc822-attached") + multi("multipart/mixed", "_004_outer_", [
        part("text/plain; charset=us-ascii", "7bit", "Forwarding my Cookshed receipt." + CRLF),
        part("message/rfc822", "7bit", head(shopH, "cookshed-original") + multi("multipart/alternative", "inner-CS", [part("text/plain; charset=utf-8", "quoted-printable", qp(utf8(text))), part("text/html; charset=utf-8", "base64", b64(utf8(html)))]),
          `Content-Disposition: attachment; filename="Your Cookshed order CS-77201.eml"${CRLF}`)]));
  }
  {
    // A text file of terms attached next to the receipt, with money of its own ("Returns by courier cost £3.95").
    const o = order([{ name: "Waxed Canvas Tote", qty: 1, unit: 6500 }, { name: "Leather Key Fob", qty: 1, unit: 1200 }], { fees: [["Delivery", 450]] });
    const html = shopPage("Saddler Row", "saddlerrow.co.uk", "SR-10994", "12 November 2026", o);
    const terms = "SADDLER ROW TERMS OF SALE\r\nReturns within 30 days. Returns by courier cost £3.95, deducted from your refund.\r\nGift wrap £4.00 per item is not refundable.\r\nOrders over £100.00 ship free.\r\nTotal liability limited to the price paid.\r\n";
    add("holdout7-terms-txt-attached", "Saddler Row", "html receipt + attached terms.txt with prices", { from: "Saddler Row <orders@saddlerrow.co.uk>", subject: "Thank you for your order SR-10994", date: "Thu, 12 Nov 2026 10:00:00 +0000", html }, o, "Saddler Row", "2026-11-12", {},
      (H) => head(H, "holdout7-terms-txt-attached") + multi("multipart/mixed", "mix-SR", [part("text/html; charset=utf-8", "quoted-printable", qp(utf8(html))),
        part('text/plain; charset=utf-8; name="terms.txt"', "quoted-printable", qp(utf8(terms)), `Content-Disposition: attachment; filename="terms.txt"${CRLF}`)]));
  }
  {
    // A huge picture written into the HTML itself (a data: address, 700 KB), before the items: the email is far longer
    // than the part of it the reader used to look at.
    const o = order([{ name: "Hand Thrown Mug Sage", qty: 2, unit: 2200 }, { name: "Stoneware Bowl Set of 4", qty: 1, unit: 5600 }], { fees: [["Delivery", 650]] });
    const pic = Buffer.alloc(460000, 7).toString("base64");
    const html = shopPage("Kiln Street Pottery", "kilnstreetpottery.co.uk", "KS-6631", "11 November 2026", o, { before: [`<img src="data:image/png;base64,${pic}" width="600" height="200" alt="" />`] });
    add("holdout7-huge-inline-picture", "Kiln Street Pottery", "700 KB data: picture above the items", { from: "Kiln Street Pottery <shop@kilnstreetpottery.co.uk>", subject: "Your order KS-6631 is confirmed", date: "Wed, 11 Nov 2026 12:00:00 +0000", html }, o, "Kiln Street Pottery", "2026-11-11", {},
      (H) => head(H, "holdout7-huge-inline-picture") + part("text/html; charset=utf-8", "base64", b64(utf8(html))));
  }
  {
    // Gmail's AMP part next to the HTML and the text (text/x-amp-html): read once, not three times.
    const o = order([{ name: "Spiced Apple Candle 200g", qty: 2, unit: 1800 }, { name: "Wick Trimmer Brass", qty: 1, unit: 1200 }], { fees: [["Delivery", 350]] });
    const html = shopPage("Wick & Wax", "wickandwax.co.uk", "WW-2204", "10 November 2026", o);
    const text = shopText("Wick & Wax", "WW-2204", "10 November 2026", o);
    add("holdout7-amp-part", "Wick & Wax", "alternative with text/x-amp-html, text and html", { from: "Wick & Wax <orders@wickandwax.co.uk>", subject: "Order WW-2204 confirmed", date: "Tue, 10 Nov 2026 09:15:00 +0000", html, text }, o, "Wick & Wax", "2026-11-10", {},
      (H) => head(H, "holdout7-amp-part") + multi("multipart/alternative", "alt-WW", [part("text/plain; charset=utf-8", "quoted-printable", qp(utf8(text))),
        part("text/x-amp-html; charset=utf-8", "base64", b64(utf8(html.replace("<html ", "<html ⚡4email ")))), part("text/html; charset=utf-8", "base64", b64(utf8(html)))]));
  }
  {
    // The text part only says to look at the HTML one ("This email needs an HTML-capable email client").
    const o = order([{ name: "Bamboo Bed Sheet Set Double", qty: 1, unit: 6900 }, { name: "Pillowcase Pair", qty: 1, unit: 2200 }], { fees: [["Delivery", 0]] });
    const html = shopPage("Dreamloft", "dreamloft.co.uk", "DL-90012", "9 November 2026", o);
    const text = "Dreamloft\nThanks for your order DL-90012.\nThis email needs an HTML-capable email client. View it online: https://www.dreamloft.co.uk/orders/DL-90012";
    add("holdout7-text-says-see-html", "Dreamloft", "text part says 'view in HTML', html has everything", { from: "Dreamloft <orders@dreamloft.co.uk>", subject: "Your Dreamloft order DL-90012", date: "Mon, 9 Nov 2026 20:00:00 +0000", html, text }, o, "Dreamloft", "2026-11-09");
  }

  // ---- Email builders' HTML ---------------------------------------------------------------------------------------------
  {
    // Mojibake: the shop's system read its own UTF-8 as Latin-1, so every "£" arrives as "Â£" and "’" as "â€™".
    const o = order([{ name: "Men’s Flannel Shirt", qty: 1, unit: 3200 }, { name: "Corduroy Cap", qty: 1, unit: 1800 }], { fees: [["Delivery", 399]] });
    const html = shopPage("Northbound Supply", "northboundsupply.co.uk", "NB-1209", "8 November 2026", o).replace(/&pound;/g, "Â£").replace(/&rsquo;/g, "â€™");
    const f = add("holdout7-mojibake", "Northbound Supply", "'Â£12.00' and 'â€™' throughout", { from: "Northbound Supply <orders@northboundsupply.co.uk>", subject: "Order NB-1209 confirmed", date: "Sun, 8 Nov 2026 13:00:00 +0000", html }, o, "Northbound Supply", "2026-11-08");
    f.expected.items[0].name = "Men’s Flannel Shirt";
  }
  {
    // Entities every way: &#163;, &#xA3;, &pound;&nbsp;, "&amp;" in names, a price split by &nbsp; from its sign.
    const o = order([{ name: "Fish & Chips Board Game", qty: 1, unit: 2499 }, { name: "Salt & Vinegar Crisps Socks", qty: 2, unit: 899 }], { fees: [["P&P", 299]] });
    const cell = (p, k) => [`&#163;${(p / 100).toFixed(2)}`, `&#xA3;${(p / 100).toFixed(2)}`, `&pound;&nbsp;${(p / 100).toFixed(2)}`][k % 3];
    const html = page({ brand: "Quirk Gifts", domain: "quirkgifts.co.uk", rows: [`<p>Order number: QG-55100</p>`, `<p>Order date: 7 November 2026</p>`,
      table([["Item", "Qty", "Price"], ...o.lines.map((i, k) => [h(i.name), String(i.qty), cell(i.line, k)])]),
      table([["Subtotal", cell(o.subtotal, 1)], ["P&amp;P", cell(299, 2)], ["<strong>Total</strong>", `<strong>${cell(o.total, 0)}</strong>`]])] });
    add("holdout7-entities", "Quirk Gifts", "&#163; &#xA3; &pound;&nbsp; and &amp; in names", { from: "Quirk Gifts <orders@quirkgifts.co.uk>", subject: "Your Quirk Gifts order QG-55100", date: "Sat, 7 Nov 2026 10:30:00 +0000", html }, o, "Quirk Gifts", "2026-11-07");
  }
  {
    // Invisible characters inside words and prices: a soft hyphen in a name, zero-width spaces inside "£24.99".
    const o = order([{ name: "Wireless Headphones Over Ear", qty: 1, unit: 2499 }, { name: "Headphone Stand Walnut", qty: 1, unit: 1500 }], { fees: [["Delivery", 0]] });
    const html = page({ brand: "Soundbay", domain: "soundbay.co.uk", rows: [`<p>Order number: SB-30021</p>`, `<p>Order date: 6 November 2026</p>`,
      table([["Item", "Qty", "Price"], ["Wireless Head&shy;phones Over Ear", "1", "&pound;2​4.​99"], ["Head­phone Stand Wal&#8203;nut", "1", "&pound;15&#8203;.00"]]),
      table([["Subtotal", "&pound;3​9.99"], ["Delivery", "FREE"], ["<strong>Total</strong>", "<strong>&pound;39.‌99</strong>"]])] });
    add("holdout7-invisible-in-prices", "Soundbay", "soft hyphens in names, zero-width spaces in prices", { from: "Soundbay <orders@soundbay.co.uk>", subject: "Order confirmation SB-30021", date: "Fri, 6 Nov 2026 18:00:00 +0000", html }, o, "Soundbay", "2026-11-06");
  }
  {
    // A Klaviyo-style hidden preheader that names an item and its price, then the real table.
    const o = order([{ name: "Oat Milk Barista 1L", qty: 6, unit: 210 }, { name: "Ethiopian Yirgacheffe Beans 250g", qty: 1, unit: 1150 }], { fees: [["Delivery", 395]] });
    const html = shopPage("Roast Collective", "roastcollective.co.uk", "RC-71102", "5 November 2026", o, { preheader: "Ethiopian Yirgacheffe Beans 250g £11.50 and 1 more item are on their way soon" });
    add("holdout7-preheader-names-item", "Roast Collective", "hidden preheader names an item with its price", { from: "Roast Collective <hello@roastcollective.co.uk>", subject: "Your Roast Collective order RC-71102", date: "Thu, 5 Nov 2026 07:45:00 +0000", html }, o, "Roast Collective", "2026-11-05");
  }
  {
    // Outlook-only copy of the item table inside <!--[if mso]> … <![endif]-->, and the everyone-else copy after it.
    const o = order([{ name: "Recycled Yoga Mat 5mm", qty: 1, unit: 4500 }, { name: "Cork Yoga Block", qty: 2, unit: 1200 }], { fees: [["Delivery", 395]] });
    const t = itemsTable(o);
    const html = shopPage("Stillpoint Yoga", "stillpointyoga.co.uk", "SY-4410", "4 November 2026", o, { before: [`<!--[if mso]><table width="600"><tr><td>${t}</td></tr></table><![endif]--><!--[if !mso]><!-- -->`], after: [`<!--<![endif]-->`] });
    add("holdout7-mso-copy", "Stillpoint Yoga", "<!--[if mso]> copy of the item table", { from: "Stillpoint Yoga <orders@stillpointyoga.co.uk>", subject: "Order SY-4410 confirmed", date: "Wed, 4 Nov 2026 12:00:00 +0000", html }, o, "Stillpoint Yoga", "2026-11-04");
  }
  {
    // The same items twice: a desktop table and a mobile copy hidden with an inline style (display:none; mso-hide:all).
    const o = order([{ name: "Waterproof Hiking Jacket", qty: 1, unit: 12000 }, { name: "Packable Down Vest", qty: 1, unit: 6500 }], { fees: [["Delivery", 0]] });
    const mob = `<div class="mobile-only" style="display:none;max-height:0;overflow:hidden;mso-hide:all">${o.lines.map((i) => `<p>${h(i.name)}</p><p>Qty ${i.qty}</p><p>${gbp(i.line)}</p>`).join("")}</div>`;
    const html = shopPage("Summit Outfitters", "summitoutfitters.co.uk", "SO-99821", "3 November 2026", o, { before: [] }).replace(itemsTable(o), `<div class="desktop-only">${itemsTable(o)}</div>${mob}`);
    add("holdout7-mobile-copy-inline-hidden", "Summit Outfitters", "desktop table + mobile copy with inline display:none", { from: "Summit Outfitters <orders@summitoutfitters.co.uk>", subject: "Thanks for your order SO-99821", date: "Tue, 3 Nov 2026 15:30:00 +0000", html }, o, "Summit Outfitters", "2026-11-03");
  }
  {
    // The mobile and desktop copies hidden by class in the <style> sheet, not inline (.mob{display:none} shown by @media).
    const o = order([{ name: "Linen Cushion Cover Rust", qty: 2, unit: 2400 }, { name: "Feather Cushion Pad 45cm", qty: 2, unit: 900 }], { fees: [["Delivery", 495]] });
    const mob = `<table class="mob" width="100%">${o.lines.map((i) => `<tr><td>${h(i.name)}<br>Qty ${i.qty}<br>${gbp(i.line)}</td></tr>`).join("")}</table>`;
    const html = shopPage("Hearth Loom", "hearthloom.co.uk", "HL-30330", "2 November 2026", o).replace(itemsTable(o), `<div class="desk">${itemsTable(o)}</div>${mob}`)
      .replace("</style>", ".mob{display:none!important;mso-hide:all}@media only screen and (max-width:480px){.mob{display:table!important}.desk{display:none!important}}</style>");
    add("holdout7-mobile-copy-class-hidden", "Hearth Loom", "mobile copy hidden by a class in <style>", { from: "Hearth Loom <orders@hearthloom.co.uk>", subject: "Order HL-30330 confirmed", date: "Mon, 2 Nov 2026 09:00:00 +0000", html }, o, "Hearth Loom", "2026-11-02");
  }
  {
    // "View in browser" header, a tracking pixel, every link wrapped by the email service.
    const o = order([{ name: "Vitamin D3 Gummies 60", qty: 2, unit: 1299 }, { name: "Magnesium Bath Flakes 1kg", qty: 1, unit: 1450 }], { fees: [["Tracked delivery", 349]] });
    const html = shopPage("Bloom Wellness", "bloomwellness.co.uk", "BW-100045", "1 November 2026", o, { before: [] })
      .replace("<body", `<body`).replace(/<tr><td style="padding:24px 24px 8px 24px">/, `<tr><td style="font-size:11px;text-align:center">Having trouble viewing this email? <a href="https://trk.klclick.com/ls/click?upn=abc">View it in your browser</a></td></tr><tr><td style="padding:24px 24px 8px 24px">`)
      .replace(/href="https:\/\/www\.bloomwellness\.co\.uk\//g, 'href="https://trk.klclick.com/ls/click?upn=xyz&u=https://www.bloomwellness.co.uk/') + `<img src="https://trk.klclick.com/open/pixel.gif?id=1" width="1" height="1" style="display:block" alt="">`;
    add("holdout7-view-in-browser-pixel", "Bloom Wellness", "'View it in your browser', pixel, wrapped links", { from: "Bloom Wellness <orders@bloomwellness.co.uk>", subject: "Your Bloom Wellness order BW-100045", date: "Sun, 1 Nov 2026 17:00:00 +0000", html }, o, "Bloom Wellness", "2026-11-01");
  }
  {
    // A Shopify-notification-style summary: "Name × 2" with the line price beside it, a discount code line, taxes included.
    const o = order([{ name: "Organic Cotton Hoodie Oat", qty: 2, unit: 4500 }, { name: "Embroidered Patch Set", qty: 1, unit: 900 }], { fees: [["Shipping", 450]], discounts: [["Discount (AUTUMN10)", 990]] });
    const rows = o.lines.map((i) => [`<span style="font-size:16px;font-weight:600">${h(i.name)} × ${i.qty}</span>`, { td: `<strong>${gbp(i.line)}</strong>`, attrs: 'align="right"' }]);
    const html = page({ brand: "Field Day Apparel", domain: "fielddayapparel.com", rows: [`<p>Order #1043</p>`, `<p>Thank you for your purchase! Placed 31 October 2026</p>`, `<h3>Order summary</h3>`, table(rows),
      table([["Subtotal", gbp(o.subtotal)], ["Discount (AUTUMN10)", gbp(-990)], ["Shipping", gbp(450)], ["Taxes (included)", gbp(1335)], ["<strong>Total</strong>", `<strong>${gbp(o.total)} GBP</strong>`]])] });
    add("holdout7-shopify-notification", "Field Day Apparel", "'Name × 2' summary, discount code, taxes included", { from: "Field Day Apparel <store+5512@t.shopifyemail.com>", subject: "Order #1043 confirmed", date: "Sat, 31 Oct 2026 14:10:00 +0000", html }, o, "Field Day Apparel", "2026-10-31");
  }
  {
    // Salesforce-style nested tables: every field its own cell, &nbsp; spacer cells between them.
    const o = order([{ name: "Rose Hip Face Oil 30ml", qty: 1, unit: 2800 }, { name: "Clay Mask 100ml", qty: 1, unit: 1900 }, { name: "Muslin Cloth Pack of 3", qty: 1, unit: 600 }], { fees: [["Delivery", 295]] });
    const rows = o.lines.map((i) => [`<table><tr><td class="name">${h(i.name)}</td></tr><tr><td>Qty:&nbsp;${i.qty}</td></tr></table>`, "&nbsp;", { td: gbp(i.line), attrs: 'align="right"' }]);
    const html = page({ brand: "Wild Apothecary", domain: "wildapothecary.co.uk", rows: [`<p>Order number:&nbsp;WA-0099123</p>`, `<p>Order date:&nbsp;30 October 2026</p>`, table(rows), table(moneyRows(o))] });
    add("holdout7-salesforce-nested", "Wild Apothecary", "nested field tables, &nbsp; spacer cells", { from: "Wild Apothecary <noreply@wildapothecary.co.uk>", subject: "Your order WA-0099123", date: "Fri, 30 Oct 2026 08:00:00 +0000", html }, o, "Wild Apothecary", "2026-10-30");
  }
  {
    // Mailchimp-style columns: each item a block of inline-block divs (picture, name, quantity, price).
    const o = order([{ name: "Seed Starter Kit", qty: 1, unit: 2200 }, { name: "Terracotta Pot 15cm", qty: 4, unit: 450 }], { fees: [["Delivery", 499]] });
    const blocks = o.lines.map((i) => `<div style="display:inline-block;width:100%;max-width:280px;vertical-align:top"><img src="https://www.greenshoots.co.uk/p/${i.name.length}.jpg" width="120" alt=""></div><div style="display:inline-block;width:100%;max-width:280px;vertical-align:top"><div>${h(i.name)}</div><div>Quantity: ${i.qty}</div><div>${gbp(i.line)}</div></div>`).join("");
    const html = page({ brand: "Green Shoots", domain: "greenshoots.co.uk", rows: [`<p>Order number: GS-55210</p>`, `<p>Order date: 29 October 2026</p>`, blocks, table(moneyRows(o))] });
    add("holdout7-mailchimp-blocks", "Green Shoots", "inline-block column blocks per item", { from: "Green Shoots <orders@greenshoots.co.uk>", subject: "Order GS-55210 confirmed", date: "Thu, 29 Oct 2026 12:30:00 +0000", html }, o, "Green Shoots", "2026-10-29");
  }

  // ---- Forwards and replies ---------------------------------------------------------------------------------------------
  const original = (shop, addr, ref, when, o, dateHdr, subject) => ({ shop, addr, ref, when, o, dateHdr, subject, text: shopText(shop, ref, when, o), html: shopPage(shop, addr.split("@")[1], ref, when, o) });
  {
    // The shopper wrote a note above the forward, with money in it ("it was £45, not £40").
    const o = order([{ name: "Wool Blend Overcoat Camel", qty: 1, unit: 14500 }], { fees: [["Delivery", 0]] });
    const g = original("Tailor & Thread", "orders@tailorandthread.co.uk", "TT-88001", "28 October 2026", o, "Wed, 28 Oct 2026 at 10:02", "Your Tailor & Thread order TT-88001");
    const note = "Hi, this is the coat I want to return. They charged me £145 but it was £40 cheaper in the sale the next day, so I'd like the £40 back if I can't return it.\n\nThanks,\nSam\n\n";
    const hdr = `---------- Forwarded message ---------\nFrom: Tailor & Thread <${g.addr}>\nDate: ${g.dateHdr}\nSubject: ${g.subject}\nTo: <${SHOPPER.email}>\n\n\n`;
    add("holdout7-fwd-note-with-money", "Tailor & Thread", "shopper's note with prices above a Gmail forward", { from: `${SHOPPER.name} <sam.taylor@gmail.com>`, to: "receipts@example.com", subject: "Fwd: " + g.subject, date: "Wed, 28 Oct 2026 18:00:00 +0000",
      text: note + hdr + g.text, html: `<div dir="ltr">${note.replace(/\n/g, "<br>")}<div class="gmail_quote"><div dir="ltr" class="gmail_attr">${hdr.trim().replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div><br>${(/<body[^>]*>([\s\S]*)<\/body>/.exec(g.html))[1]}</div></div>` }, o, "Tailor & Thread", "2026-10-28");
  }
  {
    // A reply to a forward: the shopper replied to their own forward, so the whole receipt is quoted with "> ".
    const o = order([{ name: "Kids Scooter Blue", qty: 1, unit: 4999 }, { name: "Helmet Small", qty: 1, unit: 1999 }], { fees: [["Delivery", 399]] });
    const g = original("Wheelhouse Toys", "orders@wheelhousetoys.co.uk", "WT-30442", "27 October 2026", o, "Tue, 27 Oct 2026 at 09:00", "Order WT-30442 confirmed");
    const quoted = (`---------- Forwarded message ---------\nFrom: Wheelhouse Toys <${g.addr}>\nDate: ${g.dateHdr}\nSubject: ${g.subject}\nTo: <${SHOPPER.email}>\n\n` + g.text).split("\n").map((l) => "> " + l).join("\n");
    add("holdout7-reply-to-forward", "Wheelhouse Toys", "reply above a forward, quoted with '> '", { from: `${SHOPPER.name} <sam.taylor@gmail.com>`, to: "receipts@example.com", subject: "Re: Fwd: " + g.subject, date: "Wed, 28 Oct 2026 08:00:00 +0000",
      text: `Adding this one too, the helmet is the wrong size.\n\nOn Tue, 27 Oct 2026 at 12:00, ${SHOPPER.name} <sam.taylor@gmail.com> wrote:\n\n${quoted}` }, o, "Wheelhouse Toys", "2026-10-27");
  }
  {
    // Two levels of quoting (">> "): a reply to a reply to the forward.
    const o = order([{ name: "Electric Toothbrush Heads 4 Pack", qty: 2, unit: 1600 }, { name: "Water Flosser Travel", qty: 1, unit: 3900 }], { fees: [["Delivery", 0]] });
    const g = original("Brightsmile", "orders@brightsmile.co.uk", "BS-120334", "26 October 2026", o, "Mon, 26 Oct 2026 at 15:30", "Your Brightsmile order BS-120334");
    const lvl2 = (`---------- Forwarded message ---------\nFrom: Brightsmile <${g.addr}>\nDate: ${g.dateHdr}\nSubject: ${g.subject}\nTo: <${SHOPPER.email}>\n\n` + g.text).split("\n").map((l) => ">> " + l).join("\n");
    add("holdout7-two-level-quote", "Brightsmile", "two levels of quoting ('>> ')", { from: `${SHOPPER.name} <sam.taylor@gmail.com>`, to: "receipts@example.com", subject: "Re: Re: Fwd: " + g.subject, date: "Tue, 27 Oct 2026 08:00:00 +0000",
      text: `Yes, this one.\n\nOn Tue, 27 Oct 2026, Alex Taylor <alex.taylor@example.co.uk> wrote:\n> Which order was the flosser on?\n>\n> On Mon, 26 Oct 2026 at 18:00, ${SHOPPER.name} <sam.taylor@gmail.com> wrote:\n${lvl2}` }, o, "Brightsmile", "2026-10-26");
  }
  for (const [lang, labels, idk] of [
    ["fr", { from: "De", sent: "Envoyé", to: "À", subject: "Objet", sp: " " }, "lundi 26 octobre 2026 11:04"],
    ["de", { from: "Von", sent: "Gesendet", to: "An", subject: "Betreff", sp: "" }, "Sonntag, 25. Oktober 2026 16:20"],
    ["nl", { from: "Van", sent: "Verzonden", to: "Aan", subject: "Onderwerp", sp: "" }, "zaterdag 24 oktober 2026 09:12"]]) {
    // Outlook's forward header in the shopper's own language ("De : … Envoyé : …", "Von: … Gesendet: …", "Van: … Verzonden: …").
    const day = { fr: "26 October 2026", de: "25 October 2026", nl: "24 October 2026" }[lang], iso = { fr: "2026-10-26", de: "2026-10-25", nl: "2026-10-24" }[lang];
    const shop = { fr: "Maison Perle", de: "Bergwerk Outdoor", nl: "Fietsfabriek" }[lang], dom = { fr: "maisonperle.co.uk", de: "bergwerkoutdoor.co.uk", nl: "fietsfabriek.co.uk" }[lang];
    const o = order({ fr: [{ name: "Pearl Drop Earrings", qty: 1, unit: 6500 }, { name: "Jewellery Pouch", qty: 1, unit: 500 }], de: [{ name: "Insulated Flask 750ml", qty: 2, unit: 2400 }, { name: "Camping Mug Enamel", qty: 1, unit: 1100 }],
      nl: [{ name: "Bike Lights Set USB", qty: 1, unit: 3500 }, { name: "Bike Lock D Shackle", qty: 1, unit: 4200 }] }[lang], { fees: [["Delivery", 395]] });
    const ref = { fr: "MP-2201", de: "BW-77310", nl: "FF-55002" }[lang];
    const g = original(shop, "orders@" + dom, ref, day, o, idk, `Your ${shop} order ${ref}`);
    const L = labels, sp = L.sp;
    const hdrText = `________________________________\n${L.from}${sp}: ${shop} <${g.addr}>\n${L.sent}${sp}: ${idk}\n${L.to}${sp}: ${SHOPPER.name} <${SHOPPER.email}>\n${L.subject}${sp}: ${g.subject}\n\n`;
    const hdrHtml = `<hr style="display:inline-block;width:98%" tabindex="-1"><div id="divRplyFwdMsg" dir="ltr"><font face="Calibri, sans-serif" style="font-size:11pt" color="#000000"><b>${L.from}${sp}:</b> ${h(shop)} &lt;${g.addr}&gt;<br><b>${L.sent}${sp}:</b> ${idk}<br><b>${L.to}${sp}:</b> ${SHOPPER.name} &lt;${SHOPPER.email}&gt;<br><b>${L.subject}${sp}:</b> ${h(g.subject)}</font><div>&nbsp;</div></div>`;
    add(`holdout7-outlook-fwd-${lang}`, shop, `Outlook forward header in ${lang}`, { from: `${SHOPPER.name} <sam.taylor@outlook.com>`, to: "receipts@example.com", subject: (lang === "de" ? "WG: " : lang === "nl" ? "Doorst: " : "TR: ") + g.subject, date: { fr: "Mon, 26 Oct 2026 22:00:00 +0000", de: "Sun, 25 Oct 2026 22:00:00 +0000", nl: "Sat, 24 Oct 2026 22:00:00 +0000" }[lang],
      text: "\n\n" + hdrText + g.text, html: `<html><body><div><br></div>${hdrHtml}${(/<body[^>]*>([\s\S]*)<\/body>/.exec(g.html))[1]}</body></html>` }, o, shop, iso);
  }
  {
    // Gmail's "[Message clipped]  View entire message" in the middle of the items: what follows (an item, the total) is not
    // there. The items read must be the ones shown, the total unknown, and the receipt flagged as maybe incomplete.
    const o = order([{ name: "Festive Hamper Large", qty: 1, unit: 7500 }, { name: "Mulled Wine Spice Kit", qty: 1, unit: 1200 }]);
    const html = page({ brand: "Larder & Co", domain: "larderandco.co.uk", rows: [`<p>Order number: LC-40019</p>`, `<p>Order date: 23 October 2026</p>`, itemsTable(o),
      `<div style="margin:16px 0">[Message clipped]&nbsp;&nbsp;<a href="https://mail.google.com/mail/u/0?ui=2&amp;ik=abc&amp;view=lg&amp;permmsgid=msg-f:123">View entire message</a></div>`] }).replace(/<tr><td style="padding:24px;font-size:12px"[\s\S]*?<\/td><\/tr>/, "");
    add("holdout7-gmail-clipped-mid", "Larder & Co", "'[Message clipped]' after the items, before the money", { from: "Larder & Co <orders@larderandco.co.uk>", subject: "Your Larder & Co order LC-40019", date: "Fri, 23 Oct 2026 10:00:00 +0000", html }, o, "Larder & Co", "2026-10-23", { partial: true, totalPence: null });
  }
  {
    // Clipped after the total (only the footer is missing): everything is there, but nothing can say so for certain.
    const o = order([{ name: "Leather Card Holder Tan", qty: 1, unit: 3500 }, { name: "Monogram Embossing", qty: 1, unit: 500 }], { fees: [["Delivery", 0]] });
    const text = shopText("Hide & Stitch", "HS-9902", "22 October 2026", o) + "\n\n[Message clipped]  View entire message";
    add("holdout7-gmail-clipped-after-total", "Hide & Stitch", "'[Message clipped]' after the total", { from: "Hide & Stitch <orders@hideandstitch.co.uk>", subject: "Order HS-9902 confirmed", date: "Thu, 22 Oct 2026 16:00:00 +0000", text }, o, "Hide & Stitch", "2026-10-22", { partial: true });
  }

  // ---- The receipt is only in an attachment -----------------------------------------------------------------------------
  {
    // "Your receipt is attached" with the total in the body and the items only in a PDF.
    const o = order([{ name: "(in the PDF)", qty: 1, unit: 8640 }]);
    const text = "Hi Sam,\n\nThanks for shopping with Harbour Hardware. Your receipt for order HH-22310 is attached.\n\nOrder date: 21 October 2026\nTotal paid: £86.40\n\nHarbour Hardware";
    const f = add("holdout7-pdf-only-total-in-body", "Harbour Hardware", "items only in a PDF, total in the body", { from: "Harbour Hardware <receipts@harbourhardware.co.uk>", subject: "Your receipt from Harbour Hardware", date: "Wed, 21 Oct 2026 17:30:00 +0000", text }, o, "Harbour Hardware", "2026-10-21", {},
      (H) => head(H, "holdout7-pdf-only-total-in-body") + multi("multipart/mixed", "mix-HH", [part("text/plain; charset=utf-8", "quoted-printable", qp(utf8(text))),
        part('application/pdf; name="Receipt-HH-22310.pdf"', "base64", b64(FAKE_PDF), `Content-Disposition: attachment; filename="Receipt-HH-22310.pdf"${CRLF}`)]));
    f.expected.items = []; f.expected.attachmentOnly = "pdf"; f.attach = [{ type: "application/pdf", name: "Receipt-HH-22310.pdf" }];
  }
  {
    // A picture of the till receipt, and nothing else but "Your receipt is attached".
    const o = order([]);
    const text = "Thank you for visiting Corner Crust Bakery.\nYour receipt is attached.";
    const f = add("holdout7-image-only", "Corner Crust Bakery", "only a photo of the receipt attached", { from: "Corner Crust Bakery <receipts@cornercrust.co.uk>", subject: "Your receipt from Corner Crust Bakery", date: "Tue, 20 Oct 2026 08:10:00 +0000", text }, o, "Corner Crust Bakery", "2026-10-20", { totalPence: null },
      (H) => head(H, "holdout7-image-only") + multi("multipart/mixed", "mix-CC", [part("text/plain; charset=utf-8", "7bit", text.replace(/\n/g, CRLF)),
        part('image/jpeg; name="receipt.jpg"', "base64", b64("\xff\xd8\xff\xe0" + "y".repeat(2000) + "\xff\xd9"), `Content-Disposition: attachment; filename="receipt.jpg"${CRLF}`)]));
    f.expected.items = []; f.expected.attachmentOnly = "image"; f.expected.currency = null; f.attach = [{ type: "image/jpeg", name: "receipt.jpg" }];
  }
  {
    // A summary in the body ("3 items, total £120.00"), the invoice with the items as a PDF.
    const o = order([{ name: "(in the PDF)", qty: 1, unit: 12000 }]);
    const html = page({ brand: "Office Nest", domain: "officenest.co.uk", rows: [`<p>Thanks for your order, Sam.</p>`, `<p>Order number: ON-771020</p>`, `<p>Order date: 19 October 2026</p>`, `<p>Your order of 3 items comes to <strong>£120.00</strong> including delivery.</p>`, `<p>Your VAT invoice is attached as a PDF.</p>`] }).replace(/£/g, "&pound;");
    const f = add("holdout7-pdf-invoice-summary", "Office Nest", "'order of 3 items', total, invoice PDF attached", { from: "Office Nest <orders@officenest.co.uk>", subject: "Order ON-771020 confirmed: your invoice", date: "Mon, 19 Oct 2026 11:00:00 +0000", html }, o, "Office Nest", "2026-10-19", { itemCount: 3 },
      (H) => head(H, "holdout7-pdf-invoice-summary") + multi("multipart/mixed", "mix-ON", [part("text/html; charset=utf-8", "base64", b64(utf8(html))),
        part("application/octet-stream", "base64", b64(FAKE_PDF), `Content-Disposition: attachment; filename="Invoice ON-771020.pdf"${CRLF}`)]));
    f.expected.items = []; f.expected.attachmentOnly = "pdf"; f.attach = [{ type: "application/octet-stream", name: "Invoice ON-771020.pdf" }];
  }

  // ---- Recommendations ------------------------------------------------------------------------------------------------
  {
    // After the total, a "Recommended for you" grid of 30 products with prices (a big marketing email).
    const o = order([{ name: "Chunky Knit Throw Grey", qty: 1, unit: 5900 }, { name: "Scented Reed Diffuser", qty: 1, unit: 2200 }], { fees: [["Delivery", 395]] });
    const recs = Array.from({ length: 30 }, (_, k) => [`<img src="https://www.cosyhaven.co.uk/p/r${k}.jpg" width="150" alt=""><br>${["Velvet", "Boucle", "Linen", "Faux Fur", "Waffle"][k % 5]} ${["Cushion", "Throw", "Lamp", "Rug", "Candle", "Vase"][k % 6]} ${k + 1}<br>${gbp(1500 + k * 250)}`]);
    const grid = []; for (let k = 0; k < 30; k += 3) grid.push(recs.slice(k, k + 3).map((r) => r[0]));
    const html = shopPage("Cosy Haven", "cosyhaven.co.uk", "CH-66120", "18 October 2026", o, { after: [`<h2>Recommended for you</h2>`, table(grid)] });
    add("holdout7-carousel-30", "Cosy Haven", "30 'Recommended for you' products after the total", { from: "Cosy Haven <orders@cosyhaven.co.uk>", subject: "Your Cosy Haven order CH-66120", date: "Sun, 18 Oct 2026 19:00:00 +0000", html }, o, "Cosy Haven", "2026-10-18");
  }
  {
    // "You might also like" with four products and prices, after the total, in a text-only email.
    const o = order([{ name: "Running Belt Black", qty: 1, unit: 1800 }, { name: "Energy Gel Box of 12", qty: 1, unit: 1500 }], { fees: [["Delivery", 299]] });
    const text = shopText("Pace Lab", "PL-20031", "17 October 2026", o, { after: ["", "You might also like", "Hydration Vest 5L | £55.00", "Compression Calf Sleeves | £25.00", "Reflective Running Cap | £18.00", "Blister Plasters x10 | £6.50"] });
    add("holdout7-also-like-text", "Pace Lab", "'You might also like' with prices after the total (text)", { from: "Pace Lab <orders@pacelab.co.uk>", subject: "Order PL-20031 confirmed", date: "Sat, 17 Oct 2026 07:30:00 +0000", text }, o, "Pace Lab", "2026-10-17");
  }
  {
    // "Customers also bought" between the items and the money.
    const o = order([{ name: "Espresso Machine Compact", qty: 1, unit: 17900 }, { name: "Milk Jug 350ml", qty: 1, unit: 1200 }], { fees: [["Delivery", 0]] });
    const also = `<h3>Customers also bought</h3>${table([["Descaler Tablets", gbp(899)], ["Knock Box", gbp(2200)], ["Tamper 58mm", gbp(1800)]])}`;
    const html = shopPage("Crema Home", "cremahome.co.uk", "CR-80033", "16 October 2026", o, { money: false, after: [also, table(moneyRows(o))] });
    add("holdout7-also-bought-before-money", "Crema Home", "'Customers also bought' between the items and the money", { from: "Crema Home <orders@cremahome.co.uk>", subject: "Your Crema Home order CR-80033", date: "Fri, 16 Oct 2026 13:00:00 +0000", html }, o, "Crema Home", "2026-10-16");
  }
  {
    // "Complete the look" products with prices placed ABOVE the items, under the greeting.
    const o = order([{ name: "Satin Midi Skirt Emerald", qty: 1, unit: 4900 }], { fees: [["Delivery", 450]] });
    const look = `<h3>Complete the look</h3>${table([[`Silk Cami Ivory<br>${gbp(3500)}`, `Block Heel Mule<br>${gbp(5500)}`]])}`;
    const html = shopPage("Atelier Nine", "ateliernine.co.uk", "AN-12077", "15 October 2026", o, { before: [look, `<h3>Your order</h3>`] });
    add("holdout7-complete-the-look-above", "Atelier Nine", "'Complete the look' with prices above the items", { from: "Atelier Nine <orders@ateliernine.co.uk>", subject: "Thanks for your order AN-12077", date: "Thu, 15 Oct 2026 20:00:00 +0000", html }, o, "Atelier Nine", "2026-10-15");
  }
  return out;
}
export { CRLF, utf8, cp1252, b64, qp, head, part, multi, FAKE_PDF, itemsTable, shopPage, shopText };

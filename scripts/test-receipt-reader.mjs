// The receipt reader: what counts as an item, what the shop is called, and which group it goes in. The cases are the
// kinds of mistakes found on a real account (shop and card details invented).
import assert from "node:assert/strict";
import { cleanItem, cleanItems, cleanShopName, rankShop, shopNamesInText, forwardedSender, looksLikePerson } from "../worker/receipt-reader.js";
import { parseReceiptEmail } from "../worker/receipt-parser.js";
import { categorise, shopDisplayName, storeKey, legacyStoreKey, agreedShopNames, logoDomainFor } from "../worker/receipt-category.js";
let n = 0; const t = (m, f) => { f(); n++; console.log("ok -", m); };
const c = (name, domain, items = []) => categorise({ retailer: { name, domain }, items: items.map(x => ({ name: x })) });

t("payment lines, savings, refunds and table labels are not items", () => {
  for (const junk of ["You've saved", "You saved", "Credit:", "Item Refund:", "From", "Was", "Card", "Quantity 1 Price", "APPLEPAY", "Apple Pay",
    "Vouchers        1", "x1", "Promos Applied [SAVE50]", "Mastercard Credit Card Payment (400000******1234):", "Mastercard", "Visa ending 1234",
    "Delivery", "Subtotal", "Total savings", "Klarna", "Gift card balance", "£12.00", "Order summary", "Qty: 2"])
    assert.equal(cleanItem({ name: junk, qty: 1 }), null, junk);
});
t("real items are kept, with a quantity that ran into the name moved out", () => {
  for (const ok of ["Curry Sauce 咖喱汁", "Omega-3 Fish Fingers", "Match Masters", "Define Jacket Nulu", "lululemon Align™ High-Rise Lettuce-Hem Flared Pant", "Credit card holder in tan leather"])
    assert.equal(cleanItem({ name: ok, qty: 1 })?.name, ok, ok);
  assert.deepEqual(cleanItem({ name: "Chocolate Brown                1", qty: 1 }), { name: "Chocolate Brown", qty: 1 });
  assert.deepEqual(cleanItem({ name: "Sausage roll x2", qty: 1 }), { name: "Sausage roll", qty: 2 });
  assert.equal(cleanItems([{ name: "You've saved" }, { name: "Wool jumper", qty: 1 }]).length, 1);
});
t("card numbers never survive as an item", () => {
  assert.equal(cleanItem({ name: "Payment 4000 00** **** 1234" }), null);
  assert.equal(cleanItem({ name: "Card ****1234" }), null);
});
t("shop names lose the department, country, team and decorations", () => {
  assert.equal(shopDisplayName({ name: "Swarovski Customer Service GB", domain: "swarovski.com" }), "Swarovski");
  assert.equal(shopDisplayName({ name: "Tempur UK Consumer Support", domain: "tempur.co.uk" }), "Tempur");
  assert.equal(shopDisplayName({ name: "The Buyagift Team", domain: "t.buyagift.co.uk" }), "Buyagift");
  assert.equal(shopDisplayName({ name: "Groupon 🎄", domain: "r.grouponmail.co.uk" }), "Groupon");
  assert.equal(shopDisplayName({ name: "Panda Mami - Panda Mami Nottingham", domain: "touchtakeaway.net" }), "Panda Mami");
  assert.equal(shopDisplayName({ name: "McDonald's Account Services", domain: "privaterelay.appleid.com" }), "McDonald's");
  assert.equal(shopDisplayName({ name: "Mcdonalds", domain: "mcdonalds.co.uk" }), "McDonald's");
  assert.equal(shopDisplayName({ name: "Admiralcasino.co.uk", domain: "admiralcasino.co.uk" }), "Admiral Casino");
  assert.equal(shopDisplayName({ name: "The Greene King App", domain: "app.greeneking.co.uk" }), "Greene King");
  assert.equal(shopDisplayName({ name: "The Scent Reserve", domain: "thescentreserve.com" }), "The Scent Reserve", "a real 'The' stays");
  assert.equal(shopDisplayName({ domain: 'tempur.com"' }), "Tempur", "a stray quote in the address");
  assert.equal(shopDisplayName({ name: "Ted Baker", domain: "global-e.com" }), "Ted Baker");
  assert.equal(shopDisplayName({ name: "Charlotte Tilbury", domain: "charlottetilbury.com" }), "Charlotte Tilbury", "a shop named after a person");
});
t("a person's name on a shop's own address is replaced by the shop", () => {
  assert.equal(looksLikePerson("Liam Hartley", "clarechampion.ie"), true);
  assert.equal(looksLikePerson("Sweaty Betty", "sweatybetty.com"), false);
  assert.equal(shopDisplayName({ name: "David Hartley", domain: "bowsandwhistles.co.uk" }), "Bows and Whistles");
  const agreed = agreedShopNames([
    { retailer: { name: "Clare Champion Digital Edition", domain: "clarechampion.ie" } }, { retailer: { name: "Clare Champion Digital Edition", domain: "clarechampion.ie" } },
    { retailer: { name: "Liam Hartley", domain: "clarechampion.ie" } }, { retailer: { name: "Domino's Pizza", domain: "dominos.co.uk" } }, { retailer: { name: "Dominos", domain: "dominos.co.uk" } }]);
  assert.equal(agreed.get("clarechampion.ie"), "Clare Champion");
  assert.equal(agreed.get("dominos.co.uk"), "Domino's");
});
t("the shop is ranked from every clue: data block, forwarded sender, sender, footer, web address", () => {
  assert.deepEqual(rankShop({ senderName: "Swarovski Customer Service GB", senderDomain: "swarovski.com" }).name, "Swarovski");
  const fw = forwardedSender("---------- Forwarded message ---------\nFrom: lululemon <orders@e.lululemon.com>\nDate: 19 Nov 2025");
  assert.deepEqual(fw, { name: "lululemon", domain: "e.lululemon.com" });
  assert.equal(rankShop({ senderName: "Sam", senderDomain: "gmail.com", personal: true, forwardedName: fw.name, forwardedDomain: fw.domain }).name, "lululemon");
  const shopify = rankShop({ senderName: "Kick Lane", senderDomain: "g.shopifyemail.com", bodyNames: shopNamesInText("Thank you for shopping with Kick Lane!\n© 2026 Kick Lane") });
  assert.equal(shopify.name, "Kick Lane"); assert.equal(shopify.domain, null); assert.equal(shopify.via, "g.shopifyemail.com");
  const dojo = rankShop({ senderName: "Dojo", senderDomain: "dojo.tech", bodyNames: shopNamesInText("Your receipt from The Crown Inn.\nTotal £12.40") });
  assert.equal(dojo.name, "The Crown Inn", "the card-machine company is not the shop");
  assert.equal(rankShop({ senderName: "Liam Hartley", senderDomain: "clarechampion.ie", bodyNames: ["Clare Champion"] }).name, "Clare Champion");
  assert.equal(cleanShopName("noreply"), null);
});
t("groups are scored from the shop, its name and the items", () => {
  assert.equal(c("GreatBeanBags", "greatbeanbags.com", ["Chocolate Brown"]).category, "home", "a colour isn't food");
  assert.equal(c(null, "tvbedsnorthwest.co.uk", ["You saved"]).category, "home");
  assert.equal(c("Tiffany & Co.", "clientservices.tiffany.com").category, "fashion");
  assert.equal(c("Tempur UK Consumer Support", "tempur.co.uk").category, "home");
  assert.equal(c("Lumin", "luminskin.com").category, "beauty");
  assert.equal(c("Dojo", "dojo.tech").category, "other", "not Electronics because of '.tech'");
  const tix = c("Eventim", "eventim.co.uk"); assert.equal(tix.category, "experiences"); assert.equal(tix.returnable, false); assert.ok(tix.notReturnableReason);
  assert.equal(c("London Theatre Direct", "londontheatredirect.com").category, "experiences");
  const bet = c("Admiralcasino.co.uk", "admiralcasino.co.uk"); assert.equal(bet.returnable, false);
  assert.equal(c("Clare Champion Digital Edition", "clarechampion.ie").category, "digital");
  assert.equal(c("Sainsbury's", "sainsburys.co.uk", ["You've saved"]).returnable, false, "a supermarket shop stays food");
  const cups = c("Sainsbury's", "sainsburys.co.uk", ["Paper cups 50 pack", "Bananas"]); assert.equal(cups.returnable, false); assert.match(cups.notReturnableReason, /Food and drink/);
  assert.equal(c("Sainsbury's", "sainsburys.co.uk", ["Tu denim jeans"]).category, "fashion", "clothes from a supermarket are still clothes");
});
t("shops sending through Shopify or Stripe each keep their own key (and the old key is kept for what was learned)", () => {
  const a = { retailer: { name: "Kick Lane", domain: "g.shopifyemail.com" } }, b = { retailer: { name: "Other Shop", domain: "g.shopifyemail.com" } };
  assert.notEqual(storeKey(a), storeKey(b));
  assert.equal(storeKey(a), "kicklane");
  assert.equal(legacyStoreKey(a), "gshopifyemail");
  assert.equal(storeKey({ retailer: { name: "Zara", domain: "zara.com" } }), "zara");
});
t("each shop's logo comes from its own address, or a well-known shop's address found from its name; never a mailbox or a payment company", () => {
  assert.equal(logoDomainFor({ name: "Wetherspoon", domain: "jdwetherspoon.co.uk" }), "jdwetherspoon.co.uk");
  assert.equal(logoDomainFor({ name: "McDonald's" }), "mcdonalds.com", "sent through Apple's private relay, no address of its own");
  assert.equal(logoDomainFor({ name: "LNER on board service" }), "lner.co.uk");
  assert.equal(logoDomainFor({ name: "Ted Baker", domain: "global-e.com" }), "tedbaker.com");
  assert.equal(logoDomainFor({ name: "Uber Eats" }), "ubereats.com", "the longer name wins");
  assert.equal(logoDomainFor({ name: "Kick Lane", domain: "g.shopifyemail.com" }), null, "Shopify's logo is not the shop's");
  assert.equal(logoDomainFor({ name: "Leon Smith", domain: "gmail.com" }), null, "a forwarded receipt from a person called Leon is not Leon the restaurant");
  assert.equal(logoDomainFor({ name: "Apple Pie Bakery" }), null);
});
const mail = (from, subject, html) => `From: ${from}\nSubject: ${subject}\nDate: Sat, 31 Oct 2026 10:00:00 +0000\nContent-Type: text/html; charset=utf-8\n\n${html}`;
t("a Shopify shop's email: the shop's own name, its items read from 'Name × 1', no Shopify address as the shop", () => {
  const r = parseReceiptEmail(mail("Kick Lane <store+123@g.shopifyemail.com>", "Order #1004 confirmed",
    `<p>Thank you for your purchase!</p><p>Order #1004</p><table><tr><td>Retro Runner Trainers × 1</td></tr><tr><td>UK 9 / White</td></tr><tr><td>£95.00</td></tr></table><p>Subtotal £95.00</p><p>Total £95.00 GBP</p><p>© 2026 Kick Lane</p>`));
  assert.equal(r.ok, true);
  assert.equal(r.retailer.name, "Kick Lane"); assert.equal(r.retailer.domain, null); assert.equal(r.retailer.via, "g.shopifyemail.com");
  assert.deepEqual(r.items.map(i => [i.name, i.qty, i.pricePence, i.variant]), [["Retro Runner Trainers", 1, 9500, "UK 9 / White"]]);
  assert.equal(categorise(r).category, "fashion");
});
t("a card-machine receipt names the venue, not the card-machine company", () => {
  const r = parseReceiptEmail(mail("Dojo <receipts@dojo.tech>", "Your receipt from The Crown Inn", `<p>Your receipt from The Crown Inn.</p><p>Order number: CR-55821</p><p>2 x Pint of lager £11.00</p><p>Total £11.00</p><p>Paid with Visa ending 1234</p>`));
  assert.equal(r.retailer.name, "The Crown Inn");
  assert.ok(!r.items.some(i => /visa/i.test(i.name)));
  assert.equal(categorise(r).category, "food");
});
t("a receipt forwarded from a personal mailbox is put under the shop that sent it", () => {
  const r = parseReceiptEmail(`From: Sam <sam.example@gmail.com>\nSubject: Fwd: Your order confirmation\nContent-Type: text/plain\n\n---------- Forwarded message ---------\nFrom: lululemon <orders@e.lululemon.com>\nSubject: Your order confirmation\n\nThanks for your order!\nOrder number: C123456789\n1 x Define Jacket Nulu £118.00\nOrder total £118.00\n`);
  assert.equal(r.retailer.name, "lululemon"); assert.equal(r.retailer.domain, "e.lululemon.com");
  assert.equal(categorise(r).category, "fashion");
});
t("a department's sender name, a stray quote and payment lines are tidied when the email is read", () => {
  const r = parseReceiptEmail(mail('"Swarovski Customer Service GB" <service@swarovski.com">', "Your order confirmation",
    `<p>Order number: SW-778812</p><table><tr><td>Swan pendant</td><td>£85.50</td></tr><tr><td>Mastercard Credit Card Payment (400000******1234):</td><td>£85.50</td></tr></table><p>Order total £85.50</p>`));
  assert.equal(r.retailer.name, "Swarovski"); assert.equal(r.retailer.domain, "swarovski.com");
  assert.deepEqual(r.items.map(i => i.name), ["Swan pendant"]);
  assert.ok(!JSON.stringify(r).includes("400000"), "no card digits are kept anywhere");
});
t("a forwarded receipt names the shop, whichever email app forwarded it", () => {
  const body = "\n\nThank you for your order\nOrder number: 1234567890\n";
  const personal = (d) => /(^|\.)(gmail\.com|outlook\.com|hotmail\.co\.uk|icloud\.com|yahoo\.co\.uk)$/.test(d);
  const forms = {
    "Gmail": "---------- Forwarded message ---------\nFrom: lululemon <orders@e.lululemon.com>\nDate: Sat, 1 Nov 2026 at 10:15\nSubject: Your order\nTo: <me@gmail.com>",
    "Gmail, read from its HTML": "---------- Forwarded message ---------\nFrom: lululemon &lt; orders@e.lululemon.com &gt;\nDate: Sat, 1 Nov 2026 at 10:15",
    "Outlook.com": "________________________________\nFrom: lululemon <orders@e.lululemon.com>\nSent: 01 November 2026 10:15\nTo: Me <me@outlook.com>\nSubject: Your order",
    "Outlook, read from its HTML": "From: lululemon &lt;orders@e.lululemon.com&gt;\nSent: 01 November 2026 10:15\nTo: Me &lt;me@outlook.com&gt;",
    "Outlook for Windows": "________________________________\nFrom: lululemon <orders@e.lululemon.com<mailto:orders@e.lululemon.com>>\nSent: 01 November 2026 10:15",
    "Outlook, plain text": "-----Original Message-----\nFrom: lululemon [mailto:orders@e.lululemon.com]\nSent: 01 November 2026 10:15",
    "Outlook for iOS": "Get Outlook for iOS<https://aka.ms/o0ukef>\n________________________________\nFrom: lululemon <orders@e.lululemon.com>\nSent: Saturday, November 1, 2026 10:15:07 AM",
    "Apple Mail": "Begin forwarded message:\n\nFrom: lululemon <orders@e.lululemon.com>\nSubject: Your order\nDate: 1 November 2026 at 10:15:07 GMT",
    "Yahoo": "----- Forwarded Message -----\nFrom: lululemon <orders@e.lululemon.com>\nTo: me@yahoo.co.uk <me@yahoo.co.uk>\nSent: Saturday, 1 November 2026, 10:15:07 GMT",
    // Passed on twice: the friend who forwarded it first is skipped, the shop is found.
    "a forward of a forward": "---------- Forwarded message ---------\nFrom: Sam <sam@hotmail.co.uk>\nDate: 2 Nov 2026\n\n________________________________\nFrom: lululemon <orders@e.lululemon.com>\nSent: 01 November 2026 10:15",
  };
  for (const [app, head] of Object.entries(forms)) assert.deepEqual(forwardedSender(head + body, { personal }), { name: "lululemon", domain: "e.lululemon.com" }, app);
  // Only a header block counts: a train ticket's "From: London Kings Cross" has no address, and a line in a receipt isn't a forward.
  assert.equal(forwardedSender("From: London Kings Cross\nTo: York\nDate: 1 Nov 2026"), null);
  assert.equal(forwardedSender("Questions? Email help@shop.test\nFrom: our team with love"), null);
  // The whole email, sent on from Outlook.com to the shopper's Gmail.
  const r = parseReceiptEmail("From: Sam Tester <sam@hotmail.co.uk>\r\nSubject: FW: Your Ted Baker order\r\nContent-Type: text/plain\r\n\r\n" +
    "________________________________\nFrom: Ted Baker <orders@tedbaker.com>\nSent: 01 November 2026 10:15\nTo: Sam\nSubject: Your Ted Baker order\n\n" +
    "Thank you for your order\nOrder number: TB-55123\nCotton Oxford Shirt - Qty 1 - £89.00\nOrder total: £89.00\n");
  assert.equal(r.ok, true, "\"Your Ted Baker order\" is an order subject");
  assert.deepEqual(r.retailer, { name: "Ted Baker", domain: "tedbaker.com" });
});

t("short names in capitals keep them; long ones are tidied; legal endings go", () => {
  assert.equal(rankShop({ senderName: "LNER", senderDomain: "lner.co.uk" }).name, "LNER");
  assert.equal(rankShop({ senderName: "ASOS", senderDomain: "asos.com" }).name, "ASOS");
  assert.equal(rankShop({ senderName: "H&M", senderDomain: "hm.com" }).name, "H&M");
  assert.equal(rankShop({ senderName: "SWAROVSKI", senderDomain: "swarovski.com" }).name, "Swarovski");
  assert.equal(shopDisplayName({ name: "Anthropic, PBC", domain: null }), "Anthropic");
});

t("emails read the same whatever the mail service did to them", () => {
  const html = '<p>Thank you for your order</p><p>Order number: 55123</p><p>Levi&rsquo;s 501&reg; Jeans 32&quot; - Qty 1 - &pound;90.00</p><p>Order total: &#xA3;90.00</p>' +
    '<p><a href="https://eur02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fwww.levi.com%2Freturns&amp;data=05%7C02%7C%7Cabc&amp;sdata=x%3D&amp;reserved=0">Start a return</a> ' +
    '<a href="https://eur02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fwww.levi.com%2Faccount&amp;data=05%7C02&amp;reserved=0">Account</a></p>';
  const mail = (enc, cs, b) => `From: Levi's <orders@levi.test>\r\nSubject: Thank you for your order\r\nContent-Type: text/html; charset="${cs}"\r\nContent-Transfer-Encoding: ${enc}\r\n\r\n${b}`;
  const a = parseReceiptEmail(mail("7bit", "utf-8", html));
  assert.deepEqual(a.items.map(i => i.name), ["Levi’s 501® Jeans 32\""], "named and hex character codes are decoded");
  assert.equal(a.totalPence, 9000);
  assert.equal(a.returns && a.returns.portalUrl, "https://www.levi.com/returns", "Microsoft's Safe Links wrapper is taken off");
  // The same email as base64 in windows-1252, the way Outlook may hand it over: "£" is a single byte there.
  const b = parseReceiptEmail(mail("base64", "windows-1252", Buffer.from(html.replace("&#xA3;", "£"), "latin1").toString("base64")));
  assert.equal(b.totalPence, 9000, "a base64 part is read in its own character set");
});

t("the address the order was sent to is kept for returns (the shop's page asks for it)", () => {
  const mail = (to) => `From: Rains <orders@rains.test>\r\nTo: ${to}\r\nSubject: Thank you for your order\r\nContent-Type: text/plain\r\n\r\nThank you for your order\nOrder number: RA-1\nLong Jacket - Qty 1 - £110.00\nOrder total: £110.00\n`;
  assert.equal(parseReceiptEmail(mail("quiet_fox_12@privaterelay.appleid.com")).sentTo, "quiet_fox_12@privaterelay.appleid.com", "a Hide My Email address");
  assert.equal(parseReceiptEmail(mail('"Sam Tester" <Sam.Tester@Outlook.com>')).sentTo, "sam.tester@outlook.com");
  assert.equal(parseReceiptEmail(mail("orders@rains.test, sam@example.com")).sentTo, "sam@example.com", "never the shop's own address");
  assert.equal(parseReceiptEmail(mail("undisclosed-recipients:;")).sentTo, null);
});

console.log(`\nPASS receipt reader: ${n} checks`);

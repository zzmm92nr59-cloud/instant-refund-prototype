// The receipt reader: what counts as an item, what the shop is called, and which group it goes in. The cases are the
// kinds of mistakes found on a real account (shop and card details invented).
import assert from "node:assert/strict";
import { cleanItem, cleanItems, cleanShopName, rankShop, shopNamesInText, forwardedSender, looksLikePerson } from "../worker/receipt-reader.js";
import { parseReceiptEmail } from "../worker/receipt-parser.js";
import { categorise, shopDisplayName, storeKey, legacyStoreKey, agreedShopNames } from "../worker/receipt-category.js";
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
console.log(`\nPASS receipt reader: ${n} checks`);

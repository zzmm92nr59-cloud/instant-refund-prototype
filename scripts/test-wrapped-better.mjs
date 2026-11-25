// Offline test (made-up shops, people and receipts; Anthropic is a stand-in): what kind of shop a name points to
// (worker/shop-kind.js and shop-kind-ai.js), the fixes behind Connor's Wrapped (a TV bed is furniture, a supermarket is
// groceries, the story doesn't open with a bottle of water, a "go-to" is somewhere you went back to) and the travel chapter.
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { shopKind, segment, spellOut } from "../worker/shop-kind.js";
import { learnShopKinds, readShopKinds, unclearShops, cleanShopKinds, SHOP_KIND_SYSTEM } from "../worker/shop-kind-ai.js";
import { categorise, itemCategories, shopDisplayName, itemKind } from "../worker/receipt-category.js";
import { buildWrapped, journeysOf } from "../worker/wrapped.js";
import { placeAt } from "../worker/uk-places.js";

// 1. Reading a shop's name word by word.
{
  assert.deepEqual(segment("tvbedsnorthwest").map((p) => p.w), ["tv", "beds", "northwest"]);
  assert.deepEqual(segment("jdsports").map((p) => p.w), ["jd", "sports"]);
  assert.deepEqual(segment("bootsuk").map((p) => p.w), ["boots", "uk"]);
  assert.equal(segment("currys").length, 1, "a possessive name isn't split into 'curry' and a loose letter");
  const k = (n, d) => shopKind(n, d);
  assert.equal(k("tvbedsnorthwest").category, "home", "tvbedsnorthwest sells beds: the last word that says what's sold decides");
  assert.equal(k("", "tvbedsnorthwest.co.uk").category, "home", "the web address alone says the same");
  assert.deepEqual(k("tvbedsnorthwest").ranked.map((r) => r.category), ["home", "electronics"], "ranked, with TV as the weaker clue");
  assert.equal(k("jdsports").category, "fashion", "a sports shop is Fashion in Relay's kinds (there is no separate sport kind)");
  assert.equal(k("Currys PC World").category, "electronics");
  assert.equal(k("The Bed Shop").category, "home");
  assert.equal(k("TV World").category, "electronics", "with no other noun, TV is what's sold");
  assert.equal(k("The TV Shop").category, "electronics");
  assert.equal(k("Smiths Furn").category, "home", "short forms are written out (furn is furniture)");
  assert.equal(k("Great Bean Bags").category, "home", "bean bags are furniture, not bags");
  const nonsense = k("Xqzzyblorp");
  assert.equal(nonsense.category, null); assert.equal(nonsense.confidence, "none");
  const inside = k("Cathkidston");
  assert.equal(inside.category, null, "a word found inside an unknown name ('cat') isn't a clue"); assert.equal(inside.confidence, "low");
  assert.equal(spellOut("tvbedsnorthwest"), "TV Beds North West");
  assert.equal(spellOut("lululemon"), null, "a brand Relay can't split keeps its own spelling");
  assert.equal(shopDisplayName({ name: "Tvbedsnorthwest", domain: "tvbedsnorthwest.co.uk" }), "TV Beds North West");
  assert.equal(shopDisplayName({ name: "Lululemon", domain: "lululemon.co.uk" }), "Lululemon");
  console.log("ok - shop names are read word by word, ranked, and only a clear answer counts");
}

// 2. Receipts: a TV bed is furniture; a supermarket's water is food; the shop's kind helps only when the items don't say.
{
  const tvb = { retailer: { name: "Tvbedsnorthwest", domain: "tvbedsnorthwest.co.uk" }, items: [{ name: "4ft6 Ottoman TV Bed - Grey Plush Velvet", pricePence: 109289 }] };
  assert.equal(categorise(tvb).category, "home");
  assert.equal(itemCategories(tvb)[0].category, "home");
  for (const n of ["Ottoman TV Bed", "Divan Base 4ft6", "Bed Frame Double", "TV Stand Oak", "Sleigh Bed Grey"]) assert.equal(itemKind(n), "home", n);
  for (const n of ["Samsung 55in QLED TV", "LG OLED TV 65"]) assert.equal(itemKind(n), "electronics", n + " is still a television");
  // No item name at all: the shop's name decides.
  assert.equal(categorise({ retailer: { name: "Tvbedsnorthwest", domain: "tvbedsnorthwest.co.uk" }, items: [] }).category, "home");
  assert.equal(categorise({ retailer: { name: "TV World", domain: "tvworld.example" }, items: [] }).category, "electronics");
  // A clear item beats the shop's name.
  assert.equal(categorise({ retailer: { name: "The Bed Shop", domain: "thebedshop.example" }, items: [{ name: "Samsung 55in QLED TV" }] }).category, "electronics");
  const sb = { retailer: { name: "Sainsbury's", domain: "sainsburys.co.uk" }, items: [{ name: "Sainsbury's Still British Bottled Spring Water 4x2L", pricePence: 150 }] };
  assert.equal(categorise(sb).category, "food"); assert.equal(itemCategories(sb)[0].category, "food");
  for (const [name, domain] of [["Tesco", "tesco.com"], ["Asda", "asda.com"], ["Morrisons", "morrisons.com"], ["Aldi", "aldi.co.uk"], ["Lidl", "lidl.co.uk"], ["Waitrose", "waitrose.com"],
    ["Co-op", "coop.co.uk"], ["Iceland", "iceland.co.uk"], ["Ocado", "ocado.com"]]) {
    const c = { retailer: { name, domain }, items: [{ name: "Kitchen Towels x2", pricePence: 300 }, { name: "Toilet Tissue 9 Roll", pricePence: 450 }, { name: "Semi Skimmed Milk 4 Pints", pricePence: 155 }] };
    assert.equal(categorise(c).category, "food", name + " is groceries, not Home & garden");
  }
  console.log("ok - a TV bed is furniture, and a supermarket shop is groceries");
}

// 3. Asking Claude once about a shop whose name isn't clear (stand-in for Anthropic; real SQLite).
{
  const sqlite = new DatabaseSync(":memory:");
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), async run() { sqlite.prepare(sql).run(...args); return {}; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; }, async all() { return { results: sqlite.prepare(sql).all(...args) }; }, _exec() { sqlite.prepare(sql).run(...args); } });
  const db = { prepare: (sql) => stmt(sql), async batch(list) { list.forEach((s) => s._exec()); return []; } };
  const cards = [
    { id: "1", retailer: { name: "Cathkidston", domain: "cathkidston.example" }, items: [{ name: "Order 4471" }], storeKey: "cathkidstonexample" },
    { id: "2", retailer: { name: "Xqzzyblorp", domain: "xqzzyblorp.example" }, items: [], storeKey: "xqzzyblorpexample" },
    { id: "3", retailer: { name: "TV World", domain: "tvworld.example" }, items: [] },                      // clear from its name
    { id: "4", retailer: { name: "Zara", domain: "zara.com" }, items: [] },                                 // a shop Relay knows
    { id: "5", retailer: { name: "Sam Smith", domain: "gmail.com" }, items: [] },                           // forwarded: never sent
    { id: "6", retailer: { name: "Oddly Named Ltd", domain: "oddly.example" }, items: [{ name: "Wool Jumper", categorySure: true }] }, // items already say
  ];
  // (A shop on Relay's list squashed into one word is asked about by its own spelling, "Cath Kidston". Round 62.)
  assert.deepEqual(unclearShops(cards).map((s) => s.name), ["Cath Kidston", "Xqzzyblorp"]);
  let calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), key: init.headers["x-api-key"] });
    const asked = JSON.parse(JSON.parse(init.body).messages[0].content);
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ shops: asked.map((s) => ({ id: s.id, kind: s.name === "Cath Kidston" ? "home" : "made-up-kind" })) }) }] }), { status: 200 }); };
  // Without the key: nothing is asked, nothing pretended.
  assert.equal(await learnShopKinds({ RELAY_DB: db }, cards, { fetchImpl }), 0);
  assert.equal(calls.length, 0);
  const env = { RELAY_DB: db, ANTHROPIC_API_KEY: "test-key-not-real" };
  assert.equal(await learnShopKinds(env, cards, { fetchImpl, now: 1 }), 2);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  const sent = JSON.stringify(calls[0].body.messages);
  for (const secret of ["Sam Smith", "gmail", "Order 4471", "Wool Jumper", "Zara", "TV World"]) assert.ok(!sent.includes(secret), "never sent: " + secret);
  assert.match(SHOP_KIND_SYSTEM, /"other"/);
  const got = await readShopKinds(db, ["cathkidstonexample", "xqzzyblorpexample"]);
  assert.equal(got.get("cathkidstonexample"), "home");
  assert.equal(got.get("xqzzyblorpexample"), "other", "an answer outside the list is kept as Other, so it isn't asked again");
  assert.equal(await learnShopKinds(env, cards, { fetchImpl, now: 2 }), 0, "each shop is asked about once, ever");
  assert.equal(calls.length, 1);
  assert.equal(cleanShopKinds("not json", new Set(["1"])), null);
  // What Claude said is a hint for that shop's receipts when nothing else says; "other" is never used as one.
  assert.equal(categorise({ retailer: { name: "Cathkidston", domain: "cathkidston.example" }, items: [], shopKindAi: "home" }).category, "home");
  assert.equal(categorise({ retailer: { name: "Xqzzyblorp", domain: "xqzzyblorp.example" }, items: [], shopKindAi: "other" }).category, "other");
  assert.equal(categorise({ retailer: { name: "Cathkidston", domain: "cathkidston.example" }, items: [{ name: "Wireless Headphones" }], shopKindAi: "home" }).category, "electronics", "a clear item still wins");
  // A failed request learns nothing and breaks nothing.
  const env2 = { RELAY_DB: db, ANTHROPIC_API_KEY: "test-key-not-real" };
  assert.equal(await learnShopKinds(env2, [{ id: "9", retailer: { name: "Blorpington", domain: "blorp.example" }, items: [] }], { fetchImpl: async () => { throw new Error("offline"); } }), 0);
  console.log("ok - an unclear shop is asked about once (name and web address only), kept for good, and only used when nothing better says");
}

// 4. Wrapped: the opening, the go-to, and travel.
const R = (name, domain) => ({ name, domain });
const listed = (c) => { const g = categorise(c), k = itemCategories(c); return { kind: "order", currency: "GBP", ...c, ...g, items: c.items.map((it, i) => ({ qty: 1, ...it, category: k[i] ? k[i].category : g.category, categorySure: Boolean(k[i] && k[i].sure) })) }; };
{
  const year = [
    listed({ id: "w1", retailer: R("Sainsbury's", "sainsburys.co.uk"), orderDate: "2026-01-04", totalPence: 150, items: [{ name: "Sainsbury's Still British Bottled Spring Water 4x2L", pricePence: 150 }] }),
    listed({ id: "c1", retailer: R("Pret A Manger", "pret.co.uk"), orderDate: "2026-01-05", totalPence: 450, items: [{ name: "Oat Flat White", pricePence: 450 }] }),
    listed({ id: "t1", retailer: R("Trainline", "thetrainline.com"), orderDate: "2026-01-06", totalPence: 8900, items: [{ name: "London Euston to Manchester Piccadilly (return)", pricePence: 8900 }] }),
    listed({ id: "n1", retailer: R("Netflix", "netflix.com"), orderDate: "2026-01-07", totalPence: 1099, items: [{ name: "Netflix Standard subscription", pricePence: 1099 }] }),
    listed({ id: "k1", retailer: R("Sainsbury's", "sainsburys.co.uk"), orderDate: "2026-01-08", totalPence: 300, items: [{ name: "Sainsbury's Kitchen Towels x2", pricePence: 300 }] }),
    listed({ id: "f1", retailer: R("Kick Lane", "kicklane.example"), orderDate: "2026-01-12", totalPence: 8500, items: [{ name: "Kick Lane Court Classic Trainers", pricePence: 8500 }] }),
    listed({ id: "f2", retailer: R("Studio North", "studionorth.example"), orderDate: "2026-01-20", totalPence: 5500, hasImage: true, items: [{ name: "Oversized Hoodie", pricePence: 5500 }] }),
    listed({ id: "b1", retailer: R("Tvbedsnorthwest", "tvbedsnorthwest.co.uk"), orderDate: "2026-03-01", totalPence: 109289, items: [{ name: "4ft6 Ottoman TV Bed - Grey Plush Velvet", pricePence: 109289 }] }),
    listed({ id: "e1", retailer: R("Currys", "currys.co.uk"), orderDate: "2026-04-01", totalPence: 109289, items: [{ name: "Samsung 55in QLED TV", pricePence: 109289 }] }),
    listed({ id: "t2", retailer: R("LNER", "lner.co.uk"), orderDate: "2026-05-02", totalPence: 6000, items: [{ name: "Manchester Piccadilly to London Euston", pricePence: 6000 }] }),
    listed({ id: "t3", retailer: R("Trainline", "thetrainline.com"), orderDate: "2026-06-02", totalPence: 4000, items: [{ name: "Edinburgh to Glasgow Queen Street", pricePence: 2000 }, { name: "Glasgow to Little Snoring Halt", pricePence: 2000 }] }),
    listed({ id: "u1", retailer: R("Uber", "uber.com"), orderDate: "2026-06-03", totalPence: 1200, items: [{ name: "Trip fare", pricePence: 1200 }] }),
  ];
  const w = buildWrapped(year, 2026, Date.UTC(2026, 11, 31));
  // The opening: not the water, the coffee, the train, the subscription or the kitchen roll; the trainers, and within a
  // month a thing with a photo is preferred.
  // (`thing` is what it is, from item-kind-core.js, for its drawn icon.)
  assert.deepEqual(w.firstBuy, { shop: "Studio North", item: "Oversized Hoodie", kind: "fashion", thing: "clothing", date: "2026-01-20", photoId: "f2" });
  const noPhoto = buildWrapped(year.filter((c) => c.id !== "f2"), 2026);
  assert.equal(noPhoto.firstBuy.item, "Kick Lane Court Classic Trainers", "the first memorable thing (the app takes the shop's name off its front)");
  assert.equal(noPhoto.firstBuy.photoId, null);
  assert.equal(buildWrapped(year.slice(0, 5), 2026).firstBuy, null, "only everyday buys: the story opens with the count instead");
  // The TV bed is Home & garden; the television is Electronics.
  const ch = Object.fromEntries(w.chapters.map((c) => [c.category, c]));
  assert.ok(ch.home && ch.home.receipts === 1 && ch.home.spentPence === 109289, "the TV bed makes a Home & garden chapter");
  assert.equal(ch.electronics.spentPence, 109289, "only the television is Electronics");
  assert.equal(ch.electronics.topShop, null, "one order isn't a go-to");
  assert.ok(!w.chapters.some((c) => c.category === "home" && c.topShop && /Sainsbury/.test(c.topShop.name)));
  // A go-to needs two orders; otherwise the biggest spend is named for what it is.
  const two = buildWrapped([
    listed({ id: "a", retailer: R("Currys", "currys.co.uk"), orderDate: "2026-02-01", totalPence: 2000, items: [{ name: "USB-C Charger", pricePence: 2000 }] }),
    listed({ id: "b", retailer: R("Currys", "currys.co.uk"), orderDate: "2026-03-01", totalPence: 3000, items: [{ name: "Wireless Headphones", pricePence: 3000 }] }),
    listed({ id: "c", retailer: R("Richer Sounds", "richersounds.com"), orderDate: "2026-04-01", totalPence: 90000, items: [{ name: "Bookshelf Speakers", pricePence: 90000 }] }),
  ], 2026).chapters[0];
  assert.deepEqual(two.topShop, { name: "Currys", receipts: 2, spentPence: 5000 }, "the shop gone back to, not the one big buy");
  const spread = buildWrapped([
    listed({ id: "a", retailer: R("Currys", "currys.co.uk"), orderDate: "2026-02-01", totalPence: 2000, items: [{ name: "USB-C Charger", pricePence: 2000 }] }),
    listed({ id: "c", retailer: R("Richer Sounds", "richersounds.com"), orderDate: "2026-04-01", totalPence: 90000, items: [{ name: "Bookshelf Speakers", pricePence: 90000 }] }),
  ], 2026).chapters[0];
  assert.equal(spread.topShop, null); assert.deepEqual(spread.mostSpent, { name: "Richer Sounds", spentPence: 90000 });
  // Travel: only journeys the receipts name, as written; a return is two journeys; places Relay can't place are listed.
  const t = w.travel;
  assert.equal(t.journeys, 2 + 1 + 1 + 1, "London to Manchester and back, back again, and two Scottish journeys; the Uber trip names no places");
  assert.equal(t.trains, 5);
  assert.deepEqual(t.topRoute, { from: "London Euston", to: "Manchester Piccadilly", times: 3 }, "either way round is the same route");
  assert.deepEqual(t.places.map((p) => p.name).sort(), ["Edinburgh", "Glasgow", "Glasgow Queen Street", "London Euston", "Manchester Piccadilly"]);
  assert.deepEqual(t.unplotted, ["Little Snoring Halt"], "a place Relay can't position is never guessed onto the map");
  const eus = t.places.find((p) => p.name === "London Euston"); assert.ok(Math.abs(eus.lat - 51.53) < 0.02 && Math.abs(eus.lon + 0.13) < 0.02);
  assert.equal(buildWrapped(year.filter((c) => c.category !== "travel"), 2026).travel, null, "no travel, no travel chapter");
  assert.deepEqual(journeysOf({ category: "travel", retailer: R("Uber", "uber.com"), items: [{ name: "Trip fare" }, { name: "Pick up to drop off" }] }), [], "only names with capitals both sides count as places");
  // A coach, a train or a taxi to an airport is not a flight (review WR-1): the shop decides when Relay knows it, and the
  // word "airport" never does.
  assert.deepEqual(journeysOf({ category: "travel", retailer: R("National Express", "nationalexpress.com"), items: [{ name: "Leeds to Manchester Airport" }] }).map((j) => j.mode), ["coach"]);
  assert.deepEqual(journeysOf({ category: "travel", retailer: R("Trainline", "thetrainline.com"), items: [{ name: "London Euston to Birmingham Airport" }] }).map((j) => j.mode), ["train"]);
  assert.deepEqual(journeysOf({ category: "travel", retailer: R("Made-up Cars", "madeupcars.example"), items: [{ name: "Leeds to Manchester Airport" }] }).map((j) => j.mode), ["trip"], "an unknown shop to an airport: just a trip");
  assert.deepEqual(journeysOf({ category: "travel", retailer: R("Made-up Travel", "madeuptravel.example"), items: [{ name: "Flight Leeds to Malaga" }] }).map((j) => j.mode), ["flight"], "the word flight still says so");
  assert.equal(placeAt("London Road"), null, "a station named after a road isn't put in that city");
  assert.ok(placeAt("Manchester Oxford Road"), "a station that starts with its city's name is put in that city");
  // Each journey in the order it was made, with where both ends are, for the story to travel along.
  assert.deepEqual(t.trips.map((x) => x.from + " > " + x.to + " " + x.date), ["London Euston > Manchester Piccadilly 2026-01-06", "Manchester Piccadilly > London Euston 2026-05-02",
    "Edinburgh > Glasgow Queen Street 2026-06-02", "Glasgow > Little Snoring Halt 2026-06-02"]);
  assert.ok(t.trips[0].fromAt && t.trips[0].toAt && t.trips[0].return === true); assert.equal(t.trips[3].toAt, null, "an unknown place has no position");
  assert.equal(t.moreTrips, 0);
  // "Did you visit?": only places with well-known sights listed, asked about, at most two; never London.
  assert.deepEqual(t.visits.map((v) => v.place), ["Manchester", "Glasgow"]);
  assert.ok(t.visits[0].attractions.includes("Manchester Cathedral") && t.visits[0].attractions.length <= 3);
  // Connor's year (18 Nov 2026): a sharing bag of Fruit Pastilles first, then more groceries. The story never opens on sweets:
  // with nothing lasting bought, it opens on the count; with a jumper later in the year, on the jumper (drawn as clothing).
  const sweets = [
    listed({ id: "s1", retailer: R("Sainsbury's", "sainsburys.co.uk"), orderDate: "2026-04-19", totalPence: 125, items: [{ name: "Rowntree's 130g Fruit Pastilles Sweets Sharing Bag Lollies", pricePence: 125 }] }),
    listed({ id: "s2", retailer: R("Sainsbury's", "sainsburys.co.uk"), orderDate: "2026-04-26", totalPence: 410, items: [{ name: "Haribo Starmix Sweets Sharing Bag 140g", pricePence: 135 }, { name: "Sainsbury's Bag For Life", pricePence: 25 }, { name: "Percy Pig 170g", pricePence: 250 }] }),
    listed({ id: "s3", retailer: R("Tesco", "tesco.com"), orderDate: "2026-05-02", totalPence: 300, items: [{ name: "Kinder Bueno Twin Bar 43g", pricePence: 100 }, { name: "Pringles Original 165g Tube", pricePence: 200 }] }),
    listed({ id: "s4", retailer: R("Boots", "boots.com"), orderDate: "2026-05-03", totalPence: 600, items: [{ name: "Scholl Cracked Heel Repair Balm 60ml", pricePence: 600 }] }),
    listed({ id: "s5", retailer: R("M&S", "marksandspencer.com"), orderDate: "2026-05-04", totalPence: 400, items: [{ name: "Moscow Mule 250ml", pricePence: 200 }, { name: "Large Gift Bag", pricePence: 200 }] }),
  ];
  // Connor's next Wrapped (18 Nov 2026) opened on "Highland Game Venison Grillsteaks 300g" as a game: nothing from a
  // supermarket opens the story, however its line reads.
  sweets.unshift(listed({ id: "s0", retailer: R("Sainsbury's", "sainsburys.co.uk"), orderDate: "2026-01-11", totalPence: 450, items: [{ name: "Highland Game Venison Grillsteaks 300g", pricePence: 450 }] }));
  assert.equal(buildWrapped(sweets, 2026).firstBuy, null, "a sweets-and-groceries year opens on the count");
  assert.equal(buildWrapped(sweets.concat(listed({ id: "j0", retailer: R("Sainsbury's", "sainsburys.co.uk"), orderDate: "2026-06-01", totalPence: 1800, items: [{ name: "Tu Navy Cable Knit Jumper", pricePence: 1800 }] })), 2026).firstBuy, null, "not even a jumper from a supermarket");
  const withJumper = buildWrapped(sweets.concat(listed({ id: "j1", retailer: R("Fernleigh Knitwear", "fernleighknit.example"), orderDate: "2026-06-01", totalPence: 1800, items: [{ name: "Navy Cable Knit Jumper", pricePence: 1800 }] })), 2026);
  assert.deepEqual([withJumper.firstBuy.item, withJumper.firstBuy.thing, withJumper.firstBuy.date], ["Navy Cable Knit Jumper", "clothing", "2026-06-01"]);
  assert.ok(!buildWrapped(sweets, 2026).chapters.some((c) => c.category === "fashion"), "no fashion chapter from sweets in a sharing bag");
  // A name the rules aren't sure of never opens it, but the AI's sure answer (for shoppers with AI on) can.
  const odd = [{ id: "o1", kind: "order", retailer: R("Blorp", "blorp.example"), orderDate: "2026-02-01", totalPence: 5000, category: "other", items: [{ name: "Xqzzy Mk2", pricePence: 5000 }] }];
  assert.equal(buildWrapped(odd, 2026).firstBuy, null);
  const oddAi = [{ ...odd[0], items: [{ name: "Xqzzy Mk2", pricePence: 5000, kind: "electronics", kindSure: true, kindAi: true, lasting: true }] }];
  assert.equal(buildWrapped(oddAi, 2026).firstBuy.thing, "electronics");
  // Nothing personal or made up: an empty year still builds.
  const empty = buildWrapped([], 2026);
  assert.equal(empty.firstBuy, null); assert.equal(empty.travel, null);
  console.log("ok - Wrapped opens on something memorable, files the TV bed as furniture, names a go-to only when it was one, and maps real journeys");
}
console.log("PASS shop kinds, Wrapped fixes and travel");

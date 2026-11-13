// Where things live in the app, for the browser tests. The app's layout moved things around (Profile opens from your
// picture, its sections are grouped, Home is a feed of cards, Discover is Browse): the tests check the same behaviour,
// found here, so a later move only needs changing in one place.

// The tabs a shopper sees: Home, Ask (only while Relay's assistant is on), Browse and Receipts. Profile is not a tab.
export const TABS = ["Home", "Browse", "Receipts"];
export const TABS_WITH_ASK = ["Home", "Ask", "Browse", "Receipts"];

// The tab names as written on the tab bar (a phone shows only the drawings; the names are there for screen readers).
export const tabNames = (page) => page.locator(page.viewportSize().width < 760 ? "#foot button" : "#side button")
  .evaluateAll((bs) => bs.map((b) => (b.getAttribute("data-name") || b.innerText || "").trim()));
export const litTab = (page) => page.locator("#foot button[aria-current=page], #side button[aria-current=page]").first().getAttribute("data-name");
export const tab = (page, name) => page.locator(page.viewportSize().width < 760 ? "#foot" : "#side").locator('button[data-name="' + name + '"]');

// Home has drawn once it shows its feed (or what to do first).
export async function homeReady(page, opts) {
  await page.locator("#homePage .h2-feed > *, #homePage .h2-none, #homePage .rl-po, #homePage .rl-calm-none").first().waitFor(opts);
}
// The person's initials (or photo) on their picture at the top of Home: how Home shows who's signed in.
export async function homeShows(page, initial, opts) {
  await homeReady(page, opts);
  await page.locator(".h2-me .avatar", { hasText: initial }).waitFor(opts);
}
// A card on Home, by any text on it. Tapping it opens what the old wallet card showed (its page, a sheet).
export const homeCard = (page, text) => page.locator("#homePage .h2-feed > .h2-item", { hasText: text });
export async function openHomeCard(page, text) {
  await homeCard(page, text).first().click();
  await page.locator(".rl-back .rl-sheet").last().waitFor();
  return page.locator(".rl-back .rl-sheet").last();
}
// Closes the sheet on top, the way a person does: a tap on the dimmed page above it.
export async function closeSheet(page) {
  const back = page.locator(".rl-back").last();
  if (!(await back.count())) return;
  await back.click({ position: { x: 10, y: 10 } });
  await back.waitFor({ state: "detached" });
}

// Profile: opens from the picture. Its rows, and the rows one level down.
const UNDER = {
  "Security and privacy": ["Face ID & passkeys", "Phone number", "Two-step sign-in", "Devices", "Card for swaps", "Email permission", "Download my data", "Delete my account"],
  "Help and legal": ["Help", "Chat with us", "Contact us", "Terms of use", "Privacy policy"]
};
// The old names of things that were renamed.
const RENAMED = { "Email connection": "Inboxes" };
export async function openProfile(page) {
  await page.evaluate(() => window.go("me"));
  await page.locator("#mePage .rl-arow:visible", { hasText: "Security and privacy" }).first().waitFor();
}
// The picture that opens Profile, as a person would tap it: top left on Home, top right on the other tabs.
// (Home's own picture comes after the page's top line in the page, so the last one showing is Home's when on Home.)
export const profileButton = (page) => page.locator(".topline .avatar, .h2-me").filter({ visible: true }).last();
// Opens a Profile row by name, going through its section first when it lives one level down.
export async function openAccountRow(page, name) {
  name = RENAMED[name] || name;
  const hub = Object.keys(UNDER).find((h) => UNDER[h].includes(name));
  if (!(await page.locator("#mePage .rl-arow:visible").count())) await openProfile(page);
  if (hub && !(await page.locator("#mePage .rl-arow:visible", { hasText: name }).count())) {
    // The app's double-tap guard ignores a second tap on the same spot within 400ms, so a test that has just tapped the
    // section (then gone back) waits as long as a person would.
    await page.waitForTimeout(450);
    await page.locator("#mePage .rl-arow:visible", { hasText: hub }).first().click();
  }
  const row = page.locator("#mePage .rl-arow:visible", { hasText: name }).first();
  await row.waitFor();
  await row.click();
}
export const accountRow = (page, name) => page.locator("#mePage .rl-arow", { hasText: RENAMED[name] || name }).first();
export const sectionOf = (name) => Object.keys(UNDER).find((h) => UNDER[h].includes(RENAMED[name] || name)) || null;

// Browse: its first page has Wrapped, Swap & resell, Auctions and Shops on Relay. Products are under Shops on Relay.
export async function openShops(page) {
  await page.evaluate(() => { window.go("discover"); if (window.dcShow) window.dcShow("shops"); });
  await page.locator("#catalogResults").waitFor({ state: "attached" });
}
// Receipts: a list by month. A kind (Fashion, Gifts, Shop orders…), a year or "Returns and swaps" is chosen from its
// filter sheet (the button at the top of the list); the receipts of that kind then show in the list.
export async function openReceiptKind(page, name) {
  if (!(await page.locator("#view .rl-calm-filter:visible").count()) && !(await page.locator("#view .rl-cat-back:visible").count())) {
    await page.evaluate(() => window.go("receipts"));
  }
  // A group already open: back to the whole list first.
  if (await page.locator("#view .rl-cat-back:visible").count()) await page.locator("#view .rl-cat-back").first().click();
  await page.locator("#view .rl-calm-filter").first().click();
  const sheet = page.locator(".rl-sheet[aria-label='Filter receipts']").last();
  await sheet.locator(".rl-arow").filter({ has: page.getByText(name, { exact: true }) }).first().click();
  await sheet.waitFor({ state: "detached" }).catch(() => {});
}
// Taps a tab. The tab bar steps aside while the keyboard is up (someone typing), so the keyboard goes first, as it
// would on a phone.
export async function goTab(page, name) {
  await page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
  await tab(page, name).click();
}
// For tests that aren't about the first-run prompts: this phone has already said "Not now" to "What do you shop for?"
// and seen the four first-run tips, for whoever is signed in, so neither the one-time sheet on Home, the sign-up step nor
// the tips get in the way. (scripts/test-signup-ui.mjs, scripts/test-layout-ui.mjs and scripts/test-tips-ui.mjs test those.)
// (Whoever signs in, whenever: also when the test signs in after the page has opened.)
const firstRunDone = (what) => {
  const mark = () => {
    try {
      const s = JSON.parse(localStorage.getItem("relay.session.v1") || "null");
      if (!s || !s.email) return;
      if (what.interests) {
        const k = "relay.interests-later.v1", l = JSON.parse(localStorage.getItem(k) || "[]");
        if (!l.includes(s.email)) { l.push(s.email); localStorage.setItem(k, JSON.stringify(l)); }
      }
      if (what.tips) {
        const t = JSON.parse(localStorage.getItem("relay.tips.v1") || "{}");
        if (!t[s.email]) { t[s.email] = ["home", "ask", "browse", "receipts"]; localStorage.setItem("relay.tips.v1", JSON.stringify(t)); }
      }
    } catch (e) { /* storage blocked: nothing to do */ }
  };
  mark();
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { set.call(this, k, v); if (k === "relay.session.v1") mark(); };
};
export async function skipInterests(ctx) { await ctx.addInitScript(firstRunDone, { interests: true, tips: true }); }
// For tests about interests but not the tips: the tips have been seen.
export async function skipTips(ctx) { await ctx.addInitScript(firstRunDone, { tips: true }); }

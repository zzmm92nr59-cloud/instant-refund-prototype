// Browser check of Royal Mail return labels, against a mocked API (no Royal Mail, no Shopify, no real Worker):
//  * the shopper sees the QR code, tracking number and a PDF download only when the API says Royal Mail made a label;
//  * without a label, the shopper is told to use the shop's own returns process and no QR or tracking number appears;
//  * the shop's dashboard sets up Royal Mail and never shows the saved key.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve('.');
const server = createServer(async (req, res) => { try {
  const path = resolve(root, '.' + new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html'));
  if (!path.startsWith(root + '/')) throw Error();
  res.setHeader('Content-Type', extname(path) === '.js' ? 'text/javascript' : 'text/html'); res.end(await readFile(path));
} catch { res.statusCode = 404; res.end('nf'); } });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const SESSION = 'S'.repeat(43);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const H = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

// plan: what Relay says will happen for this shop before the shopper confirms (/relay/my/return/eligibility); none = not known.
async function shopperPage(returnBody, plan = null, before = /If Kick Lane has set up Royal Mail returns in Relay, you'll get a return label straight away/) {
  const context = await browser.newContext({ viewport: { width: 390, height: 820 }, acceptDownloads: true });
  const posts = [];
  await context.route('https://**/*', route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    const j = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: H, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
    if (!p.startsWith('/relay/')) return route.abort();
    if (req.method() === 'POST') posts.push({ p, body: JSON.parse(req.postData() || '{}') });
    if (p === '/relay/my/purchases') return j(200, { purchases: [{ id: 'o1', store: 'Kick Lane', retailer: 'shopify:kick-lane.myshopify.com', orderedAt: new Date().toISOString(),
      items: [{ title: 'Logo Cap', lineId: 'L1', quantity: 1, priceMinor: 2000, currency: 'GBP', variant: 'Black', exchangeable: false, returnable: true }] }] });
    if (p === '/relay/my/return') return j(200, returnBody);
    if (p === '/relay/my/return/eligibility') return j(200, plan || {});
    if (p === '/relay/my/return/label') {
      assert.equal(req.headers().authorization, 'Bearer ' + SESSION);
      return route.fulfill({ status: 200, contentType: 'application/pdf', headers: H, body: Buffer.from('%PDF-1.4 label') });
    }
    return j(200, {});
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', () => { throw new Error('a browser pop-up appeared; Relay must ask inside the page'); });
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['relay.session.v1', JSON.stringify({ token: SESSION, email: 'alice@example.com' })]);
  await page.goto(origin + '/index.html');
  const ret = page.getByRole('button', { name: 'Return', exact: true });
  await ret.waitFor(); await ret.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await ret.click();
  await page.getByRole('button', { name: 'Wrong size or fit' }).click();
  await page.getByText(before).waitFor();
  // Pictures for a look by eye (SHOTS=<folder>): the step before confirming, in light and dark.
  if (process.env.SHOTS && plan && plan.how) for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150); await page.screenshot({ path: process.env.SHOTS + '/return-confirm-' + scheme + '.png' }); }
  if (process.env.SHOTS) await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'Start return' }).click();
  return { context, page, posts, errors };
}

// 1. Royal Mail made a label.
{
  const { context, page, posts, errors } = await shopperPage({ returnId: 'r1', returnRef: 'RLY-ABCD-EFGH', status: 'requested', labelAvailable: true, carrier: 'Royal Mail',
    trackingNumber: 'TT123456789GB', serviceName: 'Tracked Returns 24', hasPdf: true, qrImage: 'data:image/png;base64,' + PNG, shopNotified: true, item: 'Logo Cap' });
  await page.getByText('Your return label is ready').waitFor();
  await page.getByText('Kick Lane has sent you a Royal Mail Tracked Returns 24 label for Logo Cap.').waitFor();
  await page.getByText('TT123456789GB').waitFor();
  assert.equal(await page.getByAltText('Royal Mail QR code for your return').getAttribute('src'), 'data:image/png;base64,' + PNG);
  await page.getByText(/show this QR code at a Post Office counter/).waitFor();
  await page.getByText("We've emailed Kick Lane to say this return is coming.").waitFor();
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/return-label.png' });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download label to print (PDF)' }).click()]);
  assert.equal(dl.suggestedFilename(), 'royal-mail-return-label.pdf');
  assert.deepEqual(posts.find(x => x.p === '/relay/my/return').body, { orderId: 'o1', lineId: 'L1', reason: 'wrong_size' });
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS shopper sees the Royal Mail QR code, tracking number and PDF download');
}

// 2. No label: no QR code, no tracking number, and the shop's own process.
{
  const { context, page, errors } = await shopperPage({ returnId: 'r2', returnRef: 'RLY-JKLM-NPQR', status: 'requested', labelAvailable: false, shopNotified: false, item: 'Logo Cap' });
  await page.getByText('Saved in Relay').waitFor();
  const text = await page.locator('.rl-sheet').last().innerText();
  assert.match(text, /Kick Lane hasn't told Relay how it wants returns sent, so use Kick Lane's own returns process/);
  assert.match(text, /This is not a postage label or tracking number\./);
  assert.doesNotMatch(text, /QR code|Post Office|TRACKING NUMBER|Download label/);
  assert.equal(await page.locator('.rl-sheet img').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS without a label the shopper is pointed to the shop and sees no QR or tracking number');
}

// 2b. The shop has told Relay how it wants returns sent and how long it takes them: said plainly before the shopper
// confirms and after, in the shop's own words. Still no QR code or tracking number.
{
  const HOW = 'Post it to Kick Lane Returns, Unit 4, Sample Park, Leeds.\nPut your order number inside the parcel.';
  const by = new Date(Date.now() + 26 * 864e5).toISOString().slice(0, 10);
  const { context, page, errors } = await shopperPage({ returnId: 'r3', returnRef: 'RLY-STUV-WXYZ', status: 'requested', labelAvailable: false, shopNotified: true, item: 'Logo Cap', how: HOW },
    { eligible: true, label: false, inStore: false, how: HOW, returnBy: by, basis: 'shop' }, /Relay will tell Kick Lane you're returning this\. Then send it back the way Kick Lane asks\./);
  await page.getByText('Saved in Relay').waitFor();
  const text = await page.locator('.rl-sheet').last().innerText();
  assert.match(text, /We've emailed Kick Lane to say this return is coming\. Send it back the way Kick Lane asks below\./);
  assert.match(text, /HOW KICK LANE WANTS IT SENT BACK\s+Post it to Kick Lane Returns, Unit 4, Sample Park, Leeds\.\s+Put your order number inside the parcel\./);
  assert.doesNotMatch(text, /QR code|Post Office|TRACKING NUMBER|Download label|hasn't told Relay/);
  if (process.env.SHOTS) for (const scheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(150); await page.screenshot({ path: process.env.SHOTS + '/return-saved-' + scheme + '.png' }); }
  assert.deepEqual(errors, []);
  await context.close();
  // Before confirming, with the shop's own period: its instructions and its date are both shown.
  const second = await shopperPage({ returnId: 'r4', returnRef: 'RLY-AAAA-BBBB', status: 'requested', labelAvailable: false, shopNotified: true, item: 'Logo Cap', how: HOW },
    { eligible: true, label: false, inStore: false, how: HOW, returnBy: by, basis: 'shop' }, /Kick Lane takes returns for this order until \d{1,2} \w{3}/);
  await second.context.close();
  // A Royal Mail label is promised only when the shop makes them.
  const third = await shopperPage({ returnId: 'r5', returnRef: 'RLY-CCCC-DDDD', status: 'requested', labelAvailable: false, shopNotified: true, item: 'Logo Cap' },
    { eligible: true, label: true, inStore: false, how: null, returnBy: null, basis: 'relay' }, /Relay will tell Kick Lane you're returning this and give you a Royal Mail label to send it back\./);
  await third.context.close();
  console.log("PASS the shop's own returns instructions and period are shown before and after starting a return");
}

// 3. The shop's dashboard: set up Royal Mail, see it on, never see the key again, turn it off.
{
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  let settings = { connected: false }, saves = [];
  let paySettings = { method: 'shopify', cardPossible: true, testMode: true, stripe: { connected: false, ready: false, detailsSubmitted: false } };
  let retSettings = { days: null, how: null, relayLimitDays: 30 }, retSaves = [];
  await context.route('https://**/*', async route => {
    const req = route.request(), p = new URL(req.url()).pathname;
    const j = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: H, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
    if (!p.startsWith('/relay/')) return route.abort();
    if (p === '/relay/retailer/demand') return j(200, { store: 'Kick Lane', platform: 'shopify', currency: 'GBP', watchedItems: [], shoppersWatchingItems: 0, followers: 0 });
    if (p === '/relay/retailer/offers') return j(200, { offers: [] });
    if (p === '/relay/retailer/results') return j(200, { supported: true, currency: 'GBP', swaps: [{ at: Date.now(), item: 'Cloud Runner Trainers', from: 'UK 8', to: 'UK 7', quantity: 1, valueMinor: 11000, priceDiffMinor: 1500, differencePaid: true, orderUrl: null },
      { at: Date.now(), item: 'Rain Jacket', from: 'M', to: 'L', quantity: 1, valueMinor: 5500, priceDiffMinor: -500, differencePaid: null, orderUrl: null },
      // Swapped, and then the customer started a return for the new item: listed, but not counted as a swap.
      { at: Date.now() - 60000, item: 'Court Trainer', from: 'UK 8', to: 'UK 9', quantity: 1, valueMinor: 7000, priceDiffMinor: 500, differencePaid: false, differenceHow: 'shopify', thenReturned: true, orderUrl: null }],
      totals: { swaps: 2, swapsThenReturned: 1, returns: 2, swapValueMinor: 16500, swapShare: 50 },
      returns: [{ at: Date.now(), item: 'Logo Cap', quantity: 1, valueMinor: 2000, reason: 'wrong_size', ref: 'RLY-ABCD-EFGH', emailed: true, trackingNumber: 'TT123456789GB', orderUrl: null },
        { at: Date.now() - 30000, item: 'Court Trainer', quantity: 1, valueMinor: 7000, reason: 'wrong_size', ref: 'RLY-JKLM-NPQR', emailed: true, trackingNumber: null, orderUrl: null }] });
    if (p === '/relay/retailer/returns' && req.method() === 'GET') return j(200, retSettings);
    if (p === '/relay/retailer/returns') {
      const b = JSON.parse(req.postData()); retSaves.push(b);
      await new Promise(r => setTimeout(r, 300)); // slow enough for a second tap to land while it's saving
      retSettings = { days: b.days, how: String(b.how || '').trim() || null, relayLimitDays: 30 };
      return j(200, retSettings);
    }
    if (p === '/relay/retailer/royal-mail' && req.method() === 'GET') return j(200, settings);
    if (p === '/relay/retailer/royal-mail') {
      const b = JSON.parse(req.postData()); saves.push(b);
      if (b.apiKey === 'wrong-key-wrong-key-wrong') return j(400, { error: 'bad_key' });
      settings = { connected: true, serviceCode: 'TSN', serviceName: 'Tracked Returns 24', services: [{ code: 'TSS', name: 'Tracked Returns 48' }, { code: 'TSN', name: 'Tracked Returns 24' }],
        address: { ...b.address, postcode: b.address.postcode.toUpperCase() } };
      return j(200, settings);
    }
    if (p === '/relay/retailer/royal-mail/remove') { settings = { connected: false }; return j(200, settings); }
    if (p === '/relay/retailer/payments' && req.method() === 'GET') return j(200, paySettings);
    if (p === '/relay/retailer/payments') { const b = JSON.parse(req.postData()); if (b.method === 'card' && !paySettings.stripe.ready) return j(409, { error: 'stripe_not_ready' }); paySettings = { ...paySettings, method: b.method }; return j(200, paySettings); }
    if (p === '/relay/retailer/payments/stripe') return j(200, { url: 'https://connect.stripe.com/setup/s/abc123' });
    return j(404, {});
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(origin + '/retailer.html#key=rk_' + 'k'.repeat(40));
  await page.getByRole('heading', { name: 'Royal Mail return labels' }).waitFor();
  await page.getByText('Relay ref RLY-ABCD-EFGH · Royal Mail TT123456789GB').waitFor();
  // Shops come from the Shopify App Store: no test wording on a Shopify shop's dashboard.
  assert.equal(await page.locator('#platformTag').innerText(), 'Shopify');
  await page.getByRole('heading', { name: 'Swaps and returns' }).waitFor();
  assert.equal(await page.getByText(/development shop|Pilot results|Test shops/).count(), 0);
  // A swap the customer then asked to return is listed with a plain note and no value of its own (its return carries the
  // value), and the totals leave it out: two swaps worth £165.00, not three.
  const swapRows = page.locator('#activity .row.act').filter({ has: page.locator('.kind.swap') });
  assert.equal(await swapRows.count(), 3);
  const sentBack = swapRows.filter({ hasText: 'Court Trainer' });
  await sentBack.getByText("The customer has since started a return for this item, so it's counted as a return, not a swap.").waitFor();
  assert.equal((await sentBack.locator('.val').innerText()).trim(), '', 'no value on a swap that ended as a return');
  assert.equal((await swapRows.filter({ hasText: 'Rain Jacket' }).locator('.val').innerText()).trim(), '£55.00');
  assert.equal(await page.locator('#rSwaps').innerText(), '2'); assert.equal(await page.locator('#rKept').innerText(), '£165.00'); assert.equal(await page.locator('#rReturns').innerText(), '2');
  const note = await page.locator('#resultsNote').innerText();
  assert.match(note, /^50% of the customers who came to Relay with an unwanted item swapped it rather than returning it\. 1 swapped item has since had a return started, so it's counted as a return, not a swap\./);
  assert.match(note, /you refund them yourself: Relay never refunds a return\.$/);
  if (process.env.SHOTS) await page.locator('#results').screenshot({ path: process.env.SHOTS + '/retailer-results.png' });
  // Your returns: the shop's own returns period and how it wants items sent back. Nothing is set at first, and the page
  // says what its customers see until it is. A double tap saves once.
  await page.getByRole('heading', { name: 'Your returns' }).waitFor();
  assert.equal(await page.locator('#retState').innerText(), 'Not set');
  await page.locator('#ret').getByText('with nothing set, your customers see no return-by date, and can ask for a return through Relay for 30 days after ordering', { exact: false }).waitFor();
  const rf = page.locator('#retForm'), retSave = page.locator('#retSave');
  await rf.locator('[name=days]').fill('400');
  assert.equal(await rf.locator('[name=days]').evaluate(el => el.validity.valid), false, 'more than a year is refused in the box itself');
  await retSave.click();
  assert.equal(retSaves.length, 0, 'nothing is sent while the days are wrong');
  await rf.locator('[name=days]').fill('28');
  await rf.locator('[name=how]').fill('Post it to Kick Lane Returns, Unit 4, Mill Yard, Manchester M1 2AB, with your order number inside.');
  await retSave.dblclick();
  await page.getByText('Saved. Your customers now see a return-by date 28 days after they order.').waitFor();
  assert.deepEqual(retSaves, [{ days: 28, how: 'Post it to Kick Lane Returns, Unit 4, Mill Yard, Manchester M1 2AB, with your order number inside.' }], 'saved once');
  assert.equal(await page.locator('#retState').innerText(), '28 days');
  if (process.env.SHOTS) await page.locator('#ret').screenshot({ path: process.env.SHOTS + '/retailer-returns.png' });
  // Leaving the days blank takes the date away again (the instructions stay), and the page says so.
  await rf.locator('[name=days]').fill('');
  await retSave.click();
  await page.getByText('Saved. No return-by date is shown to your customers.').waitFor();
  assert.equal(retSaves.at(-1).days, null); assert.match(retSaves.at(-1).how, /^Post it to Kick Lane Returns/);
  assert.equal(await page.locator('#retState').innerText(), 'Not set');
  // It's still there after a reload.
  await page.reload(); await page.getByRole('heading', { name: 'Your returns' }).waitFor();
  await page.waitForFunction(() => document.querySelector('#retForm [name=how]').value.startsWith('Post it to Kick Lane Returns'));
  // Price differences: Shopify checkout by default; instant card can't be picked until the shop's own Stripe is ready.
  await page.getByRole('heading', { name: 'Price differences on swaps' }).waitFor();
  assert.equal(await page.locator('#payState').innerText(), 'Shopify checkout');
  assert.equal(await page.locator('input[name=payMethod][value=shopify]').isChecked(), true);
  assert.equal(await page.locator('input[name=payMethod][value=card]').isDisabled(), true);
  assert.equal(await page.locator('#stripeGo').innerText(), 'Connect Stripe');
  // A stand-in for Stripe's set-up page, so the test never depends on reaching Stripe.
  await context.route('https://connect.stripe.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>Stripe</title>' }));
  const [popup] = await Promise.all([context.waitForEvent('page'), page.locator('#stripeGo').click()]);
  await popup.waitForURL(/^https:\/\/connect\.stripe\.com\/setup\/s\/abc123$/);
  await popup.close();
  await page.getByText('Stripe opened in a new tab.', { exact: false }).waitFor();
  paySettings = { ...paySettings, stripe: { connected: true, ready: true, detailsSubmitted: true } };
  await page.reload(); await page.getByRole('heading', { name: 'Price differences on swaps' }).waitFor();
  await page.locator('#stripeText').getByText('Stripe connected · your account can take payments (test mode).').waitFor();
  await page.locator('input[name=payMethod][value=card]').check();
  await page.getByText('Saved. Price differences are now taken instantly by card and paid into your Stripe account.').waitFor();
  assert.equal(await page.locator('#payState').innerText(), 'Instant card');
  if (process.env.SHOTS) await page.locator('#pay').screenshot({ path: process.env.SHOTS + '/retailer-pay.png' });
  // Swaps at a different price say what happened to the difference, never "Same price".
  await page.getByText('Customer paid £15.00 more by card (test mode) · Relay owes you £15.00', { exact: false }).waitFor();
  await page.getByText('New item is £5.00 cheaper · please refund the customer £5.00 in Shopify', { exact: false }).waitFor();
  assert.equal(await page.getByText('Same price', { exact: false }).count(), 0);
  assert.equal(await page.locator('#rmState').innerText(), 'Off');
  const f = page.locator('#rmForm');
  await f.locator('[name=apiKey]').fill('wrong-key-wrong-key-wrong');
  for (const [k, v] of [['name', 'Kick Lane Returns'], ['line1', 'Unit 4, Mill Yard'], ['city', 'Manchester'], ['postcode', 'm1 2ab']]) await f.locator(`[name=${k}]`).fill(v);
  await page.getByRole('button', { name: 'Check key and turn on' }).click();
  await page.getByText("Royal Mail didn't accept that API key.", { exact: false }).waitFor();
  await f.locator('[name=apiKey]').fill('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  await page.getByRole('button', { name: 'Check key and turn on' }).click();
  await page.getByText('On. Customers\' returns now get a Tracked Returns 24 label from your Royal Mail account.').waitFor();
  assert.equal(await page.locator('#rmState').innerText(), 'On');
  assert.equal(await f.locator('[name=apiKey]').inputValue(), '', 'the key is cleared from the page once saved');
  assert.equal(await f.locator('[name=apiKey]').getAttribute('placeholder'), 'Saved — leave blank to keep it');
  assert.equal(await f.locator('[name=serviceCode]').inputValue(), 'TSN');
  assert.equal(await f.locator('[name=postcode]').inputValue(), 'M1 2AB');
  if (process.env.SHOTS) await page.locator('#rm').screenshot({ path: process.env.SHOTS + '/retailer-royal-mail.png' });
  // Saving again without a key keeps the stored one (no apiKey sent).
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText(/^On\. Customers/).waitFor();
  assert.equal('apiKey' in saves.at(-1), false);
  await page.getByRole('button', { name: 'Turn off' }).click();
  await page.getByText('Off. Relay deleted your Click & Drop key.', { exact: false }).waitFor();
  assert.equal(await page.locator('#rmState').innerText(), 'Off');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS shop dashboard turns Royal Mail labels on and off, and never shows the saved key');
}
// 4. The shop dashboard's "Tell your customers" card: the link to Relay, a line for order emails that says only what is
// true for this shop, and a QR code for a card in the parcel.
{
  const LINK = 'https://relay.example/';
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  let platform = 'shopify', retSettings = { days: null, how: null, relayLimitDays: 30 };
  await context.route('https://**/*', async route => {
    const req = route.request(), p = new URL(req.url()).pathname;
    const j = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: H, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
    if (!p.startsWith('/relay/')) return route.abort();
    if (p === '/relay/retailer/demand') return j(200, { store: 'Kick Lane', platform, currency: 'GBP', watchedItems: [], shoppersWatchingItems: 0, followers: 0, relayUrl: LINK });
    if (p === '/relay/retailer/offers') return j(200, { offers: [] });
    if (p === '/relay/retailer/results') return j(200, { supported: platform === 'shopify', currency: 'GBP', swaps: [], returns: [], totals: { swaps: 0, swapsThenReturned: 0, returns: 0, swapValueMinor: 0, swapShare: null } });
    if (p === '/relay/retailer/returns' && req.method() === 'GET') return j(200, retSettings);
    if (p === '/relay/retailer/returns') { const b = JSON.parse(req.postData()); retSettings = { days: b.days, how: null, relayLimitDays: 30 }; return j(200, retSettings); }
    if (p === '/relay/retailer/royal-mail') return j(200, { connected: false });
    if (p === '/relay/retailer/payments') return j(200, { method: 'shopify', cardPossible: false, testMode: true, stripe: { connected: false, ready: false, detailsSubmitted: false } });
    return j(404, {});
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(origin + '/retailer.html#key=rk_' + 'k'.repeat(40));
  await page.getByRole('heading', { name: 'Tell your customers' }).waitFor();
  // A shop with nothing yet is pointed at the card, then the usual sections follow.
  await page.getByText('To get the first ones, tell your customers about Relay with the link below.', { exact: false }).waitFor();
  assert.deepEqual(await page.locator('main h2:visible').allInnerTexts().then(a => a.slice(0, 3)), ['Swaps and returns', 'Tell your customers', 'Demand']);
  assert.equal(await page.locator('#tellLink').inputValue(), LINK);
  // No returns period set: the line gives no number of days (Relay never makes one up for a shop).
  const plain = 'Need a different size, or want to send something back? Open Relay at https://relay.example/ and sign up with the email you ordered with. You can swap an item before we send it, or start a return.';
  await page.waitForFunction(() => document.querySelector('#retState').textContent === 'Not set');
  assert.equal(await page.locator('#tellLine').inputValue(), plain);
  // The shop sets 28 days: the line follows at once, and goes back when the days are cleared.
  await page.locator('#retForm [name=days]').fill('28'); await page.locator('#retSave').click();
  await page.getByText('Saved. Your customers now see a return-by date 28 days after they order.').waitFor();
  assert.equal(await page.locator('#tellLine').inputValue(), plain.replace('start a return.', 'start a return within 28 days of ordering.'));
  // Copy buttons: the text lands on the clipboard and the button says so, then goes back to its own name.
  const copyLink = page.locator('#tellLinkCopy');
  await copyLink.click();
  await page.waitForFunction(() => document.querySelector('#tellLinkCopy').textContent === 'Copied');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), LINK);
  await page.locator('#tellLineCopy').dblclick();
  await page.waitForFunction(() => document.querySelector('#tellLineCopy').textContent === 'Copied');
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^Need a different size.* within 28 days of ordering\.$/);
  await page.waitForFunction(() => document.querySelector('#tellLinkCopy').textContent === 'Copy link' && document.querySelector('#tellLineCopy').textContent === 'Copy wording', null, { timeout: 5000 });
  // Where the browser won't let the page copy (some embedded pages), the text is selected and the page says what to press.
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('blocked')); document.execCommand = () => false; });
  await copyLink.click();
  await page.getByText("Couldn't copy it for you. It's selected above: press Ctrl+C, or Cmd+C on a Mac.").waitFor();
  assert.equal(await page.evaluate(() => { const f = document.querySelector('#tellLink'); return f.value.slice(f.selectionStart, f.selectionEnd); }), LINK);
  assert.equal(await copyLink.innerText(), 'Copy link', "it doesn't say Copied when it wasn't");
  // The QR code is the link, drawn black on white with a clear border four squares wide, large enough to print sharply.
  const qr = await page.evaluate((link) => {
    const m = qrMatrix(link), c = document.querySelector('#tellQr'), g = c.getContext('2d'), across = m.length + 8, px = c.width / across;
    let wrong = 0, borderDark = 0;
    for (let r = 0; r < across; r++) for (let col = 0; col < across; col++) {
      const d = g.getImageData(Math.floor((col + 0.5) * px), Math.floor((r + 0.5) * px), 1, 1).data, dark = d[0] < 128;
      const inside = r >= 4 && r < across - 4 && col >= 4 && col < across - 4;
      if (inside) { if (dark !== m[r - 4][col - 4]) wrong++; } else if (dark) borderDark++;
    }
    const box = c.getBoundingClientRect();
    return { squares: m.length, wrong, borderDark, pixels: c.width, square: c.width === c.height, wholePx: Number.isInteger(px), shown: Math.round(box.width) };
  }, LINK);
  assert.deepEqual(qr, { squares: 25, wrong: 0, borderDark: 0, pixels: qr.pixels, square: true, wholePx: true, shown: 168 });
  assert.ok(qr.pixels >= 900, 'drawn large (' + qr.pixels + 'px) so it prints sharply');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download QR code' }).click()]);
  assert.equal(download.suggestedFilename(), 'relay-qr-code.png');
  const saved = await download.path();
  const png = (await import('node:fs')).readFileSync(saved);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'a PNG picture');
  assert.equal(png.readUInt32BE(16), qr.pixels); assert.equal(png.readUInt32BE(20), qr.pixels);
  if (process.env.SHOTS) { (await import('node:fs')).copyFileSync(saved, process.env.SHOTS + '/relay-qr-code.png'); await page.locator('#tell').screenshot({ path: process.env.SHOTS + '/retailer-tell.png' }); }
  // Buttons are big enough to press, and nothing spills off a phone-width page.
  for (const id of ['tellLinkCopy', 'tellLineCopy', 'tellQrSave']) assert.ok((await page.locator('#' + id).boundingBox()).height >= 44, id + ' is at least 44px tall');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth), 'no sideways scrolling at phone width');
  // One column on a phone: the words get the full width, and the code sits underneath them.
  const narrow = await page.evaluate(() => { const b = (id) => document.getElementById(id).getBoundingClientRect(); return { line: b('tellLine').width, lineBottom: b('tellLineCopy').bottom, qrTop: b('tellQr').top }; });
  assert.ok(narrow.line >= 280, 'the wording gets the full width on a phone (' + Math.round(narrow.line) + 'px)');
  assert.ok(narrow.qrTop > narrow.lineBottom, 'the QR code is under the wording on a phone');
  if (process.env.SHOTS) await page.locator('#tell').screenshot({ path: process.env.SHOTS + '/retailer-tell-phone.png' });
  // A Square shop (still on Square's test system) isn't given a link to hand out.
  platform = 'square';
  await page.reload();
  await page.getByRole('heading', { name: 'Most watched' }).waitFor();
  await page.waitForFunction(() => document.querySelector('#shop').textContent === 'Kick Lane');
  assert.equal(await page.locator('#tell').isVisible(), false);
  assert.deepEqual(errors, []);
  await context.close();
  console.log("PASS shop dashboard's Tell your customers card: link, honest wording, copy, and a QR code that is the link");
}
await browser.close(); server.close();
console.log('return label UI: all checks passed');

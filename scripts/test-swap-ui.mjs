// Browser check of swapping to a dearer/cheaper size and saving a card (Stripe TEST MODE), against a mocked API.
// Stripe.js is a stand-in; nothing reaches Stripe or a shop, and no browser pop-ups are allowed.
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
const STRIPE_STUB = `window.Stripe = function (pk) { window.__stripePk = pk; return {
  paymentRequest: function () { return { canMakePayment: function () { return Promise.resolve(null); }, on: function () {} }; },
  elements: function () { return { create: function () { return { mount: function (n) { n.textContent = '[card field]'; } }; } }; },
  confirmCardSetup: function (secret) { window.__confirmedSecret = secret; return Promise.resolve({ setupIntent: { id: 'seti_test000001', status: 'succeeded' } }); } }; };`;

async function run({ card }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 820 } });
  const posts = [];
  let saved = card;
  await context.route('https://js.stripe.com/v3/', r => r.fulfill({ contentType: 'text/javascript', body: STRIPE_STUB }));
  await context.route('https://**/*', route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    const j = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.hostname === 'js.stripe.com') return route.fallback();
    if (!p.startsWith('/relay/')) return route.abort();
    if (req.method() === 'POST') posts.push({ p, body: JSON.parse(req.postData() || '{}') });
    if (p === '/relay/my/purchases') return j(200, { purchases: [{ id: 'o1', store: 'Kick Lane', retailer: 'shopify:kick-lane.myshopify.com', orderedAt: '2026-10-29T10:00:00Z',
      items: [{ title: 'Logo Cap', lineId: 'L1', quantity: 1, priceMinor: 2000, currency: 'GBP', variant: 'Black', exchangeable: true, returnable: false }] }] });
    if (p === '/relay/my/exchange/options') return j(200, { product: 'Logo Cap', priceMinor: 2000, payments: true, card: saved, options: [
      { key: 'k15', title: 'Kids', priceMinor: 1500, quantity: 4, priceDiffMinor: -500, available: true, reason: null, needsCard: false },
      { key: 'k14', title: 'Large', priceMinor: 2500, quantity: 4, priceDiffMinor: 500, available: Boolean(saved), reason: saved ? null : 'Costs £5.00 more: add a card to pay the difference', needsCard: !saved },
      { key: 'k12', title: 'Navy', priceMinor: 2000, quantity: 9, priceDiffMinor: 0, available: true, reason: null, needsCard: false }] });
    if (p === '/relay/my/exchange') return j(200, { exchanged: true, message: 'Done. Your order now has Large instead. £5.00 was taken from your card (test mode, no real money).' });
    if (p === '/relay/my/card/setup') return j(200, { clientSecret: 'seti_test000001_secret_x', setupIntentId: 'seti_test000001', publishableKey: 'pk_test_1234567890abcdef' });
    if (p === '/relay/my/card/confirm') { saved = { brand: 'visa', last4: '4242', wallet: null, testMode: true }; return j(200, { card: saved }); }
    return j(200, {});
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', () => { throw new Error('a browser pop-up appeared; Relay must ask inside the page'); });
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['relay.session.v1', JSON.stringify({ token: SESSION, email: 'alice@example.com' })]);
  await page.goto(origin + '/index.html');
  await page.getByRole('button', { name: 'Exchange size or colour →' }).click();
  return { context, page, posts, errors };
}

// 1. With a saved Apple Pay card: prices are shown, the dearer swap says exactly what will be taken and when.
{
  const { context, page, posts, errors } = await run({ card: { brand: 'visa', last4: '4242', wallet: 'apple_pay' } });
  await page.getByRole('button', { name: /Large · £5\.00 more/ }).waitFor();
  await page.getByRole('button', { name: /Kids · £5\.00 less/ }).waitFor();
  await page.getByRole('button', { name: /^Navy · in stock/ }).waitFor();
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/swap-options.png' });
  await page.getByRole('button', { name: /Large · £5\.00 more/ }).click();
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/swap-confirm.png' });
  const box = await page.locator('.rl-sheet').last().innerText();
  assert.match(box, /costs £5\.00 more\. We'll take £5\.00 from your Apple Pay · Visa ending 4242 only once the shop has updated your order\. \(Test mode: no real money\.\)/);
  await page.getByRole('button', { name: 'Swap and pay £5.00' }).click();
  await page.getByText(/£5\.00 was taken from your card \(test mode, no real money\)/).waitFor();
  assert.deepEqual(posts.find(x => x.p === '/relay/my/exchange').body, { orderId: 'o1', lineId: 'L1', variantKey: 'k14', agreedDiffMinor: 500 });
  // The cheaper one says the shop refunds, and nothing is taken.
  await page.reload(); await page.getByRole('button', { name: 'Exchange size or colour →' }).click();
  await page.getByRole('button', { name: /Kids · £5\.00 less/ }).click();
  assert.match(await page.locator('.rl-sheet').last().innerText(), /costs £5\.00 less\. Kick Lane will refund the £5\.00 to how you paid\./);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS dearer and cheaper swaps show the difference and ask in the page');
}

// 2. No card yet: the dearer option offers to add one with a £0.00 check, then the swap screen comes back.
{
  const { context, page, posts, errors } = await run({ card: null });
  const large = page.getByRole('button', { name: /Large · Costs £5\.00 more: add a card/ });
  await large.waitFor(); assert.equal(await large.isEnabled(), true);
  await large.click();
  await page.getByText('Add a card to pay the £5.00 difference. Saving it charges nothing.').waitFor();
  await page.getByText(/Test mode: use 4242 4242 4242 4242/).waitFor();
  if (process.env.SHOTS) await page.screenshot({ path: process.env.SHOTS + '/swap-addcard.png' });
  await page.getByRole('button', { name: 'Save card (£0.00)' }).click();
  await page.getByText('Card saved. Nothing was charged.').waitFor();
  assert.equal(await page.evaluate(() => window.__stripePk), 'pk_test_1234567890abcdef');
  assert.equal(await page.evaluate(() => window.__confirmedSecret), 'seti_test000001_secret_x');
  assert.deepEqual(posts.find(x => x.p === '/relay/my/card/confirm').body, { setupIntentId: 'seti_test000001' });
  // Comes back to the swap screen, where Large is now available.
  await page.getByRole('button', { name: /Large · £5\.00 more/ }).waitFor({ timeout: 5000 });
  assert.equal(posts.filter(x => x.p === '/relay/my/exchange').length, 0, 'saving a card never swaps by itself');
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS adding a card from the swap screen (stand-in Stripe), then the dearer swap becomes available');
}
await browser.close(); server.close();

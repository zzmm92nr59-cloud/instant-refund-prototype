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

async function shopperPage(returnBody) {
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
  const ret = page.getByRole('button', { name: 'Return →' });
  await ret.waitFor(); await ret.evaluate(e => e.scrollIntoView({ block: 'center' }));
  await ret.click();
  await page.getByRole('button', { name: 'Wrong size or fit' }).click();
  await page.getByText(/If Kick Lane has set up Royal Mail returns in Relay, you'll get a return label straight away/).waitFor();
  await page.getByRole('button', { name: 'Start return →' }).click();
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
  assert.match(text, /Kick Lane hasn't set up Royal Mail labels in Relay, so to send the item back, use Kick Lane's own returns process/);
  assert.match(text, /This is not a postage label or tracking number\./);
  assert.doesNotMatch(text, /QR code|Post Office|TRACKING NUMBER|Download label/);
  assert.equal(await page.locator('.rl-sheet img').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS without a label the shopper is pointed to the shop and sees no QR or tracking number');
}

// 3. The shop's dashboard: set up Royal Mail, see it on, never see the key again, turn it off.
{
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  let settings = { connected: false }, saves = [];
  await context.route('https://**/*', route => {
    const req = route.request(), p = new URL(req.url()).pathname;
    const j = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: H, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
    if (!p.startsWith('/relay/')) return route.abort();
    if (p === '/relay/retailer/demand') return j(200, { store: 'Kick Lane', platform: 'shopify', currency: 'GBP', watchedItems: [], shoppersWatchingItems: 0, followers: 0 });
    if (p === '/relay/retailer/offers') return j(200, { offers: [] });
    if (p === '/relay/retailer/results') return j(200, { supported: true, currency: 'GBP', swaps: [], totals: { swaps: 0, returns: 1, swapValueMinor: 0, swapShare: 0 },
      returns: [{ at: Date.now(), item: 'Logo Cap', quantity: 1, valueMinor: 2000, reason: 'wrong_size', ref: 'RLY-ABCD-EFGH', emailed: true, trackingNumber: 'TT123456789GB', orderUrl: null }] });
    if (p === '/relay/retailer/royal-mail' && req.method() === 'GET') return j(200, settings);
    if (p === '/relay/retailer/royal-mail') {
      const b = JSON.parse(req.postData()); saves.push(b);
      if (b.apiKey === 'wrong-key-wrong-key-wrong') return j(400, { error: 'bad_key' });
      settings = { connected: true, serviceCode: 'TSN', serviceName: 'Tracked Returns 24', services: [{ code: 'TSS', name: 'Tracked Returns 48' }, { code: 'TSN', name: 'Tracked Returns 24' }],
        address: { ...b.address, postcode: b.address.postcode.toUpperCase() } };
      return j(200, settings);
    }
    if (p === '/relay/retailer/royal-mail/remove') { settings = { connected: false }; return j(200, settings); }
    return j(404, {});
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(origin + '/retailer.html#key=rk_' + 'k'.repeat(40));
  await page.getByRole('heading', { name: 'Royal Mail return labels' }).waitFor();
  await page.getByText('Relay ref RLY-ABCD-EFGH · Royal Mail TT123456789GB').waitFor();
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
await browser.close(); server.close();
console.log('return label UI: all checks passed');

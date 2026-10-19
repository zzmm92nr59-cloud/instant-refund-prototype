// Browser check of the sign-in sheet against a mocked API (no real email, no real Worker).
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
const browser = await chromium.launch({ headless: true, ...(process.env.RELAY_CHROMIUM ? { executablePath: process.env.RELAY_CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] } : {}) });
const TOKEN = 'T'.repeat(43), SESSION = 'S'.repeat(43);
const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
await context.route('https://**/*', route => {
  const req = route.request(), p = new URL(req.url()).pathname, h = req.headers();
  const j = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (p === '/relay/auth/request') return j(200, { ok: true });
  if (p === '/relay/auth/verify') return JSON.parse(req.postData()).token === TOKEN ? j(200, { sessionToken: SESSION, email: 'alice@example.com', expiresAt: 1 }) : j(400, { error: 'invalid_or_expired_link' });
  if (p === '/relay/my/purchases') return h.authorization === 'Bearer ' + SESSION
    ? j(200, { purchases: [{ id: 'o1', amountMinor: 12999, currency: 'GBP', orderedAt: '2026-10-14T12:00:00Z', items: [{ title: '<img src=x onerror=window.__xss=1>Trainers', quantity: 1 }] }] }) : j(401, { error: 'not_signed_in' });
  if (p === '/relay/my/receipts/parse') {
    if (h.authorization !== 'Bearer ' + SESSION) return j(401, { error: 'not_signed_in' });
    return JSON.parse(req.postData()).email.includes('EO-1')
      ? j(200, { receipt: { ok: true, needsShopperConfirmation: false, refundEligible: false, retailer: { name: '<img src=x onerror=window.__xss2=1>Example Outfitters' }, orderRef: 'EO-1', orderDate: '2026-10-14', currency: 'GBP', totalPence: 5900, items: [{ name: 'Wool jumper', qty: 1, pricePence: 5900 }] } })
      : j(200, { receipt: { ok: false, reason: 'not_an_order_confirmation' } });
  }
  if (p === '/relay/auth/logout') return j(200, { ok: true });
  return j(403, { error: 'blocked' });
});
const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(origin + '/index.html'); await page.locator('.avatar').waitFor();
await page.locator('.avatar').click();
await page.getByRole('heading', { name: 'Sign in to Relay' }).waitFor();
await page.getByPlaceholder('you@example.com').fill('alice@example.com');
await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
await page.getByText('Check your inbox').waitFor();
console.log('PASS requesting a sign-in link');
await page.goto(origin + '/index.html#signin=' + TOKEN);
await page.getByRole('heading', { name: 'Your account' }).waitFor();
await page.getByText('Trainers', { exact: false }).waitFor();
assert.equal(await page.evaluate(() => window.__xss), undefined, 'server text must never run as HTML');
assert.ok(!page.url().includes('signin='), 'token removed from the address bar');
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('relay.session.v1')).token), SESSION);
console.log('PASS magic link signs in, token leaves URL, purchases shown safely');
await page.getByRole('button', { name: 'Add a receipt' }).click();
await page.getByRole('heading', { name: 'Add a receipt' }).waitFor();
await page.locator('textarea').fill('50% off everything this weekend, shop now');
await page.getByRole('button', { name: 'Read this receipt' }).click();
await page.getByText("doesn't look like an order confirmation").waitFor();
await page.locator('textarea').fill('Order number: EO-1 total £59.00');
await page.getByRole('button', { name: 'Read this receipt' }).click();
await page.getByText('Wool jumper').waitFor();
await page.getByText('£59.00').first().waitFor();
await page.getByText("can't start an automatic refund").waitFor();
assert.equal(await page.evaluate(() => window.__xss2), undefined, 'receipt text must never run as HTML');
await page.getByRole('button', { name: 'Back' }).click();
await page.getByRole('heading', { name: 'Your account' }).waitFor();
console.log('PASS receipt screen: rejects non-receipts, shows parsed details safely, says it cannot trigger refunds, Back works');
await page.reload(); await page.locator('.avatar').waitFor();
assert.equal((await page.locator('.avatar').textContent()).trim(), 'A');
await page.locator('.avatar').click(); await page.getByRole('heading', { name: 'Your account' }).waitFor();
await page.getByRole('button', { name: 'Sign out' }).click();
await page.waitForFunction(() => !localStorage.getItem('relay.session.v1'));
console.log('PASS session persists across reload and sign-out clears it');
await page.goto(origin + '/index.html#signin=' + 'X'.repeat(43));
await page.getByRole('heading', { name: 'Sign-in failed' }).waitFor();
console.log('PASS bad link shows a clear error');
assert.deepEqual(errors, []);
await browser.close(); server.close();

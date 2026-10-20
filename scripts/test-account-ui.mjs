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
const PORTAL = 'javascript:window.__xss5=1';
const inDays = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const scanBodies = [];
let reminderState = 'off', remindPosts = [];
let consentAccepted = false, gmailConnected = false, receiptStatus = 'pending', consentPosts = [];
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
await context.route('https://**/*', route => {
  const req = route.request(), p = new URL(req.url()).pathname, h = req.headers();
  if (new URL(req.url()).hostname === 'accounts.google.com') return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>google-signin-mock</title>' });
  const j = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (p === '/relay/auth/request') return j(200, { ok: true });
  if (p === '/relay/auth/verify-code') { const b = JSON.parse(req.postData()); return b.code === '123456' && b.email === 'alice@example.com' ? j(200, { sessionToken: SESSION, email: 'alice@example.com', expiresAt: 1 }) : j(400, { error: 'invalid_or_expired_code' }); }
  if (p === '/relay/auth/verify') return JSON.parse(req.postData()).token === TOKEN ? j(200, { sessionToken: SESSION, email: 'alice@example.com', expiresAt: 1 }) : j(400, { error: 'invalid_or_expired_link' });
  if (p === '/relay/my/purchases') return h.authorization === 'Bearer ' + SESSION
    ? j(200, { purchases: [{ id: 'o1', amountMinor: 12999, currency: 'GBP', orderedAt: '2026-10-14T12:00:00Z', items: [{ title: '<img src=x onerror=window.__xss=1>Trainers', quantity: 1 }] }] }) : j(401, { error: 'not_signed_in' });
  if (p === '/relay/my/receipts/parse') {
    if (h.authorization !== 'Bearer ' + SESSION) return j(401, { error: 'not_signed_in' });
    return JSON.parse(req.postData()).email.includes('EO-1')
      ? j(200, { receipt: { ok: true, needsShopperConfirmation: false, refundEligible: false, retailer: { name: '<img src=x onerror=window.__xss2=1>Example Outfitters' }, orderRef: 'EO-1', orderDate: '2026-10-14', currency: 'GBP', totalPence: 5900, items: [{ name: 'Wool jumper', qty: 1, pricePence: 5900 }] } })
      : j(200, { receipt: { ok: false, reason: 'not_an_order_confirmation' } });
  }
  const authed = h.authorization === 'Bearer ' + SESSION;
  if (p.startsWith('/relay/my/') && p !== '/relay/my/purchases' && p !== '/relay/my/receipts/parse' && !authed) return j(401, { error: 'not_signed_in' });
  if (p === '/relay/my/consent' && req.method() === 'GET') return j(200, { version: 'v-test', accepted: consentAccepted, gmailAvailable: true, text: ['Relay reads receipts in read-only mode.', 'You can disconnect and delete at any time.'] });
  if (p === '/relay/my/consent' && req.method() === 'POST') { consentPosts.push(JSON.parse(req.postData())); consentAccepted = true; return j(200, { ok: true }); }
  if (p === '/relay/my/consent/withdraw') { consentAccepted = false; gmailConnected = false; return j(200, { ok: true }); }
  if (p === '/relay/my/gmail') return j(200, gmailConnected ? { connected: true, googleEmail: 'alice@gmail.com' } : { connected: false });
  if (p === '/relay/my/gmail/connect') return j(200, { url: 'https://accounts.google.com/o/oauth2/v2/auth?state=mock' });
  if (p === '/relay/my/gmail/scan') { const b = JSON.parse(req.postData() || '{}'); scanBodies.push(b); return b.cursor ? j(200, { ok: true, added: 0, more: false, cursor: null }) : j(200, { ok: true, added: 1, more: true, cursor: '2026/05/01', scannedBack: '2026/05/01' }); }
  if (p === '/relay/my/gmail/disconnect') { gmailConnected = false; return j(200, { ok: true }); }
  if (p === '/relay/my/receipts/11111111-1111-1111-1111-111111111111/image') return route.fulfill({ status: 200, contentType: 'image/png', headers: cors, body: PNG1 });
  if (p === '/relay/my/receipts/11111111-1111-1111-1111-111111111111/remind') { const b = JSON.parse(req.postData()); remindPosts.push(b); reminderState = b.on ? 'on' : 'off'; return j(200, { ok: true }); }
  if (p === '/relay/my/receipts' && req.method() === 'GET') return j(200, { receipts: gmailConnected ? [{ id: '11111111-1111-1111-1111-111111111111', status: receiptStatus, retailer: { name: '<img src=x onerror=window.__xss3=1>Example Outfitters' }, orderRef: 'EO-1', orderDate: '2026-10-14', currency: 'GBP', totalPence: 5900, items: [{ name: 'Wool jumper', qty: 1, pricePence: 5900 }], needsShopperConfirmation: false, hasImage: true, reminder: reminderState, returns: { windowDays: 28, windowFrom: 'delivery', deadline: '2026-11-20', address: 'Returns, Unit 4, Leeds LS1 4AB', instructions: ['<img src=x onerror=window.__xss4=1>Return within 28 days.'], portalUrl: PORTAL, qrMentioned: true, labelMentioned: false }, returnPlan: { kind: 'return_instructions', deadline: inDays(5), carrier: '<img src=x onerror=window.__xss6=1>Evri', returnId: 'RT-1', steps: ['Show the QR code.'], estimatedRefundPence: 5900, currency: 'GBP', gmailId: 'abc123def456', trackUrl: PORTAL } }] : [] });
  if (p.endsWith('/confirm')) { receiptStatus = 'confirmed'; return j(200, { ok: true }); }
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
assert.equal(await page.getByPlaceholder('6-digit code').isVisible(), true, 'code box appears after the email is sent');
await page.getByPlaceholder('6-digit code').fill('999999');
await page.getByRole('button', { name: 'Sign in with code' }).click();
await page.getByText('wrong or has expired').waitFor();
await page.getByPlaceholder('6-digit code').fill('123456');
await page.getByRole('button', { name: 'Sign in with code' }).click();
await page.getByRole('heading', { name: 'Before you start' }).waitFor();
assert.ok(await page.evaluate(() => JSON.stringify(localStorage)).then(v => v.includes('token')), 'session saved after code sign-in');
await page.evaluate(() => localStorage.clear());
await page.goto(origin + '/index.html');
console.log('PASS requesting a sign-in link and signing in with the 6-digit code');
await page.goto(origin + '/index.html#signin=' + TOKEN);
await page.getByRole('heading', { name: 'Before you start' }).waitFor();
assert.equal(await page.getByRole('button', { name: /no thanks|skip|later|decline/i }).count(), 0, 'permission step has no skip option');
assert.equal(await page.getByRole('heading', { name: 'Your account' }).count(), 0, 'account not reachable before agreeing');
await page.getByText('read-only mode').waitFor();
await page.getByRole('button', { name: 'I agree and continue' }).click();
await page.getByRole('heading', { name: 'Your account' }).waitFor();
assert.deepEqual(consentPosts, [{ version: 'v-test' }], 'agreement recorded against the wording version shown');
console.log('PASS permission step is mandatory after sign-in and records the wording version');
await page.getByRole('button', { name: 'Connect Gmail', exact: true }).click();
await page.waitForURL(/accounts\.google\.com/);
console.log('PASS Connect Gmail sends the shopper to Google');
gmailConnected = true;
await page.goto(origin + '/index.html#gmail=connected');
await page.getByText('Gmail connected: alice@gmail.com').waitFor();
await page.getByText('Found or updated 1 receipt').waitFor();
assert.ok(await page.evaluate(() => { const m = [...document.querySelectorAll('.rl-msg')].find(e => /Found or updated/.test(e.textContent)); const h = [...document.querySelectorAll('h2')].find(e => /Your purchases/.test(e.textContent)); return m && h && (m.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING); }), 'scan status sits above Your purchases, next to the Scan button');
assert.equal(await page.evaluate(() => localStorage.getItem('relay_scan_cursor')), null, 'saved scan position cleared once finished');
assert.deepEqual(scanBodies, [{}, { cursor: '2026/05/01' }], 'the app follows the cursor back through the mailbox');
await page.getByPlaceholder('Search your receipts').fill('wool');
assert.equal(await page.locator('.rl-order[data-find]:visible').count(), 1, 'search finds the item');
await page.getByPlaceholder('Search your receipts').fill('lululemon');
await page.getByText('No receipts match that search.').waitFor();
assert.equal(await page.locator('.rl-order[data-find]:visible').count(), 0);
await page.getByPlaceholder('Search your receipts').fill('');
assert.equal(await page.locator('.rl-order[data-find]:visible').count(), 1);
await page.getByText('Open the email with your QR code').waitFor();
await page.getByText('5 days left').waitFor();
await page.waitForFunction(() => { const i = document.querySelector('.rl-order img'); return i && i.src.startsWith('blob:') && i.naturalWidth === 1; });
await page.getByRole('button', { name: 'Remind me 3 days before' }).click();
await page.getByRole('button', { name: 'Reminder set · turn off' }).waitFor();
assert.deepEqual(remindPosts, [{ on: true }]);
await page.getByRole('button', { name: 'Reminder set · turn off' }).click();
await page.getByRole('button', { name: 'Remind me 3 days before' }).waitFor();
assert.deepEqual(remindPosts[1], { on: false });
assert.equal(await page.locator('a[href^="https://mail.google.com/mail/u/0/#all/abc123def456"]').count(), 1);
assert.equal(await page.getByText('Track your return').count(), 0, 'non-https track link is never shown');
assert.ok(await page.getByText('Estimated refund').count() === 1);
assert.equal(await page.evaluate(() => window.__xss6), undefined);
await page.getByText('Wool jumper').waitFor();
assert.equal(await page.evaluate(() => window.__xss3), undefined, 'captured receipt text must never run as HTML');
await page.getByText('Return by 20 November 2026').waitFor();
await page.getByText('Send to: Returns, Unit 4, Leeds LS1 4AB').waitFor();
await page.getByText('mentions a QR code').waitFor();
assert.equal(await page.evaluate(() => window.__xss4), undefined, 'return wording must never run as HTML');
assert.equal(await page.getByRole('link', { name: /Start a return/ }).count(), 0, 'non-https return link is never shown');
await page.getByRole('button', { name: 'Looks right' }).click();
await page.getByText('Confirmed by you').waitFor();
console.log('PASS returning from Google scans, lists captured receipts safely, shopper confirms');
await page.getByRole('button', { name: 'Disconnect Gmail' }).click().catch(() => {});
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

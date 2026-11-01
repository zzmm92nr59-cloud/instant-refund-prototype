// Browser test: your name and profile photo. Stubbed Relay server, made-up account.
// Checks the Profile page and account sheet show the name and photo, a chosen photo is cut to a 256 × 256 JPEG on the
// device (with no camera details left in it) before it is sent, the avatar shows it on every visit, and signing out clears it.
import assert from "node:assert/strict";
import { createRequire } from "node:module"; import { createServer } from "node:http"; import { readFile, mkdir } from "node:fs/promises"; import { resolve, extname } from "node:path";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const server = createServer(async (req, res) => { try { const p = resolve(".", "." + new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); res.setHeader("Content-Type", extname(p) === ".js" ? "text/javascript" : extname(p) === ".png" ? "image/png" : "text/html"); res.end(await readFile(p)); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => server.listen(0, "127.0.0.1", r)); const origin = "http://127.0.0.1:" + server.address().port;
await mkdir("/tmp/shots", { recursive: true });
const EMAIL = "jess.tester@outlook.com";
const state = { name: null, photo: null, delay: 0, refuseName: false };
const posts = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route("https://**/*", async route => {
  const u = new URL(route.request().url()), m = route.request().method();
  const j = (b, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(b) });
  if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
  if (!u.pathname.startsWith("/relay/")) return route.abort();
  if (u.pathname === "/relay/my/profile" && m === "GET") { if (state.delay) await new Promise(r => setTimeout(r, state.delay)); return j({ email: EMAIL, name: state.name, photo: state.photo, updatedAt: null }); }
  if (u.pathname === "/relay/my/profile" && m === "POST") {
    const b = JSON.parse(route.request().postData()); posts.push(b);
    if (state.refuseName) return j({ error: "bad_name" }, 400);
    if ("name" in b) state.name = b.name;
    if ("photo" in b) state.photo = b.photo;
    return j({ email: EMAIL, name: state.name, photo: state.photo, updatedAt: Date.now() });
  }
  if (u.pathname === "/relay/auth/logout") return j({ ok: true });
  if (u.pathname === "/relay/my/consent") return j({ version: "v5", accepted: true, text: [] });
  if (u.pathname === "/relay/my/gmail") return j({ connected: false });
  if (u.pathname === "/relay/my/purchases") return j({ purchases: [] });
  if (u.pathname === "/relay/my/receipts") return j({ receipts: [] });
  return j({});
});
const page = await ctx.newPage(); const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.goto(origin + "/index.html");
await page.evaluate(e => localStorage.setItem("relay.session.v1", JSON.stringify({ token: "T".repeat(43), email: e, expiresAt: Date.now() + 864e5 })), EMAIL);
await page.reload(); await page.waitForTimeout(500);
const avatar = page.locator(".avatar").first();
assert.equal((await avatar.textContent()).trim(), "J", "no name or photo yet: the first letter of the email");

// 1. Profile page: add a name and a photo.
await page.evaluate(() => window.go("profile")); await page.waitForTimeout(400);
await page.getByRole("button", { name: "Add name and photo" }).click();
await page.getByRole("heading", { name: "Your profile" }).waitFor();
await page.getByLabel("Your name").fill("Jess Tester");
await page.locator('.rl-sheet input[type="file"]').setInputFiles("icons/icon-512.png");
await page.locator(".rl-sheet .rl-face img").waitFor();
await page.screenshot({ path: "/tmp/shots/profile-edit.png" });
await page.getByRole("button", { name: "Save" }).click();
await page.waitForTimeout(400);
const sent = posts[posts.length - 1];
assert.equal(sent.name, "Jess Tester");
assert.match(sent.photo, /^data:image\/jpeg;base64,/, "the photo is sent as a JPEG made on the device");
const bytes = Buffer.from(sent.photo.split(",")[1], "base64");
assert.ok(bytes.length < 150_000, "small enough: " + bytes.length);
assert.ok(!bytes.includes(Buffer.from("Exif")), "no camera details (like location) are left in it");
const size = await page.evaluate(src => new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = src; }), sent.photo);
assert.deepEqual(size, [256, 256], "cut to a 256 × 256 square");
assert.equal(await page.locator(".rl-sheet").count(), 0, "the sheet closes once saved");
assert.equal(await page.locator("#profileHead h2").textContent(), "Jess Tester", "the Profile page shows the name");
assert.equal(await page.locator("#profileHead .rl-face img").count(), 1, "and the photo");
assert.ok(await avatar.evaluate(a => a.classList.contains("rl-has-photo") && a.style.backgroundImage.startsWith('url("data:image/jpeg')), "the avatar shows the photo");
await page.screenshot({ path: "/tmp/shots/profile-page.png" });
console.log("ok - a name and photo are added on the Profile page; the photo is a 256 × 256 JPEG made on the device, with no camera details");

// 2. Next visit: the photo shows straight away, before Relay answers.
state.delay = 1500;
await page.reload(); await page.waitForTimeout(300);
assert.ok(await avatar.evaluate(a => a.classList.contains("rl-has-photo")), "shown from this device straight away");
state.delay = 0;
console.log("ok - the avatar shows the photo straight away on the next visit");

// 3. The account sheet shows them too, and Edit goes there and back.
await avatar.click();
await page.getByText("Jess Tester").first().waitFor();
assert.equal(await page.locator(".rl-sheet .rl-face img").count(), 1);
await page.screenshot({ path: "/tmp/shots/profile-account-sheet.png" });
await page.locator(".rl-sheet").getByRole("button", { name: "Edit", exact: true }).click();
await page.getByRole("heading", { name: "Your profile" }).waitFor();
// Remove the photo: the avatar goes back to the first letter of the name.
await page.getByRole("button", { name: "Remove photo" }).click();
await page.getByRole("button", { name: "Save" }).click();
await page.getByRole("heading", { name: "Your account" }).waitFor();
assert.equal(posts[posts.length - 1].photo, null, "removing sends no photo");
assert.equal((await avatar.textContent()).trim(), "J");
assert.ok(!(await avatar.evaluate(a => a.classList.contains("rl-has-photo"))));
console.log("ok - the account sheet shows the name and photo, and the photo can be removed");

// 4. A name Relay refuses: the shopper is told why and nothing changes.
state.refuseName = true;
await page.locator(".rl-sheet").getByRole("button", { name: "Edit", exact: true }).click();
await page.getByLabel("Your name").fill("<b>Jess</b>");
await page.getByRole("button", { name: "Save" }).click();
await page.getByText("Use letters, spaces, hyphens or apostrophes").waitFor();
state.refuseName = false;
await page.getByRole("button", { name: "Back" }).click();
console.log("ok - a refused name explains what's allowed");

// 5. Signing out clears them from this device.
await page.getByRole("button", { name: "Sign out" }).click();
await page.waitForTimeout(400);
assert.equal((await avatar.textContent()).trim(), "R", "signed out: the plain Relay avatar");
assert.equal(await page.evaluate(() => localStorage.getItem("relay.profile")), null, "the name and photo are not left on the device");
console.log("ok - signing out removes the name and photo from this device");

assert.deepEqual(errors, [], "no page errors");
await browser.close(); server.close();

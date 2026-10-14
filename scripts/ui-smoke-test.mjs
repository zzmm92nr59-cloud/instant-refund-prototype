import { chromium } from "playwright";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch({ headless: true });
let failed = false;
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(pathToFileURL(resolve("index.html")).href, { waitUntil: "domcontentloaded" });
    await page.locator("[data-purchase]").first().waitFor({ timeout: 15000 });
    assert.ok(await page.locator("[data-purchase]").count() >= 1, "Wallet has no clickable demo purchases");
    await page.locator("[data-purchase]").first().click();
    await page.getByRole("heading", { name: "Your purchase" }).waitFor();
    await page.getByRole("button", { name: /Preview Relay Plus/ }).click();
    await page.getByRole("button", { name: /Explore early refund/ }).click();
    await page.getByRole("heading", { name: /Plus · early refund preview/ }).waitFor();
    await page.getByRole("button", { name: /Back to purchase/ }).click();
    await page.getByRole("button", { name: /Exchange or discover alternatives/ }).click();
    await page.getByRole("heading", { name: /Make it right/ }).waitFor();
    await page.getByRole("button", { name: /Find available replacements/ }).click();
    await page.getByRole("heading", { name: /Find the right replacement/ }).waitFor();
    await page.getByRole("button", { name: /Radar/i }).first().click();
    await page.getByRole("heading", { name: /Your deals, discovered/ }).waitFor();
    await page.getByRole("button", { name: /Wrapped/i }).first().click();
    await page.getByRole("heading", { name: /Your year in purchases/ }).waitFor();
    assert.equal(errors.length, 0, "Browser JS errors: " + errors.join("; "));
    console.log("PASS: wallet, purchase, refund, exchange, discover, radar, wrapped", viewport);
    await page.close();
  }
} catch (error) {
  failed = true;
  console.error("Relay UI smoke test FAILED:", error);
} finally {
  await browser.close();
}
if (failed) process.exitCode = 1;

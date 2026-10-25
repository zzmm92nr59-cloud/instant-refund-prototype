#!/usr/bin/env node
// test-returns.mjs — smoke-test the returns endpoints against the deployed worker
// Usage: RELAY_TOKEN=<shopper-token> node scripts/test-returns.mjs [orderId] [lineId]
//
// With no args: calls GET /relay/my/purchases to find a recent order, then tests
// eligibility and (optionally) initiates a return.
// With orderId + lineId: tests that specific line.
//
// DO NOT run this against a live production order you don't want returned.

const BASE = "https://relay-square-api2.9pts72cy5j.workers.dev";
const TOKEN = process.env.RELAY_TOKEN;

if (!TOKEN) {
  console.error("❌  Set RELAY_TOKEN env var to a valid shopper token");
  process.exit(1);
}

const h = { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" };

async function get(path) {
  const r = await fetch(BASE + path, { headers: h });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, body };
}

async function post(path, data) {
  const r = await fetch(BASE + path, { method: "POST", headers: h, body: JSON.stringify(data) });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, body };
}

function pass(msg) { console.log("  ✅ " + msg); }
function fail(msg) { console.log("  ❌ " + msg); }
function info(msg) { console.log("  ℹ️  " + msg); }

async function main() {
  console.log("\n── Relay Returns smoke test ──");
  console.log("Worker: " + BASE + "\n");

  // 1. List purchases
  console.log("1. GET /relay/my/purchases");
  const pRes = await get("/relay/my/purchases");
  if (!pRes.ok) { fail("purchases failed: " + pRes.status + " " + JSON.stringify(pRes.body)); process.exit(1); }
  const purchases = pRes.body.purchases || [];
  pass("Got " + purchases.length + " order(s)");

  // Find a returnable item (or use CLI args)
  const [, , cliOrderId, cliLineId] = process.argv;
  let testOrderId = cliOrderId || null, testLineId = cliLineId || null;

  if (!testOrderId) {
    for (const o of purchases) {
      for (const it of o.items || []) {
        if (it.returnable) {
          testOrderId = o.id;
          testLineId = it.lineId;
          info("Auto-selected returnable item: " + it.title + " (order " + o.id + ")");
          break;
        }
      }
      if (testOrderId) break;
    }
  }

  if (!testOrderId) {
    // Try to find any item at all to check eligibility (will likely return outside_return_window or already_returned)
    for (const o of purchases) {
      for (const it of o.items || []) {
        testOrderId = o.id;
        testLineId = it.lineId;
        info("No returnable item found — testing eligibility anyway on: " + it.title);
        break;
      }
      if (testOrderId) break;
    }
  }

  if (!testOrderId) {
    info("No purchases to test against. Done.");
    return;
  }

  // 2. Check eligibility
  console.log("\n2. GET /relay/my/return/eligibility");
  const eRes = await get("/relay/my/return/eligibility?orderId=" + encodeURIComponent(testOrderId) + "&lineId=" + encodeURIComponent(testLineId));
  if (eRes.status !== 200) {
    fail("eligibility endpoint returned " + eRes.status + ": " + JSON.stringify(eRes.body));
  } else {
    const e = eRes.body;
    if (e.eligible) {
      pass("Eligible: " + e.item + " · " + e.daysLeft + " day(s) left");
    } else {
      info("Not eligible: " + e.reason + " (this is expected for old orders / already-returned items)");
    }
  }

  // 3. Initiate return (only if eligible and user passed --confirm flag)
  const doReturn = process.argv.includes("--confirm");
  if (doReturn) {
    console.log("\n3. POST /relay/my/return (--confirm flag set)");
    if (!eRes.body.eligible) {
      info("Skipping POST — item not eligible: " + (eRes.body.reason || "unknown reason"));
    } else {
      const rRes = await post("/relay/my/return", { orderId: testOrderId, lineId: testLineId, reason: "changed_mind" });
      if (rRes.ok && rRes.body.returnRef) {
        pass("Return initiated! Ref: " + rRes.body.returnRef);
        pass("QR data: " + rRes.body.qrData);
        pass("Drop off by: " + rRes.body.dropOffBy);
        pass("Instructions: " + (rRes.body.instructions || []).join(" | "));
      } else {
        fail("POST /relay/my/return failed: " + rRes.status + " " + JSON.stringify(rRes.body));
      }
    }
  } else {
    console.log("\n3. POST /relay/my/return");
    info("Skipped (add --confirm flag to actually initiate a return)");
  }

  // 4. List returns
  console.log("\n4. GET /relay/my/returns");
  const lRes = await get("/relay/my/returns");
  if (!lRes.ok) {
    fail("returns list failed: " + lRes.status + " " + JSON.stringify(lRes.body));
  } else {
    const returns = lRes.body.returns || [];
    pass("Returns list: " + returns.length + " return(s)");
    returns.slice(0, 3).forEach(function (r) {
      info(r.returnRef + " · " + r.itemTitle + " · " + r.status);
    });
  }

  console.log("\n── Done ──\n");
}

main().catch(e => { console.error(e); process.exit(1); });

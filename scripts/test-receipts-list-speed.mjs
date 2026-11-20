// Offline test (real SQLite): the receipts list is quick for a shopper with thousands of receipts, and gives exactly the
// same receipts as Relay did before it was made quicker. A made-up shopper (scripts/fixtures/receipts-dataset.mjs: the
// receipt corpus's made-up orders copied across 16 years and two inboxes, with parcel news, refunds, cancellations,
// returns, and the shopper's own same-order / different-orders choices, fixes, gifts, items returning, dismissed receipts
// and reminders) is listed by this version of the worker and by an earlier one taken from git, and every receipt must be
// the same, field for field, for the Receipts page (?all=1), Home, Wrapped and the style list. The health page's "Likely
// reading problems" is compared the same way. Timings are printed (and kept under a generous limit).
// Run: node scripts/test-receipts-list-speed.mjs [git-ref-before]   (default: the commit before the list was made quicker)
// Without git history (a shallow copy), the comparison with the earlier version is skipped and only the timings run.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { world } from "./fixtures/receipts-world.mjs";

const BEFORE = process.argv[2] || process.env.RECEIPTS_BEFORE || "f05b454";
const SIZES = (process.env.RECEIPTS_SIZES || "3000,10000").split(",").map(Number);
const SLACK = process.env.CI ? 2 : 1;

// The earlier worker, from git, in a folder of its own.
let before = null, dir = null;
try {
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", BEFORE, "worker/"], { encoding: "utf8" }).split("\n").filter(Boolean);
  dir = mkdtempSync(join(tmpdir(), "relay-before-"));
  for (const f of files) {
    const out = join(dir, f); mkdirSync(join(out, ".."), { recursive: true });
    writeFileSync(out, execFileSync("git", ["show", BEFORE + ":" + f], { maxBuffer: 64 << 20 }));
  }
  before = pathToFileURL(join(dir, "worker") + "/").href;
} catch {
  console.log("note - no git history for " + BEFORE + ": the comparison with the earlier version is skipped");
}

const clean = (w, j) => { delete j.timing; return JSON.parse(JSON.stringify(j).split(w.id).join("SHOPPER")); };
const timed = async (w, path) => {
  const t0 = performance.now(), r = await w.call(path), text = await r.text(), ms = performance.now() - t0;
  assert.equal(r.status, 200, path + " answers");
  return { ms, body: JSON.parse(text), bytes: text.length };
};
const firstDifference = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return i;
  return -1;
};
function same(what, a, b) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  const A = a.receipts || a, B = b.receipts || b, i = Array.isArray(A) ? firstDifference(A, B) : -1;
  if (i >= 0) console.log("first difference, receipt " + i + ":\n before " + JSON.stringify(A[i]).slice(0, 900) + "\n after  " + JSON.stringify(B[i]).slice(0, 900));
  assert.deepEqual(b, a, what + ": the same as before");
}

const report = [];
for (const [n, seeds] of SIZES.map((n) => [n, n <= 3000 ? [7, 11] : [7]])) {
  for (const seed of seeds) {
    const now = await world(n, { seed });
    // Twice: the first answer warms up the worker's code, as a Worker that has answered before has.
    await timed(now, "/relay/my/receipts?all=1");
    const all = await timed(now, "/relay/my/receipts?all=1"), home = await timed(now, "/relay/my/receipts");
    const cards = all.body.receipts.length;
    assert.ok(cards > n / 3, "a big list (" + cards + " receipts)");
    // The made-up shopper really has what the list joins: parcels, returns, their own choices.
    const has = (k) => all.body.receipts.filter((r) => r[k] != null).length;
    for (const k of ["delivery", "returnProgress", "cancelled", "gift", "fixed", "joinedByYou", "splitByYou", "alsoEmails", "returnBy"]) assert.ok(has(k) > 0, "some receipts have " + k);
    const line = { receipts: n, seed, cards, allMs: Math.round(all.ms), homeMs: Math.round(home.ms), MB: +(all.bytes / 1e6).toFixed(2) };
    if (before) {
      const old = await world(n, { seed, worker: before });
      await timed(old, "/relay/my/receipts?all=1");
      const oldAll = await timed(old, "/relay/my/receipts?all=1"), oldHome = await timed(old, "/relay/my/receipts");
      line.beforeAllMs = Math.round(oldAll.ms); line.beforeHomeMs = Math.round(oldHome.ms);
      same("the Receipts page's list (" + n + ", seed " + seed + ")", clean(old, oldAll.body), clean(now, all.body));
      same("Home's list (" + n + ", seed " + seed + ")", clean(old, oldHome.body), clean(now, home.body));
      if (n <= 3000) {
        for (const p of ["/relay/my/wrapped", "/relay/my/wrapped?year=2025", "/relay/my/style"]) {
          const a = await timed(old, p), b = await timed(now, p);
          same(p, clean(old, a.body), clean(now, b.body));
        }
        // Likely reading problems (the health page), across everyone and the admin's own, with years of skipped emails and
        // two more shoppers beside this one.
        for (const w of [old, now]) {
          const s = w.sqlite.prepare("INSERT INTO captured_receipts (id, shopper_id, message_ref, status, details, created_at) VALUES (?,?,?,?,?,?)");
          w.sqlite.exec("BEGIN");
          for (let i = 0; i < 20000; i++) s.run("skip-" + i, w.id, "s" + i, "not_receipt", JSON.stringify({ kind: "not_receipt" }), w.now - i * 6e5);
          const kept = w.data.rows.filter((r) => r.status !== "not_receipt");
          for (const o of ["other-a", "other-b"]) kept.forEach((r, i) => s.run(o + i, o, o + "-" + i, r.status, r.details, r.created_at));
          w.sqlite.exec("COMMIT");
        }
        const OLD = await import(before + "health.js"), NEW = await import("../worker/health.js");
        const q = (w) => async (sql, ...a) => w.sqlite.prepare(sql).all(...a).map((r) => ({ ...r }));
        let t = performance.now();
        const a = [await OLD.readingProblems(q(old)), await OLD.readingProblems(q(old), old.id)];
        line.beforeProblemsMs = Math.round(performance.now() - t); t = performance.now();
        const b = await NEW.readingProblemsBoth(q(now), now.id);
        line.problemsMs = Math.round(performance.now() - t);
        assert.ok(a[0].length > 10 && a[1].length > 10, "reading problems found shops");
        same("Likely reading problems", JSON.parse(JSON.stringify(a).split(old.id).join("ME")), JSON.parse(JSON.stringify(b).split(now.id).join("ME")));
        assert.deepEqual(await NEW.readingProblems(q(now)), b[0], "everyone's list on its own is the same");
        assert.deepEqual(await NEW.readingProblems(q(now), now.id), b[1], "the admin's own list on its own is the same");
      }
    }
    report.push(line);
    // Generous limits (a quick laptop builds 3,000 in about half a second, 10,000 in under two).
    assert.ok(all.ms < (n <= 3000 ? 2500 : 8000) * SLACK, "the whole list of " + n + " receipts is built in time (" + Math.round(all.ms) + " ms)");
  }
}
if (dir) rmSync(dir, { recursive: true, force: true });
console.table(report);
console.log("PASS the receipts list is quick with thousands of receipts" + (before ? ", and every receipt is the same as before (" + BEFORE + ")" : ""));

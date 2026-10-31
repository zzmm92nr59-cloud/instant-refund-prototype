// Runs a piece of set-up work once per worker instance instead of on every request.
// Creating tables is cheap to ask for but each statement is a round trip to the database; doing dozens on every request made the app take seconds to answer.
//
// On Cloudflare a request must never wait on work another request started: if that other request is abandoned part-way (the
// shopper closes or reloads the page), its database calls never finish, and everything waiting on them would hang for good.
// That is what stopped purchases loading. So on Cloudflare only a *finished* set-up is remembered (by name, one database per
// worker); until then each request does the set-up itself. The statements are "create if missing", so doing them twice is harmless.
// Under Node (our tests, which make many throw-away databases) it is remembered per database object, as before.
const done = new WeakMap();
const finished = new Set();
const underNode = typeof process !== "undefined" && !!(process.release && process.release.name === "node");
export function ensureOnce(db, key, run, o = {}) {
  if (!db || typeof db !== "object") return run();
  if (o.workers ?? !underNode) {
    if (finished.has(key)) return Promise.resolve();
    return Promise.resolve().then(run).then(v => { finished.add(key); return v; });
  }
  let m = done.get(db);
  if (!m) { m = new Map(); done.set(db, m); }
  if (!m.has(key)) m.set(key, run().catch(e => { m.delete(key); throw e; }));
  return m.get(key);
}

// Runs a list of set-up statements ("create if missing") in one trip to the database where it can (Cloudflare's batch),
// instead of one trip each. That made the first request after each deploy take several seconds.
export async function runAll(db, statements) {
  if (db && typeof db.batch === "function") {
    try { await db.batch(statements.map(sql => db.prepare(sql))); return; }
    catch { /* if the database won't take them as one batch, do them one at a time below */ }
  }
  for (const sql of statements) await db.prepare(sql).run();
}

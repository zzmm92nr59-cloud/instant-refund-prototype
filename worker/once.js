// Runs a piece of set-up work once per worker instance instead of on every request.
// Creating tables is cheap to ask for but each statement is a round trip to the database; doing dozens on every request made the app take seconds to answer.
// On Cloudflare the database object is not guaranteed to be the same object on every request, so there the work is remembered by name only
// (one database per worker). Under Node (our tests, which make many throw-away databases) it is remembered per database object.
const done = new WeakMap();
const byName = new Map();
const underNode = typeof process !== "undefined" && !!(process.release && process.release.name === "node");
export function ensureOnce(db, key, run) {
  if (!db || typeof db !== "object") return run();
  if (!underNode) {
    if (!byName.has(key)) byName.set(key, run().catch(e => { byName.delete(key); throw e; }));
    return byName.get(key);
  }
  let m = done.get(db);
  if (!m) { m = new Map(); done.set(db, m); }
  if (!m.has(key)) m.set(key, run().catch(e => { m.delete(key); throw e; }));
  return m.get(key);
}

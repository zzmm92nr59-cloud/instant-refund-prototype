// Runs a piece of set-up work once per database connection per worker instance instead of on every request.
// Creating tables is cheap to ask for but each statement is a round trip to the database; doing dozens on every request made the app take seconds to answer.
const done = new WeakMap();
export function ensureOnce(db, key, run) {
  if (!db || typeof db !== "object") return run();
  let m = done.get(db);
  if (!m) { m = new Map(); done.set(db, m); }
  if (!m.has(key)) m.set(key, run().catch(e => { m.delete(key); throw e; }));
  return m.get(key);
}

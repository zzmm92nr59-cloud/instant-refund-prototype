// After a release: which shops' websites the live server has read (its public preview list), from GitHub's servers.
await new Promise(r => setTimeout(r, 9 * 60e3));
const r = await fetch("https://relay-square-api2.9pts72cy5j.workers.dev/relay/web-shops");
const j = await r.json();
for (const s of j.shops) console.log(s.name.padEnd(32), s.status.padEnd(14), s.products);
const by = {}; for (const p of j.products) by[p.storeName] = (by[p.storeName] || 0) + 1;
console.log("products shown by shop:", JSON.stringify(by));

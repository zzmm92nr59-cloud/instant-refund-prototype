// Writes the receipt-email corpus: one JSON file per email (headers, HTML part, text part and the answer key).
//   node scripts/fixtures/receipt-emails/make-corpus.mjs
// Everything in it is made up (see lib.mjs). scripts/test-receipt-corpus.mjs reads the JSON files.
import { writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import food from "./food.mjs";
import grocery from "./grocery.mjs";
import retail from "./retail.mjs";
import digital from "./digital.mjs";
import holdout from "./holdout.mjs";
import holdout2 from "./holdout2.mjs";
import holdout3 from "./holdout3.mjs";
import holdout4 from "./holdout4.mjs";
import holdout5 from "./holdout5.mjs";
import holdout6 from "./holdout6.mjs";
import holdout7 from "./holdout7.mjs";
import holdout8 from "./holdout8.mjs";
import holdout9 from "./holdout9.mjs";
import holdout10 from "./holdout10.mjs";
import holdout11 from "./holdout11.mjs";
import holdout12 from "./holdout12.mjs";
import holdout13b from "./holdout13b.mjs";
import holdout13a from "./holdout13a.mjs";
import holdout14b from "./holdout14b.mjs";

const dir = dirname(fileURLToPath(import.meta.url));
const all = [...food(), ...grocery(), ...retail(), ...digital(), ...holdout(), ...holdout2(), ...holdout3(), ...holdout4(), ...holdout5(), ...holdout6(), ...holdout7(), ...holdout8(), ...holdout9(), ...holdout10(), ...holdout11(), ...holdout12(), ...holdout13a(), ...holdout13b(), ...holdout14b()];
const ids = new Set();
for (const f of all) { if (ids.has(f.id)) throw new Error("two fixtures called " + f.id); ids.add(f.id); }
for (const name of readdirSync(dir)) if (name.endsWith(".json")) unlinkSync(join(dir, name));
for (const f of all) writeFileSync(join(dir, f.id + ".json"), JSON.stringify(f, null, 1) + "\n");
console.log(`wrote ${all.length} fixtures from ${new Set(all.map((f) => f.sender)).size} senders`);

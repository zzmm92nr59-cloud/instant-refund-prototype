// Which receipt lines can be listed in Market: physical goods only.
import assert from "node:assert/strict";
import { resellable } from "../worker/resale.js";
const r = (store, ...names) => ({ retailer: { name: store }, items: names.map(name => ({ name })) });
const ok = (rec, i = 0, learned) => resellable(rec, rec.items[i], learned);
assert.equal(ok(r("lululemon", "Define Jacket Nulu")), true);
assert.equal(ok(r("Kick Lane", "Logo Sports Cap")), true);
assert.equal(ok(r("Sainsbury's", "You've saved")), false, "savings line, food shop");
assert.equal(ok(r("Just Eat", "Credit: Just Eat")), false, "food delivery credit");
assert.equal(ok(r("Tesco", "Bananas")), false, "groceries");
assert.equal(ok(r("Uber", "Trip to Kings Cross")), false, "travel");
assert.equal(ok(r("Netflix", "Standard plan")), false, "digital");
assert.equal(ok(r("Zara", "Delivery")), false, "not a product");
assert.equal(ok(r("Zara", "Total")), false, "not a product");
assert.equal(ok(r("Zara", "Linen shirt")), true);
assert.equal(ok(r("Some Shop", "Wool coat"), 0, "food"), false, "shopper said this shop is food");
assert.equal(ok(r("Tesco", "Kettle"), 0, "home"), true, "shopper's own category wins");
console.log("test-resellable: all checks passed");

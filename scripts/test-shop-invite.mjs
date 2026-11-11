// The QR code in the shop dashboard's "Tell your customers" card (retailer.html). A shop prints it on a card that goes in
// every parcel, so a wrong code is a dead end for every customer: the answers below are pinned.
//
// How the pinned answers were checked (10 November 2026, outside this test, which has no QR reader): codes for 242 texts
// of 1 to 213 bytes were read back correctly by OpenCV's QR reader, and compared square by square with the codes
// ReportLab's separate QR maker draws for the same text (the same data and error-correction squares every time; only
// the choice among the eight allowed masks sometimes differs). Any change to qrMatrix must be checked the same way
// before these answers are changed.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const page = readFileSync("retailer.html", "utf8");
const src = /\/\/ >>> qr\n([\s\S]*?)\/\/ <<< qr\n/.exec(page);
assert.ok(src, "the QR code maker is between its markers in retailer.html");
const qrMatrix = new Function(src[1] + "\nreturn qrMatrix;")();
const rows = (text) => qrMatrix(text).map(r => r.map(x => (x ? "1" : "0")).join(""));
const sha = (text) => createHash("sha256").update(rows(text).join("\n")).digest("hex").slice(0, 16);

// 1. The size grows with the text, and text that's too long for a code this size gets no code at all (never a wrong one).
const sizeOf = (bytes) => qrMatrix("x".repeat(bytes)).length;
for (const [most, version] of [[14, 1], [26, 2], [42, 3], [62, 4], [84, 5], [106, 6], [122, 7], [152, 8], [180, 9], [213, 10]]) {
  assert.equal(sizeOf(most), 17 + 4 * version, most + " bytes fit version " + version);
  if (version < 10) assert.equal(sizeOf(most + 1), 17 + 4 * (version + 1), "one more byte needs the next size up");
}
assert.equal(qrMatrix("x".repeat(214)), null);
assert.equal(qrMatrix("£".repeat(107)), null, "length is counted in bytes: a pound sign is two");
assert.equal(qrMatrix("£".repeat(106)).length, 57);

// 2. Every code has the three corner squares, the timing lines and the always-dark square where a reader looks for them.
const FINDER = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];
for (const text of ["A", "https://relay.example/", "https://zzmm92nr59-cloud.github.io/instant-refund-prototype/", "q".repeat(130), "r".repeat(213)]) {
  const g = rows(text), n = g.length;
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) FINDER.forEach((line, i) => assert.equal(g[r0 + i].substr(c0, 7), line, "corner square at " + r0 + "," + c0));
  for (let i = 0; i < 8; i++) { assert.equal(g[7][i], "0"); assert.equal(g[i][7], "0"); assert.equal(g[7][n - 1 - i], "0"); assert.equal(g[i][n - 8], "0"); assert.equal(g[n - 8][i], "0"); assert.equal(g[n - 1 - i][7], "0"); }
  for (let i = 8; i < n - 8; i++) { assert.equal(g[6][i], i % 2 ? "0" : "1"); assert.equal(g[i][6], i % 2 ? "0" : "1"); }
  assert.equal(g[n - 8][8], "1");
  assert.ok(g.every(line => line.length === n), "square");
}

// 3. Pinned answers (see the top of this file for how they were checked).
const PINNED = JSON.parse(readFileSync("scripts/fixtures/qr-pinned.json", "utf8"));
assert.ok(PINNED.length >= 12);
for (const { text, size, sha: want } of PINNED) {
  assert.equal(qrMatrix(text).length, size, "size for " + JSON.stringify(text.slice(0, 30)));
  assert.equal(sha(text), want, "the code for " + JSON.stringify(text.slice(0, 40)) + (text.length > 40 ? "…" : "") + " has changed");
}
// The whole of one small code, so a change shows up as squares, not only as a different fingerprint.
assert.deepEqual(rows("https://relay.example/"), readFileSync("scripts/fixtures/qr-relay-example.txt", "utf8").trim().split("\n"));

// 4. The dashboard card says only what Relay does: a swap before the order is sent, and a number of days only when the
// shop has set its own returns period.
assert.match(page, /You can swap an item before we send it, or start a return\$\{tellDays \? ` within \$\{tellDays\} days of ordering` : ""\}\./);
assert.match(page, /sign up with the email you ordered with/);

console.log("shop invite: all checks passed");

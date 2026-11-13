// Made-up pictures for browser tests and for pictures of the app: item photos and shop logos, drawn from plain shapes in
// the test browser. Nothing here comes from a real shop.
//
//   import { samplePictures } from "./sample-pictures.mjs";
//   const pics = await samplePictures(browser, { marks: true });   // { "photo-tall": <PNG bytes>, "logo-grey": <PNG bytes>, ... }
//
// Item photos, in the three shapes shops send: "photo-square" and "photo-square-2" (1:1), "photo-tall" and "photo-tall-2"
// (4:5), "photo-wide" (3:2). Each is a studio backdrop, a soft shadow and one plain object in the middle.
// With marks: true every photo also carries a ring near each corner and a small dot of MARK_COLOUR at its exact centre,
// so a test can tell from the screen whether a photo was cropped evenly and sits in the middle of its tile. Leave marks
// off for pictures people will look at.
//
// Shop logos: "logo-white-a" and "logo-white-b" (square, on white), "logo-grey" (square, on its own pale grey: LOGO_GREY),
// "logo-clear" (square, see-through) and "logo-wide" (a wide wordmark on white).
export const MARK_COLOUR = [255, 0, 255];
export const LOGO_GREY = [242, 242, 244];
export const SAMPLE_SHAPES = { "photo-square": [800, 800], "photo-square-2": [800, 800], "photo-tall": [800, 1000], "photo-tall-2": [800, 1000], "photo-wide": [900, 600],
  "logo-white-a": [400, 400], "logo-white-b": [400, 400], "logo-grey": [400, 400], "logo-clear": [400, 400], "logo-wide": [720, 240] };

const photo = (top, bottom, main, second, thing) => `
  const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, "${top}"); grd.addColorStop(1, "${bottom}"); g.fillStyle = grd; g.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, s = Math.min(w, h);
  g.fillStyle = "rgba(0,0,0,.14)"; g.beginPath(); g.ellipse(cx, cy + s * .3, s * .3, s * .045, 0, 0, 7); g.fill();
  g.fillStyle = "${main}"; g.strokeStyle = "${second}"; g.lineWidth = s * .03; g.lineJoin = "round";
  const box = (x, y, ww, hh, r) => { g.beginPath(); g.roundRect(x, y, ww, hh, r); g.fill(); };
  if ("${thing}" === "mug") { box(cx - s * .2, cy - s * .2, s * .34, s * .46, s * .05); g.beginPath(); g.arc(cx + s * .16, cy + s * .02, s * .1, -1.2, 1.2); g.stroke(); g.fillStyle = "${second}"; box(cx - s * .2, cy - s * .2, s * .34, s * .06, s * .03); }
  if ("${thing}" === "shirt") { g.beginPath(); g.moveTo(cx - s * .12, cy - s * .26); g.lineTo(cx + s * .12, cy - s * .26); g.lineTo(cx + s * .3, cy - s * .14); g.lineTo(cx + s * .22, cy - s * .02); g.lineTo(cx + s * .16, cy - s * .06); g.lineTo(cx + s * .16, cy + s * .28); g.lineTo(cx - s * .16, cy + s * .28); g.lineTo(cx - s * .16, cy - s * .06); g.lineTo(cx - s * .22, cy - s * .02); g.lineTo(cx - s * .3, cy - s * .14); g.closePath(); g.fill(); g.fillStyle = "${second}"; g.beginPath(); g.arc(cx, cy - s * .26, s * .07, 0, Math.PI); g.fill(); }
  if ("${thing}" === "shoe") { g.beginPath(); g.moveTo(cx - s * .3, cy + s * .16); g.lineTo(cx - s * .3, cy - s * .08); g.quadraticCurveTo(cx - s * .1, cy - s * .12, cx - s * .02, cy); g.quadraticCurveTo(cx + s * .2, cy + s * .02, cx + s * .32, cy + s * .12); g.lineTo(cx + s * .32, cy + s * .16); g.closePath(); g.fill(); g.fillStyle = "${second}"; box(cx - s * .32, cy + s * .16, s * .66, s * .06, s * .03); }
  if ("${thing}" === "lamp") { g.beginPath(); g.moveTo(cx - s * .08, cy - s * .28); g.lineTo(cx + s * .08, cy - s * .28); g.lineTo(cx + s * .2, cy - s * .02); g.lineTo(cx - s * .2, cy - s * .02); g.closePath(); g.fill(); g.fillStyle = "${second}"; box(cx - s * .015, cy - s * .02, s * .03, s * .28, s * .01); box(cx - s * .12, cy + s * .25, s * .24, s * .04, s * .02); }
  if ("${thing}" === "bag") { box(cx - s * .22, cy - s * .08, s * .44, s * .34, s * .05); g.beginPath(); g.arc(cx, cy - s * .08, s * .12, Math.PI, 0); g.stroke(); }
  if (marks) {
    g.strokeStyle = "rgba(0,0,0,.3)"; g.lineWidth = Math.max(3, s * .008);
    for (const [x, y] of [[.06, .06], [.94, .06], [.06, .94], [.94, .94]]) { g.beginPath(); g.arc(w * x, h * y, s * .022, 0, 7); g.stroke(); }
    g.fillStyle = "rgb(${MARK_COLOUR.join(",")})"; g.beginPath(); g.arc(cx, cy, s * .03, 0, 7); g.fill();
  }`;
const MARKS = {
  ring: `g.strokeStyle = C; g.lineWidth = s * .09; g.beginPath(); g.arc(cx, cy, s * .26, 0.6, 5.6); g.stroke(); g.fillStyle = C; g.beginPath(); g.arc(cx + s * .2, cy + s * .2, s * .06, 0, 7); g.fill();`,
  bars: `g.fillStyle = C; for (let i = 0; i < 3; i++) { g.beginPath(); g.roundRect(cx - s * .28 + i * s * .2, cy - s * .26 + i * s * .08, s * .14, s * .52 - i * s * .16, s * .04); g.fill(); }`,
  disc: `g.fillStyle = C; g.beginPath(); g.arc(cx, cy, s * .32, 0, 7); g.fill(); g.fillStyle = B; g.beginPath(); g.moveTo(cx - s * .14, cy + s * .14); g.lineTo(cx, cy - s * .18); g.lineTo(cx + s * .14, cy + s * .14); g.closePath(); g.fill();`,
  leaf: `g.fillStyle = C; g.beginPath(); g.moveTo(cx, cy - s * .32); g.quadraticCurveTo(cx + s * .34, cy - s * .1, cx, cy + s * .32); g.quadraticCurveTo(cx - s * .34, cy - s * .1, cx, cy - s * .32); g.fill();` };
const logo = (back, colour, mark) => `const cx = w / 2, cy = h / 2, s = Math.min(w, h), C = "${colour}", B = "${back || "#ffffff"}"; ${back ? `g.fillStyle = "${back}"; g.fillRect(0, 0, w, h);` : ""} ${MARKS[mark]}`;
const wordmark = (colour, word) => `g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h); g.fillStyle = "${colour}"; g.font = "800 " + Math.round(h * .46) + "px Arial, Helvetica, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("${word}", w / 2, h / 2 + h * .02, w * .92);`;
const DRAW = {
  "photo-square": photo("#f1ede6", "#e3ddd2", "#c8553d", "#8f3a29", "mug"),
  "photo-square-2": photo("#eef2ea", "#dbe4d3", "#4f7a48", "#2d4a29", "lamp"),
  "photo-tall": photo("#e8edf2", "#d6dee8", "#3f6f8f", "#274a61", "shirt"),
  "photo-tall-2": photo("#f4efe6", "#e6dccb", "#8a6a3b", "#5a4322", "bag"),
  "photo-wide": photo("#efe9f3", "#ddd3e6", "#5b4a8a", "#2f2550", "shoe"),
  "logo-white-a": logo("#ffffff", "#1d3557", "disc"),
  "logo-white-b": logo("#ffffff", "#d1495b", "bars"),
  "logo-grey": logo(`rgb(${LOGO_GREY.join(",")})`, "#3a3a40", "leaf"),
  "logo-clear": logo("", "#2a9d8f", "ring"),
  "logo-wide": wordmark("#22223b", "NORTHFOLD") };

// Draws every sample picture in a page of the given browser and hands back PNG bytes by name.
export async function samplePictures(browser, opts) {
  const marks = Boolean(opts && opts.marks), page = await browser.newPage(), out = {};
  try {
    for (const [name, [w, h]] of Object.entries(SAMPLE_SHAPES)) {
      const b64 = await page.evaluate(([w, h, body, marks]) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); new Function("g", "w", "h", "marks", body)(g, w, h, marks); return c.toDataURL("image/png").split(",")[1]; }, [w, h, DRAW[name], marks]);
      out[name] = Buffer.from(b64, "base64");
    }
  } finally { await page.close(); }
  return out;
}

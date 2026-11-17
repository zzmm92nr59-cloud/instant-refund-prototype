// Reading a shopper's photo of a paper receipt (bank.js, "Add a photo of the receipt"): Claude (Anthropic's AI) reads the
// shop's name, the date, the items with their prices and the total, and says how sure it is.
//
// Rules (do not weaken):
//  * Off until ANTHROPIC_API_KEY is set (or AI_READER=off, as for AI help). Without it, Relay keeps the photo and makes the
//    receipt from what the bank says (shop, amount, date) with no items: nothing is guessed.
//  * Only the photo goes to Anthropic, with no words about the shopper or the payment. Claude isn't told what the bank paid,
//    so it can't bend what it reads to fit.
//  * What comes back is checked like anything a person types (ai-reader.js cleanAiReading): only sensible values. Anything
//    it couldn't read clearly stays empty.
//  * It never decides anything: a total that differs from the bank's is shown as it is, beside what the bank paid.
import { aiAvailable, cleanAiReading } from "./ai-reader.js";

export const RECEIPT_PHOTO_SYSTEM = [
  "You read one photo of a paper shop receipt for Relay, a UK app that keeps people's receipts, and reply with one JSON object and nothing else.",
  "Keys: isPurchase (true only if the photo shows a shop's receipt for something bought), shop (the shop's name as printed, as a person would say it; never a payment company such as Visa, Mastercard, SumUp or Square),",
  "orderRef (the receipt or transaction number exactly as printed, or null), orderDate (YYYY-MM-DD, the date printed on the receipt), currency (three letters, such as GBP),",
  "totalPence (the total paid as printed, in pence, as a whole number), items (each line bought: name as printed, qty as a whole number, pricePence for that line in pence),",
  "confidence (\"high\" when every part was clear, \"medium\" when some of it was hard to read, \"low\" when most of it was).",
  "Use null for anything you can't read clearly, and an empty list when no items can be read. Never guess, work out or invent anything: copy only what is printed.",
  "Leave out card numbers, names, loyalty or membership numbers, addresses, phone numbers and anything else about the person."
].join(" ");
// As ai-runner.js aiModel (not imported from there, which would load the inbox reader too).
const model = (env) => env.AI_READER_MODEL || "claude-haiku-5-5";

// Asks Claude to read one photo ({ type, data } from photos.js decodePhoto). Returns { reading, confidence } or { error }:
// "ai_off", "ai_unreachable", "ai_busy", "ai_refused" or "unreadable".
export async function readReceiptPhoto(env, photo, latestDay, fetchImpl) {
  if (!aiAvailable(env)) return { error: "ai_off" };
  let r;
  try {
    r = await fetchImpl("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: model(env), max_tokens: 1500, system: RECEIPT_PHOTO_SYSTEM, messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: photo.type, data: photo.data } },
        { type: "text", text: "Read this receipt." }] }] }),
      signal: AbortSignal.timeout(40000) });
  } catch { return { error: "ai_unreachable" }; }
  if (r.status === 429 || r.status >= 500) return { error: "ai_busy" };
  if (!r.ok) return { error: "ai_refused" };
  const body = await r.json().catch(() => null);
  const out = body && Array.isArray(body.content) ? body.content.filter((c) => c && c.type === "text").map((c) => c.text).join("") : "";
  const reading = cleanAiReading(out, latestDay);
  if (!reading) return { error: "unreadable" };
  let confidence = null;
  try { const a = out.indexOf("{"), b = out.lastIndexOf("}"); const j = JSON.parse(out.slice(a, b + 1)); if (["high", "medium", "low"].includes(j.confidence)) confidence = j.confidence; } catch {}
  return { reading, confidence: confidence || "low" };
}

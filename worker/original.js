// "View original receipt": fetches ONE email live from the shopper's Gmail, cleans it and returns
// display-ready HTML. Nothing is stored. The app shows the result in a sandboxed frame with no scripts,
// so cleaning here is defence in depth, not the only barrier.
const MAX_HTML = 400_000;
const MAX_INLINE_IMAGE = 600_000; // bytes per embedded picture
const MAX_INLINE_TOTAL = 2_500_000;
const MAX_INLINE_COUNT = 12;

function unb64url(text) {
  const b = atob(String(text).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}
function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
const utf8 = bytes => new TextDecoder("utf-8", { fatal: false }).decode(bytes);
const header = (part, name) => ((part.headers || []).find(h => String(h.name).toLowerCase() === name) || {}).value || "";

function walk(part, out, depth = 0) {
  if (!part || depth > 8) return;
  const type = String(part.mimeType || "").toLowerCase();
  if (type.startsWith("multipart/") || (part.parts && part.parts.length)) {
    for (const p of part.parts || []) walk(p, out, depth + 1);
    return;
  }
  if (type === "text/html" && part.body && part.body.data) out.html.push(utf8(unb64url(part.body.data)));
  else if (type === "text/plain" && part.body && part.body.data) out.text.push(utf8(unb64url(part.body.data)));
  else if (type.startsWith("image/") && /^image\/(png|jpe?g|gif|webp)$/.test(type) && part.body && (part.body.attachmentId || part.body.data)) {
    const cid = header(part, "content-id").replace(/^<|>$/g, "");
    out.images.push({ type, cid, name: part.filename || "", attachmentId: part.body.attachmentId || null, data: part.body.data || null, size: part.body.size || 0 });
  }
}

const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function safeHttps(u) {
  try { const x = new URL(String(u).trim()); return x.protocol === "https:" ? x.toString() : null; } catch { return null; }
}

// Allow-list cleaning: drop active/embedding elements, event handlers and non-https links/images.
export function cleanHtml(html, cidMap = new Map()) {
  let h = String(html).slice(0, MAX_HTML);
  h = h.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|iframe|object|embed|form|link|meta|base|applet|frame|frameset|noscript|template|svg|math|audio|video|source|input|button|select|textarea)\b[\s\S]*?(<\/\1\s*>|$)/gi, "")
    .replace(/<\/?(script|iframe|object|embed|form|link|meta|base|applet|frame|frameset|noscript|template|svg|math|audio|video|source|input|button|select|textarea)\b[^>]*>/gi, "");
  // Remove @import and non-https url() from style blocks and attributes.
  h = h.replace(/@import[^;>]*;?/gi, "");
  const cleanCss = css => css.replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (m, q, u) => (/^https:\/\//i.test(u) ? `url("${esc(u)}")` : "none"))
    .replace(/expression\s*\(|behavior\s*:|-moz-binding/gi, "");
  h = h.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (m, css) => `<style>${cleanCss(css)}</style>`);
  // Rewrite tags one at a time.
  h = h.replace(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (full, tag, attrs) => {
    const t = tag.toLowerCase();
    if (t === "style") return "<style>";
    const kept = [];
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let m;
    while ((m = re.exec(attrs))) {
      const name = m[1].toLowerCase();
      const val = m[2] ?? m[3] ?? m[4] ?? "";
      if (name.startsWith("on") || name === "srcset" || name === "formaction" || name === "ping" || name === "xlink:href") continue;
      if (name === "href") {
        if (t !== "a") continue;
        const ok = safeHttps(val.replace(/&amp;/g, "&"));
        if (ok) kept.push(`href="${esc(ok)}" target="_blank" rel="noopener noreferrer nofollow"`);
        continue;
      }
      if (name === "src") {
        if (t !== "img") continue;
        const clean = val.replace(/&amp;/g, "&").trim();
        if (/^cid:/i.test(clean)) {
          const d = cidMap.get(clean.slice(4).replace(/^<|>$/g, ""));
          if (d) kept.push(`src="${d}"`);
          continue;
        }
        const ok = safeHttps(clean);
        if (ok) kept.push(`src="${esc(ok)}"`);
        continue;
      }
      if (name === "style") { kept.push(`style="${esc(cleanCss(val.replace(/&quot;/g, '"')).replace(/"/g, "'"))}"`); continue; }
      if (name === "background") continue;
      if (/^(alt|title|width|height|align|valign|bgcolor|color|colspan|rowspan|cellpadding|cellspacing|border|class|id|dir|lang|role|face|size|nowrap)$/.test(name)) {
        kept.push(`${name}="${esc(val)}"`);
      }
    }
    return `<${t}${kept.length ? " " + kept.join(" ") : ""}>`;
  });
  return h;
}

export function plainToHtml(text) {
  return "<pre style=\"white-space:pre-wrap;font-family:inherit\">" + esc(String(text).slice(0, 100_000)) + "</pre>";
}

// Links worth surfacing as buttons: returns/refund/track pages on https.
export function usefulLinks(html) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html).slice(0, MAX_HTML))) && out.length < 6) {
    const url = safeHttps((m[1] || m[2] || "").replace(/&amp;/g, "&"));
    const label = m[3].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!url || !label || seen.has(url)) continue;
    if (/return|refund|exchange|track|view (your )?order|order status|manage/i.test(label + " " + url)) {
      if (/unsubscribe|privacy|terms|preferences/i.test(label)) continue;
      seen.add(url);
      out.push({ label, url });
    }
  }
  return out;
}

export async function buildOriginal(fetchImpl, token, messageId) {
  const auth = { Authorization: "Bearer " + token };
  const res = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`, { headers: auth });
  if (res.status === 404) return { status: 404, body: { error: "email_not_found" } };
  if (!res.ok) return { status: 502, body: { error: "gmail_unavailable" } };
  const msg = await res.json().catch(() => ({}));
  const out = { html: [], text: [], images: [] };
  walk(msg.payload, out);
  // Pictures embedded in the email (QR codes are usually these): fetched live and inlined as data.
  const cidMap = new Map();
  const gallery = [];
  let total = 0, count = 0;
  for (const img of out.images) {
    if (count >= MAX_INLINE_COUNT) break;
    let b64 = null;
    try {
      if (img.data) b64 = bytesToB64(unb64url(img.data));
      else if (img.attachmentId && img.size <= MAX_INLINE_IMAGE) {
        const a = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(img.attachmentId)}`, { headers: auth });
        if (a.ok) { const j = await a.json().catch(() => ({})); if (typeof j.data === "string") b64 = bytesToB64(unb64url(j.data)); }
      }
    } catch { b64 = null; }
    if (!b64) continue;
    const bytes = Math.floor(b64.length * 0.75);
    if (bytes > MAX_INLINE_IMAGE || total + bytes > MAX_INLINE_TOTAL) continue;
    total += bytes; count++;
    const uri = `data:${img.type};base64,${b64}`;
    if (img.cid) cidMap.set(img.cid, uri);
    gallery.push({ uri, cid: img.cid });
  }
  const rawHtml = out.html.join("\n");
  const html = rawHtml ? cleanHtml(rawHtml, cidMap) : plainToHtml(out.text.join("\n"));
  const used = new Set();
  for (const [cid, uri] of cidMap) if (html.includes(uri)) used.add(cid);
  // Attachments that the email body does not show (some stores attach the QR code) are listed separately.
  const extra = gallery.filter(g => !g.cid || !used.has(g.cid)).map(g => g.uri);
  return { status: 200, body: { html, extraImages: extra, links: usefulLinks(rawHtml) } };
}

// Wraps cleaned HTML for the sandboxed frame: no scripts, nothing but https/data pictures.
export const FRAME_CSP = "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https:";

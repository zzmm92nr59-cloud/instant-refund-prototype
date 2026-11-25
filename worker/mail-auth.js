// Did an email really come from the domain in its From line? (Security review M4, 25 Nov 2026.)
//
// A carrier's "your return was delivered to the shop" email, or a shop's "we've received your return", is what a future
// instant refund would rely on (return-tracking.js onItsWay / returnReceived). The person most interested in a fake one is
// the shopper, and it is their own inbox Relay reads. So when the receiving mail service (Gmail, Outlook) wrote down how the
// email checked out (its Authentication-Results header), Relay looks at it:
//   "pass": DMARC passed for the From domain, or DKIM or SPF passed for a domain aligned with it (the same domain, or one
//           under the same organisation's domain);
//   "fail": the header is there, and none of those passed for the From domain;
//   null:   no such header (Relay can't tell).
// Only the topmost Authentication-Results counts: the receiving service adds its own above anything the email arrived with.
//
// Known limit, said plainly: the shopper owns the mailbox. An email they put in it themselves (Gmail's messages.insert, IMAP
// APPEND) skips the receiving service and keeps whatever headers they wrote, a "pass" included. So "pass" only means the
// email doesn't contradict itself; it is never enough to pay on. docs/RETURN_TRACKING.md says what a payout needs.

const MULTI_PART_SUFFIX = /^(co|org|ac|gov|ltd|plc|me|net|sch|nhs|police)\.uk$/;
// The organisation's domain, roughly: the last two labels, or three under the UK's second-level names (royalmail.co.uk).
export function orgDomain(domain) {
  const d = String(domain || "").toLowerCase().replace(/\.$/, "");
  const parts = d.split(".").filter(Boolean);
  if (parts.length < 2) return d;
  const two = parts.slice(-2).join(".");
  return MULTI_PART_SUFFIX.test(two) && parts.length >= 3 ? parts.slice(-3).join(".") : two;
}
const aligned = (a, b) => Boolean(a && b) && orgDomain(a) === orgDomain(b);

function headerBlock(raw) {
  const s = String(raw || "");
  const m = s.match(/\r?\n\r?\n/);
  return (m ? s.slice(0, m.index) : s.slice(0, 64 * 1024)).replace(/\r?\n[ \t]+/g, " ");
}
function fromDomainOf(block) {
  const line = (block.split(/\r?\n/).find((l) => /^from\s*:/i.test(l)) || "").replace(/^from\s*:/i, "");
  const addr = ((line.match(/<([^<>\s]+@[^<>\s]+)>/) || [])[1] || (line.match(/([^\s<>"]+@[^\s<>"]+)/) || [])[1] || "").toLowerCase();
  return (addr.split("@")[1] || "").replace(/[^a-z0-9.-]+$/, "") || null;
}

// "pass" | "fail" | null for one raw email (headers and body as read from the mailbox).
export function senderCheckOf(raw) {
  const block = headerBlock(raw);
  const from = fromDomainOf(block);
  const line = block.split(/\r?\n/).find((l) => /^authentication-results\s*:/i.test(l));
  if (!line || !from) return null;
  const value = line.replace(/^authentication-results\s*:/i, "").slice(0, 4000);
  // Each result: "method=result ... key=value ..." up to the next ";".
  const results = value.split(";").map((part) => {
    const m = /\b(dmarc|dkim|spf)\s*=\s*([a-z]+)/i.exec(part);
    if (!m) return null;
    const prop = (name) => { const p = new RegExp("\\b" + name.replace(".", "\\.") + "\\s*=\\s*([^\\s;()]+)", "i").exec(part); return p ? p[1].toLowerCase() : null; };
    const domainIn = (v) => (v ? v.replace(/^.*@/, "").replace(/^@/, "") : null);
    const method = m[1].toLowerCase(), result = m[2].toLowerCase();
    const domain = method === "dmarc" ? domainIn(prop("header.from")) : method === "dkim" ? domainIn(prop("header.d") || prop("header.i")) : domainIn(prop("smtp.mailfrom") || prop("smtp.helo"));
    return { method, result, domain };
  }).filter(Boolean);
  if (!results.length) return null;
  const ok = results.some((r) => r.result === "pass" && (r.method === "dmarc" ? (!r.domain || aligned(r.domain, from)) : aligned(r.domain, from)));
  return ok ? "pass" : "fail";
}

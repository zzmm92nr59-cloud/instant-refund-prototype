// A photo someone uploads (a shop's auction photo, a seller's listing photo, a shopper's photo of what they bought), made
// smaller on their phone first: checked to really be a JPEG, PNG or WebP by its bytes, whatever its label says, and at most
// 450 KB. Returns { type, data } (base64), { error } when too big, or null when it isn't a picture.
export const MAX_PHOTO_BYTES = 450 * 1024;
export function decodePhoto(raw) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(raw || ""));
  if (!m) return null;
  let bin;
  try { bin = atob(m[2]); } catch { return null; }
  if (bin.length < 100 || bin.length > MAX_PHOTO_BYTES) return { error: "photo_too_big" };
  const b = (i) => bin.charCodeAt(i);
  // What the bytes really are, whatever the label says.
  const type = b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff ? "image/jpeg" : b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 ? "image/png"
    : bin.slice(0, 4) === "RIFF" && bin.slice(8, 12) === "WEBP" ? "image/webp" : null;
  return type ? { type, data: m[2] } : null;
}

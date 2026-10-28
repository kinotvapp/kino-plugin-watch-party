// Room codes, endpoint words, member ids and the two QR formats (invite and TV link), all pure.

/** A room code as typed: spaces, hyphens and dots dropped, 4 to 12 digits, else null. */
export function normCode(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[ .-]/g, "");
  return /^[0-9]{4,12}$/.test(s) ? s : null;
}

/** An endpoint's words as typed (lower case, trimmed), else null. Never an address: a URL is not words. */
export function normWords(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])$/.test(s) ? s : null;
}

/** The code shown to people: «1234», or in groups of four for a longer one («1234 5678 9012»). */
export function groupCode(code) {
  return String(code || "").replace(/(\d{4})(?=\d)/g, "$1 ");
}

/**
 * The code never reaches the chat: a message holding it (any 0-2 separators between its digits, full-width digits too) gets
 * it masked. Only where it stands alone (no digit right before or after it), so a 4-digit code does not eat a year or a
 * longer number that merely contains it.
 */
export function maskCode(text, code) {
  if (typeof code !== "string" || !/^[0-9]{4,12}$/.test(code)) return text;
  const fw = (d) => String.fromCharCode(0xff10 + Number(d));
  const anyDigit = "0-9" + fw(0) + "-" + fw(9);
  const digit = (d) => "[" + d + fw(d) + "]";
  const sep = "[^" + anyDigit + "]{0,2}";
  const body = code.split("").map(digit).join(sep);
  return text.replace(new RegExp("(?<![" + anyDigit + "])" + body + "(?![" + anyDigit + "])", "g"), "••••");
}

/** A random id of [n] base-36 characters (pairing tokens; never a secret that guards the room). */
export function randomToken(n) {
  let s = "";
  while (s.length < n) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}
/** A member id as Kino gives it (`m` and 7 of [a-z0-9]), or the endpoint holder's `host`. */
export const MID = /^(?:host|m[0-9a-z]{7})$/;
export const PAIR = /^[0-9a-z]{16}$/;

/** The invite QR: the words and the code, nothing else (no URL, no deep link). */
export function partyQrText(words, code) {
  return `KINOPARTY1|${words}|${code}`;
}
export function parsePartyQr(text) {
  if (typeof text !== "string" || text.length > 200) return null;
  const m = /^KINOPARTY1\|([a-z0-9-]{3,80})\|([0-9]{4,12})$/.exec(text.trim());
  if (!m) return null;
  const words = normWords(m[1]);
  return words ? { words, code: m[2] } : null;
}

/** A TV's link QR: its link endpoint's words and fresh code, and when it expires. */
export function linkQrText(words, code, expiresAtMs) {
  return `KINOLINK1|${words}|${code}|${expiresAtMs}`;
}
/** `{ words, code, exp }`, `{ error: "expired" }`, or null for anything else. */
export function parseLinkQr(text, now) {
  if (typeof text !== "string" || text.length > 200) return null;
  const m = /^KINOLINK1\|([a-z0-9-]{3,80})\|([0-9]{12})\|([0-9]{10,16})$/.exec(text.trim());
  if (!m) return null;
  const words = normWords(m[1]);
  const exp = Number(m[3]);
  if (!words || !Number.isSafeInteger(exp)) return null;
  // A minute of slack for the clocks of two devices; the TV closes the endpoint itself anyway.
  if (exp + 60000 < now) return { error: "expired" };
  return { words, code: m[2], exp };
}

/** Full-width digits as ASCII (a paste from some keyboards). */
export const asciiDigits = (s) => Array.from(s).map((ch) => {
  const c = ch.codePointAt(0);
  return c >= 0xff10 && c <= 0xff19 ? String(c - 0xff10) : ch;
}).join("");

export const digitsOnly = (s) => s.replace(/[^0-9]/g, "");

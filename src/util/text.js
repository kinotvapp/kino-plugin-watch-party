// Small pure helpers every part uses: type checks, UTF-8 sizes, scrubbing a text or a name, an error's code.

import { LIMITS } from "../limits.js";

export const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
export const utf8 = (s) => new TextEncoder().encode(String(s)).length;
export const jsonBytes = (v) => utf8(JSON.stringify(v));
export const keysAre = (o, required, optional = []) => {
  const ks = Object.keys(o);
  return required.every((k) => ks.includes(k)) && ks.every((k) => required.includes(k) || optional.includes(k));
};

// The regular expressions are built from code points (no escapes in the source): control, format, direction and invisible
// filler characters are removed; zero-width joiners stay because they build ordinary emoji.
const BS = String.fromCharCode(92);
const cp = (n) => BS + "u{" + n.toString(16) + "}";
const STRIP_RANGES = [
  [0x0, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180e, 0x180e],
  [0x200b, 0x200b], [0x200e, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x206f], [0x2800, 0x2800], [0x3164, 0x3164],
  [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff9, 0xfffb], [0x2028, 0x2029], [0xe0000, 0xe007f],
];
const STRIP = new RegExp("[" + STRIP_RANGES.map(([a, b]) => cp(a) + "-" + cp(b)).join("") + "]", "gu");
const MARKS = new RegExp("(" + BS + "p{M}{2})" + BS + "p{M}+", "gu"); // at most two combining marks per character
const BLANK = new RegExp("^[" + BS + "s" + BS + "p{M}" + cp(0x200c) + cp(0x200d) + "]*$", "u");
// Marks the room tab draws itself (devices, the host): a name may not carry them.
const NAME_MARKS = new RegExp("[" + ["📱", "📺", "·", "•", "✓"].join("") + "]", "gu");

/** Plain one-line text: breaks as spaces, control/format/direction/filler characters removed, spaces collapsed, at most [max] characters; a blank-looking text is "". */
export function scrub(raw, max) {
  if (typeof raw !== "string") return "";
  const s = raw.replace(/[\r\n\t]+/g, " ").replace(STRIP, "").replace(MARKS, "$1").replace(/\s+/g, " ").trim();
  if (BLANK.test(s)) return "";
  const points = Array.from(s);
  return points.length <= max ? s : points.slice(0, max).join("").trim();
}

/** A member's name: scrubbed, without the marks the tab draws, at most LIMITS.nameChars. */
export function scrubName(raw) {
  return scrub(scrub(raw, 64).replace(NAME_MARKS, " "), LIMITS.nameChars);
}

export const codeOf = (e) => (e && typeof e.code === "string" ? e.code : "error");

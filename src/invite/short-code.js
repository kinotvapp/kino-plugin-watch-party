// The short-code service (url-code.kinotv.workers.dev): the room's address, the 5-digit code, create, look up, revoke.

import { LIMITS } from "../limits.js";
import { asciiDigits } from "../util/codes.js";
import { isObj } from "../util/text.js";

/** The service: POST `{ url }` -> `{ code, url, expires_in_seconds }`; GET `/<code>` -> the same, 404 for an unknown code. */
export const SHORT_SERVICE = "https://url-code.kinotv.workers.dev/";

/** The room's own address as the short code stands for it (and as the QR carries it). */
export function roomUrlOf(words, code) {
  return `https://${words}.trycloudflare.com/?c=${code}`;
}

/**
 * The words and the code out of a room address, STRICTLY: `https://<words>.trycloudflare.com/?c=<4..12 digits>` (or without
 * the `/`), words of 2 to 6 lowercase letter-only parts joined by hyphens, at most 63 characters; no user, port, other path,
 * other query or fragment. Anything else is null. The address is only read, never fetched.
 */
export function parseRoomUrl(url) {
  if (typeof url !== "string" || url.length > 200) return null;
  const m = /^https:\/\/([a-z]+(?:-[a-z]+){1,5})\.trycloudflare\.com\/?\?c=([0-9]{4,12})$/.exec(url);
  if (!m || m[1].length > 63) return null;
  return { words: m[1], code: m[2] };
}

/** A typed short code: spaces, hyphens and dots dropped, full-width digits read as digits, exactly 5 digits; else null. */
export function normShort(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = asciiDigits(String(raw)).replace(/[\s.\-]/g, "");
  return /^[0-9]{5}$/.test(s) ? s : null;
}

/** The short code to read aloud: «41 408». */
export function groupShort(code) {
  return /^[0-9]{5}$/.test(String(code)) ? `${String(code).slice(0, 2)} ${String(code).slice(2)}` : String(code || "");
}

/** The service's answer read defensively: `{ code, url, ttlMs }` or null (a code as a string or a number of 5 digits). */
export function readShortAnswer(body) {
  if (!isObj(body)) return null;
  const code = normShort(typeof body.code === "number" ? String(body.code) : body.code);
  const url = typeof body.url === "string" ? body.url : null;
  const ttl = Number.isFinite(body.expires_in_seconds) && body.expires_in_seconds > 0 ? Math.min(body.expires_in_seconds * 1000, LIMITS.shortTtlMs) : LIMITS.shortTtlMs;
  return { code, url, ttlMs: ttl };
}

const shortFetchOptions = { timeoutMs: LIMITS.shortTimeoutMs, redirect: "manual", cookies: false, maxBytes: 4096 };

async function callService(fetch, url, options) {
  let last = null;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, { ...shortFetchOptions, ...options });
      if (res && res.status >= 500 && i === 0) { last = { status: res.status }; continue; }
      return res;
    } catch (e) {
      last = e;
    }
  }
  return last && last.status ? last : null;
}

/** The host's short code for its room: `{ ok: true, short, until }` or `{ ok: false, error: "network" | "invalid" }`. */
export async function createShortCode(fetch, words, code, now) {
  const want = roomUrlOf(words, code);
  const res = await callService(fetch, SHORT_SERVICE, { method: "POST", headers: { "content-type": "application/json" }, body: { json: { url: want } } });
  if (!res || typeof res.status !== "number") return { ok: false, error: "network" };
  if (res.status !== 200) return { ok: false, error: res.status >= 500 ? "network" : "invalid" }; // only 200 counts
  let body;
  try { body = res.json(); } catch (e) { return { ok: false, error: "invalid" }; }
  const a = readShortAnswer(body);
  // The service must give back the very address it stored, with a 5-digit code.
  if (!a || !a.code || (a.url !== null && a.url !== want)) return { ok: false, error: "invalid" };
  return { ok: true, short: a.code, until: now + a.ttlMs };
}

/**
 * Revokes a short code (`DELETE /<code>`), best effort: 3 s, no retry, whatever the answer (its shape is not relied on), and
 * it never throws. Kino's own room closings (its TTL, 30 wrong joins, the app ending, the plugin switched off) cannot run it:
 * the service's 8-hour expiry covers those.
 */
export async function revokeShortCode(fetch, short) {
  const code = normShort(short);
  if (!code || typeof fetch !== "function") return false;
  try {
    await fetch(SHORT_SERVICE + code, { method: "DELETE", timeoutMs: 3000, redirect: "manual", cookies: false, maxBytes: 1024 });
    return true;
  } catch (e) {
    return false;
  }
}

/** A guest's lookup: `{ ok: true, words, code }` or `{ ok: false, error: "notFound" | "invalid" | "network" }`. */
export async function lookupShortCode(fetch, short) {
  const code = normShort(short);
  if (!code) return { ok: false, error: "invalid" };
  const res = await callService(fetch, SHORT_SERVICE + code, { method: "GET" });
  if (!res || typeof res.status !== "number") return { ok: false, error: "network" };
  if (res.status === 404) return { ok: false, error: "notFound" };
  if (res.status !== 200) return { ok: false, error: res.status >= 500 ? "network" : "invalid" }; // only 200 counts
  let body;
  try { body = res.json(); } catch (e) { return { ok: false, error: "invalid" }; }
  const a = readShortAnswer(body);
  const room = a && parseRoomUrl(a.url);
  return room ? { ok: true, ...room } : { ok: false, error: "invalid" };
}

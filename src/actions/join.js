// Joining and creating: the room calls, the short code, scanning, linking a TV, opening a backup door.

import { both, tx } from "../i18n/texts.js";
import { createShortCode, revokeShortCode } from "../invite/short-code.js";
import { LIMITS } from "../limits.js";
import { addMyMid, enqueue, helloOf, newParty } from "../party/state.js";
import { pump } from "../transport/outbox.js";
import { toast } from "../ui/kit.js";
import { normWords, parseLinkQr, randomToken } from "../util/codes.js";
import { codeOf, isObj, scrubName } from "../util/text.js";

export async function joinRoom(k, p, words, code, name, role, now, extra = {}) {
  const joined = await k.room.join({ words, code, name: name || undefined });
  const fresh = p.phase !== "party" || p.code !== code;
  if (fresh) {
    const me = { ...newParty(name).me, name: scrubName(name), role, pair: extra.pair || null, pairOut: p.me.pairOut || null };
    Object.assign(p, newParty(name), { me });
  }
  p.phase = "party";
  p.role = "guest";
  p.code = code;
  p.handle = joined.handle;
  p.joinedWords = normWords(words) || words;
  p.awaiting = null;
  p.me.mid = joined.memberId;
  addMyMid(p, joined.memberId);
  p.hostName = scrubName(joined.host && joined.host.name);
  if (fresh) p.hostWords = words;
  p.expiresAtMs = joined.expiresAtMs;
  p.cursors = { ...(p.cursors || {}), joined: 0 };
  p.snapAt = now;
  p.lastOkAt = now;
  p.redirect = null;
  p.banner = null;
  p.outbox = p.outbox.filter((o) => o.session === "hosted");
  enqueue(p, "joined", helloOf(p));
  // A phone that linked a TV gives its pairing token to every host it joins, so its TV is shown with it there too.
  if (p.me.role === "seat" && p.me.pairOut) enqueue(p, "joined", { t: "pair", token: p.me.pairOut });
  return joined;
}

/** Opens this device's backup door (same code, its own words): only from a press, and only for a seat. */
export async function openBackup(k, p, now) {
  if (p.me.role !== "seat" || p.role !== "guest" || p.myWords) return false;
  const opened = await k.room.open({ code: p.code, ttlMin: LIMITS.roomTtlMin, max: LIMITS.maxMembers, name: p.me.name || undefined });
  p.myWords = opened.words;
  p.backupAt = now;
  p.backupSentAt = 0;
  p.cursors.hosted = 0;
  return true;
}

export const lost = (e) => ["room_unreachable", "room_closed", "room_denied"].includes(codeOf(e));

/**
 * A checked room: with a saved name, join it now (this same press); without one, the name step (j2) first, the room kept in
 * Kino's panel state so «Atrás» returns to the code with what was typed.
 */
export async function toNameOrJoin(k, p, target, ctx, now, extra = {}) {
  if (!p.me.name) return { state: { ...extra, wizStep: "j2", joinTarget: target, error: null }, focus: "myName" };
  const answer = await joinAndGreet(k, p, target.words, target.code, p.me.name, ctx, now);
  if (target.short) p.short = target.short;
  return { ...answer, state: { ...(answer.state || {}), wizStep: "home", joinTarget: null, shortTyped: null } };
}

/** The host asks the service for its room's short code (5 s, one retry). Never logs the address or the codes. */
export async function askShort(k, p, now) {
  if (typeof k.fetch !== "function") { p.shortError = true; return false; }
  await dropShort(k, p); // a code this device made before (another door, an earlier try) is revoked first
  const got = await createShortCode((url, o) => k.fetch(url, o), p.hostWords, p.code, now);
  if (!got.ok) { p.short = null; p.shortError = true; return false; }
  p.short = got.short;
  p.shortMine = true;
  p.shortUntil = got.until;
  p.shortError = false;
  return true;
}

/** Revokes the short code this device created (if any) and forgets it; never blocks a close for more than 3 s, never fails it. */
export async function dropShort(k, p) {
  const short = p.shortMine ? p.short : null;
  p.short = null;
  p.shortMine = false;
  p.shortUntil = 0;
  if (short) await revokeShortCode((url, o) => k.fetch(url, o), short);
}

export async function joinAndGreet(k, p, words, code, name, ctx, now) {
  await joinRoom(k, p, words, code, name, "seat", now);
  await pump(k.room, p, ctx, now);
  // The first two guests also open a backup door, in this same press (opening one needs the person's press).
  try {
    const members = await k.room.members({ session: p.handle });
    const guests = Array.isArray(members) ? members.filter((m) => m && !m.host).length : 99;
    if (guests <= LIMITS.backups) await openBackup(k, p, now);
  } catch (e) {
    // no backup door from this device: it stays a guest
  }
  return { ...toast(both("Entraste a la sala", "You joined the room"), "success"), state: { tab: "chat", invite: null, inviteError: false } };
}

/** `kino.qr.scan`, or an answer that explains why it could not run (a TV, no camera, no permission). */
export async function scanOrExplain(k, title) {
  let text;
  try {
    text = await k.qr.scan({ title: title.es, titleEn: title.en });
  } catch (e) {
    if (codeOf(e) === "unavailable") return toast(both("Este aparato no puede escanear: escribe las palabras y el código", "This device cannot scan: type the words and the code"), "warning");
    if (codeOf(e) === "permission_denied") return toast(both("Permite la cámara a Kino en los ajustes del teléfono", "Allow Kino the camera in the phone's settings"), "warning");
    if (codeOf(e) === "busy") return toast(both("Ya hay un escáner abierto", "A scanner is already open"), "warning");
    throw e;
  }
  if (text === null || text === undefined) return toast(both("Cancelado", "Cancelled"));
  return String(text);
}

/**
 * «Agregar dispositivo»: the phone scans the TV's link QR, joins the TV's link endpoint, tells it the room (its words AND code:
 * only scan your own TV's code), and pairs it.
 */
export async function addDevice(k, p, ctx, now) {
  if (p.phase !== "party" || p.me.role !== "seat") return null;
  const text = await scanOrExplain(k, tx("addDeviceTitle"));
  if (isObj(text)) return text;
  const q = parseLinkQr(text, now);
  if (!q) return toast(both("Ese código QR no es el de un televisor con Party Chat", "That QR code is not a TV's Party Chat code"), "error");
  if (q.error === "expired") return toast(both("El código del televisor venció: pide uno nuevo", "The TV's code expired: show a new one"), "warning");
  if (q.code === p.code) return toast(both("Ese código no es el de un televisor", "That is not a TV's code"), "error");
  let linked;
  try {
    linked = await k.room.join({ words: q.words, code: q.code, name: p.me.name || undefined });
  } catch (e) {
    // A guest holding a backup door has no free slot for the link: give the door up (and tell the host) and try once more.
    if (codeOf(e) !== "room_busy" || !p.myWords || p.role === "host") throw e;
    try { await k.room.close({ session: "hosted" }); } catch (x) { /* gone */ }
    p.myWords = null;
    enqueue(p, "joined", { t: "nobackup" });
    linked = await k.room.join({ words: q.words, code: q.code, name: p.me.name || undefined });
  }
  const pair = randomToken(16);
  try {
    await k.room.send({ t: "link", words: p.hostWords, code: p.code, name: p.me.name, pair }, { session: linked.handle });
  } finally {
    try { await k.room.close({ session: linked.handle }); } catch (e) { /* gone */ }
  }
  p.me.pairOut = pair;
  if (p.role === "host") {
    for (const [t, v] of Object.entries(p.pairs)) if (v.mid === "host") delete p.pairs[t];
    p.pairs[pair] = { mid: "host", at: now };
  } else enqueue(p, "joined", { t: "pair", token: pair });
  await pump(k.room, p, ctx, now);
  return toast(both("Televisor vinculado: entra a la sala desde el televisor", "TV linked: join the room from the TV"), "success");
}

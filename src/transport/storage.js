// The party kept in kino.storage: loading, compacting within the store's size, saving.

import { trimHistory } from "../chat/history.js";
import { LIMITS } from "../limits.js";
import { newParty } from "../party/state.js";
import { codeOf, isObj, utf8 } from "../util/text.js";

const STORE = "party";
export const NAME = "name";

/** The party kept in kino.storage (expires with the room: the chat is never kept beyond it). */
export function loadParty(storage) {
  try {
    const raw = storage.get(STORE);
    const p = raw ? JSON.parse(raw) : null;
    if (isObj(p) && p.v === 2 && isObj(p.me)) return p;
  } catch (e) {
    // a damaged entry starts over
  }
  let name = "";
  try { name = storage.get(NAME) || ""; } catch (e) { name = ""; }
  return newParty(name);
}

/** [p] trimmed for storage: the per-member logs pruned, the lists bounded. Never above LIMITS.saveBytes as JSON. */
export function compactParty(p, now) {
  p.sent = p.sent.filter((s) => now - s.at < 60000).slice(-LIMITS.sendsPerMinute);
  for (const k of Object.keys(p.replies)) { p.replies[k] = p.replies[k].filter((t) => now - t < 60000); if (!p.replies[k].length) delete p.replies[k]; }
  for (const k of Object.keys(p.chatTimes)) { p.chatTimes[k] = p.chatTimes[k].filter((t) => now - t < LIMITS.chatWindowMs); if (!p.chatTimes[k].length) delete p.chatTimes[k]; }
  for (const k of Object.keys(p.lobby).slice(0, -LIMITS.maxMembers * 2)) delete p.lobby[k];
  p.gone = p.gone.slice(-16);
  p.seeks = p.seeks.filter((t) => now - t < 60000);
  p.notes = p.notes.slice(-LIMITS.notes);
  let text = JSON.stringify(p);
  if (utf8(text) > LIMITS.saveBytes) { p.outbox = []; p.jobs = []; text = JSON.stringify(p); }
  if (utf8(text) > LIMITS.saveBytes) { p.hist = trimHistory(p.hist, 32 * 1024); text = JSON.stringify(p); }
  return text;
}

/** Saves the party. A refused write (the store is full) degrades: the outbox and the answers go, the chat shrinks, try again. */
export function saveParty(storage, p, now, log = null) {
  if (p.phase === "idle" && !p.link && !p.pending) { try { storage.remove(STORE); } catch (e) { /* nothing to remove */ } return true; }
  const left = p.expiresAtMs ? p.expiresAtMs - now : LIMITS.roomTtlMin * 60000;
  const ttlMs = Math.max(60000, Math.min(left + 300000, LIMITS.roomTtlMin * 60000 + 300000));
  try {
    storage.set(STORE, compactParty(p, now), { ttlMs });
    return true;
  } catch (e) {
    if (log) log(`watch party: saving the room state was refused (${codeOf(e)}); trimmed and tried again`);
    p.outbox = [];
    p.jobs = [];
    p.hist = trimHistory(p.hist, 16 * 1024);
    try { storage.set(STORE, JSON.stringify(p), { ttlMs }); return true; } catch (x) { return false; }
  }
}

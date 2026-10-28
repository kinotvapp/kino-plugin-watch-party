// The chat history every device keeps (pure): reading an entry, trimming, merging, ranges, gaps, the rate limit.

import { EMOJIS, LIMITS } from "../limits.js";
import { MID } from "../util/codes.js";
import { isInt, isObj, jsonBytes, keysAre, scrub, scrubName } from "../util/text.js";

/** A chat entry as every device keeps it: `{ c, k, by, n, x, at, r? }` (cseq, kind, author's member id at the numbering host, name, text or emoji, host time, "d" for a TV). */
export function readEntry(e) {
  if (!isObj(e) || !keysAre(e, ["c", "k", "by", "n", "x", "at"], ["r"])) return null;
  if (!isInt(e.c, 1, 1e12) || !MID.test(String(e.by)) || !Number.isFinite(e.at)) return null;
  if (e.r !== undefined && e.r !== "d") return null;
  const n = scrubName(e.n);
  let x;
  if (e.k === "msg") x = scrub(e.x, LIMITS.textChars);
  else if (e.k === "emoji") x = EMOJIS.includes(e.x) ? e.x : "";
  else return null;
  if (!x) return null;
  // A TV's seat may only react: a text entry by a display is ignored by every client.
  if (e.r === "d" && e.k !== "emoji") return null;
  return { c: e.c, k: e.k, by: e.by, n, x, at: e.at, ...(e.r ? { r: "d" } : {}) };
}

/** The newest entries that fit LIMITS.histEntries and LIMITS.histBytes (counted as stored JSON), in cseq order. */
export function trimHistory(hist, maxBytes = LIMITS.histBytes) {
  const out = hist.length > LIMITS.histEntries ? hist.slice(hist.length - LIMITS.histEntries) : hist.slice();
  let bytes = out.reduce((n, e) => n + jsonBytes(e) + 1, 0);
  while (out.length && bytes > maxBytes) bytes -= jsonBytes(out.shift()) + 1;
  return out;
}

/** [hist] with [entries] merged in (deduplicated by cseq, sorted, bounded). Entries at or below [floor] are older than what is kept. */
export function addEntries(hist, entries, floor = 0) {
  const byC = new Map(hist.map((e) => [e.c, e]));
  for (const e of entries) if (e.c > floor && !byC.has(e.c)) byC.set(e.c, e);
  return trimHistory([...byC.values()].sort((a, b) => a.c - b.c));
}

/**
 * What a `need` for [from]..[to] gets from [hist]: the entries still kept in that range, `have` (the oldest kept) when the
 * range starts before the window, and `gone` when nothing of it is kept at all (the guest stops asking for it).
 */
export function historyRange(hist, from, to) {
  const entries = hist.filter((e) => e.c >= from && e.c <= to);
  const oldest = hist.length ? hist[0].c : null;
  return { entries, have: oldest !== null && from < oldest && to >= oldest ? oldest : null, gone: entries.length === 0 };
}

/** [entries] cut into chunks whose `{ t: "hist", entries }` message stays within [max] bytes. */
export function chunkEntries(entries, max = LIMITS.chunkBytes) {
  const chunks = [];
  let cur = [];
  for (const e of entries) {
    if (cur.length && jsonBytes({ t: "hist", entries: [...cur, e] }) > max) { chunks.push(cur); cur = []; }
    cur.push(e);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

export const inHole = (holes, c) => holes.some(([a, b]) => c >= a && c <= b);

/**
 * The first missing range inside one epoch's run of [hist] above [floor], skipping the known [holes] (ranges the host said
 * are gone): `{ from, to }`, else null. Entries of different epochs never count as a gap.
 */
export function firstGap(hist, floor = 0, holes = []) {
  for (let i = 1; i < hist.length; i++) {
    const a = hist[i - 1].c, b = hist[i].c;
    if (a < floor) continue;
    if (Math.floor(a / LIMITS.epochSpan) !== Math.floor(b / LIMITS.epochSpan) || b <= a + 1) continue;
    for (let c = a + 1; c < b; c++) {
      if (inHole(holes, c)) continue;
      let to = c;
      while (to + 1 < b && !inHole(holes, to + 1)) to++;
      return { from: c, to };
    }
  }
  return null;
}

/** Whether [who] may send another chat entry now (LIMITS.chatPerWindow in LIMITS.chatWindowMs); records it when it may. */
export function chatAllowed(times, who, now) {
  const recent = (times[who] || []).filter((t) => now - t < LIMITS.chatWindowMs);
  if (recent.length >= LIMITS.chatPerWindow) { times[who] = recent; return false; }
  recent.push(now);
  times[who] = recent;
  return true;
}

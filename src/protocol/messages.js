// Pure validation of everything a peer sends: a guest's messages, a host's messages and snapshots, a phone's link message.

import { readEntry } from "../chat/history.js";
import { EMOJIS, LIMITS, SPEEDS } from "../limits.js";
import { readMedia } from "./media.js";
import { MID, normWords, PAIR } from "../util/codes.js";
import { isInt, isObj, keysAre, scrubName } from "../util/text.js";

/** A guest's message to its host, normalized, or null (an unknown kind or any extra field ignores it whole). A message never names its sender: that is Kino's `from`. */
export function readGuestMessage(p) {
  if (!isObj(p) || typeof p.t !== "string") return null;
  switch (p.t) {
    case "hello":
      if (!keysAre(p, ["t", "name", "role"], ["pair", "maxCseq"])) return null;
      if (!["seat", "display"].includes(p.role)) return null;
      if (p.pair !== undefined && !PAIR.test(String(p.pair))) return null;
      if (p.maxCseq !== undefined && !isInt(p.maxCseq, 0, 1e12)) return null;
      return { t: "hello", name: scrubName(p.name), role: p.role, pair: p.pair || null, maxCseq: p.maxCseq || 0 };
    case "msg":
      if (!keysAre(p, ["t", "text"]) || typeof p.text !== "string") return null;
      return { t: "msg", text: p.text };
    case "emoji":
      if (!keysAre(p, ["t", "e"]) || !EMOJIS.includes(p.e)) return null;
      return { t: "emoji", e: p.e };
    case "need":
      if (!keysAre(p, ["t", "from"], ["to"]) || !isInt(p.from, 1, 1e12)) return null;
      if (p.to !== undefined && (!isInt(p.to, p.from, 1e12))) return null;
      return { t: "need", from: p.from, to: p.to === undefined ? null : p.to };
    case "sync":
      return keysAre(p, ["t"]) ? { t: "sync" } : null;
    case "backup": {
      if (!keysAre(p, ["t", "words"])) return null;
      const words = normWords(p.words);
      return words ? { t: "backup", words } : null;
    }
    case "nobackup":
      return keysAre(p, ["t"]) ? { t: "nobackup" } : null;
    case "here":
      return keysAre(p, ["t"]) ? { t: "here" } : null;
    case "pair":
      if (!keysAre(p, ["t", "token"]) || !PAIR.test(String(p.token))) return null;
      return { t: "pair", token: p.token };
    case "bye":
      return keysAre(p, ["t"]) ? { t: "bye" } : null;
    case "hist": {
      if (!keysAre(p, ["t", "entries"]) || !Array.isArray(p.entries) || p.entries.length > LIMITS.lateJoin) return null;
      return { t: "hist", entries: p.entries.map(readEntry).filter(Boolean) };
    }
    default:
      return null;
  }
}

/** A snapshot from an endpoint holder, normalized, or null. Its member ids are Kino's at that endpoint ("host" for the holder). */
export function readSnapshot(p) {
  if (!isObj(p) || p.t !== "snap") return null;
  if (!keysAre(p, ["t", "seq", "epoch", "hostName", "hostWords", "maxCseq", "members", "backups", "want", "state", "chat"], ["media"])) return null;
  if (!isInt(p.seq, 1, 1e12) || !isInt(p.epoch, 1, LIMITS.maxEpoch) || !isInt(p.maxCseq, 0, 1e12)) return null;
  const hostWords = normWords(p.hostWords);
  if (!hostWords || !Array.isArray(p.members) || p.members.length > LIMITS.maxMembers || !isObj(p.backups) || !Array.isArray(p.want)) return null;
  const members = [];
  for (const m of p.members) {
    if (!isObj(m) || !MID.test(String(m.id)) || !isInt(m.js, 1, 1e6) || !["seat", "display"].includes(m.role)) return null;
    if (m.of !== undefined && m.of !== null && !MID.test(String(m.of))) return null;
    if (members.some((x) => x.id === m.id)) return null;
    members.push({ id: m.id, name: scrubName(m.name), js: m.js, role: m.role, of: m.role === "display" && m.of ? m.of : null });
  }
  if (!members.some((m) => m.id === "host")) return null;
  const backups = {};
  for (const [id, w] of Object.entries(p.backups).slice(0, LIMITS.backups)) {
    const words = normWords(w);
    if (MID.test(id) && id !== "host" && words && members.some((m) => m.id === id && m.role === "seat")) backups[id] = words;
  }
  const want = p.want.filter((x) => MID.test(String(x)) && x !== "host").slice(0, LIMITS.backups);
  const st = readState(p.state);
  if (!st || !Array.isArray(p.chat) || p.chat.length > LIMITS.snapChat) return null;
  return {
    t: "snap", seq: p.seq, epoch: p.epoch, hostName: scrubName(p.hostName), hostWords, maxCseq: p.maxCseq,
    members, backups, want, media: p.media === undefined ? null : readMedia(p.media), state: st, chat: p.chat.map(readEntry).filter(Boolean),
  };
}

function readState(s) {
  if (!isObj(s) || !keysAre(s, ["pos", "paused", "speed", "at"])) return null;
  if (!isInt(s.pos, 0, 1e9) || typeof s.paused !== "boolean" || !SPEEDS.includes(s.speed) || !Number.isFinite(s.at)) return null;
  return { pos: s.pos, paused: s.paused, speed: s.speed, at: s.at };
}

/** An endpoint holder's message to a guest, normalized, or null. */
export function readHostMessage(p) {
  if (!isObj(p) || typeof p.t !== "string") return null;
  switch (p.t) {
    case "snap":
      return readSnapshot(p);
    case "state": {
      if (!keysAre(p, ["t", "pos", "paused", "speed", "at"], ["why", "by"])) return null;
      const st = readState({ pos: p.pos, paused: p.paused, speed: p.speed, at: p.at });
      if (!st) return null;
      const why = ["tick", "pause", "resume", "seek", "start"].includes(p.why) ? p.why : "tick";
      return { t: "state", ...st, why, by: scrubName(p.by) };
    }
    case "chat":
    case "hist": {
      if (!keysAre(p, ["t", "entries"]) || !Array.isArray(p.entries) || p.entries.length > 80) return null;
      return { t: p.t, entries: p.entries.map(readEntry).filter(Boolean) };
    }
    case "have":
      if (!keysAre(p, ["t", "from"]) || !isInt(p.from, 1, 1e12)) return null;
      return { t: "have", from: p.from };
    case "gone":
      if (!keysAre(p, ["t", "from", "to"]) || !isInt(p.from, 1, 1e12) || !isInt(p.to, p.from, 1e12)) return null;
      return { t: "gone", from: p.from, to: p.to };
    case "need":
      if (!keysAre(p, ["t", "from"]) || !isInt(p.from, 1, 1e12)) return null;
      return { t: "need", from: p.from };
    case "bye":
      return keysAre(p, ["t"]) ? { t: "bye" } : null;
    case "redirect": {
      if (!keysAre(p, ["t", "words", "name"])) return null;
      const words = normWords(p.words);
      return words ? { t: "redirect", words, name: scrubName(p.name) } : null;
    }
    default:
      return null;
  }
}

/** A phone's message to a TV's link endpoint, normalized, or null. */
export function readLinkMessage(p) {
  if (!isObj(p) || p.t !== "link" || !keysAre(p, ["t", "words", "code", "name", "pair"])) return null;
  const words = normWords(p.words);
  const code = typeof p.code === "string" && /^[0-9]{4,12}$/.test(p.code) ? p.code : null;
  if (!words || !code || !PAIR.test(String(p.pair))) return null;
  return { t: "link", words, code, name: scrubName(p.name), pair: p.pair };
}

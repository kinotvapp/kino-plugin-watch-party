// The party: the state this device keeps while in a room, the outbox queue, the snapshot, and small roster helpers.

import { addEntries } from "../chat/history.js";
import { LIMITS } from "../limits.js";
import { jsonBytes, scrubName } from "../util/text.js";

/**
 * A fresh, roomless party for this device. The fields, by group:
 * - who: `phase` idle|party, `role` host|guest, `me` { mid (Kino's id at the door joined, "host" when hosting), name,
 *   role seat|display, pair (a TV: its phone's pairing token), pairOut (a phone: the token it gave its TV) }, `myMids`.
 * - the room: `code`, `epoch`, `hostName`, `hostWords` (the host's door), `joinedWords` (the door this device joined: only
 *   its holder's snapshots count), `handle` (the joined session), `myWords` (this device's door), `roster` (members by Kino
 *   id; the host's copy also keeps each display's pairing token and when it last heard each member), `nextJs`, `myJs`,
 *   `backups`, `want`, `media`, `snap` (the newest snapshot of the joined door's holder), `view` (the election's members
 *   and doors, from every such snapshot), `leftDoors` (the newest 3 doors of members who left this host).
 * - the chat: `hist`, `maxCseq` (host), `maxKnown`, `oldest`, `holes`, `lastNeed`, `pendingChat`, `pendingMine`.
 * - sending: `outbox` (bounded), `jobs` (history answers, made at send time), `sent`, `replies` (per-member answer times),
 *   `cursors` (per mailbox), `hereAt` (a guest's last "my tab is open").
 * - sync: `st`, `stAt`, `skew`, `follow`, `hold`, `lastAction`, `expect`, `seeks`, `lead`, `seekPending`, `stuck`.
 * - failover: `banner`, `lastOkAt` (the last message from the joined door's holder), `hostFailed` + `hostFailedAt` (a fresh
 *   try of the host's door failed), `awaiting` (this guest went to the successor's door and waits for it to host), `probe`
 *   and `moved` (a host looking for the room), `aloneSince`, `realLeftAt`, `lobby`, `lobbyHello`, `lobbySent`,
 *   `lobbySentAt`, `recovering`, `askedMid`, `oldView`, `gone` (kept for older saves, unused).
 * - the TV link: `link`, `pending`; the host's `pairs`.
 */
export function newParty(name = "") {
  return {
    v: 2, phase: "idle", role: null, me: { mid: null, name: scrubName(name), role: "seat", pair: null, pairOut: null, of: null }, myMids: [],
    code: null, epoch: 0, hostName: "", hostWords: null, joinedWords: null, handle: null, myWords: null, backupAt: 0, backupSentAt: 0,
    roster: [], nextJs: 1, myJs: 0, backups: {}, want: [], media: null, snap: null, view: null, leftDoors: {},
    hist: [], maxCseq: 0, maxKnown: 0, oldest: 0, holes: [], lastNeed: null, needAt: 0, pendingChat: [], pendingMine: [],
    outbox: [], jobs: [], sent: [], replies: {}, chatTimes: {}, myChat: [], cursors: { joined: 0, hosted: 0, probe: 0 }, hereAt: 0,
    st: null, stAt: 0, skew: [], follow: true, hold: false, lastAction: 0, expect: null, seeks: [], lead: 0, seekPending: null, stuck: false,
    snapSeq: 0, snapAt: 0, lastSnapSent: 0, lastStateSent: 0, snapDue: false, forceState: null,
    banner: null, lastOkAt: 0, doorUp: false, chatSeen: 0, hostFailed: false, hostFailedAt: 0, awaiting: null, gone: [], probe: null, moved: null, aloneSince: 0,
    realLeftAt: 0, lobby: {}, lobbyHello: {}, lobbySent: {}, lobbySentAt: [], recovering: false, askedMid: null,
    oldView: null, link: null, pending: null, pairs: {}, closeJoined: null, closeHosted: false, expiresAtMs: 0, redirect: null,
    correctedAt: 0, correctedTo: null, notes: [], short: null, shortUntil: 0, shortError: false, shortMine: false,
  };
}

export const note = (p, now, es, en) => { p.notes = [...p.notes, { at: now, es, en }].slice(-LIMITS.notes); };
export const histMax = (p) => (p.hist.length ? p.hist[p.hist.length - 1].c : 0);
export const rosterOf = (p, id) => p.roster.find((m) => m.id === id) || null;
export const displayName = (name, en) => name || (en ? "Guest" : "Invitado");
export const addMyMid = (p, mid) => { if (mid && !p.myMids.includes(mid)) p.myMids = [...p.myMids, mid].slice(-10); };

/**
 * Queues one message. The outbox is bounded (LIMITS.outboxItems and LIMITS.outboxBytes): a newer broadcast `state` or `snap`
 * replaces the queued one, an identical message is never queued twice, and when it is full the oldest one-member messages go
 * first, then the oldest broadcasts. History answers never wait here: they are made at send time from `hist` (`jobs`).
 */
export function enqueue(p, session, payload, to) {
  const item = { session, payload, ...(to ? { to } : {}) };
  const key = JSON.stringify(item);
  if (p.outbox.some((o) => JSON.stringify(o) === key)) return;
  if (!to && (payload.t === "state" || payload.t === "snap")) p.outbox = p.outbox.filter((o) => o.to || o.session !== session || o.payload.t !== payload.t);
  if (to && (payload.t === "state" || payload.t === "snap")) p.outbox = p.outbox.filter((o) => !(o.to === to && o.session === session && o.payload.t === payload.t));
  p.outbox.push(item);
  const bytes = () => p.outbox.reduce((n, o) => n + jsonBytes(o), 0);
  while (p.outbox.length > LIMITS.outboxItems || (p.outbox.length > 1 && bytes() > LIMITS.outboxBytes)) {
    const direct = p.outbox.findIndex((o) => o.to);
    p.outbox.splice(direct >= 0 ? direct : 0, 1);
  }
}

/** The snapshot the host broadcasts: always within LIMITS.snapBytes (the chat tail is trimmed first). */
export function buildSnapshot(p, now) {
  const base = {
    t: "snap", seq: p.snapSeq, epoch: p.epoch, hostName: p.hostName, hostWords: p.hostWords, maxCseq: p.maxCseq,
    members: p.roster.map((m) => ({ id: m.id, name: m.name, js: m.js, role: m.role, ...(m.role === "display" ? { of: m.of } : {}) })),
    backups: { ...p.backups }, want: p.want.slice(), ...(p.media ? { media: p.media } : {}),
    state: p.st ? { pos: p.st.pos, paused: p.st.paused, speed: p.st.speed, at: p.st.at } : { pos: 0, paused: true, speed: 1, at: now },
    chat: [],
  };
  let tail = p.hist.slice(-LIMITS.snapChat);
  for (;;) {
    const snap = { ...base, chat: tail };
    if (jsonBytes(snap) <= LIMITS.snapBytes) return snap;
    if (!tail.length) break;
    tail = tail.slice(1);
  }
  // Only a degenerate title could be this long: drop it, the ids still name the title.
  return { ...base, ...(p.media ? { media: { ...p.media, title: "" } } : {}), chat: [] };
}

/** A chat entry numbered by this device (it is the host) and queued for the next broadcast. */
export function hostAddChat(p, entry, now) {
  p.maxCseq = Math.max(p.maxCseq, p.epoch * LIMITS.epochSpan) + 1;
  const e = { c: p.maxCseq, ...entry, at: now };
  p.hist = addEntries(p.hist, [e]);
  p.pendingChat.push(e);
  return e;
}

/** Whether [mid] may cost the host another answer of [kind] now, within [count] per [windowMs]; records it when it may. */
export function replyAllowed(p, mid, kind, now, count, windowMs) {
  const key = kind + ":" + mid;
  const recent = (p.replies[key] || []).filter((t) => now - t < windowMs);
  if (recent.length >= count) { p.replies[key] = recent; return false; }
  p.replies[key] = [...recent, now];
  return true;
}

/** A history answer for [mid] from [from] to [to]: one per member (a different ask replaces it, the same ask is ignored). */
export function addJob(p, mid, from, to, now) {
  const end = Math.max(from, Math.min(to === null ? p.maxCseq : to, p.maxCseq || to || from));
  const same = p.jobs.find((j) => j.to === mid);
  if (same && same.from === from && same.end === end) return;
  p.jobs = [...p.jobs.filter((j) => j.to !== mid), { to: mid, from, next: from, end, sentAny: false, at: now }].slice(-LIMITS.jobs);
}

/** The rows of the member list: one per person, a TV shown with the phone it belongs to; equal names numbered («Bea (2)»). */
export function memberRows(roster) {
  const rows = [];
  for (const m of roster.filter((x) => x.role === "seat")) {
    const tvs = roster.filter((x) => x.role === "display" && x.of === m.id);
    rows.push({ id: m.id, name: m.name, host: m.id === "host", phone: true, tv: tvs.length > 0 });
  }
  for (const d of roster.filter((x) => x.role === "display" && !roster.some((s) => s.role === "seat" && s.id === x.of))) {
    rows.push({ id: d.id, name: d.name, host: false, phone: false, tv: true });
  }
  const seen = {};
  for (const r of rows) {
    const key = (r.name || "").toLowerCase();
    seen[key] = (seen[key] || 0) + 1;
    if (seen[key] > 1) r.name = `${r.name || ""} (${seen[key]})`.trim();
  }
  return rows;
}

/** This device's hello: its name and seat, a TV's pairing token, and how far its chat goes. Never an id: Kino names the sender. */
export function helloOf(p) {
  return { t: "hello", name: p.me.name, role: p.me.role, ...(p.me.role === "display" && p.me.pair ? { pair: p.me.pair } : {}), maxCseq: histMax(p) };
}

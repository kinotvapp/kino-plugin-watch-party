// The host's reducer: its mailbox (joins, leaves, members' messages) and its periodic work.

import { addEntries, chatAllowed, chunkEntries } from "../chat/history.js";
import { LIMITS, SPEEDS } from "../limits.js";
import { wantedBackups } from "./election.js";
import {
  addJob, buildSnapshot, displayName, enqueue, histMax, hostAddChat, note, replyAllowed, rosterOf,
} from "./state.js";
import { mediaOf, sameMedia } from "../protocol/media.js";
import { readGuestMessage } from "../protocol/messages.js";
import { maskCode, MID } from "../util/codes.js";
import { isObj, scrub, scrubName } from "../util/text.js";

/** One event of the host's own mailbox: a join, a leave or a member's message. The sender is Kino's `from`; nothing else is trusted. */
export function hostReceive(p, ev, now) {
  if (!isObj(ev) || typeof ev.from !== "string" || !MID.test(ev.from) || ev.from === "host") return;
  if (ev.kind === "join") {
    if (Object.keys(p.lobby).length < LIMITS.maxMembers * 2) p.lobby[ev.from] = { name: scrubName(ev.name), at: now };
    // Whoever reaches the door sees the room at once (a newcomer, a member coming back, a host looking for the room).
    if (p.st || p.hist.length) enqueue(p, "hosted", buildSnapshot({ ...p, snapSeq: Math.max(1, p.snapSeq) }, now), ev.from);
    return;
  }
  if (ev.kind === "leave") { dropMember(p, ev.from, now); return; }
  if (ev.kind !== "msg") return;
  const m = readGuestMessage(ev.payload);
  if (!m) return;
  if (m.t === "hello") { hostHello(p, ev.from, m, now); return; }
  const member = rosterOf(p, ev.from);
  if (!member) return; // not a member yet: no hello
  member.lastAt = now;
  switch (m.t) {
    case "here":
      return;
    case "msg": {
      if (member.role === "display") return; // a TV's seat may only react (a client convention: see the README)
      if (!chatAllowed(p.chatTimes, member.id, now)) return;
      const text = maskCode(maskCode(scrub(m.text, LIMITS.textChars), p.code), p.short);
      if (!text) return;
      hostAddChat(p, { k: "msg", by: member.id, n: member.name, x: text }, now);
      return;
    }
    case "emoji":
      if (!chatAllowed(p.chatTimes, member.id, now)) return;
      hostAddChat(p, { k: "emoji", by: member.id, n: member.name, x: m.e, ...(member.role === "display" ? { r: "d" } : {}) }, now);
      return;
    case "need":
      addJob(p, member.id, m.from, m.to, now);
      return;
    case "sync":
      if (p.st && replyAllowed(p, member.id, "sync", now, 1, LIMITS.syncEveryMs)) enqueue(p, "hosted", { t: "state", ...p.st, why: "tick" }, member.id);
      return;
    case "backup":
      if (member.role === "seat" && p.want.includes(member.id) && !Object.values(p.backups).includes(m.words)) {
        p.backups[member.id] = m.words;
        p.snapDue = true;
      }
      return;
    case "nobackup":
      if (p.backups[member.id]) { delete p.backups[member.id]; p.snapDue = true; }
      return;
    case "pair": {
      if (member.role !== "seat") return;
      // One token per seat: a new one replaces that seat's old one, never another seat's.
      for (const [t, v] of Object.entries(p.pairs)) if (v.mid === member.id) delete p.pairs[t];
      p.pairs[m.token] = { mid: member.id, at: now };
      p.roster = p.roster.map((r) => (r.role === "display" && r.pair === m.token && !r.of ? { ...r, of: member.id } : r));
      p.snapDue = true;
      return;
    }
    case "bye":
      dropMember(p, ev.from, now, true);
      return;
    case "hist": {
      // Only the answer to this host's own `need` after a failover: entries of older epochs, newer than what it has, by authors
      // of the last snapshot it saw as a guest, their names taken from that snapshot (a member cannot rename the authors).
      if (p.askedMid !== ev.from) return;
      p.askedMid = null;
      const floor = histMax(p);
      const authors = new Map(((p.oldView && p.oldView.members) || []).map((x) => [x.id, x]));
      const fresh = m.entries
        .filter((e) => e.c > floor && e.c < p.epoch * LIMITS.epochSpan && authors.has(e.by) && !(authors.get(e.by).role === "display" && e.k !== "emoji"))
        .map((e) => ({ ...e, n: authors.get(e.by).name }));
      if (!fresh.length) return;
      p.hist = addEntries(p.hist, fresh);
      p.pendingChat.push(...fresh);
      return;
    }
    default:
  }
}

export const isDisplay = (p, id) => (rosterOf(p, id) || {}).role === "display";

export function hostHello(p, mid, m, now) {
  const bound = rosterOf(p, mid);
  if (bound) {
    // A second hello from the same session refreshes a TV's pairing or the member's name («Cambiar mi nombre»); it never adds
    // a member or changes a seat.
    if (m.name && m.name !== bound.name && m.role === bound.role) {
      p.roster = p.roster.map((r) => (r.id === mid ? { ...r, name: m.name } : r));
      p.snapDue = true;
    }
    if (bound.role === "display" && m.role === "display" && m.pair && m.pair !== bound.pair) {
      const pair = p.pairs[m.pair];
      p.roster = p.roster.map((r) => (r.id === mid ? { ...r, pair: m.pair, of: pair && rosterOf(p, pair.mid) ? pair.mid : r.of } : r));
      p.snapDue = true;
    }
    return;
  }
  if (p.roster.length >= LIMITS.maxMembers) return; // the room's own maximum, the host included
  const name = (p.lobby[mid] && p.lobby[mid].name) || m.name;
  delete p.lobby[mid];
  const pair = m.role === "display" && m.pair ? p.pairs[m.pair] : null;
  const of = pair && rosterOf(p, pair.mid) ? pair.mid : null;
  const js = p.nextJs++;
  p.roster = [...p.roster, { id: mid, name, js, role: m.role, of, lastAt: now, ...(m.role === "display" && m.pair ? { pair: m.pair } : {}) }];
  note(p, now, `${displayName(name)} entró`, `${displayName(name, true)} joined`);
  // A newcomer gets the last LIMITS.lateJoin entries (as an answer made at send time, within the member's budget).
  const tail = p.hist.slice(-LIMITS.lateJoin);
  if (tail.length) addJob(p, mid, tail[0].c, p.maxCseq, now);
  // A new host after a failover asks the first member that has newer chat than it for the missing tail.
  if (p.recovering && m.maxCseq > histMax(p) && !p.askedMid) {
    p.askedMid = mid;
    enqueue(p, "hosted", { t: "need", from: histMax(p) + 1 }, mid);
  }
  if (p.st) enqueue(p, "hosted", { t: "state", ...p.st, why: "tick" }, mid);
  p.snapDue = true;
}

/**
 * A member left (Kino's `leave`, or its `bye`). It counts as a real departure (for the «alone» notice) after a `bye`, or
 * when the host heard from it shortly before; a member silent for LIMITS.idleGuessMs before its leave most likely just closed
 * its drawer and was dropped by the room's 2-minute rule.
 */
function dropMember(p, mid, now, byBye = false) {
  delete p.lobby[mid];
  p.jobs = p.jobs.filter((j) => j.to !== mid);
  p.outbox = p.outbox.filter((o) => o.to !== mid);
  for (const [t, v] of Object.entries(p.pairs)) if (v.mid === mid) delete p.pairs[t];
  const m = rosterOf(p, mid);
  if (!m) return;
  p.roster = p.roster.filter((r) => r !== m).map((r) => (r.role === "display" && r.of === m.id ? { ...r, of: null } : r));
  // A member with a backup door may have left to follow a new host: remember the door (the newest few), in case this
  // device is left behind.
  if (p.backups[m.id]) {
    const doors = { ...p.leftDoors, [m.id]: { name: m.name, js: m.js, words: p.backups[m.id], at: now } };
    p.leftDoors = Object.fromEntries(Object.entries(doors).sort((a, b) => b[1].at - a[1].at).slice(0, LIMITS.leftDoors));
  }
  delete p.backups[m.id];
  if (byBye || now - (m.lastAt || 0) < LIMITS.idleGuessMs) p.realLeftAt = now;
  note(p, now, `${displayName(m.name)} salió`, `${displayName(m.name, true)} left`);
  p.snapDue = true;
}

/** The host's periodic work: the title, the playback state, the chat batch, who keeps a backup, the snapshot, being alone. */
export function hostTick(p, ctx, now) {
  const media = mediaOf(ctx);
  if (media && !sameMedia(media, p.media)) { p.media = media; p.snapDue = true; }
  const st = { pos: Math.max(0, Math.round(Number(ctx.positionMs) || 0)), paused: Boolean(ctx.paused), speed: SPEEDS.includes(ctx.player && ctx.player.speed) ? ctx.player.speed : 1, at: now };
  const why = p.forceState;
  p.st = st;
  if (why || now - p.lastStateSent >= LIMITS.stateEveryMs) {
    enqueue(p, "hosted", { t: "state", ...st, why: why || "tick", by: p.me.name });
    p.lastStateSent = now;
    p.forceState = null;
  }
  if (p.pendingChat.length) {
    for (const chunk of chunkEntries(p.pendingChat)) enqueue(p, "hosted", { t: "chat", entries: chunk });
    p.pendingChat = [];
  }
  const want = wantedBackups(p.roster);
  if (JSON.stringify(want) !== JSON.stringify(p.want)) { p.want = want; p.snapDue = true; }
  for (const id of Object.keys(p.backups)) if (!want.includes(id)) { delete p.backups[id]; p.snapDue = true; }
  if (p.snapDue || now - p.lastSnapSent >= LIMITS.snapEveryMs) {
    p.snapSeq += 1;
    const snap = buildSnapshot(p, now);
    enqueue(p, "hosted", snap);
    if (snap.members.length > 1 && Object.keys(snap.backups).length) p.view = { members: snap.members, backups: snap.backups, epoch: p.epoch };
    p.lastSnapSent = now;
    p.snapDue = false;
  }
  // Everyone else left while there were doors, and at least one of them really left (a goodbye, or recently heard): they may
  // have gone on elsewhere. Only an offer to look; this host keeps its room. Members dropped for a closed drawer do not
  // count (the Sala tab still offers the search, quietly).
  const others = p.roster.some((m) => m.id !== "host");
  const hadDoors = Object.keys(p.leftDoors).length > 0;
  if (others || !hadDoors) { p.aloneSince = 0; if (others) p.realLeftAt = 0; }
  else if (!p.aloneSince) p.aloneSince = now;
  if (p.aloneSince && p.realLeftAt && now - p.aloneSince > LIMITS.aloneMs && !p.banner && !p.probe) p.banner = { kind: "alone" };
  if (others && p.banner && p.banner.kind === "alone") p.banner = null;
}

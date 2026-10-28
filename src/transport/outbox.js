// The room glue: the send budget, sending the outbox and history answers, reading the mailboxes, one round of work (`pump`).

import { chunkEntries, historyRange } from "../chat/history.js";
import { LIMITS } from "../limits.js";
import { lobbyReceive } from "../party/failover.js";
import { applySnapshot, guestReceive, guestTick } from "../party/guest.js";
import { hostReceive, hostTick } from "../party/host.js";
import { addMyMid, enqueue, helloOf, note } from "../party/state.js";
import { linkReceive } from "../party/tv-link.js";
import { readHostMessage } from "../protocol/messages.js";
import { codeOf, isObj, jsonBytes } from "../util/text.js";

/** Whether one more message of [bytes] fits the plugin's own send budget now. */
function budget(p, now, bytes) {
  p.sent = p.sent.filter((s) => now - s.at < 60000);
  if (p.sent.filter((s) => now - s.at < 1000).length >= LIMITS.sendsPerSecond) return false;
  if (p.sent.length >= LIMITS.sendsPerMinute) return false;
  return p.sent.reduce((n, s) => n + s.bytes, 0) + bytes <= LIMITS.bytesPerMinute;
}

async function sendOne(room, p, session, payload, to, now) {
  const bytes = jsonBytes(payload);
  if (!budget(p, now, bytes)) return "wait";
  try {
    await room.send(payload, { session, ...(to ? { to } : {}) });
    p.sent.push({ at: now, bytes });
    return "sent";
  } catch (e) {
    const code = codeOf(e);
    if (code === "rate_limited") return "wait";
    if (code === "room_unreachable") return "wait";
    return "drop"; // bad_request, a member gone, a session closed
  }
}

/** Sends what is queued: the broadcasts and short messages first, then the history answers, within the send budget. */
export async function flush(room, p, now) {
  while (p.outbox.length) {
    const item = p.outbox[0];
    const session = item.session === "hosted" ? "hosted" : p.handle;
    if (!session) { p.outbox.shift(); continue; }
    const r = await sendOne(room, p, session, item.payload, item.to, now);
    if (r === "wait") return;
    p.outbox.shift();
  }
  if (p.role !== "host" || !p.jobs.length) return;
  // Round by round, one answer per job each round, until the budget or each member's allowance runs out.
  for (let round = 0; round < LIMITS.chunksPerMemberMinute && p.jobs.length; round++) {
    for (const job of p.jobs.slice()) {
      const { entries, have, gone } = historyRange(p.hist, job.next, job.end);
      let payload = null;
      let next = job.next;
      if (have !== null && !job.sentAny) { payload = { t: "have", from: have }; next = have; }
      else if (gone) payload = job.sentAny ? null : { t: "gone", from: job.from, to: job.end };
      else {
        const chunk = chunkEntries(entries)[0];
        payload = { t: "hist", entries: chunk };
        next = chunk[chunk.length - 1].c + 1;
      }
      if (payload) {
        const key = "hist:" + job.to;
        const recent = (p.replies[key] || []).filter((t) => now - t < 60000);
        if (recent.length >= LIMITS.chunksPerMemberMinute) continue; // this member's allowance: later
        const r = await sendOne(room, p, "hosted", payload, job.to, now);
        if (r === "wait") return;
        p.replies[key] = [...recent, now];
        if (r === "drop") next = job.end + 1;
        job.sentAny = true;
        job.next = next;
      }
      if (!payload || job.next > job.end || payload.t === "gone") p.jobs = p.jobs.filter((j) => j !== job);
    }
  }
}

async function drain(room, p, session, cursor, onEvent, now) {
  for (let i = 0; i < 4; i++) {
    let box;
    try {
      box = await room.inbox({ since: p.cursors[cursor], session });
    } catch (e) {
      if (cursor === "joined" && codeOf(e) === "room_unreachable") p.doorUp = false;
      if (codeOf(e) === "room_closed") return "closed";
      return "error";
    }
    if (!isObj(box) || !Array.isArray(box.events)) return "error";
    // Whether the host's door itself answers (Kino keeps it serving while the host's app is in the background).
    if (cursor === "joined") p.doorUp = box.reachable === true;
    for (const ev of box.events) onEvent(p, ev, now);
    if (Number.isFinite(box.last)) p.cursors[cursor] = Math.max(p.cursors[cursor], box.last);
    if (!box.more) return "ok";
  }
  return "ok";
}

/**
 * A host looking for the room at another door. The only proof that the room went on there: a snapshot from that door's own
 * holder as host (`hostWords` = the probed door), at exactly this host's epoch + 1 (a change of host moves it by one), when
 * that holder is the successor this host's own last view predicts. It is shown to the person («La sala siguió con Mal»), who
 * decides; nothing closes by itself. A redirect, or anything older, means the room is still here.
 */
function probeReceive(p, ev, now) {
  if (!p.probe || p.probe.found || !isObj(ev) || ev.from !== "host" || ev.kind !== "msg") return;
  const m = readHostMessage(ev.payload);
  if (!m) return;
  if (m.t === "snap" && m.hostWords === p.probe.words) {
    if (m.epoch === p.epoch + 1 && p.probe.predicted) p.probe = { ...p.probe, found: m };
    else p.probe = { ...p.probe, done: "here" };
  } else if (m.t === "redirect") p.probe = { ...p.probe, done: m.words === p.hostWords ? "here" : "elsewhere" };
}

/** One round of room work for this device: read the mailboxes, run the reducers, close what must close, send. */
export async function pump(room, p, ctx, now) {
  if (p.link && !p.link.used && now > p.link.exp) {
    p.closeHosted = true;
    p.link = null;
    note(p, now, "El código para el teléfono venció", "The code for the phone expired");
  }
  // The TV's link endpoint (a display seat never holds a backup door, so the hosted slot is the link's alone).
  if (p.link && !p.link.used) await drain(room, p, "hosted", "hosted", linkReceive, now);
  if (p.pending && p.phase === "party") {
    if (p.pending.code === p.code) {
      // A new phone for a TV already in this room: the pairing goes with a fresh hello.
      p.me.pair = p.pending.pair;
      enqueue(p, "joined", helloOf(p));
      p.pending = null;
    } else if (!p.banner) p.banner = { kind: "linked", name: p.pending.name };
  }
  if (p.phase === "party" && p.role === "host") {
    const r = await drain(room, p, "hosted", "hosted", hostReceive, now);
    if (r === "closed" && (!p.banner || !["ended", "moved"].includes(p.banner.kind))) p.banner = { kind: "closedMine" };
    if (p.probe) await runProbe(room, p, now);
    if (p.role === "host") hostTick(p, ctx, now);
  } else if (p.phase === "party" && p.role === "guest") {
    if (p.handle) {
      const r = await drain(room, p, p.handle, "joined", guestReceive, now);
      // Kino closed this device's own session (the host dropped it after 2 minutes of silence, or it went offline): this
      // device was away. Nothing is concluded about the host; one press joins its door again.
      if (r === "closed") { p.handle = null; p.awaiting = null; p.hostFailed = false; p.banner = { kind: "dropped" }; }
    }
    if (p.myWords && p.role === "guest") {
      const r = await drain(room, p, "hosted", "hosted", lobbyReceive, now);
      if (r === "closed") { p.myWords = null; p.cursors.hosted = 0; }
    }
    if (p.role === "guest") guestTick(p, ctx, now);
    else hostTick(p, ctx, now); // just promoted
  }
  if (p.closeJoined) {
    try { await room.close({ session: p.closeJoined }); } catch (e) { /* already gone */ }
    p.closeJoined = null;
    p.cursors.joined = 0;
  }
  if (p.closeHosted) {
    try { await room.close({ session: "hosted" }); } catch (e) { /* already gone */ }
    p.closeHosted = false;
    if (p.role !== "host" && p.myWords) { p.myWords = null; p.backupAt = 0; if (p.handle) enqueue(p, "joined", { t: "nobackup" }); }
    p.cursors.hosted = 0;
  }
  await flush(room, p, now);
}

async function runProbe(room, p, now) {
  await drain(room, p, p.probe.handle, "probe", probeReceive, now);
  const pr = p.probe;
  if (pr.found) {
    if (!p.banner || p.banner.kind !== "moved") p.banner = { kind: "moved", name: pr.found.hostName, count: pr.found.members.length };
    return;
  }
  if (pr.done || now - pr.at > LIMITS.probeMs) {
    try { await room.close({ session: pr.handle }); } catch (e) { /* gone */ }
    p.probe = null;
    if (p.banner && ["alone", "moved"].includes(p.banner.kind)) p.banner = null;
    p.aloneSince = 0;
    p.realLeftAt = 0;
    if (pr.done === "here") p.leftDoors = {};
    if (!p.banner || p.banner.kind !== "closedMine") note(p, now, "No encontramos la sala en otra puerta", "The room was not found at another door");
  }
}

/** «Unirme»: the person accepts the proof the probe found; this device closes its own room and becomes that host's guest. */
export function stepDown(p, now) {
  const pr = p.probe;
  p.closeHosted = true;
  p.role = "guest";
  p.myWords = null;
  p.handle = pr.handle;
  p.joinedWords = pr.words;
  p.cursors.joined = p.cursors.probe;
  p.probe = null;
  p.banner = null;
  p.recovering = false;
  p.jobs = [];
  p.outbox = [];
  p.me.mid = pr.mid;
  addMyMid(p, pr.mid);
  applySnapshot(p, pr.found, now);
  enqueue(p, "joined", helloOf(p));
  if (p.me.pairOut) enqueue(p, "joined", { t: "pair", token: p.me.pairOut });
}

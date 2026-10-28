// The guest's reducer: its session's events, snapshots, the chat it merges, and its periodic work.

import { addEntries, chunkEntries, firstGap, historyRange, inHole } from "../chat/history.js";
import { LIMITS } from "../limits.js";
import { hostGone } from "./failover.js";
import { isDisplay } from "./host.js";
import { displayName, enqueue, histMax, note, rosterOf } from "./state.js";
import { readHostMessage } from "../protocol/messages.js";
import { observeSkew } from "../protocol/playback.js";
import { isObj } from "../util/text.js";

/**
 * One event of a guest's party session. Only the door holder's (`from: "host"`) messages count. A guest waiting at the
 * successor's door (`awaiting`) takes nothing from it but that holder's own snapshot as host: no redirect back to the host
 * it could not reach, no forwarded old snapshot.
 */
export function guestReceive(p, ev, now) {
  if (!isObj(ev) || ev.from !== "host") return;
  if (ev.kind === "closed") {
    if (p.awaiting) { p.awaiting = null; p.banner = { kind: "noAnswer" }; return; }
    hostGone(p, now, "closed");
    return;
  }
  if (ev.kind !== "msg") return;
  const m = readHostMessage(ev.payload);
  if (!m) return;
  if (p.awaiting && !(m.t === "snap" && m.hostWords === p.joinedWords)) return;
  switch (m.t) {
    case "snap": applySnapshot(p, m, now); return;
    case "state":
      if (p.hostWords !== p.joinedWords) return; // a door's holder that is not the host moves nobody
      p.lastOkAt = now;
      p.skew = observeSkew(p.skew, now - m.at);
      if (p.st && m.why !== "tick" && m.why !== "start" && p.st.paused !== m.paused) {
        note(p, now, `${displayName(m.by)} ${m.paused ? "pausó" : "siguió"}`, `${displayName(m.by, true)} ${m.paused ? "paused" : "resumed"}`);
      }
      p.st = { pos: m.pos, paused: m.paused, speed: m.speed, at: m.at };
      p.stAt = now;
      // The host itself paused, resumed or jumped: a lag measured after our last seek no longer means a slow rebuffer.
      if (m.why !== "tick") { p.lead = 0; p.seekPending = null; }
      return;
    case "chat":
    case "hist":
      p.lastOkAt = now;
      mergeChat(p, m.entries, now);
      return;
    case "have":
      p.oldest = Math.max(p.oldest, m.from);
      return;
    case "gone":
      p.holes = [...p.holes, [m.from, m.to]].slice(-LIMITS.holes);
      return;
    case "need": {
      // The (new) host asks for the tail it lacks: at most one batch, only entries this device has.
      const { entries } = historyRange(p.hist, m.from, Number.MAX_SAFE_INTEGER);
      const chunk = chunkEntries(entries.slice(-LIMITS.lateJoin))[0];
      if (chunk) enqueue(p, "joined", { t: "hist", entries: chunk });
      return;
    }
    case "bye": hostGone(p, now, "bye"); return;
    case "redirect":
      p.lastOkAt = now;
      p.redirect = { words: m.words, name: m.name };
      p.banner = { kind: "redirect", words: m.words, name: m.name };
      return;
    default:
  }
}

function mergeChat(p, entries, now) {
  const ok = entries.filter((e) => !(isDisplay(p, e.by) && e.k !== "emoji"));
  if (!ok.length) return;
  p.hist = addEntries(p.hist, ok, p.oldest ? p.oldest - 1 : 0);
  p.maxKnown = Math.max(p.maxKnown, histMax(p));
}

/**
 * A snapshot. Only the joined door's own holder, as host (`hostWords` = the door joined), counts: it may move the epoch by
 * one at most (a change of host moves it by exactly one; a bigger jump is refused), and it clears every failover banner, the
 * redirect, `hostFailed` and `awaiting`. A snapshot a backup door forwards (another host's words) only shows a newcomer the
 * room before it reaches the host; it changes nothing else (never this device's own door, never the election).
 */
export function applySnapshot(p, s, now) {
  if (s.hostWords !== p.joinedWords) {
    if (p.snap || p.awaiting) return;
    p.hostName = s.hostName;
    p.media = s.media;
    mergeChat(p, s.chat, now);
    return;
  }
  if (s.epoch < p.epoch || (p.epoch > 0 && s.epoch > p.epoch + 1)) return;
  if (s.epoch === p.epoch && s.seq <= p.snapSeq && s.hostWords === p.hostWords) return;
  const newHost = p.hostWords && (s.hostWords !== p.hostWords || s.epoch !== p.epoch);
  // Another host's clock: its offset is learned again (the old samples would be off by the two hosts' difference).
  if (newHost) p.skew = [];
  p.epoch = s.epoch;
  p.snapSeq = s.seq;
  p.hostName = s.hostName;
  p.hostWords = s.hostWords;
  p.maxKnown = Math.max(p.maxKnown, s.maxCseq);
  p.roster = s.members;
  p.backups = s.backups;
  p.want = s.want;
  p.media = s.media;
  p.snap = s;
  p.view = { members: s.members, backups: s.backups, epoch: s.epoch };
  p.snapAt = now;
  p.lastOkAt = now;
  p.skew = observeSkew(p.skew, now - s.state.at);
  if (!p.st || newHost || s.state.at >= p.st.at) { p.st = s.state; p.stAt = now; }
  mergeChat(p, s.chat, now);
  const mine = rosterOf(p, p.me.mid);
  if (mine) p.myJs = mine.js;
  if (mine && mine.role === "display") p.me.of = mine.of;
  if (p.banner && ["newHost", "noAnswer", "hostAway", "dropped", "cantCheck", "waitOthers", "takeOver", "lost", "redirect"].includes(p.banner.kind)) p.banner = null;
  p.redirect = null;
  p.awaiting = null;
  p.hostFailed = false;
  p.gone = [];
  if (newHost) note(p, now, `${displayName(s.hostName)} es el anfitrión`, `${displayName(s.hostName, true)} is the host`);
}

/** The guest's periodic work: say its tab is open, publish its backup door, ask for missing chat (giving a gap up after a `gone` or three tries), say when the host is silent. */
export function guestTick(p, ctx, now) {
  const fromHost = p.snap && p.snap.hostWords === p.joinedWords && !p.awaiting;
  if (p.handle && fromHost && now - p.hereAt >= LIMITS.hereEveryMs) { enqueue(p, "joined", { t: "here" }); p.hereAt = now; }
  if (p.hostFailed && now - p.hostFailedAt >= LIMITS.hostFailedMs) p.hostFailed = false;
  if (p.myWords && fromHost && p.want.includes(p.me.mid) && p.backups[p.me.mid] !== p.myWords && now - p.backupAt >= LIMITS.backupPublishMs && now - p.backupSentAt >= 15000) {
    enqueue(p, "joined", { t: "backup", words: p.myWords });
    p.backupSentAt = now;
  }
  // A door the host itself does not want (any more) is closed, and the host told. Only the host's own snapshot decides it.
  if (p.myWords && fromHost && !p.hostFailed && !p.want.includes(p.me.mid) && now - p.backupAt > 20000) p.closeHosted = true;
  const mine = histMax(p);
  if (fromHost && mine > 0 && now - p.needAt >= LIMITS.needEveryMs * 2 ** Math.min(4, p.lastNeed ? p.lastNeed.tries - 1 : 0)) {
    let gap = firstGap(p.hist, p.oldest, p.holes);
    if (!gap && p.maxKnown > mine && Math.floor(p.maxKnown / LIMITS.epochSpan) === Math.floor(mine / LIMITS.epochSpan) && !inHole(p.holes, mine + 1)) gap = { from: mine + 1, to: p.maxKnown };
    if (gap) {
      const from = Math.max(gap.from, p.oldest);
      const same = p.lastNeed && p.lastNeed.from === from && p.lastNeed.to === gap.to;
      const tries = same ? p.lastNeed.tries + 1 : 1;
      if (tries > LIMITS.needMaxTries) p.holes = [...p.holes, [from, gap.to]].slice(-LIMITS.holes); // given up: never asked again
      else {
        enqueue(p, "joined", { t: "need", from, to: gap.to });
        p.lastNeed = { from, to: gap.to, tries };
        p.needAt = now;
      }
    }
  }
  // The host silent: while its door still answers (its Kino in the background closed its tab, nothing more), a soft notice for
  // up to LIMITS.awayMaxMs, with no retry and no failover; then, or at once when the door itself does not answer, noAnswer.
  const silentFor = now - p.lastOkAt;
  if (!p.handle || p.awaiting || silentFor <= LIMITS.noAnswerMs) {
    if (p.banner && p.banner.kind === "hostAway") p.banner = null;
  } else if (p.doorUp && silentFor <= LIMITS.awayMaxMs) {
    if (!p.banner) p.banner = { kind: "hostAway" };
  } else if (!p.banner || p.banner.kind === "hostAway") p.banner = { kind: "noAnswer" };
}

// When the host is gone: electing and promoting the successor, a backup door's lobby, where a lost host may look.

import { LIMITS } from "../limits.js";
import { elect } from "./election.js";
import { hostHello } from "./host.js";
import { addMyMid, enqueue, histMax, note } from "./state.js";
import { readGuestMessage } from "../protocol/messages.js";
import { MID } from "../util/codes.js";
import { isObj, jsonBytes, scrubName } from "../util/text.js";

/**
 * The host is gone, on evidence that comes from its own door: its goodbye or Kino's `closed` event. The successor is elected
 * from the host's last snapshot: when it is this device, it hosts at once; anyone else sees one button to follow it.
 */
export function hostGone(p, now, why) {
  if (p.role !== "guest") return;
  p.hostFailed = true;
  p.hostFailedAt = now;
  const next = elect(p.view);
  const goneName = p.hostName;
  if (!next) { p.banner = { kind: "lost" }; return; }
  if (next.id === p.me.mid && p.myWords) { promote(p, now, goneName); return; }
  p.banner = { kind: "newHost", id: next.id, name: next.name, words: next.words, gone: goneName, why };
}

/** This device was elected: it hosts from its backup door, starting from the newest snapshot it has. */
export function promote(p, now, goneName = "") {
  p.oldView = p.view;
  p.role = "host";
  p.epoch += 1;
  p.hostName = p.me.name;
  p.hostWords = p.myWords;
  if (p.handle) p.closeJoined = p.handle;
  p.handle = null;
  p.myJs = p.myJs || 1;
  // Members re-join this door with new ids from Kino: the roster starts again with this device, in joining order after it.
  p.roster = [{ id: "host", name: p.me.name, js: p.myJs, role: "seat", of: null }];
  p.me.mid = "host";
  addMyMid(p, "host");
  p.nextJs = Math.max(p.myJs + 1, ...((p.view && p.view.members) || []).map((m) => m.js + 1));
  p.backups = {};
  p.want = [];
  p.maxCseq = Math.max(histMax(p), p.epoch * LIMITS.epochSpan);
  p.recovering = true;
  p.short = null; // the old short code points to the old host's door: this host asks for its own («Obtener un código»)
  p.shortError = false;
  p.hostFailed = false;
  p.awaiting = null;
  p.redirect = null;
  p.joinedWords = null;
  p.snapDue = true;
  p.forceState = "tick";
  p.banner = { kind: "youHost", gone: goneName, at: now };
  note(p, now, "Ahora eres el anfitrión", "You are the host now");
  // Members who already reached this door while it was a backup become members now.
  for (const [mid, hello] of Object.entries(p.lobbyHello)) hostHello(p, mid, hello, now);
  p.lobbyHello = {};
}

/** Where a host the room left behind may look: its last view plus the doors of members who left it. */
export function rejoinView(p) {
  const members = p.view ? p.view.members.slice() : [];
  const backups = p.view ? { ...p.view.backups } : {};
  for (const [id, d] of Object.entries(p.leftDoors || {})) {
    if (!members.some((m) => m.id === id)) members.push({ id, name: d.name, js: d.js, role: "seat", of: null });
    backups[id] = d.words;
  }
  return members.length ? { members, backups } : null;
}

/**
 * A guest's backup door. A newcomer there is pointed to the host and sees the room at once, but only while this device
 * itself hears its host (it never sends anyone back to a host it cannot reach); each member once, at most
 * LIMITS.lobbyPerWindow answers every 5 s. A member's hello is kept: if this device is the successor and could not reach the
 * host either, it asks its person whether to take over («Caro tampoco llega al anfitrión»): a hello alone never promotes.
 */
export function lobbyReceive(p, ev, now) {
  if (!isObj(ev) || typeof ev.from !== "string" || !MID.test(ev.from)) return;
  if (ev.kind === "join") {
    if (Object.keys(p.lobby).length >= LIMITS.maxMembers * 2) return;
    p.lobby[ev.from] = { name: scrubName(ev.name), at: now };
    const hearsHost = p.handle && !p.awaiting && !hostFailedNow(p, now) && now - p.lastOkAt < LIMITS.noAnswerMs;
    const recent = (p.lobbySentAt || []).filter((t) => now - t < 5000);
    if (hearsHost && !p.lobbySent[ev.from] && recent.length < LIMITS.lobbyPerWindow) {
      p.lobbySent = { ...p.lobbySent, [ev.from]: now };
      p.lobbySentAt = [...recent, now];
      if (p.hostWords && p.hostWords !== p.myWords) enqueue(p, "hosted", { t: "redirect", words: p.hostWords, name: p.hostName }, ev.from);
      if (p.snap) enqueue(p, "hosted", forwardSnapshot(p), ev.from);
    }
    return;
  }
  if (ev.kind === "leave") { delete p.lobby[ev.from]; delete p.lobbyHello[ev.from]; delete p.lobbySent[ev.from]; return; }
  if (ev.kind !== "msg") return;
  const m = readGuestMessage(ev.payload);
  if (!m || m.t !== "hello" || Object.keys(p.lobbyHello).length >= LIMITS.maxMembers) return;
  p.lobbyHello[ev.from] = { ...m, at: now };
  const next = elect(p.view);
  const name = (p.lobby[ev.from] && p.lobby[ev.from].name) || m.name;
  if (hostFailedNow(p, now) && next && next.id === p.me.mid && (!p.banner || ["cantCheck", "waitOthers", "noAnswer"].includes(p.banner.kind))) {
    p.banner = { kind: "takeOver", name };
  }
}

const hostFailedNow = (p, now) => p.hostFailed && now - p.hostFailedAt < LIMITS.hostFailedMs;

/** The newest snapshot this guest holds, forwarded as it is (the newcomer sees the room before it reaches the host). */
function forwardSnapshot(p) {
  const s = p.snap;
  const snap = {
    t: "snap", seq: s.seq, epoch: s.epoch, hostName: s.hostName, hostWords: s.hostWords, maxCseq: s.maxCseq,
    members: s.members.map((m) => ({ id: m.id, name: m.name, js: m.js, role: m.role, ...(m.role === "display" ? { of: m.of } : {}) })),
    backups: { ...s.backups }, want: s.want.slice(), ...(s.media ? { media: s.media } : {}), state: { ...s.state }, chat: s.chat.slice(),
  };
  while (jsonBytes(snap) > LIMITS.snapBytes && snap.chat.length) snap.chat.shift();
  return snap;
}

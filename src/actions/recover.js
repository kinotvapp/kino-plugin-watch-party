// Recovering a room: trying the host's door again, following the successor, looking for the room elsewhere.

import { dropShort, joinRoom, lost } from "./join.js";
import { both } from "../i18n/texts.js";
import { LIMITS } from "../limits.js";
import { promote, rejoinView } from "../party/failover.js";
import { pump } from "../transport/outbox.js";
import { toast } from "../ui/kit.js";

/**
 * «Reintentar» / «Entrar» after the host went silent or the room let this device go. First the host's own door, fresh: if it
 * answers, nothing happened to the host. Only if that fails are the doors tried in the election's order ([followCandidates]).
 */
export async function retryHost(k, p, ctx, now) {
  if (p.phase !== "party" || p.role !== "guest") return null;
  try {
    await joinRoom(k, p, p.hostWords, p.code, p.me.name, p.me.role, now);
    p.hostFailed = false;
    await pump(k.room, p, ctx, now);
    return toast(both("Volviste a la sala", "You are back in the room"), "success");
  } catch (e) {
    if (!lost(e)) throw e;
  }
  p.hostFailed = true;
  p.hostFailedAt = now;
  return followCandidates(k, p, ctx, now);
}

/**
 * The doors of the host's last snapshot, in the election's order. A door before this device that answers: this device waits
 * there for its holder to host (`awaiting`). When this device's own turn comes (every door before it failed), it hosts only on
 * proof that the failure is not its own connection: a member's hello at its door in the last two minutes, or a door after it
 * that answers. If nothing answers, it says so («Sin conexión con la sala») and marks nobody gone.
 */
export async function followCandidates(k, p, ctx, now) {
  const order = candidatesOf(p.view);
  for (let i = 0; i < order.length; i++) {
    const c = order[i];
    if (c.id === p.me.mid) {
      if (!p.myWords) continue;
      const hello = Object.values(p.lobbyHello).some((h) => now - (h.at || 0) < LIMITS.helloProofMs);
      let proof = hello;
      for (const o of order.slice(i + 1)) {
        if (proof) break;
        try {
          const probe = await k.room.join({ words: o.words, code: p.code, name: p.me.name || undefined });
          try { await k.room.close({ session: probe.handle }); } catch (x) { /* gone */ }
          proof = true;
        } catch (e) {
          if (!lost(e)) throw e;
        }
      }
      if (proof) {
        if (p.handle) p.closeJoined = p.handle;
        p.handle = null;
        promote(p, now, p.hostName);
        await pump(k.room, p, ctx, now);
        return toast(both("Ahora eres el anfitrión", "You are the host now"), "success");
      }
      p.banner = order.length > i + 1 ? { kind: "cantCheck" } : { kind: "waitOthers" };
      return null;
    }
    try {
      await joinRoom(k, p, c.words, p.code, p.me.name, p.me.role, now);
      p.awaiting = { id: c.id, name: c.name, words: c.words };
      p.banner = null;
      await pump(k.room, p, ctx, now);
      return null;
    } catch (e) {
      if (!lost(e)) throw e;
    }
  }
  p.banner = { kind: "cantCheck" };
  return null;
}

/** The election's order over a view: the seats holding a door, lowest joining order first, never the host. */
export function candidatesOf(view) {
  if (!view) return [];
  return view.members
    .filter((m) => m.role === "seat" && m.id !== "host" && view.backups[m.id])
    .sort((a, b) => a.js - b.js || (a.id < b.id ? -1 : 1))
    .map((m) => ({ id: m.id, name: m.name, words: view.backups[m.id], js: m.js }));
}

/**
 * «Buscar la sala»: a host left alone tries the doors of the members who left, in the election's order, keeping its own room.
 * The first door that answers is the predicted successor (the ones before it did not answer). What it finds is only shown.
 */
export async function findRoom(k, p, now) {
  if (p.role !== "host" || p.probe) return null;
  const view = rejoinView(p);
  const doors = candidatesOf(view);
  for (const d of doors) {
    try {
      const joined = await k.room.join({ words: d.words, code: p.code, name: p.me.name || undefined });
      p.probe = { handle: joined.handle, mid: joined.memberId, words: d.words, at: now, predicted: true };
      p.cursors.probe = 0;
      if (p.banner && p.banner.kind === "alone") p.banner = null;
      return toast(both("Buscando la sala…", "Looking for the room…"));
    } catch (e) {
      if (!lost(e)) throw e;
    }
  }
  p.aloneSince = 0;
  p.realLeftAt = 0;
  p.leftDoors = {};
  if (p.banner && p.banner.kind === "closedMine") {
    await dropShort(k, p); // the room is over: its code too
    p.banner = { kind: "ended" };
    return toast(both("No hay otra puerta: tu sala terminó", "There is no other door: your room is over"), "warning");
  }
  p.banner = null;
  return toast(both("No encontramos otra puerta: tu sala sigue abierta aquí", "No other door answered: your room is still open here"));
}

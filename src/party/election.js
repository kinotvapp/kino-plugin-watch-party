// Failover's deterministic parts: which seats keep a backup door and who succeeds the host (pure).

import { LIMITS } from "../limits.js";

/** The seats that should hold a backup door: the oldest LIMITS.backups by joinedSeq, the host left out. */
export function wantedBackups(roster) {
  return roster.filter((m) => m.role === "seat" && m.id !== "host").sort((a, b) => a.js - b.js || (a.id < b.id ? -1 : 1)).slice(0, LIMITS.backups).map((m) => m.id);
}

/**
 * The deterministic election: among a snapshot's members (Kino's ids at that host), the seat with the lowest joinedSeq that
 * holds a backup door, never the host and never anyone known gone. Every member computes the same answer from the same snapshot.
 */
export function elect(view, gone = []) {
  if (!view) return null;
  const c = view.members
    .filter((m) => m.role === "seat" && m.id !== "host" && !gone.includes(m.id) && view.backups[m.id])
    .sort((a, b) => a.js - b.js || (a.id < b.id ? -1 : 1))[0];
  return c ? { id: c.id, name: c.name, words: view.backups[c.id], js: c.js } : null;
}

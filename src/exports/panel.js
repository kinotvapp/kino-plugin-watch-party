// `panel` and `playerEvent` at a given time: load the party, run a round of room work, correct the player, draw.

import { LIMITS } from "../limits.js";
import { correction } from "../party/correction.js";
import { histMax } from "../party/state.js";
import { pump } from "../transport/outbox.js";
import { loadParty, saveParty } from "../transport/storage.js";
import { tabOf, view } from "../ui/view.js";
import { isObj } from "../util/text.js";

export const io = () => kino;
export const logOf = (k) => (k.log && typeof k.log.warn === "function" ? (line) => k.log.warn(line) : null);

/** `panel(context)` at time [now] (the export below passes the clock; tests pass their own). */
export async function panelAt(ctx, now) {
  const k = io();
  const p = loadParty(k.storage);
  if (p.phase === "party" || p.link) {
    try { await pump(k.room, p, ctx, now); } catch (e) { /* a room hiccup never breaks the tab */ }
  }
  if (p.phase === "party" && tabOf(ctx) === "chat") p.chatSeen = histMax(p); // what the Chat tab shows now is read
  const player = correction(p, ctx, now);
  saveParty(k.storage, p, now, logOf(k));
  return view(p, ctx, now, player);
}

/** `playerEvent(event, context)` at [now]: the host tells the room at once; a guest notices it paused or resumed by itself. */
export async function playerEventAt(event, ctx, now) {
  const k = io();
  const p = loadParty(k.storage);
  if (p.phase !== "party" || !isObj(event)) return null;
  const type = event.type;
  if (p.role === "host" && ["paused", "resumed", "started"].includes(type)) {
    p.forceState = type === "paused" ? "pause" : type === "resumed" ? "resume" : "start";
    try { await pump(k.room, p, { ...ctx, paused: type === "paused" ? true : type === "resumed" ? false : ctx.paused }, now); } catch (e) { /* next tick */ }
  } else if (p.role === "guest" && (type === "paused" || type === "resumed") && p.follow) {
    const paused = type === "paused";
    const ours = p.expect && p.expect.paused === paused && now - p.expect.at < LIMITS.holdMatchMs;
    if (!ours && p.st && p.st.paused !== paused) p.hold = true;
    p.expect = null;
  }
  saveParty(k.storage, p, now, logOf(k));
  return null;
}

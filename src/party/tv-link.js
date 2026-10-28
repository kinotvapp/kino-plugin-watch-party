// The TV's one-use link endpoint: the phone's `link` message tells the TV which room to join.

import { readLinkMessage } from "../protocol/messages.js";
import { isObj } from "../util/text.js";

/** One event of the TV's link endpoint: only the first valid `link` counts; then the endpoint is closed (one use). */
export function linkReceive(p, ev, now) {
  if (!p.link || p.link.used || !isObj(ev) || ev.kind !== "msg") return;
  if (now > p.link.exp) return;
  const m = readLinkMessage(ev.payload);
  if (!m) return;
  p.link = { ...p.link, used: true };
  p.closeHosted = true;
  p.pending = { words: m.words, code: m.code, name: m.name, pair: m.pair };
  if (p.phase === "party") return; // a new phone for a TV already in the party: the pairing goes with the next hello
  p.banner = { kind: "linked", name: m.name };
}

// The single-purpose recovery screens (waiting, dropped, a new host to follow, the room over).

import { both, T, tx } from "../i18n/texts.js";
import { partyBanner } from "./banners.js";
import { Btn, Text } from "./kit.js";

/** A recovery screen's content: the explanation in ordinary text, one ordinary button, and «Salir de la sala». */
export function recoveryNodes(p, now) {
  const b = partyBanner(p, now);
  const out = [];
  const leave = { confirm: T.leaveConfirm[0], confirmEn: T.leaveConfirm[1] };
  // The one way on is always «btnRecover», the first control (the D-pad lands there); «Salir de la sala» after it, unless
  // leaving is that way on (the room is over).
  const leaves = Boolean(b && b.action && b.action.onTap === "leave");
  if (b) {
    out.push(Text(both(b.text, b.textEn), { style: "p" }));
    if (b.action) out.push(Btn("ElevatedButton", both(b.action.label, b.action.labelEn), b.action.onTap, { key: "btnRecover", autofocus: true, ...(leaves ? leave : {}) }));
  }
  if (!leaves) out.push(Btn("TextButton", tx("leave"), "leave", { key: "btnLeave", ...leave }));
  return out;
}

/** Whether the room view is a single-purpose recovery screen (waiting, dropped, a new host to follow, the room over…). */
export function recoveryScreen(p) {
  if (p.awaiting) return true;
  return Boolean(p.banner && ["newHost", "lost", "redirect", "dropped", "noAnswer", "cantCheck", "waitOthers", "takeOver", "moved", "closedMine", "ended", "linked"].includes(p.banner.kind));
}

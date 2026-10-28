// Presses that wait on the room: their hidden progress rows, the tap that shows one, and the answers that settle them.

import { isObj } from "../util/text.js";

/**
 * Presses that wait on the room (`room.open` / `room.join`, a few seconds through the tunnel): the hidden progress row the tap
 * shows at once, and the button it disables against a second tap. The answer to the event hides the row and enables the
 * button again, success or failure.
 */
export const BUSY_ROWS = {
  busyCreate: ["Creando la sala…", "Creating the room…"],
  busyJoin: ["Uniéndose a la sala…", "Joining the room…"],
  busySearch: ["Buscando la sala…", "Looking for the room…"],
  busyDoor: ["Abriendo la puerta de respaldo…", "Opening the backup door…"],
  busyLink: ["Preparando el código para el teléfono…", "Preparing the code for the phone…"],
  busyTv: ["Vinculando el televisor…", "Linking the TV…"],
  busyShort: ["Creando el código…", "Creating the code…"],
  busySync: ["Sincronizando…", "Syncing…"],
};
export const BUSY = {
  create: { label: "busyCreate", button: "btnCreate" },
  join: { label: "busyJoin", button: "btnJoin" },
  joinShort: { label: "busyJoin", button: "btnJoinShort" },
  lookupShort: { label: "busySearch", button: "btnLookup" },
  wordsNext: { label: "busyJoin", button: "btnWordsNext" },
  readInvite: { label: "busyJoin", button: "btnReadInvite" },
  joinTarget: { label: "busyJoin", button: "btnJoinTarget" },
  shortCode: { label: "busyShort", button: "btnShort" },
  scanJoin: { label: "busyJoin", button: "btnScan" },
  redirect: { label: "busyJoin" },
  followHost: { label: "busyJoin" },
  retryHost: { label: "busyJoin" },
  enterParty: { label: "busyJoin" },
  joinMoved: { label: "busyJoin" },
  findRoom: { label: "busySearch", button: "btnFind" },
  openBackup: { label: "busyDoor", button: "btnBackup" },
  linkStart: { label: "busyLink", button: "btnLink" },
  addDevice: { label: "busyTv", button: "btnAddDevice" },
  sync: { label: "busySync", button: "btnSync" },
  resync: { label: "busySync" },
};

/** The progress row of [event]: its own, placed right after the button (or banner) that triggers it. */
export const waitKey = (event) => `busy.${event}`;

/** The tap of a press that waits: its own progress row shown and the button disabled at once (Kino's own ui operations), then the event. */
export function busyTap(event) {
  const b = BUSY[event];
  return { ui: [{ show: waitKey(event) }, ...(b.button ? [{ disable: b.button }] : [])], event };
}

/** The ui operations an answer to [event] carries: its row (and the error's retry row) hidden, the button enabled again. */
export function settle(event) {
  const b = BUSY[event];
  return b ? [{ hide: waitKey(event) }, { hide: waitKey("retry") }, ...(b.button ? [{ enable: b.button }] : [])] : [];
}

/** A failed press that waits: the error shown in place (Kino's panel state) with a retry of the same press. */
// A failed press: the error in place and, when it can be retried, the D-pad on «Reintentar» (withFocus falls back to the
// view's first control when there is none, e.g. a recovery screen whose own button is the retry).
// A typing mistake: the error in place, no retry (the D-pad goes back to the field).
export const invalid = (t) => ({ state: { error: { es: t.es, en: t.en, retry: null } } });
export const failed = (event, t) => ({ state: { error: { es: t.es, en: t.en, retry: BUSY[event] ? event : null } }, ...(BUSY[event] ? { focus: "btnRetry" } : {}) });

/** A hidden progress row with one label (Kino's progress draws it; screen readers read it). */
function waitRow(key, label) {
  const [es, en] = BUSY_ROWS[label];
  return {
    type: "Row", key, hidden: true, gap: 8, crossAxisAlignment: "center",
    children: [{ type: "LinearProgressIndicator", labelText: es, labelTextEn: en, flex: 1 }],
  };
}

/** The busy key a node's own tap shows (a button's onPressed, a banner's action, a form's onSubmitted), if any. */
function shownBusy(n) {
  const tap = n.onPressed || n.onTap || n.onSubmitted || (n.action && n.action.onTap);
  if (!isObj(tap) || !Array.isArray(tap.ui)) return null;
  const show = tap.ui.find((op) => isObj(op) && typeof op.show === "string" && op.show.startsWith("busy."));
  return show ? { key: show.show, event: tap.event } : null;
}

/**
 * Puts each waiting press's progress row right after its trigger, in the same list (so it shows where the person is looking,
 * even in a scrolled panel); a trigger inside a Row gets its row right after that Row. [labelFor] picks the row's label.
 */
export function addWaitRows(node, labelFor, seen = new Set()) {
  if (!isObj(node)) return node;
  const kids = Array.isArray(node.children) ? node.children : null;
  if (!kids) return node;
  const inRow = node.type === "Row";
  const out = [];
  for (const c of kids) {
    out.push(addWaitRows(c, labelFor, seen));
    if (inRow) continue; // the Row's parent places them
    const own = shownBusy(c);
    const inside = c.type === "Row" && Array.isArray(c.children) ? c.children.map(shownBusy).filter(Boolean) : [];
    for (const b of [...(own ? [own] : []), ...inside]) {
      if (seen.has(b.key)) continue;
      seen.add(b.key);
      out.push(waitRow(b.key, labelFor(b.event)));
    }
  }
  return { ...node, children: out };
}

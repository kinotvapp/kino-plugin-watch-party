// `panelAction` at a given time, and where the D-pad goes after an answer (`withFocus`).

import { act } from "../actions/act.js";
import { io, logOf } from "./panel.js";
import { errorText } from "../i18n/texts.js";
import { loadParty, saveParty } from "../transport/storage.js";
import { BUSY, failed, settle } from "../ui/busy.js";
import { toast } from "../ui/kit.js";
import { view } from "../ui/view.js";
import { isObj, scrubName } from "../util/text.js";

/** `panelAction(event, context)` at [now]: the person's presses. Every room call that needs a press happens here. */
export async function panelActionAt(event, ctx, now) {
  const k = io();
  const p = loadParty(k.storage);
  if (!p.cursors) p.cursors = { joined: 0, hosted: 0 };
  const values = isObj(event && event.values) ? event.values : {};
  const name = scrubName(typeof values.myName === "string" ? values.myName : p.me.name);
  const name0 = event && typeof event.name === "string" ? event.name : "";
  let answer = null;
  try {
    answer = await act(k, p, event || {}, ctx, values, name, now);
    if (BUSY[name0] && !(answer && answer.state && answer.state.error)) answer = { ...(answer || {}), state: { ...((answer && answer.state) || {}), error: null } };
  } catch (e) {
    answer = BUSY[name0] ? failed(name0, errorText(e)) : toast(errorText(e), "error");
  }
  saveParty(k.storage, p, now, logOf(k));
  if (BUSY[name0]) answer = { ...(answer || {}), ui: [...settle(name0), ...((answer && answer.ui) || [])].slice(0, 8) };
  return withFocus(answer, p, ctx, now);
}

/**
 * Every answer that changes what is on screen names where the D-pad goes next (`focus`), a control that exists in the tree it
 * leads to: the one it asked for when it is there, else the first useful control of the new view (its field, else its primary
 * button), so focus is never lost when the pressed control disappears (a step change, a loading done, an error, a room joined).
 */
export function withFocus(answer, p, ctx, now) {
  if (!isObj(answer) || answer.close) return answer;
  const merged = { ...(isObj(ctx && ctx.state) ? ctx.state : {}) };
  if (isObj(answer.state)) for (const [key, v] of Object.entries(answer.state)) { if (v === null) delete merged[key]; else merged[key] = v; }
  const tree = view(p, { ...ctx, features: ["screen"], state: merged, tab: merged.tab || ctx.tab }, now);
  const keys = focusables(tree.root || { children: [] });
  if (!keys.length) return answer;
  const fields = focusFields(tree.root || { children: [] });
  const want = typeof answer.focus === "string" && keys.includes(answer.focus) ? answer.focus : fields[0] || keys[0];
  return { ...answer, focus: want };
}

/** The keyed text fields of a tree, in reading order. */
function focusFields(root) {
  const out = [];
  const walk = (n) => {
    if (!isObj(n)) return;
    if (typeof n.key === "string" && !n.hidden && n.type === "TextField") out.push(n.key);
    for (const c of Array.isArray(n.children) ? n.children : []) walk(c);
  };
  walk(root);
  return out;
}

/** The keyed controls of a tree in reading (D-pad) order: fields, buttons and switches (never a progress row). */
export function focusables(root) {
  const out = [];
  const walk = (n) => {
    if (!isObj(n)) return;
    if (typeof n.key === "string" && !n.key.startsWith("busy.") && !n.hidden && (["TextField", "ElevatedButton", "TextButton", "Button", "IconButton", "Switch"].includes(n.type) || (n.type === "Card" && n.onTap))) out.push(n.key);
    for (const c of Array.isArray(n.children) ? n.children : []) walk(c);
    if (Array.isArray(n.items)) for (const c of n.items) walk(c);
  };
  walk(root);
  return out;
}

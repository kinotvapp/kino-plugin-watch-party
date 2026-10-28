// The Chat tab: bubbles, runs per person, notes, the input and the reactions.

import { both, T, tx } from "../i18n/texts.js";
import { EMOJIS, LIMITS } from "../limits.js";
import { displayName } from "../party/state.js";
import { skewOf } from "../protocol/playback.js";
import { busyTap } from "./busy.js";
import { Action, Banner, isTv, Text } from "./kit.js";
import { linkNodes } from "./link-qr.js";

/** Whether a chat entry is this device's own (a member id it had, or the room it hosts now under its own name). */
export function isMine(p, e) {
  return p.myMids.includes(e.by) || (p.role === "host" && e.by === "host" && e.n === p.me.name);
}

/** One message's bubble: mine filled with the primary colour, the others' a filled (neutral) card; a reaction is a glyph. */
/**
 * One message's bubble, at most three quarters of the list's width and as wide as its text: mine in the primary container
 * colour, the others' in the neutral surface variant (the text inside takes the matching colour), with a smaller corner on
 * the sender's side at the bottom (the tail). A reaction is the glyph alone, clearly large (h2; h3 on a TV).
 */
function bubble(e, mine, tv) {
  if (e.k === "emoji") return Text(both(e.x, e.x), { style: tv ? "h3" : "h2" });
  return {
    type: "Card", padding: { x: 12, y: 8 }, maxWidthFraction: 0.75,
    color: mine ? "primaryContainer" : "surfaceVariant",
    borderRadius: { topStart: "large", topEnd: "large", bottomStart: mine ? "large" : "small", bottomEnd: mine ? "small" : "large" },
    children: [Text(both(e.x, e.x))],
  };
}

/** When a chat entry was sent, on this device's clock (the host stamps it; a guest adds its measured offset). */
const localAt = (p, e) => e.at + (p.role === "guest" ? skewOf(p.skew || []) : 0);

/**
 * The messages as a chat: one item per run of consecutive entries from the same person. Mine sit on the right (the group
 * aligned to the end), the others' on the left with the name and when the run started once above it («Bea · hace 2 min»,
 * written by Kino); the newest run of mine ends with its time. The newest at the bottom, the list sticking there (Kino's
 * «↓ Nuevos» when the person reads older lines); then this device's messages still on their way, and the recent room notes
 * as small centred lines.
 */
function chatList(p, now, ctx) {
  const entries = p.hist.slice(-(isTv(ctx) ? LIMITS.shownTv : LIMITS.shown));
  const groups = [];
  for (const e of entries) {
    const last = groups.at(-1);
    if (last && last.by === e.by) last.entries.push(e);
    else groups.push({ by: e.by, mine: isMine(p, e), entries: [e] });
  }
  const side = (mine) => ({ crossAxisAlignment: mine ? "end" : "start" });
  const caption = { style: "caption", color: "muted" };
  const items = groups.map((g, gi) => ({
    type: "Column", key: "g" + g.entries[0].c, fill: true, gap: 4, ...side(g.mine),
    children: [
      ...(g.mine ? [] : [{ type: "Text", text: `${displayName(g.entries[0].n)} · `, textEn: `${displayName(g.entries[0].n, true)} · `, time: localAt(p, g.entries[0]), ...caption }]),
      ...g.entries.map((e) => bubble(e, g.mine, isTv(ctx))),
      ...(g.mine && gi === groups.length - 1 ? [{ type: "Text", time: localAt(p, g.entries.at(-1)), ...caption }] : []),
    ],
  }));
  const pending = pendingOwn(p, now);
  if (pending.length) {
    items.push({
      type: "Column", key: "pending", fill: true, gap: 4, ...side(true),
      children: [
        ...pending.map((m) => ({ type: "Card", variant: "outlined", borderRadius: "large", padding: { x: 12, y: 8 }, maxWidthFraction: 0.75, children: [Text(both(m.x, m.x))] })),
        Text(both("Enviando…", "Sending…"), { style: "caption", color: "muted" }),
      ],
    });
  }
  p.notes.filter((n) => now - n.at < 20000).slice(-2).forEach((n, i) => {
    items.push(Text(both(n.es, n.en), { key: "note" + i, style: "caption", color: "muted", fill: true, crossAxisAlignment: "center" }));
  });
  return { type: "ListView", key: "chat", flex: 1, stickToBottom: true, newItemsHint: true, gap: 8, items, empty: Text(tx("empty"), { color: "muted" }) };
}

/**
 * The chat, top to bottom: what just happened (a reaction, notes), the messages (newest at the bottom, the part that scrolls),
 * the 8 reactions (hidden until the emoji button opens them; they close after one is sent), and the input row: the text field,
 * the emoji button and «Enviar». A TV's display seat can only react: its reactions are shown directly, with no input row.
 */
export function chatTab(p, now, ctx) {
  const display = p.me.role === "display";
  const children = [];
  if (p.stuck) children.push(Text(both("No logramos alcanzar al anfitrión: tu video tarda en cargar.", "We cannot catch up with the host: your video is slow to load."), { style: "caption", color: "warning" }));
  else if (p.correctedTo !== null && now - p.correctedAt < 8000) children.push(Text(both(`Ajustado al anfitrión: ${clockText(p.correctedTo)}`, `Moved to the host: ${clockText(p.correctedTo)}`), { style: "caption", color: "muted" }));
  children.push(chatList(p, now, ctx));
  // The reactions: each a pressable card around a large glyph (h3; h4 on a TV), at least 48 dp tall, two lines of four. The
  // index travels in the action itself (with an action object Kino reads `arg` from it, never from the node). A TV's display
  // seat (no input, reactions are all it sends) shows them in place; everyone else gets them as a popover over the input row,
  // anchored to the emoji toggle: it takes no room from the list, and a reaction sent closes it (Back or a tap outside too).
  const glyphs = (close) => ({
    type: "Row", wrap: true, gap: 4,
    children: EMOJIS.map((e, i) => ({
      type: "Card", key: "emoji" + i, variant: "outlined", span: 3, minHeight: 48, padding: 4, crossAxisAlignment: "center",
      onTap: close ? { ui: [{ close: "emojiPalette" }], event: "emoji", arg: String(i) } : { event: "emoji", arg: String(i) },
      children: [Text(both(e, e), { style: isTv(ctx) ? "h4" : "h3" })],
    })),
  });
  if (display) children.push({ ...glyphs(false), key: "emojiPalette" });
  else children.push({ type: "BottomSheet", key: "emojiPalette", anchor: "emojiToggle", children: [glyphs(true)] });
  if (!display) {
    // The field sends on the keyboard's own action (onSubmitted) and on its own send icon inside the field (onTrailingTap; its
    // label is for screen readers); beside it, the emoji toggle, icon-only. On a TV the send icon is its own D-pad stop:
    // field, then send, then emoji.
    children.push({
      type: "Row", key: "inputRow", gap: isTv(ctx) ? 4 : 0, crossAxisAlignment: "center",
      children: [
        {
          type: "TextField", key: "chatText", labelText: T.message[0], labelTextEn: T.message[1], maxLength: LIMITS.textChars, onSubmitted: "send", flex: 1,
          trailingIcon: "send", trailingLabel: "Enviar", trailingLabelEn: "Send", onTrailingTap: "send",
        },
        { type: "IconButton", key: "emojiToggle", icon: "mood", labelText: "Emojis", labelTextEn: "Emoji", onPressed: { ui: [{ open: "emojiPalette" }] } },
      ],
    });
  } else if (p.link && !p.link.used) {
    children.push(...linkNodes(p));
  } else if (!p.me.of) {
    children.push(Banner("info", both("Sin teléfono vinculado: solo reacciones", "No phone linked: reactions only"), Action(tx("linkStart"), busyTap("linkStart"))));
  }
  return children;
}

/** This guest's own messages the host has not echoed yet (dropped after 20 s). */
function pendingOwn(p, now) {
  return p.pendingMine.filter((m) => now - m.at < 20000 && !p.hist.some((e) => p.myMids.includes(e.by) && e.k === "msg" && e.x === m.x && e.at >= m.at - 60000));
}

function clockText(ms) {
  const s = Math.floor(ms / 1000);
  const two = (n) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

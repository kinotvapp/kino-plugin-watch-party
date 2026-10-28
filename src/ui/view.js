// The tab's whole result: the tab chosen, the header row, the wizard, the room view or a recovery screen, the legacy panel.

import { both, T, tx } from "../i18n/texts.js";
import { LIMITS } from "../limits.js";
import { displayName } from "../party/state.js";
import { mediaMatch } from "../protocol/media.js";
import { matchBanner, partyBanner } from "./banners.js";
import { addWaitRows, BUSY, busyTap } from "./busy.js";
import { chatTab, isMine } from "./chat-tab.js";
import { errorNodes } from "./errors.js";
import { Action, Banner, Btn, Text } from "./kit.js";
import { recoveryNodes, recoveryScreen } from "./recovery.js";
import { roomTab } from "./room-tab.js";
import { idleNodes } from "./wizard.js";
import { isObj } from "../util/text.js";

/** The room view's tab this context asks for: Kino's tab choice, else the one the plugin state remembers; the chat by default. */
export function tabOf(ctx) {
  const asked = ctx.tab === "room" || ctx.tab === "chat" ? ctx.tab : isObj(ctx.state) ? ctx.state.tab : null;
  return asked === "room" ? "room" : "chat";
}

/** The tab's result (screen format), or the legacy panel when Kino's plugin screens are off. */
export function view(p, ctx, now, player = null) {
  const features = Array.isArray(ctx.features) ? ctx.features : [];
  if (!features.includes("screen")) return { title: T.title[0], titleEn: T.title[1], elements: [{ type: "text", text: T.noScreens[0], textEn: T.noScreens[1] }] };
  const inRoom = p.phase === "party";
  const base = { format: "screen", title: T.title[0], titleEn: T.title[1], ...(inRoom || p.link ? { refreshMs: LIMITS.refreshMs } : {}), ...(player ? { player } : {}) };
  const errNow = isObj(ctx.state) && isObj(ctx.state.error) ? ctx.state.error : null;
  const labelFor = (event) => {
    const ev = BUSY[event] ? event : errNow && BUSY[errNow.retry] ? errNow.retry : null;
    if (ev === "lookupShort" && p.me.name) return "busyJoin"; // with a saved name the lookup joins at once
    return ev ? BUSY[ev].label : "busyJoin";
  };
  const done = (result) => ({ ...result, root: addWaitRows(result.root, labelFor) });
  if (!inRoom) {
    return done({ ...base, root: { type: "Column", gap: 8, padding: 8, children: [...errorNodes(ctx), ...idleNodes(p, ctx)] } });
  }
  const top = errorNodes(ctx, !recoveryScreen(p));
  // In-room recovery (the host left, this device was dropped, waiting at the successor's door…): a screen of its own with the
  // explanation, ONE primary button (the banner's) and «Salir de la sala»; no inputs, no tabs.
  if (isObj(ctx.state) && ctx.state.renaming === true && !recoveryScreen(p)) {
    return done({
      ...base,
      root: {
        type: "Column", gap: 8, padding: 8,
        children: [
          Text(both("¿Cómo te llamas?", "What's your name?"), { style: "h5" }),
          { type: "TextField", key: "myName", labelText: T.yourName[0], labelTextEn: T.yourName[1], maxLength: LIMITS.nameChars, value: p.me.name },
          Btn("ElevatedButton", both("Guardar", "Save"), "rename", { key: "btnRenameSave" }),
          Text(both("Se usa en esta sala y en las próximas.", "It is used in this room and the next ones."), { style: "caption", color: "muted" }),
          Btn("TextButton", tx("back"), { event: "renameClose" }, { key: "btnBack" }),
        ],
      },
    });
  }
  if (recoveryScreen(p)) {
    return done({
      ...base,
      root: { type: "Column", gap: 8, padding: 8, children: [...top, ...recoveryNodes(p, now)] },
    });
  }
  const tab = tabOf(ctx);
  // Messages from the others since the Chat tab last showed: a count on that tab while the Sala tab is open.
  const unread = tab === "room" ? p.hist.filter((e) => e.c > (p.chatSeen || 0) && !isMine(p, e)).length : 0;
  const head = [headerRow(p, ctx)];
  const pb = partyBanner(p, now);
  if (pb) head.push(pb);
  if (p.hold && p.role === "guest") head.push(Banner("info", both("Pausaste o seguiste por tu cuenta: la sala sigue.", "You paused or resumed yourself: the room goes on."), Action(tx("resync"), "resync")));
  const mb = matchBanner(p, ctx);
  if (mb) head.push(mb);
  return done({
    ...base,
    tabs: [
      { id: "chat", label: T.chatTab[0], labelEn: T.chatTab[1], ...(unread ? { badge: { text: unread > 99 ? "99+" : String(unread) } } : {}) },
      { id: "room", label: T.roomTab[0], labelEn: T.roomTab[1] },
    ],
    tab,
    // The chat fills the panel: the messages take the room left and the input row stays at the bottom (above the keyboard).
    // The Sala tab scrolls as usual.
    ...(tab === "chat" ? { layout: "fill" } : {}),
    root: { type: "Column", gap: 8, padding: 8, children: [...top, ...head, ...(tab === "room" ? roomTab(p, ctx) : chatTab(p, now, ctx))] },
  });
}

/**
 * The room's header row: a short status on the left (who hosts, whether this guest watches the same), and for a guest the
 * «Sincronizar» icon on the right (its label is for screen readers; its progress row goes under this row).
 */
function headerRow(p, ctx) {
  const m = p.role === "guest" ? mediaMatch(ctx, p.media) : null;
  const count = p.roster.length;
  const status = p.role === "host"
    ? both(`Eres el anfitrión · ${count} ${count === 1 ? "persona" : "personas"}`, `You host · ${count} ${count === 1 ? "person" : "people"}`)
    : m && m.reason === "sameChannel"
      ? both(`Anfitrión: ${displayName(p.hostName)} · ✓ Mismo canal`, `Host: ${displayName(p.hostName, true)} · ✓ Same channel`)
      : both(`Anfitrión: ${displayName(p.hostName)}${m && m.ok ? " · ✓ Viendo lo mismo" : ""}`, `Host: ${displayName(p.hostName, true)}${m && m.ok ? " · ✓ Watching the same" : ""}`);
  return {
    type: "Row", key: "headerRow", gap: 4, crossAxisAlignment: "center",
    children: [
      Text(status, { style: "caption", flex: 1 }),
      ...(p.role === "guest" ? [{ type: "IconButton", key: "btnSync", icon: "sync", labelText: "Sincronizar", labelTextEn: "Sync", onPressed: busyTap("sync") }] : []),
    ],
  };
}

// Not in a room: the step-by-step create and join wizard, one decision per screen.

import { both, T, tx } from "../i18n/texts.js";
import { groupShort, normShort } from "../invite/short-code.js";
import { LIMITS } from "../limits.js";
import { displayName } from "../party/state.js";
import { busyTap } from "./busy.js";
import { Action, Banner, Btn, isTv, Text } from "./kit.js";
import { linkNodes } from "./link-qr.js";
import { normCode, normWords } from "../util/codes.js";
import { isObj } from "../util/text.js";

/**
 * Not in a room: a step-by-step wizard, one decision per screen (the step lives in Kino's panel state, `wizStep`).
 * - home: «Crear sala» and «Unirme a sala», nothing else.
 * - c1: «¿Cómo te llamas?» (the last name used) + «Crear sala» + «Atrás».
 * - j1: «Código de la sala» (5 digits) + «Siguiente» (asks the service) + the other ways in (phone: «Pegar invitación»,
 *   «Escanear QR»; TV: «Vincular con mi teléfono») + «Entrar con palabras y código» + «Atrás».
 * - j1b: the words and the room code + «Siguiente» + «Atrás»; jp (phones): paste an invitation + «Leer la invitación» + «Atrás».
 * - j2: «¿Cómo te llamas?» + «Entrar» + «Atrás» (to j1, the typed code kept): the name is asked after the code was checked.
 */
export const WIZ_STEPS = ["home", "c1", "j1", "j1b", "jp", "j2"];

/** The step shown: Kino's panel state says it; a TV never shows the paste step; j2 needs a checked target. */
export function wizStepOf(ctx) {
  const st = isObj(ctx && ctx.state) ? ctx.state : {};
  let step = WIZ_STEPS.includes(st.wizStep) ? st.wizStep : "home";
  if (step === "jp" && isTv(ctx)) step = "j1";
  if (step === "j2" && !targetOf(st.joinTarget)) step = "j1";
  return step;
}

/** A join target kept in the panel state between j1/j1b and j2, re-checked (the state comes back from Kino). */
export function targetOf(t) {
  if (!isObj(t)) return null;
  const words = normWords(t.words);
  const code = normCode(t.code);
  const short = t.short === undefined || t.short === null ? null : normShort(t.short);
  return words && code ? { words, code, short } : null;
}

const wizTo = (step) => ({ event: "wiz", arg: step });
const backTo = (step) => Btn("TextButton", tx("back"), wizTo(step), { key: "btnBack" });

export function idleNodes(p, ctx) {
  const st = isObj(ctx && ctx.state) ? ctx.state : {};
  const tv = isTv(ctx);
  if (p.pending) {
    return [Banner("success", both(`Teléfono vinculado: ${displayName(p.pending.name)}`, `Phone linked: ${displayName(p.pending.name, true)}`), Action(tx("enter"), busyTap("enterParty")))];
  }
  if (p.link && !p.link.used) return linkNodes(p);
  const step = wizStepOf(ctx);
  const heading = (t) => Text(t, { style: "h5" });
  switch (step) {
    case "c1":
      return [
        heading(both("¿Cómo te llamas?", "What's your name?")),
        { type: "TextField", key: "myName", labelText: T.yourName[0], labelTextEn: T.yourName[1], maxLength: LIMITS.nameChars, value: p.me.name },
        Btn("ElevatedButton", tx("create"), busyTap("create"), { key: "btnCreate" }),
        backTo("home"),
      ];
    case "j1":
      return [
        heading(both("Código de la sala", "Room code")),
        { type: "TextField", key: "joinShortCode", kind: "number", labelText: "Código (5 números)", labelTextEn: "Code (5 digits)", maxLength: 7, value: typeof st.shortTyped === "string" ? st.shortTyped : "" },
        Btn("ElevatedButton", both("Siguiente", "Next"), busyTap("lookupShort"), { key: "btnLookup" }),
        ...(tv
          ? [Btn("TextButton", tx("linkStart"), busyTap("linkStart"), { key: "btnLink" })]
          : [Btn("TextButton", both("Pegar invitación", "Paste invitation"), wizTo("jp"), { key: "btnPaste" }), Btn("TextButton", both("Escanear QR", "Scan QR"), busyTap("scanJoin"), { key: "btnScan" })]),
        Btn("TextButton", both("Entrar con palabras y código", "Join with words and code"), wizTo("j1b"), { key: "btnWords" }),
        backTo("home"),
      ];
    case "j1b":
      return [
        heading(both("Palabras y código de la sala", "The room's words and code")),
        { type: "TextField", key: "joinWords", labelText: T.words[0], labelTextEn: T.words[1], maxLength: tv ? 80 : 500 },
        { type: "TextField", key: "joinCode", ...(tv ? { kind: "number" } : {}), labelText: "Código de la sala", labelTextEn: "Room code", maxLength: tv ? 12 : 20 },
        Btn("ElevatedButton", both("Siguiente", "Next"), busyTap("wordsNext"), { key: "btnWordsNext" }),
        backTo("j1"),
      ];
    case "jp":
      return [
        heading(both("Pegar invitación", "Paste the invitation")),
        { type: "TextField", key: "joinPaste", labelText: "Pega aquí la invitación", labelTextEn: "Paste the invitation here", maxLength: 1000, multiline: true },
        Btn("ElevatedButton", both("Leer la invitación", "Read the invitation"), busyTap("readInvite"), { key: "btnReadInvite" }),
        ...(st.inviteError === true ? [Text(both("No encuentro las palabras o el código", "I cannot find the words or the code"), { color: "error" })] : []),
        backTo("j1"),
      ];
    case "j2": {
      const t = targetOf(st.joinTarget);
      const what = t.short ? both(`Código ${groupShort(t.short)}`, `Code ${groupShort(t.short)}`) : both(`Sala ${t.words}`, `Room ${t.words}`);
      return [
        heading(both("¿Cómo te llamas?", "What's your name?")),
        { type: "TextField", key: "myName", labelText: T.yourName[0], labelTextEn: T.yourName[1], maxLength: LIMITS.nameChars, value: p.me.name },
        Btn("ElevatedButton", tx("enter"), busyTap("joinTarget"), { key: "btnJoinTarget" }),
        Text(what, { style: "caption", color: "muted" }),
        backTo("j1"),
      ];
    }
    default:
      // A saved name: «Crear sala» creates at once (the name is asked only when there is none).
      return [
        Btn("ElevatedButton", tx("create"), p.me.name ? busyTap("create") : wizTo("c1"), { key: p.me.name ? "btnCreate" : "btnHomeCreate" }),
        Btn("ElevatedButton", both("Unirme a sala", "Join a room"), wizTo("j1"), { key: "btnHomeJoin" }),
      ];
  }
}

/** The control a step opens on (focus): its field, else its first button. */
export function wizFocus(step) {
  return { home: "btnHomeJoin", c1: "myName", j1: "joinShortCode", j1b: "joinWords", jp: "joinPaste", j2: "myName" }[step] || null;
}

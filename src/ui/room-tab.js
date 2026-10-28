// The Room tab (Sala): the room's line, the people, follow the host, backups, add a device, leave.

import { both, T, tx } from "../i18n/texts.js";
import { roomUrlOf } from "../invite/short-code.js";
import { displayName, memberRows } from "../party/state.js";
import { busyTap } from "./busy.js";
import { Btn, isTv, Text } from "./kit.js";
import { linkNodes } from "./link-qr.js";
import { roomLine } from "./room-line.js";
import { groupCode } from "../util/codes.js";

export function roomTab(p, ctx) {
  const rows = memberRows(p.roster);
  const children = [];
  const seat = p.me.role === "seat" && p.code;
  if (seat) children.push(...roomLine(p, ctx));
  if (p.role === "guest") children.push({ type: "Switch", key: "follow", value: p.follow, labelText: T.follow[0], labelTextEn: T.follow[1], onChanged: "follow" });
  children.push(Text(tx("members"), { style: "h5" }));
  for (const r of rows) {
    const marks = (r.phone ? " 📱" : "") + (r.tv ? " 📺" : "");
    const line = [Text(both(`${displayName(r.name)}${marks}`, `${displayName(r.name, true)}${marks}`), { flex: 1 })];
    if (r.host) line.push({ type: "Badge", text: T.hostMark[0], textEn: T.hostMark[1] });
    children.push({ type: "Row", gap: 4, crossAxisAlignment: "center", children: line });
  }
  const doors = 1 + Object.keys(p.backups).length;
  children.push(Text(both(`Puertas abiertas: ${doors}`, `Open doors: ${doors}`), { style: "caption", color: "muted" }));
  if (seat) {
    const words = p.hostWords;
    children.push({ type: "Divider" });
    children.push({ type: "QrImage", value: roomUrlOf(words, p.code), labelText: "Código QR de la sala", labelTextEn: "The room's QR code", size: "small" });
    children.push(Text(tx("inviteInfo"), { style: "caption", color: "muted" }));
    // The fallback when the short-code service is down: the room's own words and code, collapsed.
    children.push(Btn("TextButton", both("Opciones avanzadas", "Advanced options"), { ui: [{ toggle: "advanced" }] }, { key: "btnAdvanced" }));
    children.push({
      type: "Column", key: "advanced", hidden: true, gap: 4,
      children: [
        Text(both(`Palabras: ${words}`, `Words: ${words}`)),
        Text(both(`Código de la sala: ${groupCode(p.code)}`, `Room code: ${groupCode(p.code)}`), { bold: true }),
        Text(both("Sirven si el servicio del código corto no responde: «Entrar con palabras y código».", "They work if the short-code service does not answer: “Join with words and code”."), { style: "caption", color: "muted" }),
      ],
    });
    if (p.myWords && p.myWords !== words) children.push(Text(both(`Tu puerta de respaldo: ${p.myWords}`, `Your backup door: ${p.myWords}`), { style: "caption" }));
    if (p.role === "guest" && p.want.includes(p.me.mid) && !p.myWords) {
      children.push(Text(tx("backupInfo"), { style: "caption", color: "muted" }));
      children.push(Btn("TextButton", tx("openBackup"), busyTap("openBackup"), { key: "btnBackup" }));
    }
    // «Agregar dispositivo» scans the TV's QR: never on a TV.
    if (!isTv(ctx)) children.push(Btn("TextButton", tx("addDevice"), busyTap("addDevice"), { key: "btnAddDevice", devices: ["phone"] }));
  }
  if (p.link && !p.link.used) children.push(...linkNodes(p));
  // A host alone that knows other doors may look for the room there (the «alone» notice only shows after a real departure).
  if (p.role === "host" && !p.roster.some((m) => m.id !== "host") && Object.keys(p.leftDoors).length && !p.probe && !(p.banner && p.banner.kind === "alone")) {
    children.push(Btn("TextButton", both("Buscar la sala en otra puerta", "Look for the room at another door"), busyTap("findRoom"), { key: "btnFind" }));
  }
  children.push({ type: "Divider" });
  children.push(Btn("TextButton", both("Cambiar mi nombre", "Change my name"), { event: "renameOpen" }, { key: "btnRename" }));
  children.push(Btn("TextButton", tx("leave"), "leave", { confirm: T.leaveConfirm[0], confirmEn: T.leaveConfirm[1] }));
  return children;
}

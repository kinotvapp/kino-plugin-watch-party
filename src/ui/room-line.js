// The room in one line (its short code, and on the host's phone «Copiar invitación»), or why there is no short code.

import { both } from "../i18n/texts.js";
import { invitationText } from "../invite/invitation.js";
import { groupShort } from "../invite/short-code.js";
import { busyTap } from "./busy.js";
import { Btn, isTv, Text } from "./kit.js";

/**
 * The room in one line: «Sala: 41 408», and on the host's phone an icon-only «Copiar invitación» at its right end (Kino's
 * `go.copy`; Kino shows «Copiado»; `sensitive` keeps the text out of clipboard previews). Never a copy on a TV (Kino drops it
 * there): `devices` and the context say so. Without a short code: why, and for the host one press to ask again.
 */
export function roomLine(p, ctx) {
  if (!p.short) return shortNodes(p);
  const copy = p.role === "host" && p.code && p.hostWords && !isTv(ctx)
    ? [{
      type: "IconButton", key: "btnCopyInvite", icon: "copy", labelText: "Copiar invitación", labelTextEn: "Copy invitation", devices: ["phone", "desktop"],
      onPressed: { go: { copy: { text: invitationText({ short: p.short, words: p.hostWords, code: p.code, media: p.media }), label: "Invitación a Party Chat", sensitive: true } } },
    }]
    : [];
  return [{
    type: "Row", key: "roomLine", gap: 4, crossAxisAlignment: "center",
    children: [
      Text(both("Sala:", "Room:"), { color: "muted" }),
      Text(both(groupShort(p.short), groupShort(p.short)), { key: "shortCode", style: "h5", bold: true, flex: 1 }),
      ...copy,
    ],
  }];
}

/** Why there is no short code (with one press to ask again: the host only). */
function shortNodes(p) {
  if (p.role !== "host") return [Text(both("Pídele el código al anfitrión, o escanea su QR.", "Ask the host for the code, or scan their QR."), { style: "caption" })];
  return [
    Text(both("No pude crear el código corto. Puedes reintentar, o usar el QR o las opciones avanzadas.", "I could not create the short code. Try again, or use the QR or the advanced options."), { color: p.shortError ? "error" : "muted" }),
    Btn("TextButton", both("Obtener un código", "Get a code"), busyTap("shortCode"), { key: "btnShort" }),
  ];
}

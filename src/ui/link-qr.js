// The TV's link QR and its explanation.

import { both, tx } from "../i18n/texts.js";
import { Btn, Text } from "./kit.js";
import { linkQrText } from "../util/codes.js";

export function linkNodes(p) {
  return [
    { type: "QrImage", value: linkQrText(p.link.words, p.link.code, p.link.exp), labelText: "Código para vincular el teléfono", labelTextEn: "Code to link the phone", size: "medium" },
    Text(tx("linkInfo")),
    Text(both("Vence a los 5 minutos.", "It expires after 5 minutes."), { style: "caption", color: "muted" }),
    Btn("TextButton", tx("linkCancel"), "linkCancel", { key: "btnLinkCancel" }),
  ];
}

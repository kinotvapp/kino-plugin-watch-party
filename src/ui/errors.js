// A failed press's error drawn in place, with «Reintentar» when it can be retried.

import { both, tx } from "../i18n/texts.js";
import { BUSY, waitKey } from "./busy.js";
import { Btn, Text } from "./kit.js";
import { isObj } from "../util/text.js";

/** The error of the last press that waited, in place, with its retry (its own row follows it). */
/**
 * A failed press's error: the text in the error colour and, when it can be retried, «Reintentar» as a keyed button (a
 * banner's own action has no key, so the D-pad could not be sent to it). [withRetry] false on a recovery screen, whose own
 * button is the one way on.
 */
export function errorNodes(ctx, withRetry = true) {
  const e = isObj(ctx.state) && isObj(ctx.state.error) ? ctx.state.error : null;
  if (!e || typeof e.es !== "string") return [];
  const out = [Text(both(e.es, typeof e.en === "string" ? e.en : e.es), { key: "errText", color: "error" })];
  if (withRetry && typeof e.retry === "string" && BUSY[e.retry]) {
    out.push(Btn("ElevatedButton", tx("retry"), { ui: [{ show: waitKey("retry") }], event: e.retry }, { key: "btnRetry", autofocus: true }));
  }
  return out;
}

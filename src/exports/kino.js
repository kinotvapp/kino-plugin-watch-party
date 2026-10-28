// The exports Kino calls: `panel`, `panelAction`, `playerEvent`, with the device's clock.

import { panelActionAt } from "./panel-action.js";
import { panelAt, playerEventAt } from "./panel.js";

export async function panel(ctx) {
  return panelAt(ctx, Date.now());
}

export async function panelAction(event, ctx) {
  return panelActionAt(event, ctx, Date.now());
}

export async function playerEvent(event, ctx) {
  return playerEventAt(event, ctx, Date.now());
}

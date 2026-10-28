// The banners above the room: whether this device watches the room's title or channel, and the party's own status.

import { both, tx } from "../i18n/texts.js";
import { displayName } from "../party/state.js";
import { liveChannelGoOf, mediaMatch, titleByIdsOf } from "../protocol/media.js";
import { busyTap } from "./busy.js";
import { Action, Banner } from "./kit.js";

export function matchBanner(p, ctx) {
  if (p.role === "host") return null;
  const m = mediaMatch(ctx, p.media);
  const go = titleByIdsOf(p.media);
  const open = go ? Action(tx("openTitle"), { go }) : undefined;
  switch (m.reason) {
    case "same": return null; // said in the header row
    case "noRoomTitle": return null;
    case "noSource": return Banner("info", both("Este video no es de un plugin: solo chat.", "This video is not a plugin's: chat only."));
    case "live": return Banner("info", both("En vivo: solo chat, sin sincronizar.", "Live: chat only, no sync."));
    case "noIds": return Banner("info", both("No se puede sincronizar este título. Solo chat.", "This title cannot be synced. Chat only."));
    case "sameChannel": return null; // said in the header row
    case "otherChannel": {
      // The host's channel (also after a zap): a suggestion, one tap tunes; never a forced change.
      const name = p.media.title || p.media.channel.code;
      return Banner("warning", both(`La sala ve el canal «${name}».`, `The room watches the channel “${name}”.`), Action(both("Ver el mismo canal", "Watch the same channel"), { go: liveChannelGoOf(p.media) }));
    }
    case "otherTitle": return Banner("warning", both(`La sala ve «${p.media.title || "otro título"}».`, `The room watches “${p.media.title || "another title"}”.`), open);
    case "otherSource": {
      const name = (p.media && p.media.source.name) || p.media.source.pluginId;
      return Banner("warning", both(`Esta sala usa «${name}»: abre el título con ese plugin.`, `This room uses “${name}”: open the title with that plugin.`), open);
    }
    default: return null;
  }
}

export function partyBanner(p, now) {
  if (p.awaiting) {
    return Banner("info", both(`Esperando a que ${displayName(p.awaiting.name)} siga como anfitrión.`, `Waiting for ${displayName(p.awaiting.name, true)} to go on as host.`), Action(tx("retry"), "awaitRetry"));
  }
  const b = p.banner;
  if (!b) return null;
  switch (b.kind) {
    case "newHost":
      return Banner("warning", both(`El anfitrión se fue: ${displayName(b.name)} es el nuevo anfitrión`, `The host left: ${displayName(b.name, true)} is the new host`), Action(both(`Seguir con ${displayName(b.name)}`, `Go on with ${displayName(b.name, true)}`), busyTap("followHost")));
    case "youHost":
      return now - (b.at || 0) < 60000 ? Banner("success", both("El anfitrión se fue: ahora tú eres el anfitrión", "The host left: you are the host now")) : null;
    case "lost":
      return Banner("error", both("No queda nadie que pueda ser anfitrión: la sala terminó.", "Nobody is left who can host: the room is over."), Action(tx("leave"), "leave"));
    case "redirect":
      return Banner("info", both(`Entraste por otra puerta. Entra con el anfitrión, ${displayName(b.name)}.`, `You came in through another door. Join the host, ${displayName(b.name, true)}.`), Action(tx("enter"), busyTap("redirect")));
    case "dropped":
      return Banner("warning", both("Estuviste fuera un rato y la sala te sacó. Vuelve a entrar.", "You were away for a while and the room let you go. Join again."), Action(tx("enter"), busyTap("retryHost")));
    case "hostAway":
      return Banner("info", both("El anfitrión salió un momento; la sala sigue abierta.", "The host stepped away; the room is still open."));
    case "noAnswer":
      return Banner("warning", both("El anfitrión no responde. Puede ser tu conexión o la suya.", "The host is not answering. It may be your connection or theirs."), Action(tx("retry"), busyTap("retryHost")));
    case "cantCheck":
      return Banner("warning", both("Sin conexión con la sala. Puede ser tu conexión.", "No connection to the room. It may be your connection."), Action(tx("retry"), busyTap("retryHost")));
    case "waitOthers":
      return Banner("info", both("No llegamos al anfitrión. Si se fue, te avisamos cuando lleguen los demás.", "We cannot reach the host. If they left, we tell you when the others arrive."), Action(tx("retry"), busyTap("retryHost")));
    case "takeOver":
      return Banner("warning", both(`${displayName(b.name)} tampoco llega al anfitrión. ¿Sigues tú como anfitrión?`, `${displayName(b.name, true)} cannot reach the host either. Will you go on as host?`), Action(both("Seguir yo", "Go on myself"), busyTap("retryHost")));
    case "alone":
      return Banner("info", both("Todos salieron. Si siguieron en otra puerta, búscala.", "Everyone left. If they went on through another door, look for it."), Action(tx("findRoom"), busyTap("findRoom")));
    case "moved":
      return Banner("warning", both(`La sala siguió con ${displayName(b.name)} (${b.count} personas). Si te unes, tu sala se cierra.`, `The room went on with ${displayName(b.name, true)} (${b.count} people). Joining closes your room.`), Action(both("Unirme", "Join"), busyTap("joinMoved")));
    case "closedMine":
      return Banner("warning", both("Tu sala se cerró en este aparato.", "Your room closed on this device."), Action(tx("findRoom"), busyTap("findRoom")));
    case "ended":
      return Banner("error", both("Tu sala terminó y no hay otra puerta.", "Your room ended and there is no other door."), Action(tx("leave"), "leave"));
    case "linked":
      return Banner("success", both(`Teléfono vinculado: ${displayName(b.name)}. Entra a su sala.`, `Phone linked: ${displayName(b.name, true)}. Join its room.`), Action(tx("enter"), busyTap("enterParty")));
    default:
      return null;
  }
}

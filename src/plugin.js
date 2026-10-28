// Party Chat: a Kino plugin that adds a «Party Chat» TAB to the player panel of any plugin's title (apiVersion 14).
//
// People watch the same title together: a chat (plain text and eight quick reactions, nothing else) and the playback kept
// in step. Kino only offers generic pieces; the whole Watch Party protocol below is this plugin's:
//
// - `kino.room` (capability `room`): a short-lived mailbox hosted on the person's own device and reached over the Internet
//   through Kino's own tunnel. One person creates the room and is its HOST; the others join with the room's words and its
//   12-digit code. People never handle them: the host asks the Kino author's short-code service (url-code.kinotv.workers.dev,
//   the only host this plugin reaches) for a 5-digit code that stands for `https://<words>.trycloudflare.com/?c=<code>`, and a
//   guest types those 5 digits; the plugin reads the words and the code back out of that address (strictly) and never fetches
//   it. The QR carries the same address, so a phone that scans it needs no service. Words + code stay as a fallback.
// - Identity is Kino's: a member IS the `memberId` Kino gives its session at the endpoint it joined (`from` on every event).
//   A message never names its sender, so no one can claim to be someone else; a member's place is freed only by Kino's own
//   `leave` event.
// - The host is the authority: it numbers every chat entry (`cseq`), broadcasts its playback state every few seconds and a
//   SNAPSHOT of the room (members, title, state, the chat's tail) every 10 s. Guests follow the host's playback with
//   `player` actions (pause, seek, speed) through the consented capability `playerControl`.
// - Nobody depends on one device: up to two members also open a BACKUP door with the same code. When the host says goodbye
//   or Kino says its room closed, every member elects the same successor from the host's last snapshot (the lowest
//   joinedSeq that holds a door). When the host only stops answering, nobody concludes anything from silence: the member
//   tries the host's door again (one press), and only when that fresh try fails while another door answers does the
//   successor take over. The chat is replicated incrementally (`need`/`have`/`gone`), bounded (200 entries or 64 KB).
// - A person may take part with a phone and a TV: the TV shows a one-use, 5-minute link QR; the phone scans it, tells the TV
//   which room to join, and the TV joins as a `display` seat that the clients treat as reactions-only.
// - Everyone must watch through the SAME source plugin and the same title (`ctx.source`, `ctx.ids`): otherwise the tab offers
//   «Abrir este título» (`go.titleByIds`, Kino's own title page) or names the plugin the room uses.
// - On an En vivo channel (`"kinds": ["title", "live"]`, `ctx.live`), the host's channel is the shared state: no position or
//   pause to keep in step. A guest elsewhere is offered «Ver el mismo canal» (`go.liveChannel`, one tap); when the host zaps,
//   the guests get the new channel as that same suggestion, never a forced change.
//
// Everything a peer sends is UNTRUSTED: each message is checked for its shape, its sizes and its types, unknown kinds and extra
// fields are ignored, names are scrubbed, rates are capped per member, answers are budgeted, and only the host's messages move
// anyone's player. The room code is a shared secret: it is never logged and never put in the chat (a code typed into a message
// is masked); it does travel, by design, in the `link` message a phone sends to the TV it scanned.
//
// The functions below are pure where they can be (the protocol reducers, the election, the sync decision, the chat history,
// the snapshot), exported so the kit tests them with simulated members; `panel`, `panelAction` and `playerEvent` are thin glue
// that reads `kino.storage`, polls the room, runs the reducers and draws the tab with the screen kit.
//
// This file is the entry of the source tree: it only re-exports the plugin's public surface from src/. The shipped
// plugin.js is generated from it by `npm run build` (esbuild, one readable ES module); never edit plugin.js by hand.
// The README's "How the code is organized" says which folder owns what.

export { candidatesOf } from "./actions/recover.js";
export {
  readEntry, trimHistory, addEntries, historyRange, chunkEntries, firstGap, chatAllowed,
} from "./chat/history.js";
export { panel, panelAction, playerEvent } from "./exports/kino.js";
export { panelActionAt, withFocus, focusables } from "./exports/panel-action.js";
export { panelAt, playerEventAt } from "./exports/panel.js";
export { INVITE_MAX, invitationText, parseInvitation } from "./invite/invitation.js";
export {
  SHORT_SERVICE, roomUrlOf, parseRoomUrl, normShort, groupShort, readShortAnswer, createShortCode, revokeShortCode,
  lookupShortCode,
} from "./invite/short-code.js";
export { LIMITS, EMOJIS, SPEEDS } from "./limits.js";
export { wantedBackups, elect } from "./party/election.js";
export { hostGone, promote, rejoinView, lobbyReceive } from "./party/failover.js";
export { guestReceive, guestTick } from "./party/guest.js";
export { hostReceive, hostTick } from "./party/host.js";
export { newParty, enqueue, buildSnapshot, memberRows } from "./party/state.js";
export { linkReceive } from "./party/tv-link.js";
export { channelOf, mediaOf, readMedia, mediaMatch, liveChannelGoOf, titleByIdsOf } from "./protocol/media.js";
export { readGuestMessage, readSnapshot, readHostMessage, readLinkMessage } from "./protocol/messages.js";
export { observeSkew, expectedPos, seekAllowed, syncAction } from "./protocol/playback.js";
export { pump } from "./transport/outbox.js";
export { loadParty, compactParty, saveParty } from "./transport/storage.js";
export { BUSY_ROWS, BUSY, waitKey, busyTap } from "./ui/busy.js";
export { recoveryScreen } from "./ui/recovery.js";
export { view } from "./ui/view.js";
export { WIZ_STEPS, wizStepOf, wizFocus } from "./ui/wizard.js";
export {
  normCode, normWords, groupCode, maskCode, randomToken, MID, partyQrText, parsePartyQr, linkQrText, parseLinkQr,
} from "./util/codes.js";
export { scrub, scrubName } from "./util/text.js";

// The person's presses: one case per screen event (create, join, send, react, follow, leave...).

import {
  addDevice, askShort, dropShort, joinAndGreet, joinRoom, openBackup, scanOrExplain, toNameOrJoin,
} from "./join.js";
import { findRoom, followCandidates, retryHost } from "./recover.js";
import { chatAllowed } from "../chat/history.js";
import { both, tx } from "../i18n/texts.js";
import { parseInvitation } from "../invite/invitation.js";
import { groupShort, lookupShortCode, normShort, parseRoomUrl } from "../invite/short-code.js";
import { EMOJIS, LIMITS } from "../limits.js";
import { correction } from "../party/correction.js";
import { addMyMid, enqueue, helloOf, hostAddChat, newParty } from "../party/state.js";
import { mediaOf } from "../protocol/media.js";
import { flush, pump, stepDown } from "../transport/outbox.js";
import { NAME } from "../transport/storage.js";
import { failed, invalid } from "../ui/busy.js";
import { toast } from "../ui/kit.js";
import { targetOf, WIZ_STEPS, wizFocus } from "../ui/wizard.js";
import { maskCode, normCode, normWords, parsePartyQr } from "../util/codes.js";
import { isObj, scrub, scrubName } from "../util/text.js";

export async function act(k, p, event, ctx, values, name, now) {
  switch (event.name) {
    case "create": {
      if (p.phase === "party") return null;
      if (name) k.storage.set(NAME, name);
      // Kino's default 12-digit code: nobody types it (people type the service's 5-digit code, or scan the QR).
      const opened = await k.room.open({ ttlMin: LIMITS.roomTtlMin, max: LIMITS.maxMembers, name: name || undefined });
      await dropShort(k, p); // a code of an earlier room of this device is revoked before the new one is made
      Object.assign(p, newParty(name));
      p.cursors = { joined: 0, hosted: 0 };
      p.phase = "party"; p.role = "host"; p.code = opened.code; p.hostWords = opened.words; p.myWords = opened.words;
      p.expiresAtMs = opened.expiresAtMs; p.epoch = 1; p.hostName = name; p.maxCseq = LIMITS.epochSpan; p.myJs = 1;
      p.me.mid = "host";
      addMyMid(p, "host");
      p.roster = [{ id: "host", name, js: 1, role: "seat", of: null }];
      p.nextJs = 2; p.media = mediaOf(ctx); p.snapDue = true; p.forceState = "start";
      await pump(k.room, p, ctx, now);
      const got = await askShort(k, p, now);
      return got
        ? { ...toast(both(`Sala creada: comparte el código ${groupShort(p.short)}`, `Room created: share the code ${groupShort(p.short)}`), "success"), state: { tab: "chat", wizStep: "home" } }
        : { ...toast(both("Sala creada, pero sin código corto: usa el QR o las opciones avanzadas", "Room created, without a short code: use the QR or the advanced options"), "warning"), state: { tab: "chat", wizStep: "home" } };
    }
    case "shortCode": {
      if (p.role !== "host" || p.phase !== "party") return null;
      if (await askShort(k, p, now)) return toast(both(`Código: ${groupShort(p.short)}`, `Code: ${groupShort(p.short)}`), "success");
      return failed("shortCode", both("No pude crear el código corto; reintenta", "I could not create the short code; try again"));
    }
    case "joinShort": {
      const v = isObj(event.value) ? event.value : values;
      const short = normShort(v.joinShortCode);
      if (!short) return invalid(both("Escribe los 5 números del código", "Type the code's 5 digits"));
      const found = await lookupShortCode((url, o) => k.fetch(url, o), short);
      if (!found.ok) {
        if (found.error === "notFound") return failed("joinShort", both("Ese código no existe o ya venció", "That code does not exist or has expired"));
        if (found.error === "network") return failed("joinShort", both("No pude consultar el código; reintenta", "I could not look the code up; try again"));
        return invalid(both("Ese código no es válido", "That code is not valid"));
      }
      if (name) k.storage.set(NAME, name);
      const answer = await joinAndGreet(k, p, found.words, found.code, name, ctx, now);
      p.short = short; // known to this guest: masked if typed into the chat
      return answer;
    }
    case "renameOpen":
      return { state: { renaming: true }, focus: "myName" };
    case "renameClose":
      return { state: { renaming: false }, focus: "btnRename" };
    case "rename": {
      const nn = scrubName(typeof values.myName === "string" ? values.myName : "");
      if (!nn) return toast(both("Escribe un nombre", "Type a name"), "warning");
      k.storage.set(NAME, nn);
      p.me.name = nn;
      if (p.phase === "party") {
        if (p.role === "host") {
          p.hostName = nn;
          p.roster = p.roster.map((r) => (r.id === "host" ? { ...r, name: nn } : r));
          p.snapDue = true;
        } else if (p.handle) enqueue(p, "joined", helloOf(p));
        await pump(k.room, p, ctx, now);
      }
      return { ...toast(both(`Ahora te llamas ${nn}`, `Your name is now ${nn}`), "success"), state: { renaming: false } };
    }
    case "wiz": {
      // A pure step change: Kino's panel state, and the step's first control focused.
      const to = WIZ_STEPS.includes(event.arg) ? event.arg : "home";
      if (p.phase === "party") return null;
      return { state: { wizStep: to, error: null, inviteError: false, ...(to === "home" ? { joinTarget: null, shortTyped: null } : {}) }, focus: wizFocus(to) };
    }
    case "lookupShort": {
      // j1 «Siguiente»: the code is checked at the service before the name is asked.
      const typed = typeof values.joinShortCode === "string" ? values.joinShortCode : "";
      const short = normShort(typed);
      if (!short) return invalid(both("Escribe los 5 números del código", "Type the code's 5 digits"));
      const found = await lookupShortCode((url, o) => k.fetch(url, o), short);
      if (!found.ok) {
        const msg = found.error === "notFound" ? both("Ese código no existe o ya venció", "That code does not exist or has expired")
          : found.error === "network" ? both("No pude consultar el código; reintenta", "I could not look the code up; try again")
            : both("Ese código no es válido", "That code is not valid");
        // A lookup that failed (the service, or a code it does not know yet) can be retried; a code that is not valid cannot.
        const again = found.error === "network" || found.error === "notFound";
        return { state: { error: { ...msg, retry: again ? "lookupShort" : null }, shortTyped: short }, ...(again ? { focus: "btnRetry" } : {}) };
      }
      return toNameOrJoin(k, p, { words: found.words, code: found.code, short }, ctx, now, { shortTyped: short });
    }
    case "wordsNext": {
      // j1b «Siguiente»: the words and the room code (or a pasted invitation in the words field), checked here.
      const words = normWords(values.joinWords);
      const code = normCode(values.joinCode);
      const got = words && code ? { words, code } : parseInvitation(`${typeof values.joinWords === "string" ? values.joinWords : ""}\n${typeof values.joinCode === "string" ? values.joinCode : ""}`);
      if (got.short) return { state: { wizStep: "j1", shortTyped: got.short, error: null }, focus: "btnLookup" };
      if (got.error) return { state: { error: { es: "No encuentro las palabras o el código", en: "I cannot find the words or the code", retry: null } } };
      return toNameOrJoin(k, p, { words: got.words, code: got.code, short: null }, ctx, now);
    }
    case "joinTarget": {
      // j2 «Entrar»: the checked room, with the name.
      const target = targetOf(isObj(ctx.state) ? ctx.state.joinTarget : null);
      if (!target) return { state: { wizStep: "j1" } };
      if (name) k.storage.set(NAME, name);
      const answer = await joinAndGreet(k, p, target.words, target.code, name, ctx, now);
      if (target.short) p.short = target.short;
      return { ...answer, state: { ...(answer.state || {}), wizStep: "home", joinTarget: null, shortTyped: null } };
    }
    case "readInvite": {
      // jp: a pasted invitation; a short code goes back to j1 filled in, words + code go on to the name.
      const got = parseInvitation(typeof values.joinPaste === "string" ? values.joinPaste : "");
      if (got.error) return { state: { inviteError: true } };
      if (got.short) return { state: { wizStep: "j1", shortTyped: got.short, inviteError: false }, focus: "btnLookup" };
      return toNameOrJoin(k, p, { words: got.words, code: got.code, short: null }, ctx, now, { inviteError: false });
    }
    case "join": {
      const v = isObj(event.value) ? event.value : values;
      const words = normWords(v.joinWords);
      const code = normCode(v.joinCode);
      if (!words || !code) {
        // The whole invitation pasted into the words field: read it, fill the fields, and let the person confirm first.
        const got = parseInvitation(`${typeof v.joinWords === "string" ? v.joinWords : ""}\n${typeof v.joinCode === "string" ? v.joinCode : ""}`);
        if (got.short) return { ui: [{ set: { key: "joinShortCode", value: got.short } }], state: { invite: got, inviteError: false } };
        if (!got.error) return { ui: [{ set: { key: "joinWords", value: got.words } }, { set: { key: "joinCode", value: got.code } }], state: { invite: got, inviteError: false } };
        return failed("join", both("No encuentro las palabras o el código", "I cannot find the words or the code"));
      }
      if (name) k.storage.set(NAME, name);
      return joinAndGreet(k, p, words, code, name, ctx, now);
    }
    case "scanJoin": {
      const text = await scanOrExplain(k, tx("scanTitle"));
      if (isObj(text)) return text;
      // The room's own address (no service needed), or an older room's words+code QR.
      const q = parseRoomUrl(text.trim()) || parsePartyQr(text);
      if (!q) return toast(both("Ese código QR no es de Party Chat", "That QR code is not a Party Chat code"), "error");
      // As for a typed code: joined at once with a saved name, else the name step (j2).
      return toNameOrJoin(k, p, { words: q.words, code: q.code, short: null }, ctx, now);
    }
    case "send": {
      if (p.phase !== "party" || p.me.role !== "seat") return null;
      const raw = typeof values.chatText === "string" ? values.chatText : typeof event.value === "string" ? event.value : "";
      const text = maskCode(maskCode(scrub(raw, LIMITS.textChars), p.code), p.short);
      if (!text) return null;
      if (!chatAllowed({ me: p.myChat }, "me", now)) return toast(both("Espera un momento antes de enviar más", "Wait a moment before sending more"), "warning");
      p.myChat = [...p.myChat.filter((t) => now - t < LIMITS.chatWindowMs), now];
      if (p.role === "host") hostAddChat(p, { k: "msg", by: "host", n: p.me.name, x: text }, now);
      else {
        enqueue(p, "joined", { t: "msg", text });
        p.pendingMine = [...p.pendingMine, { x: text, at: now }].slice(-LIMITS.chatPerWindow);
      }
      await pump(k.room, p, ctx, now);
      return { ui: [{ clear: "chatText" }] };
    }
    case "emoji": {
      const e = EMOJIS[Number(event.arg)];
      if (p.phase !== "party" || !e) return null;
      if (!chatAllowed({ me: p.myChat }, "me", now)) return toast(both("Espera un momento", "Wait a moment"), "warning");
      p.myChat = [...p.myChat.filter((t) => now - t < LIMITS.chatWindowMs), now];
      if (p.role === "host") hostAddChat(p, { k: "emoji", by: "host", n: p.me.name, x: e }, now);
      else enqueue(p, "joined", { t: "emoji", e });
      await pump(k.room, p, ctx, now);
      // The palette closed under the pressed reaction: the D-pad goes back to the input (a display seat stays on its glyph).
      return { focus: p.me.role === "display" ? "emoji" + Number(event.arg) : "chatText" };
    }
    case "follow":
      p.follow = event.value === true;
      if (p.follow) p.hold = false;
      return null;
    case "sync":
    case "resync": {
      if (p.role !== "guest") return null;
      p.hold = false;
      p.follow = true;
      p.lastAction = 0;
      p.seeks = [];
      p.lead = 0;
      p.seekPending = null;
      p.stuck = false;
      enqueue(p, "joined", { t: "sync" });
      await pump(k.room, p, ctx, now);
      const player = correction(p, ctx, now);
      return player ? { player } : toast(both("Ya vas con el anfitrión", "You are in step with the host"));
    }
    case "openBackup":
      if (!p.want.includes(p.me.mid)) return toast(both("La sala ya tiene sus puertas de respaldo", "The room already has its backup doors"));
      await openBackup(k, p, now);
      return toast(both("Puerta de respaldo abierta", "Backup door open"), "success");
    case "retryHost":
      return retryHost(k, p, ctx, now);
    case "followHost":
      if (!p.banner || p.banner.kind !== "newHost") return null;
      return followCandidates(k, p, ctx, now);
    case "awaitRetry": {
      // Waiting at the successor's door: say hello again (it may have missed it); if the door is gone, start over.
      if (!p.awaiting) return null;
      enqueue(p, "joined", helloOf(p));
      await pump(k.room, p, ctx, now);
      return toast(both("Avisamos de nuevo que estás aquí", "We said again that you are here"));
    }
    case "joinMoved":
      if (p.role !== "host" || !p.probe || !p.probe.found) return null;
      await dropShort(k, p);
      stepDown(p, now);
      await pump(k.room, p, ctx, now);
      return toast(both("Te uniste a la sala", "You joined the room"), "success");
    case "redirect": {
      if (!p.redirect) return null;
      const words = p.redirect.words;
      await joinRoom(k, p, words, p.code, p.me.name, p.me.role, now);
      p.hostWords = words;
      await pump(k.room, p, ctx, now);
      return null;
    }
    case "findRoom":
      return findRoom(k, p, now);
    case "leave": {
      enqueue(p, p.role === "host" ? "hosted" : "joined", { t: "bye" });
      try { await flush(k.room, p, now); } catch (e) { /* leaving anyway */ }
      if (p.handle) { try { await k.room.close({ session: p.handle }); } catch (e) { /* gone */ } }
      if (p.probe) { try { await k.room.close({ session: p.probe.handle }); } catch (e) { /* gone */ } }
      if (p.myWords || p.link) { try { await k.room.close({ session: "hosted" }); } catch (e) { /* gone */ } }
      await dropShort(k, p); // after the close, so the close never waits on the service
      Object.assign(p, newParty(p.me.name));
      return { ...toast(both("Saliste de la sala", "You left the room")), state: { wizStep: "home", joinTarget: null, shortTyped: null, tab: null } };
    }
    case "linkStart": {
      if (p.link && !p.link.used) return null;
      if (p.me.role === "seat" && p.phase === "party") return null;
      const opened = await k.room.open({ ttlMin: 10, max: 2, name: name || p.me.name || undefined });
      p.link = { words: opened.words, code: opened.code, exp: now + LIMITS.linkMs, used: false };
      if (!p.cursors) p.cursors = { joined: 0, hosted: 0 };
      p.cursors.hosted = 0;
      return null;
    }
    case "linkCancel":
      if (p.link) { p.link = null; try { await k.room.close({ session: "hosted" }); } catch (e) { /* gone */ } }
      return null;
    case "enterParty": {
      const pend = p.pending;
      if (!pend) return null;
      // A TV moving to another phone's room leaves the old one first.
      if (p.phase === "party" && p.code !== pend.code && p.handle) {
        enqueue(p, "joined", { t: "bye" });
        try { await flush(k.room, p, now); await k.room.close({ session: p.handle }); } catch (e) { /* gone */ }
      }
      const tvName = scrubName(`${pend.name} TV`);
      await joinRoom(k, p, pend.words, pend.code, tvName, "display", now, { pair: pend.pair });
      p.pending = null;
      p.banner = null;
      await pump(k.room, p, ctx, now);
      return toast(both("Listo: el televisor está en la sala", "Done: the TV is in the room"), "success");
    }
    case "addDevice":
      return addDevice(k, p, ctx, now);
    default:
      return null;
  }
}

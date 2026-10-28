// Inviting: the text the host copies to paste in any chat, and reading a pasted invitation back (pure).

import { asciiDigits, digitsOnly, normCode, normWords } from "../util/codes.js";
import { scrub } from "../util/text.js";

export const INVITE_MAX = 500;

/**
 * The invitation the host copies («Copiar invitación»): plain text, no link, only what joining needs. The title (with its
 * year, season and episode) and the source plugin's name help friends open the same title with the same plugin. Nothing else:
 * no member ids, no tunnel address. Always under INVITE_MAX characters (a long title is cut first).
 */
export function invitationText({ short = null, words, code, media = null }) {
  // On an En vivo channel the friend opens the panel on any channel: the tab offers the room's.
  const play = media && media.kind === "live" && media.channel ? "pon un canal en vivo" : "reproduce el mismo título";
  const lines = (titleLine) => (short ? [
    "Únete a mi Party Chat en Kino 🎬",
    ...(titleLine ? [titleLine] : []),
    `Código: ${short}`,
    `En Kino: ${play} ▸ panel ▸ Party Chat ▸ escribe el código ▸ Entrar.`,
    "(Join my Kino Party Chat: type the code above in Kino.)",
  ] : [
    "Únete a mi Party Chat en Kino 🎬",
    ...(titleLine ? [titleLine] : []),
    `Palabras: ${words}`,
    `Código: ${code}`,
    `En Kino: ${play} ▸ panel ▸ Party Chat ▸ Entrar con palabras y código.`,
    "(Join my Kino Party Chat: words + code above.)",
  ]).join("\n");
  const titleOf = (title) => {
    if (!media || !title) return null;
    const kind = media.kind === "series" ? "Serie" : media.kind === "live" ? "En vivo" : "Película";
    const year = media.year ? ` (${media.year})` : "";
    const ep = media.kind === "series" && media.season !== null ? `, T${media.season}${media.episode !== null ? ` E${media.episode}` : ""}` : "";
    const source = media.source && media.source.name ? `, con «${scrub(media.source.name, 40)}»` : "";
    return `${kind}: ${title}${year}${ep}${source}`;
  };
  let title = media ? scrub(media.title || "", 120) : "";
  let text = lines(titleOf(title));
  while (Array.from(text).length >= INVITE_MAX && title) {
    title = Array.from(title).slice(0, -10).join("").trim();
    text = lines(titleOf(title ? title + "…" : ""));
  }
  return text;
}

/**
 * Reads a pasted invitation (the whole text, or just the words and the code, with any labels, separators, line breaks, case,
 * WhatsApp's *bold*, emoji, or the `https://<words>.trycloudflare.com` form): `{ words, code }`, or `{ error: "missing" }` /
 * `{ error: "ambiguous" }`. The words: after «Palabras:»/«Words:» (hyphens or spaces between them), else the hyphenated group of
 * 2 to 6 letter-only words with the most parts (two different ones of that size are ambiguous). The code: 4 to 12 digits
 * after «Código»/«Code»/«PIN»/«Clave», else the one standalone group of 4 to 12 digits (a year in parentheses never counts).
 * Never throws; nothing is logged.
 */
export function parseInvitation(raw) {
  try {
    if (typeof raw !== "string" || !raw.trim() || raw.length > 4000) return { error: "missing" };
    const s = asciiDigits(raw).toLowerCase().replace(/[*_~`]/g, " ");
    // The words.
    let words = null;
    // After a label: hyphenated, or separated by spaces up to the end of that line (never running into the next label).
    const labelled = /(?:palabras|words)[ \t]*[:=][ \t]*([a-z]+(?:-[a-z]+){1,5})(?![\p{L}0-9-])/u.exec(s)
      || /(?:palabras|words)[ \t]*[:=][ \t]*([a-z]+(?:[ \t]+[a-z]+){1,5})[ \t]*(?:\n|$)/u.exec(s);
    if (labelled) words = labelled[1].split(/[ \t-]+/).join("-");
    else {
      const groups = [...s.matchAll(/(?<![a-z0-9-])[a-z]+(?:-[a-z]+){1,5}(?![a-z0-9-])/g)].map((m) => m[0]);
      const most = Math.max(0, ...groups.map((g) => g.split("-").length));
      const best = [...new Set(groups.filter((g) => g.split("-").length === most))];
      if (best.length > 1) return { error: "ambiguous" };
      words = best[0] || null;
    }
    if (words && !normWords(words)) words = null;
    // The code.
    let code = null;
    const label = /(?:c[oó]digo|code|pin|clave)[ \t]*[:=#]?[ \t]*([0-9](?:[ .-]?[0-9]){3,11})(?![0-9])/.exec(s);
    if (label) code = digitsOnly(label[1]);
    else {
      const found = new Set();
      for (const m of s.matchAll(/(?<![0-9a-z])([0-9](?:[ .-]?[0-9]){3,11})(?![0-9a-z])/g)) {
        const before = s[m.index - 1];
        const after = s[m.index + m[0].length];
        if (before === "(" && after === ")") continue; // a year in a title
        found.add(digitsOnly(m[1]));
      }
      if (found.size > 1) return { error: "ambiguous" };
      code = found.size ? [...found][0] : null;
    }
    if (!words && code && /^[0-9]{5}$/.test(code)) return { short: code };
    if (code && !normCode(code)) code = null;
    if (!words || !code) return { error: "missing" };
    return { words, code };
  } catch (e) {
    return { error: "missing" };
  }
}

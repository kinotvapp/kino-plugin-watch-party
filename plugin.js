// Fiesta (Watch Party): a Kino plugin that adds a «Fiesta» / «Party» TAB to the player panel of any plugin's title (apiVersion 14).
//
// People watch the same title together: a chat (plain text and eight quick reactions, nothing else) and the playback kept
// in step. Kino only offers generic pieces; the whole Watch Party protocol below is this plugin's:
//
// - `kino.room` (capability `room`): a short-lived mailbox hosted on the person's own device and reached over the Internet
//   through Kino's own tunnel. One person creates the room and is its HOST; the others join with the room's words and its
//   short code (4 digits, `room.open({ codeDigits: 4 })`; typed, or read from a QR with `kino.qr.scan`, capability `qrScan`).
//   The plugin never sees a URL.
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
//
// Everything a peer sends is UNTRUSTED: each message is checked for its shape, its sizes and its types, unknown kinds and extra
// fields are ignored, names are scrubbed, rates are capped per member, answers are budgeted, and only the host's messages move
// anyone's player. The room code is a shared secret: it is never logged and never put in the chat (a code typed into a message
// is masked); it does travel, by design, in the `link` message a phone sends to the TV it scanned.
//
// The functions below are pure where they can be (the protocol reducers, the election, the sync decision, the chat history,
// the snapshot), exported so the kit tests them with simulated members; `panel`, `panelAction` and `playerEvent` are thin glue
// that reads `kino.storage`, polls the room, runs the reducers and draws the tab with the screen kit.

// ---------- limits (the plugin's own; Kino's room limits are stricter where they overlap) ----------

export const LIMITS = {
  textChars: 300, // one chat message, in characters
  nameChars: 24, // a member's name
  histEntries: 200, // the chat kept on each device
  histBytes: 64 * 1024, // ... or this much JSON, whichever comes first
  lateJoin: 50, // what a newcomer gets
  shown: 100, // what the tab shows
  snapChat: 20, // the chat tail in a snapshot
  snapBytes: 8192, // a snapshot's JSON, at most (the room's payload limit)
  chunkBytes: 6144, // one history chunk
  chunksPerMemberMinute: 6, // history chunks one member may cost the host in a minute
  syncEveryMs: 5000, // one `sync` answer per member in this time
  chatPerWindow: 5, // messages per sender ...
  chatWindowMs: 10000, // ... in this window
  backups: 2, // backup doors besides the host's
  maxMembers: 8, // the room's own maximum, the host included
  linkMs: 5 * 60000, // a TV's link QR
  snapEveryMs: 10000,
  noAnswerMs: 10000, // the host silent this long: say so, offer to try again
  aloneMs: 30000, // a host whose members all left this long ago may look for the room elsewhere
  stateEveryMs: 2500,
  refreshMs: 3000, // the panel's own refresh while in a room
  driftMs: 2000, // the tolerance before a guest is moved
  actionGapMs: 2000, // between two pause or speed corrections
  seekGapMs: 8000, // after a seek, at least this long (doubling) before the next one: the video rebuffers
  seeksPerMinute: 4,
  stateStaleMs: 15000, // a host state older than this moves nobody
  backupPublishMs: 5000, // a fresh door's name takes a moment to resolve
  roomTtlMin: 240,
  notes: 20,
  sendsPerSecond: 4, // below the room's 5
  sendsPerMinute: 90, // below the room's 100
  bytesPerMinute: 200 * 1024, // below the room's 256 KB
  outboxItems: 24,
  outboxBytes: 32 * 1024,
  jobs: 8, // pending history answers, one per member
  saveBytes: 120 * 1024, // what this plugin keeps in kino.storage, at most (the store holds 256 KB)
  holdMatchMs: 4000, // a player event this soon after our own action is ours
  needEveryMs: 5000,
  needMaxTries: 3, // the same gap asked this many times, then it is given up
  holes: 20,
  probeMs: 20000,
  partyCodeDigits: 4, // the party room's code (the words are the address; 4 digits keep strangers out, nothing more)
  minCodeDigits: 4, // a code typed or scanned: 4..12 digits (older rooms used 12)
  maxCodeDigits: 12,
  epochSpan: 1000000, // cseq = epoch * epochSpan + n
  maxEpoch: 1000, // a room never sees this many changes of host; a bigger claim is refused (and cseq stays far below 1e12)
  hostFailedMs: 60000, // a failed try of the host's door counts this long
  helloProofMs: 120000, // a member's hello at the successor's door this recent is the proof the others lost the host too
  hereEveryMs: 20000, // a guest whose tab is open says so this often (the host tells a real departure from a closed drawer)
  idleGuessMs: 90000, // a member silent this long before its leave was most likely idle-dropped, not gone elsewhere
  leftDoors: 3,
  lobbyPerWindow: 4, // answers of a backup door to newcomers, each member once, at most this many every 5 s
};

/** The eight quick reactions: the only thing a reaction may carry, and all a TV (a `display` seat) may send. */
export const EMOJIS = ["👍", "😂", "😮", "😢", "❤️", "🔥", "👏", "🍿"];
/** The picker under the text field: it only inserts into the text (no external emoji data). */
export const PICKER = ["😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎", "🤔", "😮", "😱", "😢", "😭", "😡", "👍", "👎", "👏", "🙌", "🙏", "💪", "🔥", "❤️", "🎉", "🍿"];
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// ---------- text, ids and codes (pure) ----------

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const utf8 = (s) => new TextEncoder().encode(String(s)).length;
const jsonBytes = (v) => utf8(JSON.stringify(v));
const keysAre = (o, required, optional = []) => {
  const ks = Object.keys(o);
  return required.every((k) => ks.includes(k)) && ks.every((k) => required.includes(k) || optional.includes(k));
};

// The regular expressions are built from code points (no escapes in the source): control, format, direction and invisible
// filler characters are removed; zero-width joiners stay because they build ordinary emoji.
const BS = String.fromCharCode(92);
const cp = (n) => BS + "u{" + n.toString(16) + "}";
const STRIP_RANGES = [
  [0x0, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180e, 0x180e],
  [0x200b, 0x200b], [0x200e, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x206f], [0x2800, 0x2800], [0x3164, 0x3164],
  [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff9, 0xfffb], [0x2028, 0x2029], [0xe0000, 0xe007f],
];
const STRIP = new RegExp("[" + STRIP_RANGES.map(([a, b]) => cp(a) + "-" + cp(b)).join("") + "]", "gu");
const MARKS = new RegExp("(" + BS + "p{M}{2})" + BS + "p{M}+", "gu"); // at most two combining marks per character
const BLANK = new RegExp("^[" + BS + "s" + BS + "p{M}" + cp(0x200c) + cp(0x200d) + "]*$", "u");
// Marks the room tab draws itself (devices, the host): a name may not carry them.
const NAME_MARKS = new RegExp("[" + ["📱", "📺", "·", "•", "✓"].join("") + "]", "gu");

/** Plain one-line text: breaks as spaces, control/format/direction/filler characters removed, spaces collapsed, at most [max] characters; a blank-looking text is "". */
export function scrub(raw, max) {
  if (typeof raw !== "string") return "";
  const s = raw.replace(/[\r\n\t]+/g, " ").replace(STRIP, "").replace(MARKS, "$1").replace(/\s+/g, " ").trim();
  if (BLANK.test(s)) return "";
  const points = Array.from(s);
  return points.length <= max ? s : points.slice(0, max).join("").trim();
}

/** A member's name: scrubbed, without the marks the tab draws, at most LIMITS.nameChars. */
export function scrubName(raw) {
  return scrub(scrub(raw, 64).replace(NAME_MARKS, " "), LIMITS.nameChars);
}

/** A room code as typed: spaces, hyphens and dots dropped, 4 to 12 digits, else null. */
export function normCode(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[ .-]/g, "");
  return /^[0-9]{4,12}$/.test(s) ? s : null;
}

/** An endpoint's words as typed (lower case, trimmed), else null. Never an address: a URL is not words. */
export function normWords(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])$/.test(s) ? s : null;
}

/** The code shown to people: «1234», or in groups of four for a longer one («1234 5678 9012»). */
export function groupCode(code) {
  return String(code || "").replace(/(\d{4})(?=\d)/g, "$1 ");
}

/**
 * The code never reaches the chat: a message holding it (any 0-2 separators between its digits, full-width digits too) gets
 * it masked. Only where it stands alone (no digit right before or after it), so a 4-digit code does not eat a year or a
 * longer number that merely contains it.
 */
export function maskCode(text, code) {
  if (typeof code !== "string" || !/^[0-9]{4,12}$/.test(code)) return text;
  const fw = (d) => String.fromCharCode(0xff10 + Number(d));
  const anyDigit = "0-9" + fw(0) + "-" + fw(9);
  const digit = (d) => "[" + d + fw(d) + "]";
  const sep = "[^" + anyDigit + "]{0,2}";
  const body = code.split("").map(digit).join(sep);
  return text.replace(new RegExp("(?<![" + anyDigit + "])" + body + "(?![" + anyDigit + "])", "g"), "••••");
}

/** A random id of [n] base-36 characters (pairing tokens; never a secret that guards the room). */
export function randomToken(n) {
  let s = "";
  while (s.length < n) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}
/** A member id as Kino gives it (`m` and 7 of [a-z0-9]), or the endpoint holder's `host`. */
export const MID = /^(?:host|m[0-9a-z]{7})$/;
const PAIR = /^[0-9a-z]{16}$/;

/** The invite QR: the words and the code, nothing else (no URL, no deep link). */
export function partyQrText(words, code) {
  return `KINOPARTY1|${words}|${code}`;
}
export function parsePartyQr(text) {
  if (typeof text !== "string" || text.length > 200) return null;
  const m = /^KINOPARTY1\|([a-z0-9-]{3,80})\|([0-9]{4,12})$/.exec(text.trim());
  if (!m) return null;
  const words = normWords(m[1]);
  return words ? { words, code: m[2] } : null;
}

/** A TV's link QR: its link endpoint's words and fresh code, and when it expires. */
export function linkQrText(words, code, expiresAtMs) {
  return `KINOLINK1|${words}|${code}|${expiresAtMs}`;
}
/** `{ words, code, exp }`, `{ error: "expired" }`, or null for anything else. */
export function parseLinkQr(text, now) {
  if (typeof text !== "string" || text.length > 200) return null;
  const m = /^KINOLINK1\|([a-z0-9-]{3,80})\|([0-9]{12})\|([0-9]{10,16})$/.exec(text.trim());
  if (!m) return null;
  const words = normWords(m[1]);
  const exp = Number(m[3]);
  if (!words || !Number.isSafeInteger(exp)) return null;
  // A minute of slack for the clocks of two devices; the TV closes the endpoint itself anyway.
  if (exp + 60000 < now) return { error: "expired" };
  return { words, code: m[2], exp };
}

// ---------- the chat history (pure) ----------

/** A chat entry as every device keeps it: `{ c, k, by, n, x, at, r? }` (cseq, kind, author's member id at the numbering host, name, text or emoji, host time, "d" for a TV). */
export function readEntry(e) {
  if (!isObj(e) || !keysAre(e, ["c", "k", "by", "n", "x", "at"], ["r"])) return null;
  if (!isInt(e.c, 1, 1e12) || !MID.test(String(e.by)) || !Number.isFinite(e.at)) return null;
  if (e.r !== undefined && e.r !== "d") return null;
  const n = scrubName(e.n);
  let x;
  if (e.k === "msg") x = scrub(e.x, LIMITS.textChars);
  else if (e.k === "emoji") x = EMOJIS.includes(e.x) ? e.x : "";
  else return null;
  if (!x) return null;
  // A TV's seat may only react: a text entry by a display is ignored by every client.
  if (e.r === "d" && e.k !== "emoji") return null;
  return { c: e.c, k: e.k, by: e.by, n, x, at: e.at, ...(e.r ? { r: "d" } : {}) };
}

/** The newest entries that fit LIMITS.histEntries and LIMITS.histBytes (counted as stored JSON), in cseq order. */
export function trimHistory(hist, maxBytes = LIMITS.histBytes) {
  const out = hist.length > LIMITS.histEntries ? hist.slice(hist.length - LIMITS.histEntries) : hist.slice();
  let bytes = out.reduce((n, e) => n + jsonBytes(e) + 1, 0);
  while (out.length && bytes > maxBytes) bytes -= jsonBytes(out.shift()) + 1;
  return out;
}

/** [hist] with [entries] merged in (deduplicated by cseq, sorted, bounded). Entries at or below [floor] are older than what is kept. */
export function addEntries(hist, entries, floor = 0) {
  const byC = new Map(hist.map((e) => [e.c, e]));
  for (const e of entries) if (e.c > floor && !byC.has(e.c)) byC.set(e.c, e);
  return trimHistory([...byC.values()].sort((a, b) => a.c - b.c));
}

/**
 * What a `need` for [from]..[to] gets from [hist]: the entries still kept in that range, `have` (the oldest kept) when the
 * range starts before the window, and `gone` when nothing of it is kept at all (the guest stops asking for it).
 */
export function historyRange(hist, from, to) {
  const entries = hist.filter((e) => e.c >= from && e.c <= to);
  const oldest = hist.length ? hist[0].c : null;
  return { entries, have: oldest !== null && from < oldest && to >= oldest ? oldest : null, gone: entries.length === 0 };
}

/** [entries] cut into chunks whose `{ t: "hist", entries }` message stays within [max] bytes. */
export function chunkEntries(entries, max = LIMITS.chunkBytes) {
  const chunks = [];
  let cur = [];
  for (const e of entries) {
    if (cur.length && jsonBytes({ t: "hist", entries: [...cur, e] }) > max) { chunks.push(cur); cur = []; }
    cur.push(e);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

const inHole = (holes, c) => holes.some(([a, b]) => c >= a && c <= b);

/**
 * The first missing range inside one epoch's run of [hist] above [floor], skipping the known [holes] (ranges the host said
 * are gone): `{ from, to }`, else null. Entries of different epochs never count as a gap.
 */
export function firstGap(hist, floor = 0, holes = []) {
  for (let i = 1; i < hist.length; i++) {
    const a = hist[i - 1].c, b = hist[i].c;
    if (a < floor) continue;
    if (Math.floor(a / LIMITS.epochSpan) !== Math.floor(b / LIMITS.epochSpan) || b <= a + 1) continue;
    for (let c = a + 1; c < b; c++) {
      if (inHole(holes, c)) continue;
      let to = c;
      while (to + 1 < b && !inHole(holes, to + 1)) to++;
      return { from: c, to };
    }
  }
  return null;
}

/** Whether [who] may send another chat entry now (LIMITS.chatPerWindow in LIMITS.chatWindowMs); records it when it may. */
export function chatAllowed(times, who, now) {
  const recent = (times[who] || []).filter((t) => now - t < LIMITS.chatWindowMs);
  if (recent.length >= LIMITS.chatPerWindow) { times[who] = recent; return false; }
  recent.push(now);
  times[who] = recent;
  return true;
}

// ---------- the title and the source (pure) ----------

/** What the room carries about the title, from a panel context; null when the playing video is not a plugin's title. */
export function mediaOf(ctx) {
  if (!isObj(ctx) || !isObj(ctx.source) || typeof ctx.source.pluginId !== "string") return null;
  const ids = isObj(ctx.ids) ? ctx.ids : {};
  const kind = ctx.kind === "episode" ? "series" : ctx.kind === "movie" ? "movie" : "live";
  const year = Number.parseInt(String(ctx.year || ""), 10);
  return {
    source: { pluginId: scrub(ctx.source.pluginId, 64), name: scrub(ctx.source.name || "", 40) },
    tmdb: isInt(ids.tmdb, 1, 2147483647) ? ids.tmdb : null,
    imdb: typeof ids.imdb === "string" && /^tt[0-9]{7,10}$/.test(ids.imdb) ? ids.imdb : null,
    kind,
    season: kind === "series" && isInt(ctx.season, 0, 999) ? ctx.season : null,
    episode: kind === "series" && isInt(ctx.episode, 1, 9999) ? ctx.episode : null,
    title: scrub(ctx.title || "", 120),
    year: isInt(year, 1870, 2100) ? year : null,
  };
}

/** A media block read from a peer, or null. */
export function readMedia(m) {
  if (!isObj(m) || !isObj(m.source) || typeof m.source.pluginId !== "string") return null;
  if (!["movie", "series", "live"].includes(m.kind)) return null;
  return {
    source: { pluginId: scrub(m.source.pluginId, 64), name: scrub(typeof m.source.name === "string" ? m.source.name : "", 40) },
    tmdb: isInt(m.tmdb, 1, 2147483647) ? m.tmdb : null,
    imdb: typeof m.imdb === "string" && /^tt[0-9]{7,10}$/.test(m.imdb) ? m.imdb : null,
    kind: m.kind,
    season: m.kind === "series" && isInt(m.season, 0, 999) ? m.season : null,
    episode: m.kind === "series" && isInt(m.episode, 1, 9999) ? m.episode : null,
    title: scrub(typeof m.title === "string" ? m.title : "", 120),
    year: isInt(m.year, 1870, 2100) ? m.year : null,
  };
}

const sameMedia = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether this guest watches what the room watches. `ok` only when BOTH the source plugin and the title match (same source =
 * same cut and encode, so positions agree). Else `reason`: "noSource" (not a plugin's title), "live" (chat only), "noIds" (the
 * room's title has no TMDB or IMDb id: it cannot be matched, so it is never synced), "otherTitle" (offer Kino's title page),
 * "otherSource" (name the room's plugin), "noRoomTitle" (the room has no title yet).
 */
export function mediaMatch(ctx, media) {
  if (!media) return { ok: false, reason: "noRoomTitle" };
  const mine = mediaOf(ctx);
  if (!mine) return { ok: false, reason: "noSource" };
  if (media.kind === "live" || mine.kind === "live") return { ok: false, reason: "live" };
  if (media.tmdb === null && media.imdb === null) return { ok: false, reason: "noIds" };
  const sameId = (media.tmdb !== null && mine.tmdb === media.tmdb) || (media.imdb !== null && mine.imdb === media.imdb);
  const sameEpisode = media.kind !== "series" || (mine.season === media.season && mine.episode === media.episode);
  if (!sameId || mine.kind !== media.kind || !sameEpisode) return { ok: false, reason: "otherTitle" };
  if (mine.source.pluginId !== media.source.pluginId) return { ok: false, reason: "otherSource" };
  return { ok: true, reason: "same" };
}

/** Kino's own title page for the room's title (`go.titleByIds`), or null when the room has no id for it. */
export function titleByIdsOf(media) {
  if (!media || media.kind === "live" || (media.tmdb === null && media.imdb === null)) return null;
  const t = { kind: media.kind };
  if (media.tmdb !== null) t.tmdb = media.tmdb;
  if (media.imdb !== null) t.imdb = media.imdb;
  if (media.kind === "series" && media.season !== null) {
    t.season = media.season;
    if (media.episode !== null) t.episode = media.episode;
  }
  if (media.title) t.title = media.title;
  if (media.year !== null) t.year = media.year;
  return { titleByIds: t };
}

// ---------- playback sync (pure) ----------

/** The last offset samples (this device's clock minus the host's, latency included); the host's offset is their minimum. */
export function observeSkew(samples, sample) {
  return [...samples, sample].slice(-10);
}
const skewOf = (samples) => (samples.length ? Math.min(...samples) : 0);

/** Where the host's video should be now, from its last state. */
export function expectedPos(st, now, skew) {
  if (st.paused) return st.pos;
  const age = Math.max(0, now - st.at - skew);
  return st.pos + age * (SPEEDS.includes(st.speed) ? st.speed : 1);
}

/** Whether a seek may run now: at most LIMITS.seeksPerMinute a minute, LIMITS.seekGapMs after the last one, doubling. */
export function seekAllowed(seeks, now) {
  const recent = seeks.filter((t) => now - t < 60000);
  if (recent.length >= LIMITS.seeksPerMinute) return false;
  if (!recent.length) return true;
  return now - recent[recent.length - 1] >= LIMITS.seekGapMs * 2 ** (recent.length - 1);
}

/**
 * What a guest's player should do to follow the host: a `KinoPlayerAction` (`pause`, `seekToMs`, `speed`) or null. Nothing
 * while following is off, the title or the source differ, the person paused or resumed by themselves (`hold`), or the host's
 * state is stale. A pause or speed change at least LIMITS.actionGapMs after the last correction; a seek only past
 * LIMITS.driftMs and only when [seekAllowed], aimed ahead by the lag the last seek left ([lead], at most 5 s).
 */
export function syncAction({ local, st, stAt, now, skew = 0, follow = true, match = { ok: true }, hold = false, lastAction = 0, durationMs = null, seeks = [], lead = 0 }) {
  if (!follow || !match.ok || hold || !st) return null;
  if (now - stAt > LIMITS.stateStaleMs) return null;
  const action = {};
  const soon = now - lastAction < LIMITS.actionGapMs;
  if (!soon && st.paused !== Boolean(local.paused)) action.pause = st.paused;
  const want = Math.round(expectedPos(st, now, skew));
  if (Math.abs(want - local.pos) > LIMITS.driftMs && seekAllowed(seeks, now)) {
    const target = want + (st.paused ? 0 : Math.max(0, Math.min(lead, 5000)));
    action.seekToMs = Math.max(0, durationMs ? Math.min(target, durationMs) : target);
  }
  const speed = SPEEDS.includes(st.speed) ? st.speed : 1;
  const mine = SPEEDS.includes(local.speed) ? local.speed : 1;
  if (!soon && speed !== mine) action.speed = speed;
  return Object.keys(action).length ? action : null;
}

// ---------- messages (pure validation of everything a peer sends) ----------

/** A guest's message to its host, normalized, or null (an unknown kind or any extra field ignores it whole). A message never names its sender: that is Kino's `from`. */
export function readGuestMessage(p) {
  if (!isObj(p) || typeof p.t !== "string") return null;
  switch (p.t) {
    case "hello":
      if (!keysAre(p, ["t", "name", "role"], ["pair", "maxCseq"])) return null;
      if (!["seat", "display"].includes(p.role)) return null;
      if (p.pair !== undefined && !PAIR.test(String(p.pair))) return null;
      if (p.maxCseq !== undefined && !isInt(p.maxCseq, 0, 1e12)) return null;
      return { t: "hello", name: scrubName(p.name), role: p.role, pair: p.pair || null, maxCseq: p.maxCseq || 0 };
    case "msg":
      if (!keysAre(p, ["t", "text"]) || typeof p.text !== "string") return null;
      return { t: "msg", text: p.text };
    case "emoji":
      if (!keysAre(p, ["t", "e"]) || !EMOJIS.includes(p.e)) return null;
      return { t: "emoji", e: p.e };
    case "need":
      if (!keysAre(p, ["t", "from"], ["to"]) || !isInt(p.from, 1, 1e12)) return null;
      if (p.to !== undefined && (!isInt(p.to, p.from, 1e12))) return null;
      return { t: "need", from: p.from, to: p.to === undefined ? null : p.to };
    case "sync":
      return keysAre(p, ["t"]) ? { t: "sync" } : null;
    case "backup": {
      if (!keysAre(p, ["t", "words"])) return null;
      const words = normWords(p.words);
      return words ? { t: "backup", words } : null;
    }
    case "nobackup":
      return keysAre(p, ["t"]) ? { t: "nobackup" } : null;
    case "here":
      return keysAre(p, ["t"]) ? { t: "here" } : null;
    case "pair":
      if (!keysAre(p, ["t", "token"]) || !PAIR.test(String(p.token))) return null;
      return { t: "pair", token: p.token };
    case "bye":
      return keysAre(p, ["t"]) ? { t: "bye" } : null;
    case "hist": {
      if (!keysAre(p, ["t", "entries"]) || !Array.isArray(p.entries) || p.entries.length > LIMITS.lateJoin) return null;
      return { t: "hist", entries: p.entries.map(readEntry).filter(Boolean) };
    }
    default:
      return null;
  }
}

/** A snapshot from an endpoint holder, normalized, or null. Its member ids are Kino's at that endpoint ("host" for the holder). */
export function readSnapshot(p) {
  if (!isObj(p) || p.t !== "snap") return null;
  if (!keysAre(p, ["t", "seq", "epoch", "hostName", "hostWords", "maxCseq", "members", "backups", "want", "state", "chat"], ["media"])) return null;
  if (!isInt(p.seq, 1, 1e12) || !isInt(p.epoch, 1, LIMITS.maxEpoch) || !isInt(p.maxCseq, 0, 1e12)) return null;
  const hostWords = normWords(p.hostWords);
  if (!hostWords || !Array.isArray(p.members) || p.members.length > LIMITS.maxMembers || !isObj(p.backups) || !Array.isArray(p.want)) return null;
  const members = [];
  for (const m of p.members) {
    if (!isObj(m) || !MID.test(String(m.id)) || !isInt(m.js, 1, 1e6) || !["seat", "display"].includes(m.role)) return null;
    if (m.of !== undefined && m.of !== null && !MID.test(String(m.of))) return null;
    if (members.some((x) => x.id === m.id)) return null;
    members.push({ id: m.id, name: scrubName(m.name), js: m.js, role: m.role, of: m.role === "display" && m.of ? m.of : null });
  }
  if (!members.some((m) => m.id === "host")) return null;
  const backups = {};
  for (const [id, w] of Object.entries(p.backups).slice(0, LIMITS.backups)) {
    const words = normWords(w);
    if (MID.test(id) && id !== "host" && words && members.some((m) => m.id === id && m.role === "seat")) backups[id] = words;
  }
  const want = p.want.filter((x) => MID.test(String(x)) && x !== "host").slice(0, LIMITS.backups);
  const st = readState(p.state);
  if (!st || !Array.isArray(p.chat) || p.chat.length > LIMITS.snapChat) return null;
  return {
    t: "snap", seq: p.seq, epoch: p.epoch, hostName: scrubName(p.hostName), hostWords, maxCseq: p.maxCseq,
    members, backups, want, media: p.media === undefined ? null : readMedia(p.media), state: st, chat: p.chat.map(readEntry).filter(Boolean),
  };
}

function readState(s) {
  if (!isObj(s) || !keysAre(s, ["pos", "paused", "speed", "at"])) return null;
  if (!isInt(s.pos, 0, 1e9) || typeof s.paused !== "boolean" || !SPEEDS.includes(s.speed) || !Number.isFinite(s.at)) return null;
  return { pos: s.pos, paused: s.paused, speed: s.speed, at: s.at };
}

/** An endpoint holder's message to a guest, normalized, or null. */
export function readHostMessage(p) {
  if (!isObj(p) || typeof p.t !== "string") return null;
  switch (p.t) {
    case "snap":
      return readSnapshot(p);
    case "state": {
      if (!keysAre(p, ["t", "pos", "paused", "speed", "at"], ["why", "by"])) return null;
      const st = readState({ pos: p.pos, paused: p.paused, speed: p.speed, at: p.at });
      if (!st) return null;
      const why = ["tick", "pause", "resume", "seek", "start"].includes(p.why) ? p.why : "tick";
      return { t: "state", ...st, why, by: scrubName(p.by) };
    }
    case "chat":
    case "hist": {
      if (!keysAre(p, ["t", "entries"]) || !Array.isArray(p.entries) || p.entries.length > 80) return null;
      return { t: p.t, entries: p.entries.map(readEntry).filter(Boolean) };
    }
    case "have":
      if (!keysAre(p, ["t", "from"]) || !isInt(p.from, 1, 1e12)) return null;
      return { t: "have", from: p.from };
    case "gone":
      if (!keysAre(p, ["t", "from", "to"]) || !isInt(p.from, 1, 1e12) || !isInt(p.to, p.from, 1e12)) return null;
      return { t: "gone", from: p.from, to: p.to };
    case "need":
      if (!keysAre(p, ["t", "from"]) || !isInt(p.from, 1, 1e12)) return null;
      return { t: "need", from: p.from };
    case "bye":
      return keysAre(p, ["t"]) ? { t: "bye" } : null;
    case "redirect": {
      if (!keysAre(p, ["t", "words", "name"])) return null;
      const words = normWords(p.words);
      return words ? { t: "redirect", words, name: scrubName(p.name) } : null;
    }
    default:
      return null;
  }
}

/** A phone's message to a TV's link endpoint, normalized, or null. */
export function readLinkMessage(p) {
  if (!isObj(p) || p.t !== "link" || !keysAre(p, ["t", "words", "code", "name", "pair"])) return null;
  const words = normWords(p.words);
  const code = typeof p.code === "string" && /^[0-9]{4,12}$/.test(p.code) ? p.code : null;
  if (!words || !code || !PAIR.test(String(p.pair))) return null;
  return { t: "link", words, code, name: scrubName(p.name), pair: p.pair };
}

// ---------- inviting: a text to paste in any chat, and reading it back (pure) ----------

export const INVITE_MAX = 500;

/**
 * The invitation the host copies («Copiar invitación»): plain text, no link, only what joining needs. The title (with its
 * year, season and episode) and the source plugin's name help friends open the same title with the same plugin. Nothing else:
 * no member ids, no tunnel address. Always under INVITE_MAX characters (a long title is cut first).
 */
export function invitationText({ words, code, media = null }) {
  const lines = (titleLine) => [
    "Únete a mi fiesta en Kino 🎬",
    ...(titleLine ? [titleLine] : []),
    `Palabras: ${words}`,
    `Código: ${code}`,
    "En Kino: reproduce el mismo título ▸ panel ▸ Fiesta ▸ Unirme.",
    "(Join my Kino watch party: words + code above.)",
  ].join("\n");
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

/** Full-width digits as ASCII (a paste from some keyboards). */
const asciiDigits = (s) => Array.from(s).map((ch) => {
  const c = ch.codePointAt(0);
  return c >= 0xff10 && c <= 0xff19 ? String(c - 0xff10) : ch;
}).join("");

const digitsOnly = (s) => s.replace(/[^0-9]/g, "");

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
    if (code && !normCode(code)) code = null;
    if (!words || !code) return { error: "missing" };
    return { words, code };
  } catch (e) {
    return { error: "missing" };
  }
}

// ---------- the party (the state this device keeps while in a room) ----------

/**
 * A fresh, roomless party for this device. The fields, by group:
 * - who: `phase` idle|party, `role` host|guest, `me` { mid (Kino's id at the door joined, "host" when hosting), name,
 *   role seat|display, pair (a TV: its phone's pairing token), pairOut (a phone: the token it gave its TV) }, `myMids`.
 * - the room: `code`, `epoch`, `hostName`, `hostWords` (the host's door), `joinedWords` (the door this device joined: only
 *   its holder's snapshots count), `handle` (the joined session), `myWords` (this device's door), `roster` (members by Kino
 *   id; the host's copy also keeps each display's pairing token and when it last heard each member), `nextJs`, `myJs`,
 *   `backups`, `want`, `media`, `snap` (the newest snapshot of the joined door's holder), `view` (the election's members
 *   and doors, from every such snapshot), `leftDoors` (the newest 3 doors of members who left this host).
 * - the chat: `hist`, `maxCseq` (host), `maxKnown`, `oldest`, `holes`, `lastNeed`, `pendingChat`, `pendingMine`.
 * - sending: `outbox` (bounded), `jobs` (history answers, made at send time), `sent`, `replies` (per-member answer times),
 *   `cursors` (per mailbox), `hereAt` (a guest's last "my tab is open").
 * - sync: `st`, `stAt`, `skew`, `follow`, `hold`, `lastAction`, `expect`, `seeks`, `lead`, `seekPending`, `stuck`.
 * - failover: `banner`, `lastOkAt` (the last message from the joined door's holder), `hostFailed` + `hostFailedAt` (a fresh
 *   try of the host's door failed), `awaiting` (this guest went to the successor's door and waits for it to host), `probe`
 *   and `moved` (a host looking for the room), `aloneSince`, `realLeftAt`, `lobby`, `lobbyHello`, `lobbySent`,
 *   `lobbySentAt`, `recovering`, `askedMid`, `oldView`, `gone` (kept for older saves, unused).
 * - the TV link: `link`, `pending`; the host's `pairs`.
 */
export function newParty(name = "") {
  return {
    v: 2, phase: "idle", role: null, me: { mid: null, name: scrubName(name), role: "seat", pair: null, pairOut: null, of: null }, myMids: [],
    code: null, epoch: 0, hostName: "", hostWords: null, joinedWords: null, handle: null, myWords: null, backupAt: 0, backupSentAt: 0,
    roster: [], nextJs: 1, myJs: 0, backups: {}, want: [], media: null, snap: null, view: null, leftDoors: {},
    hist: [], maxCseq: 0, maxKnown: 0, oldest: 0, holes: [], lastNeed: null, needAt: 0, pendingChat: [], pendingMine: [],
    outbox: [], jobs: [], sent: [], replies: {}, chatTimes: {}, myChat: [], cursors: { joined: 0, hosted: 0, probe: 0 }, hereAt: 0,
    st: null, stAt: 0, skew: [], follow: true, hold: false, lastAction: 0, expect: null, seeks: [], lead: 0, seekPending: null, stuck: false,
    snapSeq: 0, snapAt: 0, lastSnapSent: 0, lastStateSent: 0, snapDue: false, forceState: null,
    banner: null, lastOkAt: 0, hostFailed: false, hostFailedAt: 0, awaiting: null, gone: [], probe: null, moved: null, aloneSince: 0,
    realLeftAt: 0, lobby: {}, lobbyHello: {}, lobbySent: {}, lobbySentAt: [], recovering: false, askedMid: null,
    oldView: null, link: null, pending: null, pairs: {}, closeJoined: null, closeHosted: false, expiresAtMs: 0, redirect: null,
    correctedAt: 0, correctedTo: null, lastReaction: null, notes: [],
  };
}

const note = (p, now, es, en) => { p.notes = [...p.notes, { at: now, es, en }].slice(-LIMITS.notes); };
const histMax = (p) => (p.hist.length ? p.hist[p.hist.length - 1].c : 0);
const rosterOf = (p, id) => p.roster.find((m) => m.id === id) || null;
const displayName = (name, en) => name || (en ? "Guest" : "Invitado");
const addMyMid = (p, mid) => { if (mid && !p.myMids.includes(mid)) p.myMids = [...p.myMids, mid].slice(-10); };

/**
 * Queues one message. The outbox is bounded (LIMITS.outboxItems and LIMITS.outboxBytes): a newer broadcast `state` or `snap`
 * replaces the queued one, an identical message is never queued twice, and when it is full the oldest one-member messages go
 * first, then the oldest broadcasts. History answers never wait here: they are made at send time from `hist` (`jobs`).
 */
export function enqueue(p, session, payload, to) {
  const item = { session, payload, ...(to ? { to } : {}) };
  const key = JSON.stringify(item);
  if (p.outbox.some((o) => JSON.stringify(o) === key)) return;
  if (!to && (payload.t === "state" || payload.t === "snap")) p.outbox = p.outbox.filter((o) => o.to || o.session !== session || o.payload.t !== payload.t);
  if (to && (payload.t === "state" || payload.t === "snap")) p.outbox = p.outbox.filter((o) => !(o.to === to && o.session === session && o.payload.t === payload.t));
  p.outbox.push(item);
  const bytes = () => p.outbox.reduce((n, o) => n + jsonBytes(o), 0);
  while (p.outbox.length > LIMITS.outboxItems || (p.outbox.length > 1 && bytes() > LIMITS.outboxBytes)) {
    const direct = p.outbox.findIndex((o) => o.to);
    p.outbox.splice(direct >= 0 ? direct : 0, 1);
  }
}

/** The seats that should hold a backup door: the oldest LIMITS.backups by joinedSeq, the host left out. */
export function wantedBackups(roster) {
  return roster.filter((m) => m.role === "seat" && m.id !== "host").sort((a, b) => a.js - b.js || (a.id < b.id ? -1 : 1)).slice(0, LIMITS.backups).map((m) => m.id);
}

/**
 * The deterministic election: among a snapshot's members (Kino's ids at that host), the seat with the lowest joinedSeq that
 * holds a backup door, never the host and never anyone known gone. Every member computes the same answer from the same snapshot.
 */
export function elect(view, gone = []) {
  if (!view) return null;
  const c = view.members
    .filter((m) => m.role === "seat" && m.id !== "host" && !gone.includes(m.id) && view.backups[m.id])
    .sort((a, b) => a.js - b.js || (a.id < b.id ? -1 : 1))[0];
  return c ? { id: c.id, name: c.name, words: view.backups[c.id], js: c.js } : null;
}

/** The snapshot the host broadcasts: always within LIMITS.snapBytes (the chat tail is trimmed first). */
export function buildSnapshot(p, now) {
  const base = {
    t: "snap", seq: p.snapSeq, epoch: p.epoch, hostName: p.hostName, hostWords: p.hostWords, maxCseq: p.maxCseq,
    members: p.roster.map((m) => ({ id: m.id, name: m.name, js: m.js, role: m.role, ...(m.role === "display" ? { of: m.of } : {}) })),
    backups: { ...p.backups }, want: p.want.slice(), ...(p.media ? { media: p.media } : {}),
    state: p.st ? { pos: p.st.pos, paused: p.st.paused, speed: p.st.speed, at: p.st.at } : { pos: 0, paused: true, speed: 1, at: now },
    chat: [],
  };
  let tail = p.hist.slice(-LIMITS.snapChat);
  for (;;) {
    const snap = { ...base, chat: tail };
    if (jsonBytes(snap) <= LIMITS.snapBytes) return snap;
    if (!tail.length) break;
    tail = tail.slice(1);
  }
  // Only a degenerate title could be this long: drop it, the ids still name the title.
  return { ...base, ...(p.media ? { media: { ...p.media, title: "" } } : {}), chat: [] };
}

/** A chat entry numbered by this device (it is the host) and queued for the next broadcast. */
function hostAddChat(p, entry, now) {
  p.maxCseq = Math.max(p.maxCseq, p.epoch * LIMITS.epochSpan) + 1;
  const e = { c: p.maxCseq, ...entry, at: now };
  p.hist = addEntries(p.hist, [e]);
  p.pendingChat.push(e);
  if (e.k === "emoji") p.lastReaction = { at: now, n: e.n, x: e.x };
  return e;
}

/** Whether [mid] may cost the host another answer of [kind] now, within [count] per [windowMs]; records it when it may. */
function replyAllowed(p, mid, kind, now, count, windowMs) {
  const key = kind + ":" + mid;
  const recent = (p.replies[key] || []).filter((t) => now - t < windowMs);
  if (recent.length >= count) { p.replies[key] = recent; return false; }
  p.replies[key] = [...recent, now];
  return true;
}

/** A history answer for [mid] from [from] to [to]: one per member (a different ask replaces it, the same ask is ignored). */
function addJob(p, mid, from, to, now) {
  const end = Math.max(from, Math.min(to === null ? p.maxCseq : to, p.maxCseq || to || from));
  const same = p.jobs.find((j) => j.to === mid);
  if (same && same.from === from && same.end === end) return;
  p.jobs = [...p.jobs.filter((j) => j.to !== mid), { to: mid, from, next: from, end, sentAny: false, at: now }].slice(-LIMITS.jobs);
}

// ---------- the host's reducer ----------

/** One event of the host's own mailbox: a join, a leave or a member's message. The sender is Kino's `from`; nothing else is trusted. */
export function hostReceive(p, ev, now) {
  if (!isObj(ev) || typeof ev.from !== "string" || !MID.test(ev.from) || ev.from === "host") return;
  if (ev.kind === "join") {
    if (Object.keys(p.lobby).length < LIMITS.maxMembers * 2) p.lobby[ev.from] = { name: scrubName(ev.name), at: now };
    // Whoever reaches the door sees the room at once (a newcomer, a member coming back, a host looking for the room).
    if (p.st || p.hist.length) enqueue(p, "hosted", buildSnapshot({ ...p, snapSeq: Math.max(1, p.snapSeq) }, now), ev.from);
    return;
  }
  if (ev.kind === "leave") { dropMember(p, ev.from, now); return; }
  if (ev.kind !== "msg") return;
  const m = readGuestMessage(ev.payload);
  if (!m) return;
  if (m.t === "hello") { hostHello(p, ev.from, m, now); return; }
  const member = rosterOf(p, ev.from);
  if (!member) return; // not a member yet: no hello
  member.lastAt = now;
  switch (m.t) {
    case "here":
      return;
    case "msg": {
      if (member.role === "display") return; // a TV's seat may only react (a client convention: see the README)
      if (!chatAllowed(p.chatTimes, member.id, now)) return;
      const text = maskCode(scrub(m.text, LIMITS.textChars), p.code);
      if (!text) return;
      hostAddChat(p, { k: "msg", by: member.id, n: member.name, x: text }, now);
      return;
    }
    case "emoji":
      if (!chatAllowed(p.chatTimes, member.id, now)) return;
      hostAddChat(p, { k: "emoji", by: member.id, n: member.name, x: m.e, ...(member.role === "display" ? { r: "d" } : {}) }, now);
      return;
    case "need":
      addJob(p, member.id, m.from, m.to, now);
      return;
    case "sync":
      if (p.st && replyAllowed(p, member.id, "sync", now, 1, LIMITS.syncEveryMs)) enqueue(p, "hosted", { t: "state", ...p.st, why: "tick" }, member.id);
      return;
    case "backup":
      if (member.role === "seat" && p.want.includes(member.id) && !Object.values(p.backups).includes(m.words)) {
        p.backups[member.id] = m.words;
        p.snapDue = true;
      }
      return;
    case "nobackup":
      if (p.backups[member.id]) { delete p.backups[member.id]; p.snapDue = true; }
      return;
    case "pair": {
      if (member.role !== "seat") return;
      // One token per seat: a new one replaces that seat's old one, never another seat's.
      for (const [t, v] of Object.entries(p.pairs)) if (v.mid === member.id) delete p.pairs[t];
      p.pairs[m.token] = { mid: member.id, at: now };
      p.roster = p.roster.map((r) => (r.role === "display" && r.pair === m.token && !r.of ? { ...r, of: member.id } : r));
      p.snapDue = true;
      return;
    }
    case "bye":
      dropMember(p, ev.from, now, true);
      return;
    case "hist": {
      // Only the answer to this host's own `need` after a failover: entries of older epochs, newer than what it has, by authors
      // of the last snapshot it saw as a guest, their names taken from that snapshot (a member cannot rename the authors).
      if (p.askedMid !== ev.from) return;
      p.askedMid = null;
      const floor = histMax(p);
      const authors = new Map(((p.oldView && p.oldView.members) || []).map((x) => [x.id, x]));
      const fresh = m.entries
        .filter((e) => e.c > floor && e.c < p.epoch * LIMITS.epochSpan && authors.has(e.by) && !(authors.get(e.by).role === "display" && e.k !== "emoji"))
        .map((e) => ({ ...e, n: authors.get(e.by).name }));
      if (!fresh.length) return;
      p.hist = addEntries(p.hist, fresh);
      p.pendingChat.push(...fresh);
      return;
    }
    default:
  }
}

const isDisplay = (p, id) => (rosterOf(p, id) || {}).role === "display";

function hostHello(p, mid, m, now) {
  const bound = rosterOf(p, mid);
  if (bound) {
    // A second hello from the same session only refreshes a TV's pairing; it never adds a member or changes a seat.
    if (bound.role === "display" && m.role === "display" && m.pair && m.pair !== bound.pair) {
      const pair = p.pairs[m.pair];
      p.roster = p.roster.map((r) => (r.id === mid ? { ...r, pair: m.pair, of: pair && rosterOf(p, pair.mid) ? pair.mid : r.of } : r));
      p.snapDue = true;
    }
    return;
  }
  if (p.roster.length >= LIMITS.maxMembers) return; // the room's own maximum, the host included
  const name = (p.lobby[mid] && p.lobby[mid].name) || m.name;
  delete p.lobby[mid];
  const pair = m.role === "display" && m.pair ? p.pairs[m.pair] : null;
  const of = pair && rosterOf(p, pair.mid) ? pair.mid : null;
  const js = p.nextJs++;
  p.roster = [...p.roster, { id: mid, name, js, role: m.role, of, lastAt: now, ...(m.role === "display" && m.pair ? { pair: m.pair } : {}) }];
  note(p, now, `${displayName(name)} entró`, `${displayName(name, true)} joined`);
  // A newcomer gets the last LIMITS.lateJoin entries (as an answer made at send time, within the member's budget).
  const tail = p.hist.slice(-LIMITS.lateJoin);
  if (tail.length) addJob(p, mid, tail[0].c, p.maxCseq, now);
  // A new host after a failover asks the first member that has newer chat than it for the missing tail.
  if (p.recovering && m.maxCseq > histMax(p) && !p.askedMid) {
    p.askedMid = mid;
    enqueue(p, "hosted", { t: "need", from: histMax(p) + 1 }, mid);
  }
  if (p.st) enqueue(p, "hosted", { t: "state", ...p.st, why: "tick" }, mid);
  p.snapDue = true;
}

/**
 * A member left (Kino's `leave`, or its `bye`). It counts as a real departure (for the «alone» notice) after a `bye`, or
 * when the host heard from it shortly before; a member silent for LIMITS.idleGuessMs before its leave most likely just closed
 * its drawer and was dropped by the room's 2-minute rule.
 */
function dropMember(p, mid, now, byBye = false) {
  delete p.lobby[mid];
  p.jobs = p.jobs.filter((j) => j.to !== mid);
  p.outbox = p.outbox.filter((o) => o.to !== mid);
  for (const [t, v] of Object.entries(p.pairs)) if (v.mid === mid) delete p.pairs[t];
  const m = rosterOf(p, mid);
  if (!m) return;
  p.roster = p.roster.filter((r) => r !== m).map((r) => (r.role === "display" && r.of === m.id ? { ...r, of: null } : r));
  // A member with a backup door may have left to follow a new host: remember the door (the newest few), in case this
  // device is left behind.
  if (p.backups[m.id]) {
    const doors = { ...p.leftDoors, [m.id]: { name: m.name, js: m.js, words: p.backups[m.id], at: now } };
    p.leftDoors = Object.fromEntries(Object.entries(doors).sort((a, b) => b[1].at - a[1].at).slice(0, LIMITS.leftDoors));
  }
  delete p.backups[m.id];
  if (byBye || now - (m.lastAt || 0) < LIMITS.idleGuessMs) p.realLeftAt = now;
  note(p, now, `${displayName(m.name)} salió`, `${displayName(m.name, true)} left`);
  p.snapDue = true;
}

/** The host's periodic work: the title, the playback state, the chat batch, who keeps a backup, the snapshot, being alone. */
export function hostTick(p, ctx, now) {
  const media = mediaOf(ctx);
  if (media && !sameMedia(media, p.media)) { p.media = media; p.snapDue = true; }
  const st = { pos: Math.max(0, Math.round(Number(ctx.positionMs) || 0)), paused: Boolean(ctx.paused), speed: SPEEDS.includes(ctx.player && ctx.player.speed) ? ctx.player.speed : 1, at: now };
  const why = p.forceState;
  p.st = st;
  if (why || now - p.lastStateSent >= LIMITS.stateEveryMs) {
    enqueue(p, "hosted", { t: "state", ...st, why: why || "tick", by: p.me.name });
    p.lastStateSent = now;
    p.forceState = null;
  }
  if (p.pendingChat.length) {
    for (const chunk of chunkEntries(p.pendingChat)) enqueue(p, "hosted", { t: "chat", entries: chunk });
    p.pendingChat = [];
  }
  const want = wantedBackups(p.roster);
  if (JSON.stringify(want) !== JSON.stringify(p.want)) { p.want = want; p.snapDue = true; }
  for (const id of Object.keys(p.backups)) if (!want.includes(id)) { delete p.backups[id]; p.snapDue = true; }
  if (p.snapDue || now - p.lastSnapSent >= LIMITS.snapEveryMs) {
    p.snapSeq += 1;
    const snap = buildSnapshot(p, now);
    enqueue(p, "hosted", snap);
    if (snap.members.length > 1 && Object.keys(snap.backups).length) p.view = { members: snap.members, backups: snap.backups, epoch: p.epoch };
    p.lastSnapSent = now;
    p.snapDue = false;
  }
  // Everyone else left while there were doors, and at least one of them really left (a goodbye, or recently heard): they may
  // have gone on elsewhere. Only an offer to look; this host keeps its room. Members dropped for a closed drawer do not
  // count (the Sala tab still offers the search, quietly).
  const others = p.roster.some((m) => m.id !== "host");
  const hadDoors = Object.keys(p.leftDoors).length > 0;
  if (others || !hadDoors) { p.aloneSince = 0; if (others) p.realLeftAt = 0; }
  else if (!p.aloneSince) p.aloneSince = now;
  if (p.aloneSince && p.realLeftAt && now - p.aloneSince > LIMITS.aloneMs && !p.banner && !p.probe) p.banner = { kind: "alone" };
  if (others && p.banner && p.banner.kind === "alone") p.banner = null;
}

// ---------- the guest's reducer ----------

/**
 * One event of a guest's party session. Only the door holder's (`from: "host"`) messages count. A guest waiting at the
 * successor's door (`awaiting`) takes nothing from it but that holder's own snapshot as host: no redirect back to the host
 * it could not reach, no forwarded old snapshot.
 */
export function guestReceive(p, ev, now) {
  if (!isObj(ev) || ev.from !== "host") return;
  if (ev.kind === "closed") {
    if (p.awaiting) { p.awaiting = null; p.banner = { kind: "noAnswer" }; return; }
    hostGone(p, now, "closed");
    return;
  }
  if (ev.kind !== "msg") return;
  const m = readHostMessage(ev.payload);
  if (!m) return;
  if (p.awaiting && !(m.t === "snap" && m.hostWords === p.joinedWords)) return;
  switch (m.t) {
    case "snap": applySnapshot(p, m, now); return;
    case "state":
      if (p.hostWords !== p.joinedWords) return; // a door's holder that is not the host moves nobody
      p.lastOkAt = now;
      p.skew = observeSkew(p.skew, now - m.at);
      if (p.st && m.why !== "tick" && m.why !== "start" && p.st.paused !== m.paused) {
        note(p, now, `${displayName(m.by)} ${m.paused ? "pausó" : "siguió"}`, `${displayName(m.by, true)} ${m.paused ? "paused" : "resumed"}`);
      }
      p.st = { pos: m.pos, paused: m.paused, speed: m.speed, at: m.at };
      p.stAt = now;
      // The host itself paused, resumed or jumped: a lag measured after our last seek no longer means a slow rebuffer.
      if (m.why !== "tick") { p.lead = 0; p.seekPending = null; }
      return;
    case "chat":
    case "hist":
      p.lastOkAt = now;
      mergeChat(p, m.entries, now);
      return;
    case "have":
      p.oldest = Math.max(p.oldest, m.from);
      return;
    case "gone":
      p.holes = [...p.holes, [m.from, m.to]].slice(-LIMITS.holes);
      return;
    case "need": {
      // The (new) host asks for the tail it lacks: at most one batch, only entries this device has.
      const { entries } = historyRange(p.hist, m.from, Number.MAX_SAFE_INTEGER);
      const chunk = chunkEntries(entries.slice(-LIMITS.lateJoin))[0];
      if (chunk) enqueue(p, "joined", { t: "hist", entries: chunk });
      return;
    }
    case "bye": hostGone(p, now, "bye"); return;
    case "redirect":
      p.lastOkAt = now;
      p.redirect = { words: m.words, name: m.name };
      p.banner = { kind: "redirect", words: m.words, name: m.name };
      return;
    default:
  }
}

function mergeChat(p, entries, now) {
  const ok = entries.filter((e) => !(isDisplay(p, e.by) && e.k !== "emoji"));
  if (!ok.length) return;
  p.hist = addEntries(p.hist, ok, p.oldest ? p.oldest - 1 : 0);
  const last = ok[ok.length - 1];
  if (last.k === "emoji" && now - last.at < 60000) p.lastReaction = { at: now, n: last.n, x: last.x };
  p.maxKnown = Math.max(p.maxKnown, histMax(p));
}

/**
 * A snapshot. Only the joined door's own holder, as host (`hostWords` = the door joined), counts: it may move the epoch by
 * one at most (a change of host moves it by exactly one; a bigger jump is refused), and it clears every failover banner, the
 * redirect, `hostFailed` and `awaiting`. A snapshot a backup door forwards (another host's words) only shows a newcomer the
 * room before it reaches the host; it changes nothing else (never this device's own door, never the election).
 */
function applySnapshot(p, s, now) {
  if (s.hostWords !== p.joinedWords) {
    if (p.snap || p.awaiting) return;
    p.hostName = s.hostName;
    p.media = s.media;
    mergeChat(p, s.chat, now);
    return;
  }
  if (s.epoch < p.epoch || (p.epoch > 0 && s.epoch > p.epoch + 1)) return;
  if (s.epoch === p.epoch && s.seq <= p.snapSeq && s.hostWords === p.hostWords) return;
  const newHost = p.hostWords && (s.hostWords !== p.hostWords || s.epoch !== p.epoch);
  // Another host's clock: its offset is learned again (the old samples would be off by the two hosts' difference).
  if (newHost) p.skew = [];
  p.epoch = s.epoch;
  p.snapSeq = s.seq;
  p.hostName = s.hostName;
  p.hostWords = s.hostWords;
  p.maxKnown = Math.max(p.maxKnown, s.maxCseq);
  p.roster = s.members;
  p.backups = s.backups;
  p.want = s.want;
  p.media = s.media;
  p.snap = s;
  p.view = { members: s.members, backups: s.backups, epoch: s.epoch };
  p.snapAt = now;
  p.lastOkAt = now;
  p.skew = observeSkew(p.skew, now - s.state.at);
  if (!p.st || newHost || s.state.at >= p.st.at) { p.st = s.state; p.stAt = now; }
  mergeChat(p, s.chat, now);
  const mine = rosterOf(p, p.me.mid);
  if (mine) p.myJs = mine.js;
  if (mine && mine.role === "display") p.me.of = mine.of;
  if (p.banner && ["newHost", "noAnswer", "dropped", "cantCheck", "waitOthers", "takeOver", "lost", "redirect"].includes(p.banner.kind)) p.banner = null;
  p.redirect = null;
  p.awaiting = null;
  p.hostFailed = false;
  p.gone = [];
  if (newHost) note(p, now, `${displayName(s.hostName)} es el anfitrión`, `${displayName(s.hostName, true)} is the host`);
}

/**
 * The host is gone, on evidence that comes from its own door: its goodbye or Kino's `closed` event. The successor is elected
 * from the host's last snapshot: when it is this device, it hosts at once; anyone else sees one button to follow it.
 */
export function hostGone(p, now, why) {
  if (p.role !== "guest") return;
  p.hostFailed = true;
  p.hostFailedAt = now;
  const next = elect(p.view);
  const goneName = p.hostName;
  if (!next) { p.banner = { kind: "lost" }; return; }
  if (next.id === p.me.mid && p.myWords) { promote(p, now, goneName); return; }
  p.banner = { kind: "newHost", id: next.id, name: next.name, words: next.words, gone: goneName, why };
}

/** This device was elected: it hosts from its backup door, starting from the newest snapshot it has. */
export function promote(p, now, goneName = "") {
  p.oldView = p.view;
  p.role = "host";
  p.epoch += 1;
  p.hostName = p.me.name;
  p.hostWords = p.myWords;
  if (p.handle) p.closeJoined = p.handle;
  p.handle = null;
  p.myJs = p.myJs || 1;
  // Members re-join this door with new ids from Kino: the roster starts again with this device, in joining order after it.
  p.roster = [{ id: "host", name: p.me.name, js: p.myJs, role: "seat", of: null }];
  p.me.mid = "host";
  addMyMid(p, "host");
  p.nextJs = Math.max(p.myJs + 1, ...((p.view && p.view.members) || []).map((m) => m.js + 1));
  p.backups = {};
  p.want = [];
  p.maxCseq = Math.max(histMax(p), p.epoch * LIMITS.epochSpan);
  p.recovering = true;
  p.hostFailed = false;
  p.awaiting = null;
  p.redirect = null;
  p.joinedWords = null;
  p.snapDue = true;
  p.forceState = "tick";
  p.banner = { kind: "youHost", gone: goneName, at: now };
  note(p, now, "Ahora eres el anfitrión", "You are the host now");
  // Members who already reached this door while it was a backup become members now.
  for (const [mid, hello] of Object.entries(p.lobbyHello)) hostHello(p, mid, hello, now);
  p.lobbyHello = {};
}

/** Where a host the room left behind may look: its last view plus the doors of members who left it. */
export function rejoinView(p) {
  const members = p.view ? p.view.members.slice() : [];
  const backups = p.view ? { ...p.view.backups } : {};
  for (const [id, d] of Object.entries(p.leftDoors || {})) {
    if (!members.some((m) => m.id === id)) members.push({ id, name: d.name, js: d.js, role: "seat", of: null });
    backups[id] = d.words;
  }
  return members.length ? { members, backups } : null;
}

/**
 * A guest's backup door. A newcomer there is pointed to the host and sees the room at once, but only while this device
 * itself hears its host (it never sends anyone back to a host it cannot reach); each member once, at most
 * LIMITS.lobbyPerWindow answers every 5 s. A member's hello is kept: if this device is the successor and could not reach the
 * host either, it asks its person whether to take over («Caro tampoco llega al anfitrión»): a hello alone never promotes.
 */
export function lobbyReceive(p, ev, now) {
  if (!isObj(ev) || typeof ev.from !== "string" || !MID.test(ev.from)) return;
  if (ev.kind === "join") {
    if (Object.keys(p.lobby).length >= LIMITS.maxMembers * 2) return;
    p.lobby[ev.from] = { name: scrubName(ev.name), at: now };
    const hearsHost = p.handle && !p.awaiting && !hostFailedNow(p, now) && now - p.lastOkAt < LIMITS.noAnswerMs;
    const recent = (p.lobbySentAt || []).filter((t) => now - t < 5000);
    if (hearsHost && !p.lobbySent[ev.from] && recent.length < LIMITS.lobbyPerWindow) {
      p.lobbySent = { ...p.lobbySent, [ev.from]: now };
      p.lobbySentAt = [...recent, now];
      if (p.hostWords && p.hostWords !== p.myWords) enqueue(p, "hosted", { t: "redirect", words: p.hostWords, name: p.hostName }, ev.from);
      if (p.snap) enqueue(p, "hosted", forwardSnapshot(p), ev.from);
    }
    return;
  }
  if (ev.kind === "leave") { delete p.lobby[ev.from]; delete p.lobbyHello[ev.from]; delete p.lobbySent[ev.from]; return; }
  if (ev.kind !== "msg") return;
  const m = readGuestMessage(ev.payload);
  if (!m || m.t !== "hello" || Object.keys(p.lobbyHello).length >= LIMITS.maxMembers) return;
  p.lobbyHello[ev.from] = { ...m, at: now };
  const next = elect(p.view);
  const name = (p.lobby[ev.from] && p.lobby[ev.from].name) || m.name;
  if (hostFailedNow(p, now) && next && next.id === p.me.mid && (!p.banner || ["cantCheck", "waitOthers", "noAnswer"].includes(p.banner.kind))) {
    p.banner = { kind: "takeOver", name };
  }
}

const hostFailedNow = (p, now) => p.hostFailed && now - p.hostFailedAt < LIMITS.hostFailedMs;

/** The newest snapshot this guest holds, forwarded as it is (the newcomer sees the room before it reaches the host). */
function forwardSnapshot(p) {
  const s = p.snap;
  const snap = {
    t: "snap", seq: s.seq, epoch: s.epoch, hostName: s.hostName, hostWords: s.hostWords, maxCseq: s.maxCseq,
    members: s.members.map((m) => ({ id: m.id, name: m.name, js: m.js, role: m.role, ...(m.role === "display" ? { of: m.of } : {}) })),
    backups: { ...s.backups }, want: s.want.slice(), ...(s.media ? { media: s.media } : {}), state: { ...s.state }, chat: s.chat.slice(),
  };
  while (jsonBytes(snap) > LIMITS.snapBytes && snap.chat.length) snap.chat.shift();
  return snap;
}

/** The guest's periodic work: say its tab is open, publish its backup door, ask for missing chat (giving a gap up after a `gone` or three tries), say when the host is silent. */
export function guestTick(p, ctx, now) {
  const fromHost = p.snap && p.snap.hostWords === p.joinedWords && !p.awaiting;
  if (p.handle && fromHost && now - p.hereAt >= LIMITS.hereEveryMs) { enqueue(p, "joined", { t: "here" }); p.hereAt = now; }
  if (p.hostFailed && now - p.hostFailedAt >= LIMITS.hostFailedMs) p.hostFailed = false;
  if (p.myWords && fromHost && p.want.includes(p.me.mid) && p.backups[p.me.mid] !== p.myWords && now - p.backupAt >= LIMITS.backupPublishMs && now - p.backupSentAt >= 15000) {
    enqueue(p, "joined", { t: "backup", words: p.myWords });
    p.backupSentAt = now;
  }
  // A door the host itself does not want (any more) is closed, and the host told. Only the host's own snapshot decides it.
  if (p.myWords && fromHost && !p.hostFailed && !p.want.includes(p.me.mid) && now - p.backupAt > 20000) p.closeHosted = true;
  const mine = histMax(p);
  if (fromHost && mine > 0 && now - p.needAt >= LIMITS.needEveryMs * 2 ** Math.min(4, p.lastNeed ? p.lastNeed.tries - 1 : 0)) {
    let gap = firstGap(p.hist, p.oldest, p.holes);
    if (!gap && p.maxKnown > mine && Math.floor(p.maxKnown / LIMITS.epochSpan) === Math.floor(mine / LIMITS.epochSpan) && !inHole(p.holes, mine + 1)) gap = { from: mine + 1, to: p.maxKnown };
    if (gap) {
      const from = Math.max(gap.from, p.oldest);
      const same = p.lastNeed && p.lastNeed.from === from && p.lastNeed.to === gap.to;
      const tries = same ? p.lastNeed.tries + 1 : 1;
      if (tries > LIMITS.needMaxTries) p.holes = [...p.holes, [from, gap.to]].slice(-LIMITS.holes); // given up: never asked again
      else {
        enqueue(p, "joined", { t: "need", from, to: gap.to });
        p.lastNeed = { from, to: gap.to, tries };
        p.needAt = now;
      }
    }
  }
  if (!p.banner && p.handle && !p.awaiting && now - p.lastOkAt > LIMITS.noAnswerMs) p.banner = { kind: "noAnswer" };
}

// ---------- the TV's link endpoint ----------

/** One event of the TV's link endpoint: only the first valid `link` counts; then the endpoint is closed (one use). */
export function linkReceive(p, ev, now) {
  if (!p.link || p.link.used || !isObj(ev) || ev.kind !== "msg") return;
  if (now > p.link.exp) return;
  const m = readLinkMessage(ev.payload);
  if (!m) return;
  p.link = { ...p.link, used: true };
  p.closeHosted = true;
  p.pending = { words: m.words, code: m.code, name: m.name, pair: m.pair };
  if (p.phase === "party") return; // a new phone for a TV already in the party: the pairing goes with the next hello
  p.banner = { kind: "linked", name: m.name };
}

/** The rows of the member list: one per person, a TV shown with the phone it belongs to; equal names numbered («Bea (2)»). */
export function memberRows(roster) {
  const rows = [];
  for (const m of roster.filter((x) => x.role === "seat")) {
    const tvs = roster.filter((x) => x.role === "display" && x.of === m.id);
    rows.push({ id: m.id, name: m.name, host: m.id === "host", phone: true, tv: tvs.length > 0 });
  }
  for (const d of roster.filter((x) => x.role === "display" && !roster.some((s) => s.role === "seat" && s.id === x.of))) {
    rows.push({ id: d.id, name: d.name, host: false, phone: false, tv: true });
  }
  const seen = {};
  for (const r of rows) {
    const key = (r.name || "").toLowerCase();
    seen[key] = (seen[key] || 0) + 1;
    if (seen[key] > 1) r.name = `${r.name || ""} (${seen[key]})`.trim();
  }
  return rows;
}

// ---------- the glue: storage, the room, the outbox ----------

const STORE = "party";
const NAME = "name";

/** The party kept in kino.storage (expires with the room: the chat is never kept beyond it). */
export function loadParty(storage) {
  try {
    const raw = storage.get(STORE);
    const p = raw ? JSON.parse(raw) : null;
    if (isObj(p) && p.v === 2 && isObj(p.me)) return p;
  } catch (e) {
    // a damaged entry starts over
  }
  let name = "";
  try { name = storage.get(NAME) || ""; } catch (e) { name = ""; }
  return newParty(name);
}

/** [p] trimmed for storage: the per-member logs pruned, the lists bounded. Never above LIMITS.saveBytes as JSON. */
export function compactParty(p, now) {
  p.sent = p.sent.filter((s) => now - s.at < 60000).slice(-LIMITS.sendsPerMinute);
  for (const k of Object.keys(p.replies)) { p.replies[k] = p.replies[k].filter((t) => now - t < 60000); if (!p.replies[k].length) delete p.replies[k]; }
  for (const k of Object.keys(p.chatTimes)) { p.chatTimes[k] = p.chatTimes[k].filter((t) => now - t < LIMITS.chatWindowMs); if (!p.chatTimes[k].length) delete p.chatTimes[k]; }
  for (const k of Object.keys(p.lobby).slice(0, -LIMITS.maxMembers * 2)) delete p.lobby[k];
  p.gone = p.gone.slice(-16);
  p.seeks = p.seeks.filter((t) => now - t < 60000);
  p.notes = p.notes.slice(-LIMITS.notes);
  let text = JSON.stringify(p);
  if (utf8(text) > LIMITS.saveBytes) { p.outbox = []; p.jobs = []; text = JSON.stringify(p); }
  if (utf8(text) > LIMITS.saveBytes) { p.hist = trimHistory(p.hist, 32 * 1024); text = JSON.stringify(p); }
  return text;
}

/** Saves the party. A refused write (the store is full) degrades: the outbox and the answers go, the chat shrinks, try again. */
export function saveParty(storage, p, now, log = null) {
  if (p.phase === "idle" && !p.link && !p.pending) { try { storage.remove(STORE); } catch (e) { /* nothing to remove */ } return true; }
  const left = p.expiresAtMs ? p.expiresAtMs - now : LIMITS.roomTtlMin * 60000;
  const ttlMs = Math.max(60000, Math.min(left + 300000, LIMITS.roomTtlMin * 60000 + 300000));
  try {
    storage.set(STORE, compactParty(p, now), { ttlMs });
    return true;
  } catch (e) {
    if (log) log(`watch party: saving the room state was refused (${codeOf(e)}); trimmed and tried again`);
    p.outbox = [];
    p.jobs = [];
    p.hist = trimHistory(p.hist, 16 * 1024);
    try { storage.set(STORE, JSON.stringify(p), { ttlMs }); return true; } catch (x) { return false; }
  }
}

const codeOf = (e) => (e && typeof e.code === "string" ? e.code : "error");

/** Whether one more message of [bytes] fits the plugin's own send budget now. */
function budget(p, now, bytes) {
  p.sent = p.sent.filter((s) => now - s.at < 60000);
  if (p.sent.filter((s) => now - s.at < 1000).length >= LIMITS.sendsPerSecond) return false;
  if (p.sent.length >= LIMITS.sendsPerMinute) return false;
  return p.sent.reduce((n, s) => n + s.bytes, 0) + bytes <= LIMITS.bytesPerMinute;
}

async function sendOne(room, p, session, payload, to, now) {
  const bytes = jsonBytes(payload);
  if (!budget(p, now, bytes)) return "wait";
  try {
    await room.send(payload, { session, ...(to ? { to } : {}) });
    p.sent.push({ at: now, bytes });
    return "sent";
  } catch (e) {
    const code = codeOf(e);
    if (code === "rate_limited") return "wait";
    if (code === "room_unreachable") return "wait";
    return "drop"; // bad_request, a member gone, a session closed
  }
}

/** Sends what is queued: the broadcasts and short messages first, then the history answers, within the send budget. */
async function flush(room, p, now) {
  while (p.outbox.length) {
    const item = p.outbox[0];
    const session = item.session === "hosted" ? "hosted" : p.handle;
    if (!session) { p.outbox.shift(); continue; }
    const r = await sendOne(room, p, session, item.payload, item.to, now);
    if (r === "wait") return;
    p.outbox.shift();
  }
  if (p.role !== "host" || !p.jobs.length) return;
  // Round by round, one answer per job each round, until the budget or each member's allowance runs out.
  for (let round = 0; round < LIMITS.chunksPerMemberMinute && p.jobs.length; round++) {
    for (const job of p.jobs.slice()) {
      const { entries, have, gone } = historyRange(p.hist, job.next, job.end);
      let payload = null;
      let next = job.next;
      if (have !== null && !job.sentAny) { payload = { t: "have", from: have }; next = have; }
      else if (gone) payload = job.sentAny ? null : { t: "gone", from: job.from, to: job.end };
      else {
        const chunk = chunkEntries(entries)[0];
        payload = { t: "hist", entries: chunk };
        next = chunk[chunk.length - 1].c + 1;
      }
      if (payload) {
        const key = "hist:" + job.to;
        const recent = (p.replies[key] || []).filter((t) => now - t < 60000);
        if (recent.length >= LIMITS.chunksPerMemberMinute) continue; // this member's allowance: later
        const r = await sendOne(room, p, "hosted", payload, job.to, now);
        if (r === "wait") return;
        p.replies[key] = [...recent, now];
        if (r === "drop") next = job.end + 1;
        job.sentAny = true;
        job.next = next;
      }
      if (!payload || job.next > job.end || payload.t === "gone") p.jobs = p.jobs.filter((j) => j !== job);
    }
  }
}

async function drain(room, p, session, cursor, onEvent, now) {
  for (let i = 0; i < 4; i++) {
    let box;
    try {
      box = await room.inbox({ since: p.cursors[cursor], session });
    } catch (e) {
      if (codeOf(e) === "room_closed") return "closed";
      return "error";
    }
    if (!isObj(box) || !Array.isArray(box.events)) return "error";
    for (const ev of box.events) onEvent(p, ev, now);
    if (Number.isFinite(box.last)) p.cursors[cursor] = Math.max(p.cursors[cursor], box.last);
    if (!box.more) return "ok";
  }
  return "ok";
}

/**
 * A host looking for the room at another door. The only proof that the room went on there: a snapshot from that door's own
 * holder as host (`hostWords` = the probed door), at exactly this host's epoch + 1 (a change of host moves it by one), when
 * that holder is the successor this host's own last view predicts. It is shown to the person («La sala siguió con Mal»), who
 * decides; nothing closes by itself. A redirect, or anything older, means the room is still here.
 */
function probeReceive(p, ev, now) {
  if (!p.probe || p.probe.found || !isObj(ev) || ev.from !== "host" || ev.kind !== "msg") return;
  const m = readHostMessage(ev.payload);
  if (!m) return;
  if (m.t === "snap" && m.hostWords === p.probe.words) {
    if (m.epoch === p.epoch + 1 && p.probe.predicted) p.probe = { ...p.probe, found: m };
    else p.probe = { ...p.probe, done: "here" };
  } else if (m.t === "redirect") p.probe = { ...p.probe, done: m.words === p.hostWords ? "here" : "elsewhere" };
}

/** One round of room work for this device: read the mailboxes, run the reducers, close what must close, send. */
export async function pump(room, p, ctx, now) {
  if (p.link && !p.link.used && now > p.link.exp) {
    p.closeHosted = true;
    p.link = null;
    note(p, now, "El código para el teléfono venció", "The code for the phone expired");
  }
  // The TV's link endpoint (a display seat never holds a backup door, so the hosted slot is the link's alone).
  if (p.link && !p.link.used) await drain(room, p, "hosted", "hosted", linkReceive, now);
  if (p.pending && p.phase === "party") {
    if (p.pending.code === p.code) {
      // A new phone for a TV already in this room: the pairing goes with a fresh hello.
      p.me.pair = p.pending.pair;
      enqueue(p, "joined", helloOf(p));
      p.pending = null;
    } else if (!p.banner) p.banner = { kind: "linked", name: p.pending.name };
  }
  if (p.phase === "party" && p.role === "host") {
    const r = await drain(room, p, "hosted", "hosted", hostReceive, now);
    if (r === "closed" && (!p.banner || !["ended", "moved"].includes(p.banner.kind))) p.banner = { kind: "closedMine" };
    if (p.probe) await runProbe(room, p, now);
    if (p.role === "host") hostTick(p, ctx, now);
  } else if (p.phase === "party" && p.role === "guest") {
    if (p.handle) {
      const r = await drain(room, p, p.handle, "joined", guestReceive, now);
      // Kino closed this device's own session (the host dropped it after 2 minutes of silence, or it went offline): this
      // device was away. Nothing is concluded about the host; one press joins its door again.
      if (r === "closed") { p.handle = null; p.awaiting = null; p.hostFailed = false; p.banner = { kind: "dropped" }; }
    }
    if (p.myWords && p.role === "guest") {
      const r = await drain(room, p, "hosted", "hosted", lobbyReceive, now);
      if (r === "closed") { p.myWords = null; p.cursors.hosted = 0; }
    }
    if (p.role === "guest") guestTick(p, ctx, now);
    else hostTick(p, ctx, now); // just promoted
  }
  if (p.closeJoined) {
    try { await room.close({ session: p.closeJoined }); } catch (e) { /* already gone */ }
    p.closeJoined = null;
    p.cursors.joined = 0;
  }
  if (p.closeHosted) {
    try { await room.close({ session: "hosted" }); } catch (e) { /* already gone */ }
    p.closeHosted = false;
    if (p.role !== "host" && p.myWords) { p.myWords = null; p.backupAt = 0; if (p.handle) enqueue(p, "joined", { t: "nobackup" }); }
    p.cursors.hosted = 0;
  }
  await flush(room, p, now);
}

async function runProbe(room, p, now) {
  await drain(room, p, p.probe.handle, "probe", probeReceive, now);
  const pr = p.probe;
  if (pr.found) {
    if (!p.banner || p.banner.kind !== "moved") p.banner = { kind: "moved", name: pr.found.hostName, count: pr.found.members.length };
    return;
  }
  if (pr.done || now - pr.at > LIMITS.probeMs) {
    try { await room.close({ session: pr.handle }); } catch (e) { /* gone */ }
    p.probe = null;
    if (p.banner && ["alone", "moved"].includes(p.banner.kind)) p.banner = null;
    p.aloneSince = 0;
    p.realLeftAt = 0;
    if (pr.done === "here") p.leftDoors = {};
    if (!p.banner || p.banner.kind !== "closedMine") note(p, now, "No encontramos la sala en otra puerta", "The room was not found at another door");
  }
}

/** «Unirme»: the person accepts the proof the probe found; this device closes its own room and becomes that host's guest. */
function stepDown(p, now) {
  const pr = p.probe;
  p.closeHosted = true;
  p.role = "guest";
  p.myWords = null;
  p.handle = pr.handle;
  p.joinedWords = pr.words;
  p.cursors.joined = p.cursors.probe;
  p.probe = null;
  p.banner = null;
  p.recovering = false;
  p.jobs = [];
  p.outbox = [];
  p.me.mid = pr.mid;
  addMyMid(p, pr.mid);
  applySnapshot(p, pr.found, now);
  enqueue(p, "joined", helloOf(p));
  if (p.me.pairOut) enqueue(p, "joined", { t: "pair", token: p.me.pairOut });
}

// ---------- texts (Kino-first: every text has its Spanish base and English twin) ----------

const T = {
  title: ["Fiesta", "Watch party"],
  intro: ["Mira con otras personas a la vez: chat y video sincronizado. La sala vive en el aparato de quien la crea.", "Watch together: chat and playback in step. The room lives on the device of whoever creates it."],
  sameSource: ["Todos deben ver el mismo título con el mismo plugin.", "Everyone must watch the same title through the same plugin."],
  yourName: ["Tu nombre", "Your name"],
  create: ["Crear sala", "Create room"],
  joinToggle: ["Unirme a una sala", "Join a room"],
  words: ["Palabras de la sala", "Room words"],
  code: ["Código (4 números)", "Code (4 digits)"],
  enter: ["Entrar", "Join"],
  scan: ["Escanear el código QR", "Scan the QR code"],
  scanTitle: ["Escanea el código de la sala", "Scan the room's code"],
  linkStart: ["Vincular con mi teléfono", "Link with my phone"],
  linkInfo: ["En tu teléfono, dentro de la sala, toca «Agregar dispositivo» y escanea este código. Sirve una sola vez.", "On your phone, inside the room, tap “Add device” and scan this code. It works once."],
  linkCancel: ["Cancelar", "Cancel"],
  addDevice: ["Agregar dispositivo", "Add device"],
  addDeviceTitle: ["Escanea el código que muestra TU televisor", "Scan the code YOUR TV shows"],
  send: ["Enviar", "Send"],
  message: ["Mensaje", "Message"],
  emojiMore: ["Más emojis", "More emoji"],
  follow: ["Seguir al anfitrión", "Follow the host"],
  sync: ["Sincronizar", "Sync"],
  leave: ["Salir de la sala", "Leave the room"],
  leaveConfirm: ["¿Salir de la sala?", "Leave the room?"],
  chatTab: ["Chat", "Chat"],
  roomTab: ["Sala", "Room"],
  invite: ["Invitar", "Invite"],
  inviteInfo: ["Comparte las palabras y el código, o que escaneen el QR. El código evita que entre quien no lo tenga; no es un cifrado de alta seguridad: no compartas nada sensible.", "Share the words and the code, or let them scan the QR. The code keeps out whoever does not have it; it is not high-security encryption: share nothing sensitive."],
  openBackup: ["Abrir puerta de respaldo", "Open a backup door"],
  backupInfo: ["Si el anfitrión se va, la sala sigue en una puerta de respaldo.", "If the host leaves, the room goes on through a backup door."],
  empty: ["Todavía no hay mensajes.", "No messages yet."],
  same: ["Viendo lo mismo", "Watching the same"],
  members: ["Personas", "People"],
  noScreens: ["La Fiesta necesita las pantallas de plugins activas en Ajustes.", "Watch party needs plugin screens switched on in Settings."],
  openTitle: ["Abrir este título", "Open this title"],
  resync: ["Volver a sincronizar", "Sync again"],
  retry: ["Reintentar", "Try again"],
  findRoom: ["Buscar la sala", "Look for the room"],
  hostMark: ["anfitrión", "host"],
};
const tx = (k) => ({ es: T[k][0], en: T[k][1] });
const both = (es, en) => ({ es, en });

function errorText(e) {
  if (e && typeof e.userMessage === "string" && e.userMessage) return both(e.userMessage, e.userMessage);
  switch (codeOf(e)) {
    case "room_denied": return both("Ese código no es el de la sala", "That is not the room's code");
    case "room_closed": return both("La sala ya se cerró", "The room is closed");
    case "room_full": return both("La sala está llena", "The room is full");
    case "room_unreachable": return both("No se pudo llegar a la sala. Revisa la conexión.", "The room could not be reached. Check the connection.");
    case "room_busy": return both("Este aparato ya está en otras salas", "This device is already in other rooms");
    case "rate_limited": return both("Demasiados intentos: espera un momento", "Too many tries: wait a moment");
    case "permission_denied": return both("La Fiesta no tiene permiso para salas: revísalo en Ajustes", "Watch party may not use rooms: check it in Settings");
    default: return both("Algo salió mal con la sala", "Something went wrong with the room");
  }
}

const toast = (t, role) => ({ toast: role ? { text: t.es, textEn: t.en, role } : t.es, toastEn: t.en });

/**
 * «Copiar invitación» and «Copiar solo el código»: Kino's `go.copy` (a press only; Kino shows «Copiado»; `sensitive` keeps the
 * text out of clipboard previews). Never on a TV (Kino drops the copy there): `devices` and the context say so.
 */
function copyButtons(p, ctx) {
  if (!p.code || !p.hostWords || (ctx && ctx.device === "tv")) return [];
  const text = invitationText({ words: p.hostWords, code: p.code, media: p.media });
  return [{
    type: "Row", wrap: true, gap: 4, devices: ["phone", "desktop"],
    children: [
      Btn("TextButton", both("Copiar invitación", "Copy invitation"), { go: { copy: { text, label: "Invitación a la Fiesta", sensitive: true } } }, { key: "btnCopyInvite", icon: "copy" }),
      Btn("TextButton", both("Copiar solo el código", "Copy the code only"), { go: { copy: { text: p.code, label: "Código de la Fiesta", sensitive: true } } }, { key: "btnCopyCode", icon: "copy" }),
    ],
  }];
}

/**
 * Presses that wait on the room (`room.open` / `room.join`, a few seconds through the tunnel): the hidden progress row the tap
 * shows at once, and the button it disables against a second tap. The answer to the event hides the row and enables the
 * button again, success or failure.
 */
export const BUSY_ROWS = {
  busyCreate: ["Creando la sala…", "Creating the room…"],
  busyJoin: ["Uniéndose a la sala…", "Joining the room…"],
  busySearch: ["Buscando la sala…", "Looking for the room…"],
  busyDoor: ["Abriendo la puerta de respaldo…", "Opening the backup door…"],
  busyLink: ["Preparando el código para el teléfono…", "Preparing the code for the phone…"],
  busyTv: ["Vinculando el televisor…", "Linking the TV…"],
};
export const BUSY = {
  create: { row: "busyCreate", button: "btnCreate" },
  join: { row: "busyJoin", button: "btnJoin" },
  scanJoin: { row: "busyJoin", button: "btnScan" },
  redirect: { row: "busyJoin" },
  followHost: { row: "busyJoin" },
  retryHost: { row: "busyJoin" },
  enterParty: { row: "busyJoin" },
  joinMoved: { row: "busyJoin" },
  findRoom: { row: "busySearch", button: "btnFind" },
  openBackup: { row: "busyDoor", button: "btnBackup" },
  linkStart: { row: "busyLink", button: "btnLink" },
  addDevice: { row: "busyTv", button: "btnAddDevice" },
};

/** The tap of a press that waits: the progress row shown and the button disabled at once (Kino's own ui operations), then the event. */
export function busyTap(event) {
  const b = BUSY[event];
  return { ui: [{ show: b.row }, ...(b.button ? [{ disable: b.button }] : [])], event };
}

/** The ui operations an answer to [event] carries: the row hidden, the button enabled again. */
function settle(event) {
  const b = BUSY[event];
  return b ? [{ hide: b.row }, ...(b.button ? [{ enable: b.button }] : [])] : [];
}

/** A failed press that waits: the error shown in place (Kino's panel state) with a retry of the same press. */
const failed = (event, t) => ({ state: { error: { es: t.es, en: t.en, retry: BUSY[event] ? event : null } } });

/** The progress rows (hidden until a tap shows one), present in every state of the tab: one label each, read by screen readers. */
function busyRows() {
  return Object.entries(BUSY_ROWS).map(([key, [es, en]]) => ({
    type: "Row", key, hidden: true, gap: 8, crossAxisAlignment: "center",
    children: [{ type: "LinearProgressIndicator", labelText: es, labelTextEn: en, flex: 1 }],
  }));
}

/** The error of the last press that waited, in place, with its retry. */
function errorBanner(ctx) {
  const e = isObj(ctx.state) && isObj(ctx.state.error) ? ctx.state.error : null;
  if (!e || typeof e.es !== "string") return null;
  const retry = typeof e.retry === "string" && BUSY[e.retry] ? Action(tx("retry"), busyTap(e.retry)) : undefined;
  return Banner("error", both(e.es, typeof e.en === "string" ? e.en : e.es), retry);
}

// ---------- drawing the tab (screen kit, narrow enough for the pinned panel) ----------

const Text = (t, extra = {}) => ({ type: "Text", text: t.es, textEn: t.en, ...extra });
const Btn = (type, t, onPressed, extra = {}) => ({ type, labelText: t.es, labelTextEn: t.en, onPressed, ...extra });
const Banner = (role, t, action) => ({ type: "MaterialBanner", role, text: t.es, textEn: t.en, ...(action ? { action } : {}) });
const Action = (t, onTap, arg) => ({ label: t.es, labelEn: t.en, onTap, ...(arg !== undefined ? { arg } : {}) });

function entryLine(e) {
  return both(`${displayName(e.n)}: ${e.x}`, `${displayName(e.n, true)}: ${e.x}`);
}

function matchBanner(p, ctx) {
  if (p.role === "host") return null;
  const m = mediaMatch(ctx, p.media);
  const go = titleByIdsOf(p.media);
  const open = go ? Action(tx("openTitle"), { go }) : undefined;
  switch (m.reason) {
    case "same": return { type: "Badge", text: "✓ " + T.same[0], textEn: "✓ " + T.same[1] };
    case "noRoomTitle": return null;
    case "noSource": return Banner("info", both("Este video no es de un plugin: solo chat.", "This video is not a plugin's: chat only."));
    case "live": return Banner("info", both("En vivo: solo chat, sin sincronizar.", "Live: chat only, no sync."));
    case "noIds": return Banner("info", both("No se puede sincronizar este título: su plugin no da sus identificadores. Solo chat.", "This title cannot be synced: its plugin gives no ids for it. Chat only."));
    case "otherTitle": return Banner("warning", both(`La sala ve «${p.media.title || "otro título"}».`, `The room watches “${p.media.title || "another title"}”.`), open);
    case "otherSource": {
      const name = (p.media && p.media.source.name) || p.media.source.pluginId;
      return Banner("warning", both(`Esta sala usa «${name}»: abre el título con ese plugin. Si no lo tienes, instálalo primero.`, `This room uses “${name}”: open the title with that plugin. If you don't have it, install it first.`), open);
    }
    default: return null;
  }
}

function partyBanner(p, now) {
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
    case "noAnswer":
      return Banner("warning", both("El anfitrión no responde. Puede ser tu conexión o la suya.", "The host is not answering. It may be your connection or theirs."), Action(tx("retry"), busyTap("retryHost")));
    case "cantCheck":
      return Banner("warning", both("Sin conexión con la sala: no llegamos al anfitrión ni a otra puerta. Puede ser tu conexión.", "No connection to the room: neither the host nor another door answers. It may be your connection."), Action(tx("retry"), busyTap("retryHost")));
    case "waitOthers":
      return Banner("info", both("No llegamos al anfitrión. Si se fue, los demás llegarán a tu puerta y te avisaremos.", "We cannot reach the host. If they left, the others will reach your door and we will tell you."), Action(tx("retry"), busyTap("retryHost")));
    case "takeOver":
      return Banner("warning", both(`${displayName(b.name)} tampoco llega al anfitrión. ¿Sigues tú como anfitrión?`, `${displayName(b.name, true)} cannot reach the host either. Will you go on as host?`), Action(both("Seguir yo", "Go on myself"), busyTap("retryHost")));
    case "alone":
      return Banner("info", both("Todos salieron de tu sala. Si siguieron en otra puerta, puedes buscarla.", "Everyone left your room. If they went on through another door, you can look for it."), Action(tx("findRoom"), busyTap("findRoom")));
    case "moved":
      return Banner("warning", both(`La sala siguió con ${displayName(b.name)} (${b.count} personas). Si te unes, tu sala se cierra.`, `The room went on with ${displayName(b.name, true)} (${b.count} people). Joining closes your room.`), Action(both("Unirme", "Join"), busyTap("joinMoved")));
    case "closedMine":
      return Banner("warning", both("Tu sala se cerró en este aparato.", "Your room closed on this device."), Action(tx("findRoom"), busyTap("findRoom")));
    case "ended":
      return Banner("error", both("Tu sala terminó en este aparato y no hay otra puerta. Sal y crea otra si quieres.", "Your room ended on this device and there is no other door. Leave and create another if you like."), Action(tx("leave"), "leave"));
    case "linked":
      return Banner("success", both(`Teléfono vinculado: ${displayName(b.name)}. Entra a su sala.`, `Phone linked: ${displayName(b.name, true)}. Join its room.`), Action(tx("enter"), busyTap("enterParty")));
    default:
      return null;
  }
}

function chatList(p) {
  const entries = p.hist.slice(-LIMITS.shown).reverse();
  return {
    type: "ListView", key: "chat",
    items: entries.map((e) => Text(entryLine(e), { style: e.k === "emoji" ? "h5" : "p" })),
    empty: Text(tx("empty"), { color: "muted" }),
  };
}

function chatTab(p, now, ctx) {
  const display = p.me.role === "display";
  const children = [];
  // «Sala abierta»: the host alone in its room gets the invitation right away.
  if (p.role === "host" && !p.roster.some((m) => m.id !== "host")) {
    children.push(Text(both(`Sala abierta. Palabras: ${p.hostWords} · Código: ${groupCode(p.code)}`, `Room open. Words: ${p.hostWords} · Code: ${groupCode(p.code)}`)));
    children.push(...copyButtons(p, ctx));
  }
  if (p.lastReaction && now - p.lastReaction.at < 6000) children.push(Text(both(`${p.lastReaction.x} ${displayName(p.lastReaction.n)}`, `${p.lastReaction.x} ${displayName(p.lastReaction.n, true)}`), { style: "h3" }));
  const recent = p.notes.filter((n) => now - n.at < 20000).slice(-2);
  for (const n of recent) children.push(Text(both(n.es, n.en), { style: "caption", color: "muted" }));
  children.push({
    type: "Row", wrap: true, gap: 4,
    children: EMOJIS.map((e, i) => ({ type: "TextButton", labelText: e, onPressed: "emoji", arg: String(i), span: 3 })),
  });
  if (!display) {
    children.push({ type: "TextField", key: "chatText", labelText: T.message[0], labelTextEn: T.message[1], maxLength: LIMITS.textChars, onSubmitted: "send" });
    children.push({
      type: "Row", wrap: true, gap: 4,
      children: [Btn("ElevatedButton", tx("send"), "send", { span: 6 }), Btn("TextButton", tx("emojiMore"), { ui: [{ toggle: "picker" }] }, { span: 6 })],
    });
    children.push({ type: "GridView", key: "picker", hidden: true, columns: 6, children: PICKER.map((e, i) => ({ type: "TextButton", labelText: e, onPressed: "pick", arg: String(i) })) });
  } else if (p.link && !p.link.used) {
    children.push(...linkNodes(p));
  } else if (!p.me.of) {
    children.push(Banner("info", both("Sin teléfono vinculado: solo reacciones", "No phone linked: reactions only"), Action(tx("linkStart"), busyTap("linkStart"))));
  }
  if (p.role === "guest") {
    children.push({
      type: "Row", wrap: true, gap: 4,
      children: [
        { type: "Switch", key: "follow", value: p.follow, labelText: T.follow[0], labelTextEn: T.follow[1], onChanged: "follow", span: 8 },
        Btn("TextButton", tx("sync"), "sync", { span: 4 }),
      ],
    });
  }
  for (const m of pendingOwn(p, now)) children.push(Text(both(`${displayName(p.me.name)}: ${m.x} (enviando…)`, `${displayName(p.me.name, true)}: ${m.x} (sending…)`), { color: "muted" }));
  if (p.stuck) children.push(Text(both("No logramos alcanzar al anfitrión: tu video tarda en cargar. Prueba «Sincronizar» en un momento.", "We cannot catch up with the host: your video is slow to load. Try “Sync” in a moment."), { style: "caption", color: "warning" }));
  else if (p.correctedTo !== null && now - p.correctedAt < 8000) children.push(Text(both(`Ajustado al anfitrión: ${clockText(p.correctedTo)}`, `Moved to the host: ${clockText(p.correctedTo)}`), { style: "caption", color: "muted" }));
  children.push(chatList(p));
  return children;
}

/** This guest's own messages the host has not echoed yet (dropped after 20 s). */
function pendingOwn(p, now) {
  return p.pendingMine.filter((m) => now - m.at < 20000 && !p.hist.some((e) => p.myMids.includes(e.by) && e.k === "msg" && e.x === m.x && e.at >= m.at - 60000));
}

function clockText(ms) {
  const s = Math.floor(ms / 1000);
  const two = (n) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

function roomTab(p, ctx) {
  const rows = memberRows(p.roster);
  const children = [Text(tx("members"), { style: "h5" })];
  for (const r of rows) {
    const marks = (r.phone ? " 📱" : "") + (r.tv ? " 📺" : "");
    const line = [Text(both(`${displayName(r.name)}${marks}`, `${displayName(r.name, true)}${marks}`), { flex: 1 })];
    if (r.host) line.push({ type: "Badge", text: T.hostMark[0], textEn: T.hostMark[1] });
    children.push({ type: "Row", gap: 4, crossAxisAlignment: "center", children: line });
  }
  const doors = 1 + Object.keys(p.backups).length;
  children.push(Text(both(`Puertas abiertas: ${doors}`, `Open doors: ${doors}`), { style: "caption", color: "muted" }));
  if (p.me.role === "seat" && p.code) {
    const words = p.hostWords;
    children.push({ type: "Divider" });
    children.push(Text(tx("invite"), { style: "h5" }));
    children.push(Text(both(`Palabras: ${words}`, `Words: ${words}`)));
    children.push(Text(both(`Código: ${groupCode(p.code)}`, `Code: ${groupCode(p.code)}`), { bold: true }));
    if (p.role === "host") children.push(...copyButtons(p, ctx));
    children.push({ type: "QrImage", value: partyQrText(words, p.code), labelText: "Código QR de la sala", labelTextEn: "The room's QR code", size: "small" });
    children.push(Text(tx("inviteInfo"), { style: "caption", color: "muted" }));
    if (p.myWords && p.myWords !== words) children.push(Text(both(`Tu puerta de respaldo: ${p.myWords}`, `Your backup door: ${p.myWords}`), { style: "caption" }));
    if (p.role === "guest" && p.want.includes(p.me.mid) && !p.myWords) {
      children.push(Text(tx("backupInfo"), { style: "caption", color: "muted" }));
      children.push(Btn("TextButton", tx("openBackup"), busyTap("openBackup"), { key: "btnBackup" }));
    }
    children.push(Btn("TextButton", tx("addDevice"), busyTap("addDevice"), { key: "btnAddDevice", devices: ["phone"] }));
  }
  if (p.link && !p.link.used) children.push(...linkNodes(p));
  // A host alone that knows other doors may look for the room there (the «alone» notice only shows after a real departure).
  if (p.role === "host" && !p.roster.some((m) => m.id !== "host") && Object.keys(p.leftDoors).length && !p.probe) {
    children.push(Btn("TextButton", both("Buscar la sala en otra puerta", "Look for the room at another door"), busyTap("findRoom"), { key: "btnFind" }));
  }
  children.push({ type: "Divider" });
  children.push(Btn("TextButton", tx("leave"), "leave", { confirm: T.leaveConfirm[0], confirmEn: T.leaveConfirm[1] }));
  return children;
}

function linkNodes(p) {
  return [
    Text(tx("linkInfo")),
    { type: "QrImage", value: linkQrText(p.link.words, p.link.code, p.link.exp), labelText: "Código para vincular el teléfono", labelTextEn: "Code to link the phone", size: "medium" },
    Text(both("Vence a los 5 minutos.", "It expires after 5 minutes."), { style: "caption", color: "muted" }),
    Btn("TextButton", tx("linkCancel"), "linkCancel"),
  ];
}

function idleNodes(p, ctx) {
  // The panel's own title already says «Fiesta»: the body starts with what it is for.
  const children = [Text(tx("intro")), Text(tx("sameSource"), { style: "caption", color: "muted" })];
  if (p.pending) {
    children.push(Banner("success", both(`Teléfono vinculado: ${displayName(p.pending.name)}`, `Phone linked: ${displayName(p.pending.name, true)}`), Action(tx("enter"), busyTap("enterParty"))));
    return children;
  }
  if (p.link && !p.link.used) { children.push(...linkNodes(p)); return children; }
  children.push({ type: "TextField", key: "myName", labelText: T.yourName[0], labelTextEn: T.yourName[1], maxLength: LIMITS.nameChars, value: p.me.name });
  children.push(Btn("ElevatedButton", tx("create"), busyTap("create"), { key: "btnCreate" }));
  children.push(Btn("TextButton", tx("joinToggle"), { ui: [{ toggle: "joinForm" }] }));
  children.push({
    type: "Form", key: "joinForm", hidden: true, onSubmitted: busyTap("join"),
    children: [
      { type: "TextField", key: "joinPaste", labelText: "Pega aquí la invitación", labelTextEn: "Paste the invitation here", maxLength: 1000, multiline: true },
      Btn("TextButton", both("Leer la invitación", "Read the invitation"), "readInvite", { key: "btnReadInvite" }),
      ...inviteFeedback(ctx),
      { type: "TextField", key: "joinWords", labelText: T.words[0], labelTextEn: T.words[1], maxLength: 500, required: true },
      { type: "TextField", key: "joinCode", labelText: T.code[0], labelTextEn: T.code[1], maxLength: 20 },
      { type: "ElevatedButton", key: "btnJoin", labelText: T.enter[0], labelTextEn: T.enter[1], submit: true },
    ],
  });
  children.push(Btn("TextButton", tx("scan"), busyTap("scanJoin"), { key: "btnScan", devices: ["phone"] }));
  children.push(Btn("TextButton", tx("linkStart"), busyTap("linkStart"), { key: "btnLink", devices: ["tv"] }));
  return children;
}

/** What a read invitation shows before joining: the words and the code to confirm, or why nothing was found. */
function inviteFeedback(ctx) {
  const st = isObj(ctx && ctx.state) ? ctx.state : {};
  if (isObj(st.invite) && typeof st.invite.words === "string" && typeof st.invite.code === "string") {
    return [Text(both(`Vas a entrar a: ${st.invite.words} · código ${groupCode(st.invite.code)}. Toca «Entrar».`, `You are about to join: ${st.invite.words} · code ${groupCode(st.invite.code)}. Tap “Join”.`), { bold: true })];
  }
  if (st.inviteError === true) return [Text(both("No encuentro las palabras o el código", "I cannot find the words or the code"), { color: "error" })];
  return [];
}

/** The tab's result (screen format), or the legacy panel when Kino's plugin screens are off. */
export function view(p, ctx, now, player = null) {
  const features = Array.isArray(ctx.features) ? ctx.features : [];
  if (!features.includes("screen")) return { title: T.title[0], titleEn: T.title[1], elements: [{ type: "text", text: T.noScreens[0], textEn: T.noScreens[1] }] };
  const inRoom = p.phase === "party";
  const base = { format: "screen", title: T.title[0], titleEn: T.title[1], ...(inRoom || p.link ? { refreshMs: LIMITS.refreshMs } : {}), ...(player ? { player } : {}) };
  const top = [...busyRows()];
  const err = errorBanner(ctx);
  if (err) top.push(err);
  if (!inRoom) return { ...base, root: { type: "Column", gap: 8, padding: 8, children: [...top, ...idleNodes(p, ctx)] } };
  const asked = ctx.tab === "room" || ctx.tab === "chat" ? ctx.tab : isObj(ctx.state) ? ctx.state.tab : null;
  const tab = asked === "room" ? "room" : "chat";
  const head = [Text(both(`Sala de ${displayName(p.hostName)}`, `${displayName(p.hostName, true)}'s room`), { style: "h5" })];
  const pb = partyBanner(p, now);
  if (pb) head.push(pb);
  if (p.hold && p.role === "guest") head.push(Banner("info", both("Pausaste o seguiste por tu cuenta: la sala sigue.", "You paused or resumed yourself: the room goes on."), Action(tx("resync"), "resync")));
  const mb = matchBanner(p, ctx);
  if (mb) head.push(mb);
  return {
    ...base,
    tabs: [{ id: "chat", label: T.chatTab[0], labelEn: T.chatTab[1] }, { id: "room", label: T.roomTab[0], labelEn: T.roomTab[1] }],
    tab,
    root: { type: "Column", gap: 8, padding: 8, children: [...top, ...head, ...(tab === "room" ? roomTab(p, ctx) : chatTab(p, now, ctx))] },
  };
}

// ---------- the guest's player ----------

/**
 * The correction this panel call carries, recorded so the player events it causes are known as ours. After a seek, once the
 * video moves again (or LIMITS.seekGapMs passed), the lag it left is measured against where the host is NOW and folded into
 * `lead` (`lead + residual`, kept within 0..5 s): a slow first seek and fast later ones converge instead of overshooting.
 */
function correction(p, ctx, now) {
  if (p.phase !== "party" || p.role !== "guest" || !p.handle || p.awaiting) return null;
  const local = { pos: Number(ctx.positionMs) || 0, paused: ctx.paused, speed: ctx.player && ctx.player.speed };
  const skew = skewOf(p.skew);
  const sp = p.seekPending;
  if (sp && !sp.measured && p.st && !p.st.paused && (local.pos > sp.to + 300 || now - sp.at >= LIMITS.seekGapMs)) {
    const residual = Math.round(expectedPos(p.st, now, skew) - local.pos);
    p.lead = Math.max(0, Math.min(5000, p.lead + residual));
    p.seekPending = { ...sp, measured: true };
  }
  p.seeks = p.seeks.filter((t) => now - t < 60000);
  const action = syncAction({
    local, st: p.st, stAt: p.stAt, now, skew, follow: p.follow, match: mediaMatch(ctx, p.media), hold: p.hold,
    lastAction: p.lastAction, durationMs: Number.isFinite(ctx.durationMs) ? ctx.durationMs : null, seeks: p.seeks, lead: p.lead,
  });
  const off = p.st && p.follow && !p.hold && Math.abs(expectedPos(p.st, now, skew) - local.pos) > LIMITS.driftMs;
  p.stuck = Boolean(off && p.seeks.length >= LIMITS.seeksPerMinute);
  if (!action) return null;
  if (action.pause !== undefined || action.speed !== undefined) p.lastAction = now;
  if (action.pause !== undefined) p.expect = { paused: action.pause, at: now };
  if (action.seekToMs !== undefined) {
    p.seeks = [...p.seeks, now];
    p.seekPending = { to: action.seekToMs, at: now, measured: false };
    p.correctedTo = action.seekToMs;
    p.correctedAt = now;
  }
  return action;
}

// ---------- the exports Kino calls ----------

const io = () => kino;
const logOf = (k) => (k.log && typeof k.log.warn === "function" ? (line) => k.log.warn(line) : null);

/** `panel(context)` at time [now] (the export below passes the clock; tests pass their own). */
export async function panelAt(ctx, now) {
  const k = io();
  const p = loadParty(k.storage);
  if (p.phase === "party" || p.link) {
    try { await pump(k.room, p, ctx, now); } catch (e) { /* a room hiccup never breaks the tab */ }
  }
  const player = correction(p, ctx, now);
  saveParty(k.storage, p, now, logOf(k));
  return view(p, ctx, now, player);
}

/** `playerEvent(event, context)` at [now]: the host tells the room at once; a guest notices it paused or resumed by itself. */
export async function playerEventAt(event, ctx, now) {
  const k = io();
  const p = loadParty(k.storage);
  if (p.phase !== "party" || !isObj(event)) return null;
  const type = event.type;
  if (p.role === "host" && ["paused", "resumed", "started"].includes(type)) {
    p.forceState = type === "paused" ? "pause" : type === "resumed" ? "resume" : "start";
    try { await pump(k.room, p, { ...ctx, paused: type === "paused" ? true : type === "resumed" ? false : ctx.paused }, now); } catch (e) { /* next tick */ }
  } else if (p.role === "guest" && (type === "paused" || type === "resumed") && p.follow) {
    const paused = type === "paused";
    const ours = p.expect && p.expect.paused === paused && now - p.expect.at < LIMITS.holdMatchMs;
    if (!ours && p.st && p.st.paused !== paused) p.hold = true;
    p.expect = null;
  }
  saveParty(k.storage, p, now, logOf(k));
  return null;
}

async function joinRoom(k, p, words, code, name, role, now, extra = {}) {
  const joined = await k.room.join({ words, code, name: name || undefined });
  const fresh = p.phase !== "party" || p.code !== code;
  if (fresh) {
    const me = { ...newParty(name).me, name: scrubName(name), role, pair: extra.pair || null, pairOut: p.me.pairOut || null };
    Object.assign(p, newParty(name), { me });
  }
  p.phase = "party";
  p.role = "guest";
  p.code = code;
  p.handle = joined.handle;
  p.joinedWords = normWords(words) || words;
  p.awaiting = null;
  p.me.mid = joined.memberId;
  addMyMid(p, joined.memberId);
  p.hostName = scrubName(joined.host && joined.host.name);
  if (fresh) p.hostWords = words;
  p.expiresAtMs = joined.expiresAtMs;
  p.cursors = { ...(p.cursors || {}), joined: 0 };
  p.snapAt = now;
  p.lastOkAt = now;
  p.redirect = null;
  p.banner = null;
  p.outbox = p.outbox.filter((o) => o.session === "hosted");
  enqueue(p, "joined", helloOf(p));
  // A phone that linked a TV gives its pairing token to every host it joins, so its TV is shown with it there too.
  if (p.me.role === "seat" && p.me.pairOut) enqueue(p, "joined", { t: "pair", token: p.me.pairOut });
  return joined;
}

/** This device's hello: its name and seat, a TV's pairing token, and how far its chat goes. Never an id: Kino names the sender. */
function helloOf(p) {
  return { t: "hello", name: p.me.name, role: p.me.role, ...(p.me.role === "display" && p.me.pair ? { pair: p.me.pair } : {}), maxCseq: histMax(p) };
}

/** Opens this device's backup door (same code, its own words): only from a press, and only for a seat. */
async function openBackup(k, p, now) {
  if (p.me.role !== "seat" || p.role !== "guest" || p.myWords) return false;
  const opened = await k.room.open({ code: p.code, ttlMin: LIMITS.roomTtlMin, max: LIMITS.maxMembers, name: p.me.name || undefined });
  p.myWords = opened.words;
  p.backupAt = now;
  p.backupSentAt = 0;
  p.cursors.hosted = 0;
  return true;
}

/** `panelAction(event, context)` at [now]: the person's presses. Every room call that needs a press happens here. */
export async function panelActionAt(event, ctx, now) {
  const k = io();
  const p = loadParty(k.storage);
  if (!p.cursors) p.cursors = { joined: 0, hosted: 0 };
  const values = isObj(event && event.values) ? event.values : {};
  const name = scrubName(typeof values.myName === "string" ? values.myName : p.me.name);
  const name0 = event && typeof event.name === "string" ? event.name : "";
  let answer = null;
  try {
    answer = await act(k, p, event || {}, ctx, values, name, now);
    if (BUSY[name0] && !(answer && answer.state && answer.state.error)) answer = { ...(answer || {}), state: { ...((answer && answer.state) || {}), error: null } };
  } catch (e) {
    answer = BUSY[name0] ? failed(name0, errorText(e)) : toast(errorText(e), "error");
  }
  saveParty(k.storage, p, now, logOf(k));
  if (BUSY[name0]) answer = { ...(answer || {}), ui: [...settle(name0), ...((answer && answer.ui) || [])].slice(0, 8) };
  return answer;
}

const lost = (e) => ["room_unreachable", "room_closed", "room_denied"].includes(codeOf(e));

async function act(k, p, event, ctx, values, name, now) {
  switch (event.name) {
    case "create": {
      if (p.phase === "party") return null;
      if (name) k.storage.set(NAME, name);
      // A short code: the words are the address, 4 digits keep out whoever does not have them (Kino closes a room after 30
      // wrong joins). A Kino without `codeDigits` ignores it and gives 12 digits, which works the same.
      const opened = await k.room.open({ codeDigits: LIMITS.partyCodeDigits, ttlMin: LIMITS.roomTtlMin, max: LIMITS.maxMembers, name: name || undefined });
      Object.assign(p, newParty(name));
      p.cursors = { joined: 0, hosted: 0 };
      p.phase = "party"; p.role = "host"; p.code = opened.code; p.hostWords = opened.words; p.myWords = opened.words;
      p.expiresAtMs = opened.expiresAtMs; p.epoch = 1; p.hostName = name; p.maxCseq = LIMITS.epochSpan; p.myJs = 1;
      p.me.mid = "host";
      addMyMid(p, "host");
      p.roster = [{ id: "host", name, js: 1, role: "seat", of: null }];
      p.nextJs = 2; p.media = mediaOf(ctx); p.snapDue = true; p.forceState = "start";
      await pump(k.room, p, ctx, now);
      return { ...toast(both("Sala creada: comparte las palabras y el código", "Room created: share the words and the code"), "success"), state: { tab: "room" } };
    }
    case "readInvite": {
      // Fills the two fields from a pasted invitation and shows them back; joining stays the person's «Entrar».
      const got = parseInvitation(typeof values.joinPaste === "string" ? values.joinPaste : "");
      if (got.error) return { state: { invite: null, inviteError: true } };
      return { ui: [{ set: { key: "joinWords", value: got.words } }, { set: { key: "joinCode", value: got.code } }], state: { invite: got, inviteError: false } };
    }
    case "join": {
      const v = isObj(event.value) ? event.value : values;
      const words = normWords(v.joinWords);
      const code = normCode(v.joinCode);
      if (!words || !code) {
        // The whole invitation pasted into the words field: read it, fill the fields, and let the person confirm first.
        const got = parseInvitation(`${typeof v.joinWords === "string" ? v.joinWords : ""}\n${typeof v.joinCode === "string" ? v.joinCode : ""}`);
        if (!got.error) return { ui: [{ set: { key: "joinWords", value: got.words } }, { set: { key: "joinCode", value: got.code } }], state: { invite: got, inviteError: false } };
        return failed("join", both("No encuentro las palabras o el código", "I cannot find the words or the code"));
      }
      if (name) k.storage.set(NAME, name);
      return joinAndGreet(k, p, words, code, name, ctx, now);
    }
    case "scanJoin": {
      const text = await scanOrExplain(k, tx("scanTitle"));
      if (isObj(text)) return text;
      const q = parsePartyQr(text);
      if (!q) return toast(both("Ese código QR no es de una Fiesta", "That QR code is not a watch party's"), "error");
      return joinAndGreet(k, p, q.words, q.code, name, ctx, now);
    }
    case "send": {
      if (p.phase !== "party" || p.me.role !== "seat") return null;
      const raw = typeof values.chatText === "string" ? values.chatText : typeof event.value === "string" ? event.value : "";
      const text = maskCode(scrub(raw, LIMITS.textChars), p.code);
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
      p.lastReaction = { at: now, n: p.me.name, x: e };
      await pump(k.room, p, ctx, now);
      return null;
    }
    case "pick": {
      const e = PICKER[Number(event.arg)];
      if (!e) return null;
      const cur = typeof values.chatText === "string" ? values.chatText : "";
      const next = Array.from(cur + e).length <= LIMITS.textChars ? cur + e : cur;
      return { ui: [{ set: { key: "chatText", value: next } }] };
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
      Object.assign(p, newParty(p.me.name));
      return toast(both("Saliste de la sala", "You left the room"));
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

/**
 * «Reintentar» / «Entrar» after the host went silent or the room let this device go. First the host's own door, fresh: if it
 * answers, nothing happened to the host. Only if that fails are the doors tried in the election's order ([followCandidates]).
 */
async function retryHost(k, p, ctx, now) {
  if (p.phase !== "party" || p.role !== "guest") return null;
  try {
    await joinRoom(k, p, p.hostWords, p.code, p.me.name, p.me.role, now);
    p.hostFailed = false;
    await pump(k.room, p, ctx, now);
    return toast(both("Volviste a la sala", "You are back in the room"), "success");
  } catch (e) {
    if (!lost(e)) throw e;
  }
  p.hostFailed = true;
  p.hostFailedAt = now;
  return followCandidates(k, p, ctx, now);
}

/**
 * The doors of the host's last snapshot, in the election's order. A door before this device that answers: this device waits
 * there for its holder to host (`awaiting`). When this device's own turn comes (every door before it failed), it hosts only on
 * proof that the failure is not its own connection: a member's hello at its door in the last two minutes, or a door after it
 * that answers. If nothing answers, it says so («Sin conexión con la sala») and marks nobody gone.
 */
async function followCandidates(k, p, ctx, now) {
  const order = candidatesOf(p.view);
  for (let i = 0; i < order.length; i++) {
    const c = order[i];
    if (c.id === p.me.mid) {
      if (!p.myWords) continue;
      const hello = Object.values(p.lobbyHello).some((h) => now - (h.at || 0) < LIMITS.helloProofMs);
      let proof = hello;
      for (const o of order.slice(i + 1)) {
        if (proof) break;
        try {
          const probe = await k.room.join({ words: o.words, code: p.code, name: p.me.name || undefined });
          try { await k.room.close({ session: probe.handle }); } catch (x) { /* gone */ }
          proof = true;
        } catch (e) {
          if (!lost(e)) throw e;
        }
      }
      if (proof) {
        if (p.handle) p.closeJoined = p.handle;
        p.handle = null;
        promote(p, now, p.hostName);
        await pump(k.room, p, ctx, now);
        return toast(both("Ahora eres el anfitrión", "You are the host now"), "success");
      }
      p.banner = order.length > i + 1 ? { kind: "cantCheck" } : { kind: "waitOthers" };
      return null;
    }
    try {
      await joinRoom(k, p, c.words, p.code, p.me.name, p.me.role, now);
      p.awaiting = { id: c.id, name: c.name, words: c.words };
      p.banner = null;
      await pump(k.room, p, ctx, now);
      return null;
    } catch (e) {
      if (!lost(e)) throw e;
    }
  }
  p.banner = { kind: "cantCheck" };
  return null;
}

/** The election's order over a view: the seats holding a door, lowest joining order first, never the host. */
export function candidatesOf(view) {
  if (!view) return [];
  return view.members
    .filter((m) => m.role === "seat" && m.id !== "host" && view.backups[m.id])
    .sort((a, b) => a.js - b.js || (a.id < b.id ? -1 : 1))
    .map((m) => ({ id: m.id, name: m.name, words: view.backups[m.id], js: m.js }));
}

/**
 * «Buscar la sala»: a host left alone tries the doors of the members who left, in the election's order, keeping its own room.
 * The first door that answers is the predicted successor (the ones before it did not answer). What it finds is only shown.
 */
async function findRoom(k, p, now) {
  if (p.role !== "host" || p.probe) return null;
  const view = rejoinView(p);
  const doors = candidatesOf(view);
  for (const d of doors) {
    try {
      const joined = await k.room.join({ words: d.words, code: p.code, name: p.me.name || undefined });
      p.probe = { handle: joined.handle, mid: joined.memberId, words: d.words, at: now, predicted: true };
      p.cursors.probe = 0;
      if (p.banner && p.banner.kind === "alone") p.banner = null;
      return toast(both("Buscando la sala…", "Looking for the room…"));
    } catch (e) {
      if (!lost(e)) throw e;
    }
  }
  p.aloneSince = 0;
  p.realLeftAt = 0;
  p.leftDoors = {};
  if (p.banner && p.banner.kind === "closedMine") {
    p.banner = { kind: "ended" };
    return toast(both("No hay otra puerta: tu sala terminó", "There is no other door: your room is over"), "warning");
  }
  p.banner = null;
  return toast(both("No encontramos otra puerta: tu sala sigue abierta aquí", "No other door answered: your room is still open here"));
}

async function joinAndGreet(k, p, words, code, name, ctx, now) {
  await joinRoom(k, p, words, code, name, "seat", now);
  await pump(k.room, p, ctx, now);
  // The first two guests also open a backup door, in this same press (opening one needs the person's press).
  try {
    const members = await k.room.members({ session: p.handle });
    const guests = Array.isArray(members) ? members.filter((m) => m && !m.host).length : 99;
    if (guests <= LIMITS.backups) await openBackup(k, p, now);
  } catch (e) {
    // no backup door from this device: it stays a guest
  }
  return { ...toast(both("Entraste a la sala", "You joined the room"), "success"), state: { tab: "chat", invite: null, inviteError: false } };
}

/** `kino.qr.scan`, or an answer that explains why it could not run (a TV, no camera, no permission). */
async function scanOrExplain(k, title) {
  let text;
  try {
    text = await k.qr.scan({ title: title.es, titleEn: title.en });
  } catch (e) {
    if (codeOf(e) === "unavailable") return toast(both("Este aparato no puede escanear: escribe las palabras y el código", "This device cannot scan: type the words and the code"), "warning");
    if (codeOf(e) === "permission_denied") return toast(both("Permite la cámara a Kino en los ajustes del teléfono", "Allow Kino the camera in the phone's settings"), "warning");
    if (codeOf(e) === "busy") return toast(both("Ya hay un escáner abierto", "A scanner is already open"), "warning");
    throw e;
  }
  if (text === null || text === undefined) return toast(both("Cancelado", "Cancelled"));
  return String(text);
}

/**
 * «Agregar dispositivo»: the phone scans the TV's link QR, joins the TV's link endpoint, tells it the room (its words AND code:
 * only scan your own TV's code), and pairs it.
 */
async function addDevice(k, p, ctx, now) {
  if (p.phase !== "party" || p.me.role !== "seat") return null;
  const text = await scanOrExplain(k, tx("addDeviceTitle"));
  if (isObj(text)) return text;
  const q = parseLinkQr(text, now);
  if (!q) return toast(both("Ese código QR no es el de un televisor con la Fiesta", "That QR code is not a TV's watch party code"), "error");
  if (q.error === "expired") return toast(both("El código del televisor venció: pide uno nuevo", "The TV's code expired: show a new one"), "warning");
  if (q.code === p.code) return toast(both("Ese código no es el de un televisor", "That is not a TV's code"), "error");
  let linked;
  try {
    linked = await k.room.join({ words: q.words, code: q.code, name: p.me.name || undefined });
  } catch (e) {
    // A guest holding a backup door has no free slot for the link: give the door up (and tell the host) and try once more.
    if (codeOf(e) !== "room_busy" || !p.myWords || p.role === "host") throw e;
    try { await k.room.close({ session: "hosted" }); } catch (x) { /* gone */ }
    p.myWords = null;
    enqueue(p, "joined", { t: "nobackup" });
    linked = await k.room.join({ words: q.words, code: q.code, name: p.me.name || undefined });
  }
  const pair = randomToken(16);
  try {
    await k.room.send({ t: "link", words: p.hostWords, code: p.code, name: p.me.name, pair }, { session: linked.handle });
  } finally {
    try { await k.room.close({ session: linked.handle }); } catch (e) { /* gone */ }
  }
  p.me.pairOut = pair;
  if (p.role === "host") {
    for (const [t, v] of Object.entries(p.pairs)) if (v.mid === "host") delete p.pairs[t];
    p.pairs[pair] = { mid: "host", at: now };
  } else enqueue(p, "joined", { t: "pair", token: pair });
  await pump(k.room, p, ctx, now);
  return toast(both("Televisor vinculado: entra a la sala desde el televisor", "TV linked: join the room from the TV"), "success");
}

export async function panel(ctx) {
  return panelAt(ctx, Date.now());
}

export async function panelAction(event, ctx) {
  return panelActionAt(event, ctx, Date.now());
}

export async function playerEvent(event, ctx) {
  return playerEventAt(event, ctx, Date.now());
}

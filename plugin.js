// Fiesta (Watch Party): a Kino plugin that adds a «Fiesta» / «Party» TAB to the player panel of any plugin's title (apiVersion 14).
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
  shown: 40, // the messages the tab draws on a phone (newest at the bottom; the list scrolls)
  shownTv: 25, // and on a TV
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
  minCodeDigits: 4, // a room code typed or read: 4..12 digits (the party now uses Kino's default 12)
  maxCodeDigits: 12,
  shortDigits: 5, // the service's short code
  shortTimeoutMs: 5000, // each call to the service, and one retry
  shortTtlMs: 8 * 3600000, // the service keeps a code this long (it says so in `expires_in_seconds`)
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

// ---------- the short-code service (url-code.kinotv.workers.dev) ----------

/** The service: POST `{ url }` -> `{ code, url, expires_in_seconds }`; GET `/<code>` -> the same, 404 for an unknown code. */
export const SHORT_SERVICE = "https://url-code.kinotv.workers.dev/";

/** The room's own address as the short code stands for it (and as the QR carries it). */
export function roomUrlOf(words, code) {
  return `https://${words}.trycloudflare.com/?c=${code}`;
}

/**
 * The words and the code out of a room address, STRICTLY: `https://<words>.trycloudflare.com/?c=<4..12 digits>` (or without
 * the `/`), words of 2 to 6 lowercase letter-only parts joined by hyphens, at most 63 characters; no user, port, other path,
 * other query or fragment. Anything else is null. The address is only read, never fetched.
 */
export function parseRoomUrl(url) {
  if (typeof url !== "string" || url.length > 200) return null;
  const m = /^https:\/\/([a-z]+(?:-[a-z]+){1,5})\.trycloudflare\.com\/?\?c=([0-9]{4,12})$/.exec(url);
  if (!m || m[1].length > 63) return null;
  return { words: m[1], code: m[2] };
}

/** A typed short code: spaces, hyphens and dots dropped, full-width digits read as digits, exactly 5 digits; else null. */
export function normShort(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = asciiDigits(String(raw)).replace(/[\s.\-]/g, "");
  return /^[0-9]{5}$/.test(s) ? s : null;
}

/** The short code to read aloud: «41 408». */
export function groupShort(code) {
  return /^[0-9]{5}$/.test(String(code)) ? `${String(code).slice(0, 2)} ${String(code).slice(2)}` : String(code || "");
}

/** The service's answer read defensively: `{ code, url, ttlMs }` or null (a code as a string or a number of 5 digits). */
export function readShortAnswer(body) {
  if (!isObj(body)) return null;
  const code = normShort(typeof body.code === "number" ? String(body.code) : body.code);
  const url = typeof body.url === "string" ? body.url : null;
  const ttl = Number.isFinite(body.expires_in_seconds) && body.expires_in_seconds > 0 ? Math.min(body.expires_in_seconds * 1000, LIMITS.shortTtlMs) : LIMITS.shortTtlMs;
  return { code, url, ttlMs: ttl };
}

const shortFetchOptions = { timeoutMs: LIMITS.shortTimeoutMs, redirect: "manual", cookies: false, maxBytes: 4096 };

async function callService(fetch, url, options) {
  let last = null;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, { ...shortFetchOptions, ...options });
      if (res && res.status >= 500 && i === 0) { last = { status: res.status }; continue; }
      return res;
    } catch (e) {
      last = e;
    }
  }
  return last && last.status ? last : null;
}

/** The host's short code for its room: `{ ok: true, short, until }` or `{ ok: false, error: "network" | "invalid" }`. */
export async function createShortCode(fetch, words, code, now) {
  const want = roomUrlOf(words, code);
  const res = await callService(fetch, SHORT_SERVICE, { method: "POST", headers: { "content-type": "application/json" }, body: { json: { url: want } } });
  if (!res || typeof res.status !== "number") return { ok: false, error: "network" };
  if (res.status !== 200) return { ok: false, error: res.status >= 500 ? "network" : "invalid" }; // only 200 counts
  let body;
  try { body = res.json(); } catch (e) { return { ok: false, error: "invalid" }; }
  const a = readShortAnswer(body);
  // The service must give back the very address it stored, with a 5-digit code.
  if (!a || !a.code || (a.url !== null && a.url !== want)) return { ok: false, error: "invalid" };
  return { ok: true, short: a.code, until: now + a.ttlMs };
}

/**
 * Revokes a short code (`DELETE /<code>`), best effort: 3 s, no retry, whatever the answer (its shape is not relied on), and
 * it never throws. Kino's own room closings (its TTL, 30 wrong joins, the app ending, the plugin switched off) cannot run it:
 * the service's 8-hour expiry covers those.
 */
export async function revokeShortCode(fetch, short) {
  const code = normShort(short);
  if (!code || typeof fetch !== "function") return false;
  try {
    await fetch(SHORT_SERVICE + code, { method: "DELETE", timeoutMs: 3000, redirect: "manual", cookies: false, maxBytes: 1024 });
    return true;
  } catch (e) {
    return false;
  }
}

/** A guest's lookup: `{ ok: true, words, code }` or `{ ok: false, error: "notFound" | "invalid" | "network" }`. */
export async function lookupShortCode(fetch, short) {
  const code = normShort(short);
  if (!code) return { ok: false, error: "invalid" };
  const res = await callService(fetch, SHORT_SERVICE + code, { method: "GET" });
  if (!res || typeof res.status !== "number") return { ok: false, error: "network" };
  if (res.status === 404) return { ok: false, error: "notFound" };
  if (res.status !== 200) return { ok: false, error: res.status >= 500 ? "network" : "invalid" }; // only 200 counts
  let body;
  try { body = res.json(); } catch (e) { return { ok: false, error: "invalid" }; }
  const a = readShortAnswer(body);
  const room = a && parseRoomUrl(a.url);
  return room ? { ok: true, ...room } : { ok: false, error: "invalid" };
}

// ---------- inviting: a text to paste in any chat, and reading it back (pure) ----------

export const INVITE_MAX = 500;

/**
 * The invitation the host copies («Copiar invitación»): plain text, no link, only what joining needs. The title (with its
 * year, season and episode) and the source plugin's name help friends open the same title with the same plugin. Nothing else:
 * no member ids, no tunnel address. Always under INVITE_MAX characters (a long title is cut first).
 */
export function invitationText({ short = null, words, code, media = null }) {
  const lines = (titleLine) => (short ? [
    "Únete a mi fiesta en Kino 🎬",
    ...(titleLine ? [titleLine] : []),
    `Código: ${short}`,
    "En Kino: reproduce el mismo título ▸ panel ▸ Fiesta ▸ escribe el código ▸ Entrar.",
    "(Join my Kino watch party: type the code above in Kino.)",
  ] : [
    "Únete a mi fiesta en Kino 🎬",
    ...(titleLine ? [titleLine] : []),
    `Palabras: ${words}`,
    `Código: ${code}`,
    "En Kino: reproduce el mismo título ▸ panel ▸ Fiesta ▸ Entrar con palabras y código.",
    "(Join my Kino watch party: words + code above.)",
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
    if (!words && code && /^[0-9]{5}$/.test(code)) return { short: code };
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
    correctedAt: 0, correctedTo: null, notes: [], short: null, shortUntil: 0, shortError: false, shortMine: false,
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
      const text = maskCode(maskCode(scrub(m.text, LIMITS.textChars), p.code), p.short);
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
    // A second hello from the same session refreshes a TV's pairing or the member's name («Cambiar mi nombre»); it never adds
    // a member or changes a seat.
    if (m.name && m.name !== bound.name && m.role === bound.role) {
      p.roster = p.roster.map((r) => (r.id === mid ? { ...r, name: m.name } : r));
      p.snapDue = true;
    }
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
  p.short = null; // the old short code points to the old host's door: this host asks for its own («Obtener un código»)
  p.shortError = false;
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
  yourName: ["Tu nombre", "Your name"],
  create: ["Crear sala", "Create room"],
  words: ["Palabras de la sala", "Room words"],
  enter: ["Entrar", "Join"],
  scanTitle: ["Escanea el código de la sala", "Scan the room's code"],
  linkStart: ["Vincular con mi teléfono", "Link with my phone"],
  linkInfo: ["En el teléfono, en la sala: «Agregar dispositivo» y escanea. Sirve una vez.", "On the phone, in the room: “Add device” and scan. It works once."],
  linkCancel: ["Cancelar", "Cancel"],
  addDevice: ["Agregar dispositivo", "Add device"],
  addDeviceTitle: ["Escanea el código que muestra TU televisor", "Scan the code YOUR TV shows"],
  message: ["Mensaje", "Message"],
  follow: ["Seguir al anfitrión", "Follow the host"],
  leave: ["Salir de la sala", "Leave the room"],
  leaveConfirm: ["¿Salir de la sala?", "Leave the room?"],
  chatTab: ["Chat", "Chat"],
  roomTab: ["Sala", "Room"],
  inviteInfo: ["Comparte el código o el QR. Solo deja afuera a extraños: no compartas nada sensible.", "Share the code or the QR. It only keeps strangers out: share nothing sensitive."],
  openBackup: ["Abrir puerta de respaldo", "Open a backup door"],
  backupInfo: ["Si el anfitrión se va, la sala sigue en una puerta de respaldo.", "If the host leaves, the room goes on through a backup door."],
  empty: ["Todavía no hay mensajes.", "No messages yet."],
  members: ["Personas", "People"],
  noScreens: ["La Fiesta necesita las pantallas de plugins activas en Ajustes.", "Watch party needs plugin screens switched on in Settings."],
  openTitle: ["Abrir este título", "Open this title"],
  resync: ["Volver a sincronizar", "Sync again"],
  retry: ["Reintentar", "Try again"],
  findRoom: ["Buscar la sala", "Look for the room"],
  hostMark: ["anfitrión", "host"],
  back: ["Atrás", "Back"],
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
 * The room in one line: «Sala: 41 408», and on the host's phone an icon-only «Copiar invitación» at its right end (Kino's
 * `go.copy`; Kino shows «Copiado»; `sensitive` keeps the text out of clipboard previews). Never a copy on a TV (Kino drops it
 * there): `devices` and the context say so. Without a short code: why, and for the host one press to ask again.
 */
function roomLine(p, ctx) {
  if (!p.short) return shortNodes(p);
  const copy = p.role === "host" && p.code && p.hostWords && !isTv(ctx)
    ? [{
      type: "IconButton", key: "btnCopyInvite", icon: "copy", labelText: "Copiar invitación", labelTextEn: "Copy invitation", devices: ["phone", "desktop"],
      onPressed: { go: { copy: { text: invitationText({ short: p.short, words: p.hostWords, code: p.code, media: p.media }), label: "Invitación a la Fiesta", sensitive: true } } },
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
  busyShort: ["Creando el código…", "Creating the code…"],
  busySync: ["Sincronizando…", "Syncing…"],
};
export const BUSY = {
  create: { label: "busyCreate", button: "btnCreate" },
  join: { label: "busyJoin", button: "btnJoin" },
  joinShort: { label: "busyJoin", button: "btnJoinShort" },
  lookupShort: { label: "busySearch", button: "btnLookup" },
  wordsNext: { label: "busyJoin", button: "btnWordsNext" },
  readInvite: { label: "busyJoin", button: "btnReadInvite" },
  joinTarget: { label: "busyJoin", button: "btnJoinTarget" },
  shortCode: { label: "busyShort", button: "btnShort" },
  scanJoin: { label: "busyJoin", button: "btnScan" },
  redirect: { label: "busyJoin" },
  followHost: { label: "busyJoin" },
  retryHost: { label: "busyJoin" },
  enterParty: { label: "busyJoin" },
  joinMoved: { label: "busyJoin" },
  findRoom: { label: "busySearch", button: "btnFind" },
  openBackup: { label: "busyDoor", button: "btnBackup" },
  linkStart: { label: "busyLink", button: "btnLink" },
  addDevice: { label: "busyTv", button: "btnAddDevice" },
  sync: { label: "busySync", button: "btnSync" },
  resync: { label: "busySync" },
};

/** The progress row of [event]: its own, placed right after the button (or banner) that triggers it. */
export const waitKey = (event) => `busy.${event}`;

/** The tap of a press that waits: its own progress row shown and the button disabled at once (Kino's own ui operations), then the event. */
export function busyTap(event) {
  const b = BUSY[event];
  return { ui: [{ show: waitKey(event) }, ...(b.button ? [{ disable: b.button }] : [])], event };
}

/** The ui operations an answer to [event] carries: its row (and the error's retry row) hidden, the button enabled again. */
function settle(event) {
  const b = BUSY[event];
  return b ? [{ hide: waitKey(event) }, { hide: waitKey("retry") }, ...(b.button ? [{ enable: b.button }] : [])] : [];
}

/** A failed press that waits: the error shown in place (Kino's panel state) with a retry of the same press. */
// A failed press: the error in place and, when it can be retried, the D-pad on «Reintentar» (withFocus falls back to the
// view's first control when there is none, e.g. a recovery screen whose own button is the retry).
// A typing mistake: the error in place, no retry (the D-pad goes back to the field).
const invalid = (t) => ({ state: { error: { es: t.es, en: t.en, retry: null } } });
const failed = (event, t) => ({ state: { error: { es: t.es, en: t.en, retry: BUSY[event] ? event : null } }, ...(BUSY[event] ? { focus: "btnRetry" } : {}) });

/** A hidden progress row with one label (Kino's progress draws it; screen readers read it). */
function waitRow(key, label) {
  const [es, en] = BUSY_ROWS[label];
  return {
    type: "Row", key, hidden: true, gap: 8, crossAxisAlignment: "center",
    children: [{ type: "LinearProgressIndicator", labelText: es, labelTextEn: en, flex: 1 }],
  };
}

/** The busy key a node's own tap shows (a button's onPressed, a banner's action, a form's onSubmitted), if any. */
function shownBusy(n) {
  const tap = n.onPressed || n.onTap || n.onSubmitted || (n.action && n.action.onTap);
  if (!isObj(tap) || !Array.isArray(tap.ui)) return null;
  const show = tap.ui.find((op) => isObj(op) && typeof op.show === "string" && op.show.startsWith("busy."));
  return show ? { key: show.show, event: tap.event } : null;
}

/**
 * Puts each waiting press's progress row right after its trigger, in the same list (so it shows where the person is looking,
 * even in a scrolled panel); a trigger inside a Row gets its row right after that Row. [labelFor] picks the row's label.
 */
function addWaitRows(node, labelFor, seen = new Set()) {
  if (!isObj(node)) return node;
  const kids = Array.isArray(node.children) ? node.children : null;
  if (!kids) return node;
  const inRow = node.type === "Row";
  const out = [];
  for (const c of kids) {
    out.push(addWaitRows(c, labelFor, seen));
    if (inRow) continue; // the Row's parent places them
    const own = shownBusy(c);
    const inside = c.type === "Row" && Array.isArray(c.children) ? c.children.map(shownBusy).filter(Boolean) : [];
    for (const b of [...(own ? [own] : []), ...inside]) {
      if (seen.has(b.key)) continue;
      seen.add(b.key);
      out.push(waitRow(b.key, labelFor(b.event)));
    }
  }
  return { ...node, children: out };
}

/** The error of the last press that waited, in place, with its retry (its own row follows it). */
/**
 * A failed press's error: the text in the error colour and, when it can be retried, «Reintentar» as a keyed button (a
 * banner's own action has no key, so the D-pad could not be sent to it). [withRetry] false on a recovery screen, whose own
 * button is the one way on.
 */
function errorNodes(ctx, withRetry = true) {
  const e = isObj(ctx.state) && isObj(ctx.state.error) ? ctx.state.error : null;
  if (!e || typeof e.es !== "string") return [];
  const out = [Text(both(e.es, typeof e.en === "string" ? e.en : e.es), { key: "errText", color: "error" })];
  if (withRetry && typeof e.retry === "string" && BUSY[e.retry]) {
    out.push(Btn("ElevatedButton", tx("retry"), { ui: [{ show: waitKey("retry") }], event: e.retry }, { key: "btnRetry" }));
  }
  return out;
}

// ---------- drawing the tab (screen kit, narrow enough for the pinned panel) ----------

const Text = (t, extra = {}) => ({ type: "Text", text: t.es, textEn: t.en, ...extra });
const Btn = (type, t, onPressed, extra = {}) => ({ type, labelText: t.es, labelTextEn: t.en, onPressed, ...extra });
const Banner = (role, t, action) => ({ type: "MaterialBanner", role, text: t.es, textEn: t.en, ...(action ? { action } : {}) });
const Action = (t, onTap, arg) => ({ label: t.es, labelEn: t.en, onTap, ...(arg !== undefined ? { arg } : {}) });

function matchBanner(p, ctx) {
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
    case "otherTitle": return Banner("warning", both(`La sala ve «${p.media.title || "otro título"}».`, `The room watches “${p.media.title || "another title"}”.`), open);
    case "otherSource": {
      const name = (p.media && p.media.source.name) || p.media.source.pluginId;
      return Banner("warning", both(`Esta sala usa «${name}»: abre el título con ese plugin.`, `This room uses “${name}”: open the title with that plugin.`), open);
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

/** Whether a chat entry is this device's own (a member id it had, or the room it hosts now under its own name). */
function isMine(p, e) {
  return p.myMids.includes(e.by) || (p.role === "host" && e.by === "host" && e.n === p.me.name);
}

/** One message's bubble: mine filled with the primary colour, the others' a filled (neutral) card; a reaction is a glyph. */
function bubble(e, mine) {
  if (e.k === "emoji") return Text(both(e.x, e.x), { style: "h4" });
  return {
    type: "Card", borderRadius: "large", padding: { x: 12, y: 8 },
    ...(mine ? { color: "primary" } : { variant: "filled" }),
    children: [Text(both(e.x, e.x))],
  };
}

/**
 * The messages as a chat: one item per run of consecutive entries from the same person. Mine sit on the right (the group
 * aligned to the end, an empty gutter on the left), the others' on the left with the name once above the run. The gutter
 * (padding + margin, 80 dp on the start or end side) keeps a bubble under about three quarters of the panel; a bubble is as
 * wide as its text. The newest at the bottom; then this device's messages still on their way, and the recent room notes as
 * small centred lines.
 */
function chatList(p, now, ctx) {
  const entries = p.hist.slice(-(isTv(ctx) ? LIMITS.shownTv : LIMITS.shown));
  const groups = [];
  for (const e of entries) {
    const last = groups.at(-1);
    if (last && last.by === e.by) last.entries.push(e);
    else groups.push({ by: e.by, mine: isMine(p, e), entries: [e] });
  }
  const side = (mine) => mine
    ? { crossAxisAlignment: "end", padding: { start: 48 }, margin: { start: 32 } }
    : { crossAxisAlignment: "start", padding: { end: 48 }, margin: { end: 32 } };
  const items = groups.map((g) => ({
    type: "Column", key: "g" + g.entries[0].c, fill: true, gap: 4, ...side(g.mine),
    children: [
      ...(g.mine ? [] : [Text(both(displayName(g.entries[0].n), displayName(g.entries[0].n, true)), { style: "caption", color: "muted" })]),
      ...g.entries.map((e) => bubble(e, g.mine)),
    ],
  }));
  const pending = pendingOwn(p, now);
  if (pending.length) {
    items.push({
      type: "Column", key: "pending", fill: true, gap: 4, ...side(true),
      children: [
        ...pending.map((m) => ({ type: "Card", variant: "outlined", borderRadius: "large", padding: { x: 12, y: 8 }, children: [Text(both(m.x, m.x))] })),
        Text(both("Enviando…", "Sending…"), { style: "caption", color: "muted" }),
      ],
    });
  }
  p.notes.filter((n) => now - n.at < 20000).slice(-2).forEach((n, i) => {
    items.push(Text(both(n.es, n.en), { key: "note" + i, style: "caption", color: "muted", fill: true, crossAxisAlignment: "center" }));
  });
  return { type: "ListView", key: "chat", flex: 1, gap: 8, items, empty: Text(tx("empty"), { color: "muted" }) };
}

/**
 * The chat, top to bottom: what just happened (a reaction, notes), the messages (newest at the bottom, the part that scrolls),
 * the 8 reactions (hidden until the emoji button opens them; they close after one is sent), and the input row: the text field,
 * the emoji button and «Enviar». A TV's display seat can only react: its reactions are shown directly, with no input row.
 */
function chatTab(p, now, ctx) {
  const display = p.me.role === "display";
  const children = [];
  if (p.stuck) children.push(Text(both("No logramos alcanzar al anfitrión: tu video tarda en cargar.", "We cannot catch up with the host: your video is slow to load."), { style: "caption", color: "warning" }));
  else if (p.correctedTo !== null && now - p.correctedAt < 8000) children.push(Text(both(`Ajustado al anfitrión: ${clockText(p.correctedTo)}`, `Moved to the host: ${clockText(p.correctedTo)}`), { style: "caption", color: "muted" }));
  children.push(chatList(p, now, ctx));
  // The reactions: shown directly for a TV's display seat (all it can send), else hidden behind the emoji toggle (a `ui`
  // toggle, no round trip); one sent closes them and the answer puts the D-pad back on the input. One compact block of two
  // lines of four, under the list (which keeps the room left), never pushing it off screen.
  children.push({
    type: "Row", key: "emojiPalette", wrap: true, gap: 4, ...(display ? {} : { hidden: true }),
    children: EMOJIS.map((e, i) => ({ type: "TextButton", key: "emoji" + i, labelText: e, onPressed: display ? "emoji" : { ui: [{ hide: "emojiPalette" }], event: "emoji" }, arg: String(i), span: 3 })),
  });
  if (!display) {
    // The field sends on the keyboard's own action (onSubmitted) and on its own send icon inside the field (onTrailingTap; its
    // label is for screen readers); beside it, the emoji toggle, icon-only. On a TV the send icon is its own D-pad stop:
    // field, then send, then emoji.
    children.push({
      type: "Row", key: "inputRow", gap: isTv(ctx) ? 4 : 0, crossAxisAlignment: "center",
      children: [
        {
          type: "TextField", key: "chatText", labelText: T.message[0], labelTextEn: T.message[1], maxLength: LIMITS.textChars, onSubmitted: "send", flex: 1,
          trailingIcon: "send", trailingLabel: "Enviar", trailingLabelEn: "Send", onTrailingTap: "send",
        },
        { type: "IconButton", key: "emojiToggle", icon: "mood", labelText: "Emojis", labelTextEn: "Emoji", onPressed: { ui: [{ toggle: "emojiPalette" }] } },
      ],
    });
  } else if (p.link && !p.link.used) {
    children.push(...linkNodes(p));
  } else if (!p.me.of) {
    children.push(Banner("info", both("Sin teléfono vinculado: solo reacciones", "No phone linked: reactions only"), Action(tx("linkStart"), busyTap("linkStart"))));
  }
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

function linkNodes(p) {
  return [
    { type: "QrImage", value: linkQrText(p.link.words, p.link.code, p.link.exp), labelText: "Código para vincular el teléfono", labelTextEn: "Code to link the phone", size: "medium" },
    Text(tx("linkInfo")),
    Text(both("Vence a los 5 minutos.", "It expires after 5 minutes."), { style: "caption", color: "muted" }),
    Btn("TextButton", tx("linkCancel"), "linkCancel", { key: "btnLinkCancel" }),
  ];
}

/** Whether the tab is drawn on a TV (the drawer or the pinned panel there): no clipboard, no camera. */
const isTv = (ctx) => Boolean(ctx && ctx.device === "tv");

/**
 * Not in a room: a step-by-step wizard, one decision per screen (the step lives in Kino's panel state, `wizStep`).
 * - home: «Crear sala» and «Unirme a sala», nothing else.
 * - c1: «¿Cómo te llamas?» (the last name used) + «Crear sala» + «Atrás».
 * - j1: «Código de la sala» (5 digits) + «Siguiente» (asks the service) + the other ways in (phone: «Pegar invitación»,
 *   «Escanear QR»; TV: «Vincular con mi teléfono») + «Entrar con palabras y código» + «Atrás».
 * - j1b: the words and the room code + «Siguiente» + «Atrás»; jp (phones): paste an invitation + «Leer la invitación» + «Atrás».
 * - j2: «¿Cómo te llamas?» + «Entrar» + «Atrás» (to j1, the typed code kept): the name is asked after the code was checked.
 */
export const WIZ_STEPS = ["home", "c1", "j1", "j1b", "jp", "j2"];

/** The step shown: Kino's panel state says it; a TV never shows the paste step; j2 needs a checked target. */
export function wizStepOf(ctx) {
  const st = isObj(ctx && ctx.state) ? ctx.state : {};
  let step = WIZ_STEPS.includes(st.wizStep) ? st.wizStep : "home";
  if (step === "jp" && isTv(ctx)) step = "j1";
  if (step === "j2" && !targetOf(st.joinTarget)) step = "j1";
  return step;
}

/** A join target kept in the panel state between j1/j1b and j2, re-checked (the state comes back from Kino). */
function targetOf(t) {
  if (!isObj(t)) return null;
  const words = normWords(t.words);
  const code = normCode(t.code);
  const short = t.short === undefined || t.short === null ? null : normShort(t.short);
  return words && code ? { words, code, short } : null;
}


const wizTo = (step) => ({ event: "wiz", arg: step });
const backTo = (step) => Btn("TextButton", tx("back"), wizTo(step), { key: "btnBack" });

function idleNodes(p, ctx) {
  const st = isObj(ctx && ctx.state) ? ctx.state : {};
  const tv = isTv(ctx);
  if (p.pending) {
    return [Banner("success", both(`Teléfono vinculado: ${displayName(p.pending.name)}`, `Phone linked: ${displayName(p.pending.name, true)}`), Action(tx("enter"), busyTap("enterParty")))];
  }
  if (p.link && !p.link.used) return linkNodes(p);
  const step = wizStepOf(ctx);
  const heading = (t) => Text(t, { style: "h5" });
  switch (step) {
    case "c1":
      return [
        heading(both("¿Cómo te llamas?", "What's your name?")),
        { type: "TextField", key: "myName", labelText: T.yourName[0], labelTextEn: T.yourName[1], maxLength: LIMITS.nameChars, value: p.me.name },
        Btn("ElevatedButton", tx("create"), busyTap("create"), { key: "btnCreate" }),
        backTo("home"),
      ];
    case "j1":
      return [
        heading(both("Código de la sala", "Room code")),
        { type: "TextField", key: "joinShortCode", kind: "number", labelText: "Código (5 números)", labelTextEn: "Code (5 digits)", maxLength: 7, value: typeof st.shortTyped === "string" ? st.shortTyped : "" },
        Btn("ElevatedButton", both("Siguiente", "Next"), busyTap("lookupShort"), { key: "btnLookup" }),
        ...(tv
          ? [Btn("TextButton", tx("linkStart"), busyTap("linkStart"), { key: "btnLink" })]
          : [Btn("TextButton", both("Pegar invitación", "Paste invitation"), wizTo("jp"), { key: "btnPaste" }), Btn("TextButton", both("Escanear QR", "Scan QR"), busyTap("scanJoin"), { key: "btnScan" })]),
        Btn("TextButton", both("Entrar con palabras y código", "Join with words and code"), wizTo("j1b"), { key: "btnWords" }),
        backTo("home"),
      ];
    case "j1b":
      return [
        heading(both("Palabras y código de la sala", "The room's words and code")),
        { type: "TextField", key: "joinWords", labelText: T.words[0], labelTextEn: T.words[1], maxLength: tv ? 80 : 500 },
        { type: "TextField", key: "joinCode", ...(tv ? { kind: "number" } : {}), labelText: "Código de la sala", labelTextEn: "Room code", maxLength: tv ? 12 : 20 },
        Btn("ElevatedButton", both("Siguiente", "Next"), busyTap("wordsNext"), { key: "btnWordsNext" }),
        backTo("j1"),
      ];
    case "jp":
      return [
        heading(both("Pegar invitación", "Paste the invitation")),
        { type: "TextField", key: "joinPaste", labelText: "Pega aquí la invitación", labelTextEn: "Paste the invitation here", maxLength: 1000, multiline: true },
        Btn("ElevatedButton", both("Leer la invitación", "Read the invitation"), busyTap("readInvite"), { key: "btnReadInvite" }),
        ...(st.inviteError === true ? [Text(both("No encuentro las palabras o el código", "I cannot find the words or the code"), { color: "error" })] : []),
        backTo("j1"),
      ];
    case "j2": {
      const t = targetOf(st.joinTarget);
      const what = t.short ? both(`Código ${groupShort(t.short)}`, `Code ${groupShort(t.short)}`) : both(`Sala ${t.words}`, `Room ${t.words}`);
      return [
        heading(both("¿Cómo te llamas?", "What's your name?")),
        { type: "TextField", key: "myName", labelText: T.yourName[0], labelTextEn: T.yourName[1], maxLength: LIMITS.nameChars, value: p.me.name },
        Btn("ElevatedButton", tx("enter"), busyTap("joinTarget"), { key: "btnJoinTarget" }),
        Text(what, { style: "caption", color: "muted" }),
        backTo("j1"),
      ];
    }
    default:
      // A saved name: «Crear sala» creates at once (the name is asked only when there is none).
      return [
        Btn("ElevatedButton", tx("create"), p.me.name ? busyTap("create") : wizTo("c1"), { key: p.me.name ? "btnCreate" : "btnHomeCreate" }),
        Btn("ElevatedButton", both("Unirme a sala", "Join a room"), wizTo("j1"), { key: "btnHomeJoin" }),
      ];
  }
}

/** The control a step opens on (focus): its field, else its first button. */
export function wizFocus(step) {
  return { home: "btnHomeJoin", c1: "myName", j1: "joinShortCode", j1b: "joinWords", jp: "joinPaste", j2: "myName" }[step] || null;
}



/** The tab's result (screen format), or the legacy panel when Kino's plugin screens are off. */
export function view(p, ctx, now, player = null) {
  const features = Array.isArray(ctx.features) ? ctx.features : [];
  if (!features.includes("screen")) return { title: T.title[0], titleEn: T.title[1], elements: [{ type: "text", text: T.noScreens[0], textEn: T.noScreens[1] }] };
  const inRoom = p.phase === "party";
  const base = { format: "screen", title: T.title[0], titleEn: T.title[1], ...(inRoom || p.link ? { refreshMs: LIMITS.refreshMs } : {}), ...(player ? { player } : {}) };
  const errNow = isObj(ctx.state) && isObj(ctx.state.error) ? ctx.state.error : null;
  const labelFor = (event) => {
    const ev = BUSY[event] ? event : errNow && BUSY[errNow.retry] ? errNow.retry : null;
    if (ev === "lookupShort" && p.me.name) return "busyJoin"; // with a saved name the lookup joins at once
    return ev ? BUSY[ev].label : "busyJoin";
  };
  const done = (result) => ({ ...result, root: addWaitRows(result.root, labelFor) });
  if (!inRoom) {
    return done({ ...base, root: { type: "Column", gap: 8, padding: 8, children: [...errorNodes(ctx), ...idleNodes(p, ctx)] } });
  }
  const top = errorNodes(ctx, !recoveryScreen(p));
  // In-room recovery (the host left, this device was dropped, waiting at the successor's door…): a screen of its own with the
  // explanation, ONE primary button (the banner's) and «Salir de la sala»; no inputs, no tabs.
  if (isObj(ctx.state) && ctx.state.renaming === true && !recoveryScreen(p)) {
    return done({
      ...base,
      root: {
        type: "Column", gap: 8, padding: 8,
        children: [
          Text(both("¿Cómo te llamas?", "What's your name?"), { style: "h5" }),
          { type: "TextField", key: "myName", labelText: T.yourName[0], labelTextEn: T.yourName[1], maxLength: LIMITS.nameChars, value: p.me.name },
          Btn("ElevatedButton", both("Guardar", "Save"), "rename", { key: "btnRenameSave" }),
          Text(both("Se usa en esta sala y en las próximas.", "It is used in this room and the next ones."), { style: "caption", color: "muted" }),
          Btn("TextButton", tx("back"), { event: "renameClose" }, { key: "btnBack" }),
        ],
      },
    });
  }
  if (recoveryScreen(p)) {
    return done({
      ...base,
      root: { type: "Column", gap: 8, padding: 8, children: [...top, ...recoveryNodes(p, now)] },
    });
  }
  const asked = ctx.tab === "room" || ctx.tab === "chat" ? ctx.tab : isObj(ctx.state) ? ctx.state.tab : null;
  const tab = asked === "room" ? "room" : "chat";
  const head = [headerRow(p, ctx)];
  const pb = partyBanner(p, now);
  if (pb) head.push(pb);
  if (p.hold && p.role === "guest") head.push(Banner("info", both("Pausaste o seguiste por tu cuenta: la sala sigue.", "You paused or resumed yourself: the room goes on."), Action(tx("resync"), "resync")));
  const mb = matchBanner(p, ctx);
  if (mb) head.push(mb);
  return done({
    ...base,
    tabs: [{ id: "chat", label: T.chatTab[0], labelEn: T.chatTab[1] }, { id: "room", label: T.roomTab[0], labelEn: T.roomTab[1] }],
    tab,
    root: { type: "Column", gap: 8, padding: 8, children: [...top, ...head, ...(tab === "room" ? roomTab(p, ctx) : chatTab(p, now, ctx))] },
  });
}

/**
 * The room's header row: a short status on the left (who hosts, whether this guest watches the same), and for a guest the
 * «Sincronizar» icon on the right (its label is for screen readers; its progress row goes under this row).
 */
function headerRow(p, ctx) {
  const m = p.role === "guest" ? mediaMatch(ctx, p.media) : null;
  const count = p.roster.length;
  const status = p.role === "host"
    ? both(`Eres el anfitrión · ${count} ${count === 1 ? "persona" : "personas"}`, `You host · ${count} ${count === 1 ? "person" : "people"}`)
    : both(`Anfitrión: ${displayName(p.hostName)}${m && m.ok ? " · ✓ Viendo lo mismo" : ""}`, `Host: ${displayName(p.hostName, true)}${m && m.ok ? " · ✓ Watching the same" : ""}`);
  return {
    type: "Row", key: "headerRow", gap: 4, crossAxisAlignment: "center",
    children: [
      Text(status, { style: "caption", flex: 1 }),
      ...(p.role === "guest" ? [{ type: "IconButton", key: "btnSync", icon: "sync", labelText: "Sincronizar", labelTextEn: "Sync", onPressed: busyTap("sync") }] : []),
    ],
  };
}

/** A recovery screen's content: the explanation in ordinary text, one ordinary button, and «Salir de la sala». */
function recoveryNodes(p, now) {
  const b = partyBanner(p, now);
  const out = [];
  const leave = { confirm: T.leaveConfirm[0], confirmEn: T.leaveConfirm[1] };
  // The one way on is always «btnRecover», the first control (the D-pad lands there); «Salir de la sala» after it, unless
  // leaving is that way on (the room is over).
  const leaves = Boolean(b && b.action && b.action.onTap === "leave");
  if (b) {
    out.push(Text(both(b.text, b.textEn), { style: "p" }));
    if (b.action) out.push(Btn("ElevatedButton", both(b.action.label, b.action.labelEn), b.action.onTap, { key: "btnRecover", ...(leaves ? leave : {}) }));
  }
  if (!leaves) out.push(Btn("TextButton", tx("leave"), "leave", { key: "btnLeave", ...leave }));
  return out;
}

/** Whether the room view is a single-purpose recovery screen (waiting, dropped, a new host to follow, the room over…). */
export function recoveryScreen(p) {
  if (p.awaiting) return true;
  return Boolean(p.banner && ["newHost", "lost", "redirect", "dropped", "noAnswer", "cantCheck", "waitOthers", "takeOver", "moved", "closedMine", "ended", "linked"].includes(p.banner.kind));
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
  return withFocus(answer, p, ctx, now);
}

/**
 * Every answer that changes what is on screen names where the D-pad goes next (`focus`), a control that exists in the tree it
 * leads to: the one it asked for when it is there, else the first useful control of the new view (its field, else its primary
 * button), so focus is never lost when the pressed control disappears (a step change, a loading done, an error, a room joined).
 */
export function withFocus(answer, p, ctx, now) {
  if (!isObj(answer) || answer.close) return answer;
  const merged = { ...(isObj(ctx && ctx.state) ? ctx.state : {}) };
  if (isObj(answer.state)) for (const [key, v] of Object.entries(answer.state)) { if (v === null) delete merged[key]; else merged[key] = v; }
  const tree = view(p, { ...ctx, features: ["screen"], state: merged, tab: merged.tab || ctx.tab }, now);
  const keys = focusables(tree.root || { children: [] });
  if (!keys.length) return answer;
  const fields = focusFields(tree.root || { children: [] });
  const want = typeof answer.focus === "string" && keys.includes(answer.focus) ? answer.focus : fields[0] || keys[0];
  return { ...answer, focus: want };
}

/** The keyed text fields of a tree, in reading order. */
function focusFields(root) {
  const out = [];
  const walk = (n) => {
    if (!isObj(n)) return;
    if (typeof n.key === "string" && !n.hidden && n.type === "TextField") out.push(n.key);
    for (const c of Array.isArray(n.children) ? n.children : []) walk(c);
  };
  walk(root);
  return out;
}

/** The keyed controls of a tree in reading (D-pad) order: fields, buttons and switches (never a progress row). */
export function focusables(root) {
  const out = [];
  const walk = (n) => {
    if (!isObj(n)) return;
    if (typeof n.key === "string" && !n.key.startsWith("busy.") && !n.hidden && ["TextField", "ElevatedButton", "TextButton", "Button", "IconButton", "Switch"].includes(n.type)) out.push(n.key);
    for (const c of Array.isArray(n.children) ? n.children : []) walk(c);
    if (Array.isArray(n.items)) for (const c of n.items) walk(c);
  };
  walk(root);
  return out;
}

const lost = (e) => ["room_unreachable", "room_closed", "room_denied"].includes(codeOf(e));

async function act(k, p, event, ctx, values, name, now) {
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
      if (!q) return toast(both("Ese código QR no es de una Fiesta", "That QR code is not a watch party's"), "error");
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
    await dropShort(k, p); // the room is over: its code too
    p.banner = { kind: "ended" };
    return toast(both("No hay otra puerta: tu sala terminó", "There is no other door: your room is over"), "warning");
  }
  p.banner = null;
  return toast(both("No encontramos otra puerta: tu sala sigue abierta aquí", "No other door answered: your room is still open here"));
}

/**
 * A checked room: with a saved name, join it now (this same press); without one, the name step (j2) first, the room kept in
 * Kino's panel state so «Atrás» returns to the code with what was typed.
 */
async function toNameOrJoin(k, p, target, ctx, now, extra = {}) {
  if (!p.me.name) return { state: { ...extra, wizStep: "j2", joinTarget: target, error: null }, focus: "myName" };
  const answer = await joinAndGreet(k, p, target.words, target.code, p.me.name, ctx, now);
  if (target.short) p.short = target.short;
  return { ...answer, state: { ...(answer.state || {}), wizStep: "home", joinTarget: null, shortTyped: null } };
}

/** The host asks the service for its room's short code (5 s, one retry). Never logs the address or the codes. */
async function askShort(k, p, now) {
  if (typeof k.fetch !== "function") { p.shortError = true; return false; }
  await dropShort(k, p); // a code this device made before (another door, an earlier try) is revoked first
  const got = await createShortCode((url, o) => k.fetch(url, o), p.hostWords, p.code, now);
  if (!got.ok) { p.short = null; p.shortError = true; return false; }
  p.short = got.short;
  p.shortMine = true;
  p.shortUntil = got.until;
  p.shortError = false;
  return true;
}

/** Revokes the short code this device created (if any) and forgets it; never blocks a close for more than 3 s, never fails it. */
async function dropShort(k, p) {
  const short = p.shortMine ? p.short : null;
  p.short = null;
  p.shortMine = false;
  p.shortUntil = 0;
  if (short) await revokeShortCode((url, o) => k.fetch(url, o), short);
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

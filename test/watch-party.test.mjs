// Fiesta (Watch Party) run with Kino's Node kit (sdk/): the same sandbox as the app, its panel results and answers
// read by the kit's screen-format panel validator (the app's PanelScreenOutput rules), its context the app's foreign one (a tab
// contributed to another plugin's title). Two layers:
//
// - the kit's own room (createKino + createKitRoom: one device, two simulated members) for the shapes and the app's gates;
// - a small fake network of several devices (net.mjs) for chat and sync between two people, failover between four, backup
//   doors, newcomers through any door, a returning host, and the phone + TV companion flow.
//
// The clock is the test's: every call passes `now` (panelAt / panelActionAt / playerEventAt are what Kino's exports call with
// Date.now()). Sample titles are movies and series only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join as pjoin } from "node:path";
import { fileURLToPath } from "node:url";
import { createKino, createKitRoom } from "../sdk/kino-shim.mjs";
import { loadPlugin } from "../sdk/sandbox.mjs";
import { validate } from "../sdk/validate.mjs";
import { contract, validateManifest } from "../sdk/contract.mjs";
import { fakeContext, foreignContext, liveContext } from "../sdk/panel.mjs";
import { checkPanelScreen, checkPanelScreenAnswer, childNodes, fakePanelScreenContext } from "../sdk/screen.mjs";
import { createNet, createShortService, deviceKino } from "./net.mjs";

/** The kit's `fetchImpl` over the fake short-code service (the kit shim calls it like the WHATWG fetch): never the network. */
function kitFetch(svc = createShortService()) {
  const f = async (url, init = {}) => {
    let body;
    try { body = typeof init.body === "string" && init.body ? { json: JSON.parse(init.body) } : undefined; } catch { body = undefined; }
    const r = await svc.fetch(String(url), { method: init.method || "GET", body });
    return new Response(r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  };
  f.svc = svc;
  return f;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = pjoin(HERE, "..");
const PLUGIN = pjoin(DIR, "plugin.js");
const PLUGIN_SOURCE = readFileSync(PLUGIN, "utf8");
const MANIFEST_TEXT = readFileSync(pjoin(DIR, "kino-plugin.json"), "utf8");
const MANIFEST = JSON.parse(MANIFEST_TEXT);
const quiet = { log() {}, info() {}, warn() {}, error() {} };
const plain = (v) => JSON.parse(JSON.stringify(v));
const LATINO = { pluginId: "latino", name: "Latino" };
const T0 = Date.UTC(2026, 9, 27, 20);
const SPAN = 1000000;

let pure = null;
async function P() {
  if (!pure) pure = (await loadPlugin(PLUGIN, createKino(MANIFEST, { env: {}, fetchImpl: kitFetch() }).kino, { console: quiet })).plugin;
  return pure;
}

// ---------- the tree helpers ----------

const all = (n) => [n, ...childNodes(n).flatMap(all)];
const texts = (root) => all(root).flatMap((n) => [n.text, n.label, n.title].filter((x) => typeof x === "string"));
const ofType = (root, type) => all(root).filter((n) => n.type === type);
/** A raw chat ListView's bubbles in order: { mine, text } (a card's text, or a reaction's glyph). */
const bubblesOf = (list) => list.items.flatMap((g) => g.type !== "Column" ? [] : g.children
  .filter((n) => n.type === "Card" || (n.type === "Text" && ["h2", "h3"].includes(n.style)))
  .map((n) => ({ mine: g.crossAxisAlignment === "end", text: n.type === "Card" ? n.children[0].text : n.text })));
const rawChat = (raw) => all(raw.root).find((n) => n.key === "chat");
const focusFirstField = (raw) => all(raw.root).find((n) => n.type === "TextField" && !n.hidden)?.key;

/**
 * The context Kino gives a tab contributed to another plugin's title (Dune on «Latino» by default); with `dev.live` (Task 11) the
 * live one of an En vivo channel instead: the channel, no position.
 */
function ctxOf(dev, now, over = {}) {
  if (dev.live) {
    const live = liveContext(dev.live, { device: dev.kind, lang: "es-CO" }, dev.live.sourceName || "TDT");
    return fakePanelScreenContext(live, { state: { inputs: {}, ui: {}, ...(dev.tab ? { tab: dev.tab } : {}), ...(dev.state || {}) } });
  }
  const base = fakeContext("movie:438631", { title: "Dune", year: "2021", ids: { tmdb: 438631, imdb: "tt1160419" }, device: dev.kind, positionMs: posAt(dev, now), paused: dev.paused, ...(dev.ctxOver || {}), ...over });
  base.player = { ...base.player, speed: dev.speed || 1 };
  const f = foreignContext(base, "watch-party", dev.source || LATINO);
  return fakePanelScreenContext(f, { state: { inputs: {}, ui: {}, ...(dev.tab ? { tab: dev.tab } : {}), ...(dev.state || {}) } });
}

/** Where a device's player is at [now]: it moves on while playing, at its speed. */
function posAt(dev, now) {
  return Math.round(dev.paused ? dev.pos : dev.pos + (now - dev.posAt) * (dev.speed || 1));
}
/** The person (or Kino, applying a player action) moves this device's player. */
function setPlayer(dev, now, { pos, paused, speed } = {}) {
  dev.pos = pos !== undefined ? pos : posAt(dev, now);
  dev.posAt = now;
  if (paused !== undefined) dev.paused = paused;
  if (speed !== undefined) dev.speed = speed;
}

/** `panel(context)` as Kino reads it: nothing may be dropped. */
async function panel(dev, now, over = {}) {
  if (dev.net) dev.net.now = now;
  dev.fn = "panel";
  const raw = plain(await dev.plugin.panelAt(ctxOf(dev, now, over), now));
  const r = checkPanelScreen(raw, "es");
  assert.deepEqual(withoutCopyDrops(r.dropped, raw), [], `${dev.id}: nothing dropped from the panel`);
  assert.ok(r.panel, `${dev.id}: a valid panel`);
  return { raw, panel: r.panel };
}

/**
 * Task 8x adds `go.copy` (the 11th go shape). Until the kit knows it, it drops each copy button's go with exactly this line;
 * these are filtered (one per copy go in the tree, nothing else). Once 8x lands the kit drops nothing and this filters nothing.
 */
const groupShortOf = (x) => `${x.slice(0, 2)} ${x.slice(2)}`;
const COPY_DROP = "screen: button onTap go must be exactly one of title, play, search, browse, section, categories, close, screen, titleByIds, url, dropped";
const copyGos = (raw) => (JSON.stringify(raw).match(/"go":\{"copy":/g) || []).length;
function withoutCopyDrops(dropped, raw) {
  let left = copyGos(raw);
  return dropped.filter((line) => !(line === COPY_DROP && left-- > 0));
}

/** A press in the tab (`panelAction`), its answer read as Kino reads it. */
async function press(dev, name, now, { arg, value, values = {}, trigger = "press" } = {}) {
  if (dev.net) dev.net.now = now;
  dev.fn = "panelAction";
  const event = { trigger, name, values, ...(arg !== undefined ? { arg } : {}), ...(value !== undefined ? { value } : {}) };
  const raw = plain(await dev.plugin.panelActionAt(event, ctxOf(dev, now), now));
  if (raw === null) return null;
  const r = checkPanelScreenAnswer(raw, "es");
  assert.deepEqual(r.dropped, [], `${dev.id}: nothing dropped from the answer to ${name}`);
  return raw;
}

async function playerEvent(dev, type, now, over = {}) {
  if (dev.net) dev.net.now = now;
  dev.fn = "playerEvent";
  return plain(await dev.plugin.playerEventAt({ type }, ctxOf(dev, now, over), now));
}

const party = (dev) => JSON.parse(dev.kino.storage.get("party"));

async function device(net, id, { kind = "phone", source = LATINO } = {}) {
  const dev = { id, kind, source, pos: 600000, posAt: T0, paused: false, speed: 1 };
  dev.net = net;
  dev.kino = deviceKino(net, dev);
  dev.plugin = (await loadPlugin(PLUGIN, dev.kino, { console: quiet })).plugin;
  return dev;
}

/** [n] rounds of every device's panel refresh, LIMITS.refreshMs apart; the clock after them. */
async function rounds(devs, t, n = 3, step = 3000) {
  for (let i = 0; i < n; i++) {
    for (const d of devs) await panel(d, t);
    t += step;
  }
  return t;
}

async function create(host, name, t) {
  const a = await press(host, "create", t, { values: { myName: name } });
  assert.equal(a.toast.role, "success");
  return party(host);
}

async function join(dev, words, code, name, t) {
  return press(dev, "join", t, { value: { joinWords: words, joinCode: code.replace(/(\d{4})(?=\d)/g, "$1 ") }, values: { myName: name } });
}

/** A host and [names] guests joined one after another, everyone's snapshot settled, backup doors published. */
async function room(names, { t = T0 } = {}) {
  const net = createNet();
  const host = await device(net, "ana");
  const h = await create(host, "Ana", t);
  const guests = [];
  for (const n of names) {
    const g = await device(net, n.toLowerCase());
    t += 500;
    const a = await join(g, h.hostWords, h.code, n, t);
    assert.equal(a.toast.role, "success", `${n} joined`);
    guests.push(g);
  }
  t = await rounds([host, ...guests], t + 1000, 5);
  return { net, host, guests, code: h.code, words: h.hostWords, t };
}

const hist = (dev) => party(dev).hist;
const say = async (dev, text, t) => press(dev, "send", t, { values: { chatText: text } });

// ---------- the manifest ----------

test("the manifest: a contributed tab with room, qrScan and playerControl; Kino would accept it", async () => {
  const m = validateManifest(MANIFEST_TEXT);
  assert.equal(m.ok, true, m.message);
  assert.equal(MANIFEST.apiVersion, 14);
  assert.deepEqual(MANIFEST.capabilities, ["playerPanelTab", "room", "qrScan", "playerControl"]);
  assert.equal(MANIFEST.panel.contributes, true);
  const r = await validate(DIR);
  assert.deepEqual(r.problems, []);
  // Kino asks the person, in red: what the tab sees, that it moves the video, and the room over the Internet.
  for (const line of [contract.manifest.panel.contributes.consentLine.es, contract.kinoRoom.consentLine.es]) {
    assert.ok(r.consent.some((l) => l.text === line && l.danger === true), line);
  }
  assert.ok(r.consent.some((l) => /pausar, reanudar y mover/.test(l.text) && l.danger === true));
  // The only host it reaches is the short-code service.
  assert.deepEqual(MANIFEST.hosts, ["url-code.kinotv.workers.dev"]);
  assert.equal(MANIFEST.fetchHosts, undefined);
});

// ---------- pure pieces ----------

test("text: scrubbed, capped, the code masked; codes, words and QR texts strict", async () => {
  const p = await P();
  assert.equal(p.scrub("ho‮la\u0007\n  mundo", 300), "hola mundo");
  assert.equal(Array.from(p.scrub("x".repeat(400), 300)).length, 300);
  assert.equal(p.maskCode("el código es 1234 5678 9012", "123456789012"), "el código es ••••");
  assert.equal(p.normCode("1234-5678 9012"), "123456789012");
  assert.equal(p.normCode("12345"), "12345", "4 to 12 digits: older 12-digit rooms still join");
  assert.equal(p.normCode("123"), null);
  assert.equal(p.normCode("12 34"), "1234");
  assert.equal(p.groupCode("1234"), "1234");
  assert.equal(p.maskCode("es 12 34, no 2021 ni 12345", "1234"), "es ••••, no 2021 ni 12345", "a 4-digit code is masked only where it stands alone");
  assert.equal(p.groupCode("123456789012"), "1234 5678 9012");
  assert.equal(p.normWords("https://evil.example/x"), null);
  assert.deepEqual(plain(p.parsePartyQr("KINOPARTY1|brave-river-cat-moon|123456789012")), { words: "brave-river-cat-moon", code: "123456789012" });
  assert.equal(p.parsePartyQr("https://example.com/?code=123456789012"), null);
  assert.deepEqual(plain(p.parsePartyQr("KINOPARTY1|brave-river-cat-moon|1234")), { words: "brave-river-cat-moon", code: "1234" });
  assert.equal(p.parsePartyQr("KINOPARTY1|brave-river-cat-moon|123"), null);
  assert.equal(p.parsePartyQr("KINOPARTY1|brave-river|12"), null);
});

test("messages: an unknown kind, an extra field or a wrong type is ignored whole", async () => {
  const p = await P();
  assert.deepEqual(plain(p.readGuestMessage({ t: "msg", text: "hola" })), { t: "msg", text: "hola" });
  assert.equal(p.readGuestMessage({ t: "msg", text: "hola", link: "https://x.example" }), null);
  assert.equal(p.readGuestMessage({ t: "image", url: "https://x.example/a.png" }), null);
  assert.equal(p.readGuestMessage({ t: "emoji", e: "🦄" }), null);
  assert.equal(p.readGuestMessage({ t: "need", from: "1" }), null);
  assert.equal(p.readGuestMessage([1]), null);
  assert.equal(p.readHostMessage({ t: "state", pos: 1, paused: false, speed: 3, at: 1 }), null);
  assert.equal(p.readSnapshot({ t: "snap" }), null);
  assert.equal(p.readLinkMessage({ t: "link", words: "a-b-c", code: "1234", name: "x", memberId: "pabcdefghij", pair: "0123456789abcdef" }), null);
});

test("historyBoundedTo200Entries: 200 entries or 64 KB, whichever comes first", async () => {
  const p = await P();
  const mk = (i, x = `mensaje ${i}`) => ({ c: SPAN + i, k: "msg", by: "pabcdefghij", n: "Bea", x, at: i });
  const h = p.addEntries([], Array.from({ length: 250 }, (_, i) => mk(i + 1)));
  assert.equal(h.length, 200);
  assert.equal(h[0].c, SPAN + 51);
  assert.equal(h[199].c, SPAN + 250);
  const long = p.addEntries([], Array.from({ length: 120 }, (_, i) => mk(i + 1, "ñ€".repeat(150))));
  const bytes = long.reduce((n, e) => n + Buffer.byteLength(e.x) + Buffer.byteLength(e.n) + 40, 0);
  assert.ok(long.length < 120 && bytes <= 64 * 1024, `${long.length} entries, ${bytes} bytes`);
  assert.equal(long[long.length - 1].c, SPAN + 120, "the newest stay");
});

test("snapshotTrimmedToEightKB: the chat tail is trimmed first; members, title and state stay", async () => {
  const p = await P();
  const s = p.newParty("Ana");
  Object.assign(s, { phase: "party", role: "host", epoch: 1, hostName: "Ana", hostWords: "brave-river-cat-moon", snapSeq: 1, maxCseq: SPAN + 20 });
  s.roster = Array.from({ length: 8 }, (_, i) => ({ id: i ? "m" + String(i).repeat(7) : "host", name: "Nombre largo número " + i, js: i + 1, role: "seat", of: null }));
  s.media = { source: LATINO, tmdb: 438631, imdb: "tt1160419", kind: "movie", season: null, episode: null, title: "Dune", year: 2021 };
  s.st = { pos: 1234567, paused: true, speed: 1, at: T0 };
  s.hist = Array.from({ length: 20 }, (_, i) => ({ c: SPAN + i + 1, k: "msg", by: "m1111111", n: "Bea", x: "ñ€😀".repeat(100), at: i }));
  const snap = plain(p.buildSnapshot(s, T0));
  assert.ok(Buffer.byteLength(JSON.stringify(snap)) <= 8192);
  assert.ok(snap.chat.length > 0 && snap.chat.length < 20, `${snap.chat.length} entries kept`);
  assert.equal(snap.chat[snap.chat.length - 1].c, SPAN + 20, "the newest entries are the ones kept");
  assert.equal(snap.members.length, 8);
  assert.deepEqual(snap.state, { pos: 1234567, paused: true, speed: 1, at: T0 });
  assert.equal(snap.media.title, "Dune");
  assert.ok(p.readSnapshot(snap), "a member reads it back");
});

test("needBeyondWindowAnswersHave: entries older than the window are gone; the answer says where it starts", async () => {
  const p = await P();
  const s = p.newParty("Ana");
  Object.assign(s, { phase: "party", role: "host", epoch: 1, maxCseq: SPAN + 200 });
  s.roster = [{ id: "host", name: "Ana", js: 1, role: "seat", of: null }, { id: "mbbbbbbb", name: "Bea", js: 2, role: "seat", of: null }];
  s.hist = Array.from({ length: 150 }, (_, i) => ({ c: SPAN + 51 + i, k: "msg", by: "mbbbbbbb", n: "Bea", x: "m" + i, at: i }));
  p.hostReceive(s, { from: "mbbbbbbb", kind: "msg", payload: { t: "need", from: SPAN + 1 } }, T0);
  // Answers are made at send time from the history (never stored as bulky messages): a job, then its first answers.
  assert.equal(s.outbox.length, 0);
  assert.equal(s.jobs.length, 1);
  const sent = [];
  const room = {
    async send(payload, o) { sent.push({ payload: plain(payload), to: o.to }); },
    async inbox() { return { events: [], last: 0, more: false, reachable: true }; },
    async close() {},
  };
  await p.pump(room, s, { positionMs: 0, paused: true, player: { speed: 1 } }, T0);
  const answers = sent.filter((x) => x.to === "mbbbbbbb");
  assert.deepEqual(answers[0].payload, { t: "have", from: SPAN + 51 });
  assert.ok(answers.length >= 2 && answers.slice(1).every((o) => o.payload.t === "hist" && Buffer.byteLength(JSON.stringify(o.payload)) <= 6144));
  // The guest takes `have` as its floor and never asks below it again.
  const g = p.newParty("Bea");
  Object.assign(g, { phase: "party", role: "guest" });
  p.guestReceive(g, { from: "host", kind: "msg", payload: { t: "have", from: SPAN + 51 } }, T0);
  assert.equal(g.oldest, SPAN + 51);
});

test("the election is deterministic: the lowest joinedSeq holding a backup door, never the host or someone gone", async () => {
  const p = await P();
  const view = {
    members: [{ id: "host", js: 1, role: "seat", name: "Ana" }, { id: "mddddddd", js: 4, role: "seat", name: "Dani" }, { id: "mccccccc", js: 3, role: "seat", name: "Caro" }, { id: "mbbbbbbb", js: 2, role: "display", name: "Bea TV" }],
    backups: { mddddddd: "d-door", mccccccc: "c-door" },
  };
  assert.equal(p.elect(view, []).id, "mccccccc");
  assert.equal(p.elect(view, ["mccccccc"]).id, "mddddddd");
  assert.equal(p.elect(view, ["mccccccc", "mddddddd"]), null);
  assert.deepEqual(plain(p.wantedBackups(view.members)), ["mccccccc", "mddddddd"]);
});

test("syncAction: 2 s of drift, the paused flag, the speed; never while off, on another title, held or too soon", async () => {
  const p = await P();
  const st = { pos: 600000, paused: false, speed: 1, at: T0 };
  const base = { st, stAt: T0, now: T0 + 1000, skew: 0 };
  assert.equal(p.syncAction({ ...base, local: { pos: 600000, paused: false, speed: 1 } }), null, "1 s behind is in step");
  assert.deepEqual(plain(p.syncAction({ ...base, local: { pos: 590000, paused: false, speed: 1 } })), { seekToMs: 601000 });
  assert.deepEqual(plain(p.syncAction({ ...base, st: { ...st, paused: true }, local: { pos: 600500, paused: false, speed: 1 } })), { pause: true });
  assert.deepEqual(plain(p.syncAction({ ...base, st: { ...st, speed: 1.5 }, local: { pos: 601000, paused: false, speed: 1 } })), { speed: 1.5 });
  const far = { pos: 0, paused: true, speed: 1 };
  assert.equal(p.syncAction({ ...base, local: far, follow: false }), null);
  assert.equal(p.syncAction({ ...base, local: far, match: { ok: false } }), null);
  assert.equal(p.syncAction({ ...base, local: far, hold: true }), null);
  assert.deepEqual(plain(p.syncAction({ ...base, local: far, lastAction: T0 })), { seekToMs: 601000 }, "a pause or speed change waits 2 s after the last one");
  const behind = { pos: 590000, paused: false, speed: 1 };
  assert.equal(p.syncAction({ ...base, local: behind, seeks: [T0 - 1000] }), null, "a seek waits for the video to rebuffer");
  assert.deepEqual(plain(p.syncAction({ ...base, local: behind, seeks: [T0 - 9000], lead: 2500 })), { seekToMs: 603500 }, "aimed ahead by the lag the last seek left");
  assert.equal(p.seekAllowed([T0 - 30000, T0 - 10000], T0), false, "the second wait doubles to 16 s");
  assert.equal(p.seekAllowed([T0 - 40000, T0 - 20000], T0), true);
  assert.equal(p.seekAllowed([T0 - 59000, T0 - 50000, T0 - 34000, T0 - 2000], T0), false, "at most 4 a minute");
  assert.equal(p.syncAction({ ...base, local: far, stAt: T0 - 20000 }), null, "a stale state moves nobody");
});

test("the same source and the same title: else Kino's title page or the room's plugin named", async () => {
  const p = await P();
  const media = { source: LATINO, tmdb: 438631, imdb: "tt1160419", kind: "movie", season: null, episode: null, title: "Dune", year: 2021 };
  const ctx = (over) => ({ kind: "movie", ids: { tmdb: 438631 }, title: "Dune", year: "2021", source: LATINO, ...over });
  assert.equal(p.mediaMatch(ctx({}), media).ok, true);
  assert.equal(p.mediaMatch(ctx({ source: { pluginId: "otro", name: "Otro" } }), media).reason, "otherSource");
  assert.equal(p.mediaMatch(ctx({ ids: { tmdb: 1399 } }), media).reason, "otherTitle");
  assert.equal(p.mediaMatch(ctx({ source: undefined }), media).reason, "noSource");
  assert.deepEqual(plain(p.titleByIdsOf(media)), { titleByIds: { kind: "movie", tmdb: 438631, imdb: "tt1160419", title: "Dune", year: 2021 } });
  const ep = { ...media, kind: "series", tmdb: 1396, imdb: null, season: 2, episode: 3, title: "Breaking Bad", year: 2008 };
  assert.equal(p.mediaMatch(ctx({ kind: "episode", ids: { tmdb: 1396 }, season: 2, episode: 4 }), ep).reason, "otherTitle", "another episode");
  assert.deepEqual(plain(p.titleByIdsOf(ep)), { titleByIds: { kind: "series", tmdb: 1396, season: 2, episode: 3, title: "Breaking Bad", year: 2008 } });
});

// ---------- the kit's own room (one device, two simulated members) ----------

test("kit room: the host's tab, Bea's hello and message relayed with a cseq, junk ignored, the code never in the chat", async () => {
  const kitRoom = createKitRoom({ now: () => T0 });
  const { kino } = createKino(MANIFEST, { room: kitRoom, callFunction: "panelAction", env: {}, now: () => T0, fetchImpl: kitFetch() });
  const plugin = (await loadPlugin(PLUGIN, kino, { console: quiet })).plugin;
  const dev = { id: "kit", kind: "phone", pos: 600000, posAt: T0, paused: false, plugin, kino };
  const a = await press(dev, "create", T0, { values: { myName: "Ana" } });
  assert.deepEqual([a.state.tab, a.focus], ["chat", "chatText"], "the room opens on the chat, the D-pad on its input");
  const code = party(dev).code;
  assert.match(code, /^[0-9]{12}$/, "Kino's default 12-digit room code: nobody types it");
  dev.tab = "room";
  const { panel: shown } = await panel(dev, T0 + 100);
  assert.ok(texts(shown.root).some((x) => x.includes(code.replace(/(\d{4})(?=\d)/g, "$1 "))), "the code shown grouped");
  assert.equal(ofType(shown.root, "qr")[0].value, `https://${party(dev).hostWords}.trycloudflare.com/?c=${code}`);
  kitRoom.say("mbea0001", { t: "hello", name: "Bea", role: "seat", maxCseq: 0 });
  kitRoom.say("mbea0001", { t: "msg", text: `hola, el código es ${code}` });
  kitRoom.say("mbea0001", { t: "msg", text: "hola", extra: true });
  kitRoom.say("mbea0001", { t: "image", url: "https://example.com/x.png" });
  kitRoom.say("mcaro002", { t: "msg", text: "sin hello no cuenta" });
  dev.tab = "chat";
  await panel(dev, T0 + 3100);
  const h = hist(dev);
  assert.equal(h.length, 1);
  assert.equal(h[0].x, "hola, el código es ••••");
  assert.equal(h[0].c, SPAN + 1);
  const chat = kitRoom.received.mbea0001.find((m) => m.t === "chat");
  assert.equal(chat.entries[0].x, "hola, el código es ••••");
  assert.ok(kitRoom.received.mcaro002.some((m) => m.t === "snap"), "Caro gets the snapshot too");
  assert.ok(!JSON.stringify(kitRoom.received).includes(code), "the code never travels in a payload");
});

test("kit room: a guest joins the waiting room, follows the host's state and asks with Sincronizar", async () => {
  const kitRoom = createKitRoom({ now: () => T0 });
  const { kino } = createKino(MANIFEST, { room: kitRoom, callFunction: "panelAction", env: {}, now: () => T0, fetchImpl: kitFetch() });
  const plugin = (await loadPlugin(PLUGIN, kino, { console: quiet })).plugin;
  const dev = { id: "kitg", kind: "phone", pos: 500000, posAt: T0, paused: false, plugin, kino };
  const a = await join(dev, kitRoom.remote.words, kitRoom.remote.code, "Beto", T0);
  assert.equal(a.toast.role, "success");
  assert.deepEqual(kitRoom.received.host[0], { t: "hello", name: "Beto", role: "seat", maxCseq: 0 });
  assert.equal(party(dev).me.mid, "mkit0001", "this device is the id Kino gave its session");
  const media = { source: LATINO, tmdb: 438631, imdb: "tt1160419", kind: "movie", season: null, episode: null, title: "Dune", year: 2021 };
  kitRoom.say("host", { t: "snap", seq: 1, epoch: 1, hostName: "Kit", hostWords: kitRoom.remote.words, maxCseq: SPAN, members: [{ id: "host", name: "Kit", js: 1, role: "seat" }, { id: "mkit0001", name: "Beto", js: 2, role: "seat" }], backups: {}, want: [], media, state: { pos: 600000, paused: false, speed: 1, at: T0 + 1000 }, chat: [] });
  const r = await panel(dev, T0 + 1000);
  assert.deepEqual(r.raw.player, { seekToMs: 600000 });
  assert.ok(texts(r.panel.root).some((x) => x.includes("Viendo lo mismo")));
  kitRoom.received.host.length = 0;
  dev.pos = 600000;
  const s = await press(dev, "sync", T0 + 5000);
  assert.ok(s === null || s.toast || s.player);
  assert.deepEqual(kitRoom.received.host.filter((m) => m.t !== "here"), [{ t: "sync" }]);
});

// ---------- two people on the fake network: chat and sync ----------

test("two members: chat both ways with the host's numbers, reactions, the 8-emoji palette only, 5 messages per 10 s", async () => {
  let { host, guests: [bea], t } = await room(["Bea"]);
  await say(bea, "¿Empezamos Dune?", t);
  t = await rounds([host, bea], t + 100, 2);
  await say(host, "¡Sí! 🍿", t);
  await press(bea, "emoji", t + 50, { arg: "7" });
  t = await rounds([host, bea], t + 100, 2);
  for (const d of [host, bea]) assert.deepEqual(hist(d).map((e) => [e.c, e.n, e.x]), [[SPAN + 1, "Bea", "¿Empezamos Dune?"], [SPAN + 2, "Ana", "¡Sí! 🍿"], [SPAN + 3, "Bea", "🍿"]]);
  assert.equal(await press(bea, "emoji", t, { arg: "99" }), null, "a reaction outside the palette does not exist");
  // Five messages in ten seconds, then «Espera un momento».
  for (let i = 0; i < 5; i++) assert.deepEqual((await say(bea, "m" + i, t + 6000 + i)).ui, [{ clear: "chatText" }]);
  assert.equal((await say(bea, "m5", t + 6010)).toast.role, "warning");
  // The tab: bubbles of plain text (no link, no image), and the guest's own pending messages, marked «Enviando…».
  const { raw, panel: shown } = await panel(bea, t + 6100);
  const list = rawChat(raw);
  assert.ok(all({ children: list.items }).every((n) => [undefined, "Column", "Card", "Text"].includes(n.type)));
  assert.equal(list.items.at(-1).key, "pending");
  assert.ok(texts(shown.root).includes("Enviando…"));
});

test("two members: the guest follows pause, seek and speed within 2 s, and its own corrections never loop back", async () => {
  let { host, guests: [bea], t } = await room(["Bea"]);
  // Both players run in step (started together): within 2 s nothing moves.
  setPlayer(bea, t, { pos: posAt(host, t) + 1500 });
  t = await rounds([host, bea], t, 1);
  let r = await panel(bea, t);
  assert.equal(r.raw.player, undefined, "within 2 s: nothing to do");
  // The host pauses: Kino tells the plugin at once; the guest pauses on its next refresh.
  setPlayer(host, t, { paused: true });
  await playerEvent(host, "paused", t + 100);
  r = await panel(bea, t + 1000);
  assert.equal(r.raw.player.pause, true);
  setPlayer(bea, t + 1100, { paused: true, ...(r.raw.player.seekToMs !== undefined ? { pos: r.raw.player.seekToMs } : {}) });
  await playerEvent(bea, "paused", t + 1200); // caused by the plugin's own pause: not a manual one
  assert.equal(party(bea).hold, false);
  // The host seeks far away, speeds up and resumes.
  t += 9000; // a seek waits 8 s after the last one (the pause above may have carried one)
  setPlayer(host, t + 4000, { pos: 1500000, speed: 1.5, paused: false });
  await playerEvent(host, "resumed", t + 4000);
  r = await panel(bea, t + 4200);
  assert.equal(r.raw.player.pause, false);
  assert.equal(r.raw.player.speed, 1.5);
  assert.ok(Math.abs(r.raw.player.seekToMs - 1500300) < 500, JSON.stringify(r.raw.player));
  setPlayer(bea, t + 4300, { pos: r.raw.player.seekToMs, paused: false, speed: 1.5 });
  await playerEvent(bea, "resumed", t + 4400);
  assert.equal(party(bea).hold, false);
  // In step again: the next refreshes move nothing (no feedback loop), and the host never follows anyone.
  r = await panel(bea, t + 7000);
  assert.equal(r.raw.player, undefined);
  const hostResult = await panel(host, t + 7100);
  assert.equal(hostResult.raw.player, undefined);
  // A manual pause while the host plays: the tab stops following until «Volver a sincronizar».
  setPlayer(bea, t + 9000, { paused: true });
  await playerEvent(bea, "paused", t + 9000);
  assert.equal(party(bea).hold, true);
  t = await rounds([host], t + 9500, 1);
  r = await panel(bea, t + 12000);
  assert.equal(r.raw.player, undefined);
  assert.ok(texts(r.panel.root).some((x) => x.includes("por tu cuenta")));
  t = await rounds([host], t + 12500, 1);
  const again = await press(bea, "resync", t);
  assert.equal(again.player.pause, false);
  // Following switched off: nothing moves.
  await press(bea, "follow", t + 1000, { value: false, trigger: "change" });
  setPlayer(bea, t + 1000, { pos: 0 });
  t = await rounds([host], t + 2000, 1);
  r = await panel(bea, t);
  assert.equal(r.raw.player, undefined);
});

test("the same source: another plugin names the room's; another title offers Kino's title page; no sync until it matches", async () => {
  let { host, guests: [bea], t } = await room(["Bea"]);
  setPlayer(bea, t, { pos: 0 });
  bea.source = { pluginId: "otro", name: "Otro" };
  let r = await panel(bea, t);
  assert.equal(r.raw.player, undefined);
  assert.ok(texts(r.panel.root).some((x) => x.includes("Esta sala usa «Latino»")));
  bea.source = LATINO;
  bea.ctxOver = { title: "Avatar", year: "2009", ids: { tmdb: 19995 } };
  r = await panel(bea, t + 3000);
  assert.equal(r.raw.player, undefined);
  const banner = ofType(r.panel.root, "banner").find((b) => /La sala ve/.test(b.text));
  assert.deepEqual(plain(banner.action.onTap.go), { titleByIds: { kind: "movie", tmdb: 438631, imdb: "tt1160419", title: "Dune", year: 2021 } });
  bea.ctxOver = {};
  r = await panel(bea, t + 6000);
  assert.ok(r.raw.player && r.raw.player.seekToMs > 0, "once both match the guest follows");
});

test("untrusted peers: junk from a member changes nothing, a guest's forged state or snapshot moves no one", async () => {
  let { net, host, guests: [bea, caro], t } = await room(["Bea", "Caro"]);
  const before = hist(host).length;
  caro.fn = "panel";
  const handle = caro.joined[0].handle;
  for (const junk of [{ t: "msg" }, { t: "msg", text: 42 }, { t: "emoji", e: "🦄" }, { t: "snap", seq: 99 }, { t: "state", pos: 0, paused: true, speed: 1, at: 0 }, { t: "hello", name: "Impostor", role: "seat" }, { t: "hello", name: "Caro", role: "seat", epoch: 999999 }, { hack: true }]) {
    net.now += 300; // within the room's 5 messages a second
    await caro.kino.room.send(junk, { session: handle, to: "all" });
  }
  t = await rounds([host, bea, caro], t, 2);
  assert.equal(hist(host).length, before);
  assert.deepEqual(party(host).roster.map((m) => m.id), ["host", party(bea).me.mid, party(caro).me.mid], "a second hello from a session adds no one (it may only rename that member), and no forged epoch moves the host");
  assert.equal(party(host).banner, null);
  const r = await panel(bea, t);
  assert.equal(r.raw.player, undefined, "Caro's forged pause reached Bea but only the host's messages count");
  assert.ok(net.sent.length > 0);
});

// ---------- four people: backup doors and failover ----------

test("onlyTwoBackupEndpoints: the two oldest guests open a door; a third is neither asked nor accepted", async () => {
  let { host, guests: [bea, caro, dani], t } = await room(["Bea", "Caro", "Dani"]);
  t = await rounds([host, bea, caro, dani], t, 3);
  const h = party(host);
  assert.deepEqual(Object.keys(h.backups).sort(), [party(bea).me.mid, party(caro).me.mid].sort());
  assert.deepEqual(h.want, [party(bea).me.mid, party(caro).me.mid]);
  assert.equal(party(dani).myWords, null);
  assert.equal((await press(dani, "openBackup", t)).toast, "La sala ya tiene sus puertas de respaldo");
  // A door Dani announces anyway is ignored by the host.
  dani.fn = "panel";
  await dani.kino.room.send({ t: "backup", words: "dani-door-99" }, { session: dani.joined[0].handle });
  await rounds([host], t, 1);
  assert.equal(Object.keys(party(host).backups).length, 2);
  const { panel: shown } = await (async () => { host.tab = "room"; return panel(host, t + 3000); })();
  assert.ok(texts(shown.root).some((x) => x === "Puertas abiertas: 3"));
});

test("hostLeavesAndLowestJoinedSeqTakesOver: everyone elects Bea; one tap each to follow her", async () => {
  let { host, guests: [bea, caro, dani], t } = await room(["Bea", "Caro", "Dani"]);
  t = await rounds([host, bea, caro, dani], t, 3);
  const beaId = party(bea).me.mid;
  await press(host, "leave", t);
  t = await rounds([bea, caro, dani], t + 100, 1);
  assert.equal(party(bea).role, "host");
  assert.equal(party(bea).epoch, 2);
  for (const d of [caro, dani]) {
    assert.deepEqual([party(d).banner.kind, party(d).banner.id], ["newHost", beaId]);
    const { panel: shown } = await panel(d, t);
    assert.ok(texts(shown.root).some((x) => x.includes("El anfitrión se fue: Bea es el nuevo anfitrión")));
    await press(d, "followHost", t + 50);
  }
  t = await rounds([bea, caro, dani], t + 100, 3);
  assert.deepEqual(party(bea).roster.map((m) => m.name).sort(), ["Bea", "Caro", "Dani"]);
  for (const d of [caro, dani]) {
    assert.equal(party(d).hostWords, party(bea).myWords);
    assert.equal(party(d).epoch, 2);
    assert.equal(party(d).banner, null);
  }
  // The chat goes on under the new host, numbered in its own epoch.
  await say(dani, "seguimos", t);
  t = await rounds([bea, caro, dani], t + 100, 2);
  assert.equal(hist(caro).at(-1).c, 2 * SPAN + 1);
});

test("snapshotKeepsChatAndStateAcrossFailover: the new host's first snapshot carries the old title and chat", async () => {
  let { net, host, guests: [bea, caro], t } = await room(["Bea", "Caro"]);
  await say(caro, "qué buena la música de Dune", t);
  t = await rounds([host, bea, caro], t + 100, 4);
  await press(host, "leave", t);
  t = await rounds([bea, caro], t + 100, 1);
  net.sent.length = 0;
  await press(caro, "followHost", t);
  t = await rounds([bea, caro], t + 100, 1);
  const snap = net.sent.find((s) => s.from === "bea" && s.payload.t === "snap");
  assert.ok(snap, "Bea broadcasts a snapshot at once");
  assert.equal(snap.payload.epoch, 2);
  assert.equal(snap.payload.media.title, "Dune");
  assert.ok(snap.payload.chat.some((e) => e.x === "qué buena la música de Dune"));
  assert.ok(!snap.payload.members.some((m) => m.name === "Ana"));
  assert.equal(typeof snap.payload.state.pos, "number");
});

test("newcomerJoinsThroughAnyMemberEndpoint: through Caro's door the newcomer sees the room and reaches the host in one tap", async () => {
  let { net, host, guests: [bea, caro], code, t } = await room(["Bea", "Caro"]);
  await say(bea, "¡hola!", t);
  t = await rounds([host, bea, caro], t + 100, 4);
  const door = party(caro).myWords;
  assert.ok(door && door !== party(host).hostWords);
  const eva = await device(net, "eva");
  const a = await join(eva, door, code, "Eva", t);
  assert.equal(a.toast.role, "success");
  t = await rounds([host, bea, caro, eva], t + 100, 2);
  assert.equal(party(eva).banner.kind, "redirect");
  assert.ok(hist(eva).some((e) => e.x === "¡hola!"), "the forwarded snapshot shows the chat at once");
  await press(eva, "redirect", t);
  t = await rounds([host, bea, caro, eva], t + 100, 3);
  assert.ok(party(host).roster.some((m) => m.name === "Eva"));
  assert.equal(party(eva).banner, null);
});

test("returningHostRejoinsAsGuest: the host's door stops answering; one try each moves the room on; the host comes back as a guest", async () => {
  let { net, host, guests: [bea, caro], t } = await room(["Bea", "Caro"]);
  const ana = party(host);
  net.down.add(ana.hostWords);
  t = await rounds([host, bea, caro], t, 12); // 36 s of silence: nobody concludes anything from it
  for (const d of [bea, caro]) {
    assert.equal(party(d).role, "guest");
    assert.equal(party(d).banner.kind, "noAnswer");
  }
  // Bea, the successor, tries the host's door: it fails, Caro's door answers, so the host is the one gone. She takes over.
  await press(bea, "retryHost", t);
  assert.equal(party(bea).role, "host");
  assert.equal(party(bea).epoch, 2);
  // Caro tries the host's door: it fails; she goes to Bea's door in the same press.
  await press(caro, "retryHost", t + 100);
  t = await rounds([host, bea, caro], t + 200, 12);
  assert.deepEqual(party(bea).roster.map((m) => m.name), ["Bea", "Caro"]);
  assert.equal(party(host).banner.kind, "alone", "only an offer to look: Ana keeps her room");
  assert.equal(party(host).role, "host");
  net.down.delete(ana.hostWords);
  await press(host, "findRoom", t);
  t = await rounds([host, bea, caro], t + 100, 4);
  // What the search found is only shown; Ana's room stays open until she accepts it.
  assert.deepEqual([party(host).role, party(host).banner.kind, party(host).banner.name], ["host", "moved", "Bea"]);
  await press(host, "joinMoved", t);
  t = await rounds([host, bea, caro], t + 100, 3);
  const a = party(host);
  assert.equal(a.role, "guest");
  assert.equal(a.hostWords, party(bea).myWords);
  assert.equal(a.epoch, 2);
  assert.deepEqual(party(bea).roster.map((m) => m.name), ["Bea", "Caro", "Ana"]);
  assert.equal(party(bea).role, "host");
});

test("chatGapFilledWithNeed: a lost batch is asked for and filled", async () => {
  let { net, host, guests: [bea], t } = await room(["Bea"]);
  const lost = SPAN + 2;
  net.drop = ({ to, payload }) => to === "bea" && (payload.t === "snap" || (payload.t === "chat" && payload.entries.some((e) => e.c === lost)));
  for (const text of ["uno", "dos", "tres"]) {
    await say(host, text, t);
    t = await rounds([host, bea], t + 100, 1);
  }
  t = await rounds([host, bea], t, 3);
  assert.ok(net.sent.some((s) => s.from === "bea" && s.payload.t === "need" && s.payload.from === lost));
  assert.deepEqual(hist(bea).map((e) => e.x), ["uno", "dos", "tres"]);
});

test("lateJoinerGetsLast50: a newcomer gets the last 50 entries, not the whole chat", async () => {
  let { net, host, guests: [bea], code, words, t } = await room(["Bea"]);
  for (let i = 1; i <= 120; i++) {
    await say(host, "línea " + i, t);
    t += 2100;
  }
  t = await rounds([host, bea], t, 2);
  const eva = await device(net, "eva");
  await join(eva, words, code, "Eva", t);
  t = await rounds([host, bea, eva], t + 100, 3);
  const h = hist(eva);
  assert.equal(h.length, 50);
  assert.equal(h[0].x, "línea 71");
  assert.equal(h.at(-1).x, "línea 120");
});

test("longChatKeepsRecentWindowAcrossFailover: 250 lines, the host goes, the last 200 survive and the tab draws the newest 40", async () => {
  let { host, guests: [bea, caro], t } = await room(["Bea", "Caro"]);
  for (let i = 1; i <= 250; i++) {
    await say(host, "línea " + i, t);
    t += 2100;
    if (i % 5 === 0) t = await rounds([host, bea, caro], t, 1, 100);
  }
  t = await rounds([host, bea, caro], t, 3);
  await press(host, "leave", t);
  t = await rounds([bea, caro], t + 100, 1);
  await press(caro, "followHost", t);
  await say(caro, "después del cambio", t + 100);
  t = await rounds([bea, caro], t + 200, 3);
  for (const d of [bea, caro]) {
    const h = hist(d);
    assert.equal(h.length, 200);
    assert.equal(h[0].x, "línea 52");
    assert.equal(h.at(-1).x, "después del cambio");
  }
  const { raw } = await panel(caro, t);
  const drawn = bubblesOf(rawChat(raw));
  assert.equal(drawn.length, 40, "the tab draws the newest 40 (the list scrolls)");
  assert.deepEqual(drawn.at(-1), { mine: true, text: "después del cambio" });
  caro.kind = "tv";
  assert.equal(bubblesOf(rawChat((await panel(caro, t)).raw)).length, 25, "and 25 on a TV");
});

// ---------- one person, a phone and a TV ----------

/** Ana hosts, Bea joins with her phone, Bea's TV shows the link QR. */
async function companion() {
  const r = await room(["Bea"]);
  const tv = await device(r.net, "tv", { kind: "tv" });
  await press(tv, "linkStart", r.t, { values: { myName: "Bea" } });
  const { panel: shown } = await panel(tv, r.t + 100);
  const qr = ofType(shown.root, "qr")[0].value;
  return { ...r, phone: r.guests[0], tv, qr, t: r.t + 200 };
}

test("linkQrHasFreshCodeAndExpires5Minutes: a fresh code of its own, gone after 5 minutes", async () => {
  const p = await P();
  const { net, tv, qr, code, t } = await companion();
  const link = p.parseLinkQr(qr, t);
  assert.ok(link.code && link.code !== code, "never the room's code");
  assert.ok(link.exp - t <= 5 * 60000 && link.exp - t > 4 * 60000);
  assert.deepEqual(plain(p.parseLinkQr(qr, t + 7 * 60000)), { error: "expired" });
  const { panel: later } = await panel(tv, t + 5 * 60000 + 1000);
  assert.equal(ofType(later.root, "qr").length, 0);
  assert.equal(net.endpoints.get(link.words).closed, true, "the endpoint is closed with it");
});

test("linkEndpointIsOneUse + memberListShowsTwoDevicesAsOnePerson: scan, link, one press on the TV", async () => {
  const p = await P();
  let { net, host, phone, tv, qr, t } = await companion();
  phone.scans.push(qr);
  const a = await press(phone, "addDevice", t);
  assert.equal(a.toast.role, "success", JSON.stringify(a));
  assert.equal(party(phone).myWords, null, "the phone gave its backup door up for the link slot");
  t = await rounds([host, phone, tv], t + 100, 1);
  const link = p.parseLinkQr(qr, t);
  assert.equal(net.endpoints.get(link.words).closed, true, "closed after the first valid link");
  const other = await device(net, "otro");
  assert.ok((await join(other, link.words, link.code, "Otro", t)).state.error, "nobody else gets in");
  const { panel: shown } = await panel(tv, t);
  assert.ok(texts(shown.root).some((x) => x.includes("Teléfono vinculado: Bea")));
  await press(tv, "enterParty", t + 100);
  t = await rounds([host, phone, tv], t + 200, 3);
  const roster = party(host).roster;
  const tvSeat = roster.find((m) => m.role === "display");
  assert.equal(tvSeat.of, party(phone).me.mid);
  assert.deepEqual(plain(p.memberRows(roster)).map((r) => [r.name, r.host, r.phone, r.tv]), [["Ana", true, true, false], ["Bea", false, true, true]]);
  host.tab = "room";
  const { panel: list } = await panel(host, t);
  assert.ok(texts(list.root).some((x) => x === "Bea 📱 📺"));
});

test("displayMemberTextIgnored + displayMemberEmojiAccepted: a TV's seat only reacts, and every client enforces it", async () => {
  const p = await P();
  let { host, phone, tv, qr, t } = await companion();
  phone.scans.push(qr);
  await press(phone, "addDevice", t);
  t = await rounds([host, phone, tv], t + 100, 1);
  await press(tv, "enterParty", t);
  t = await rounds([host, phone, tv], t + 100, 3);
  const { panel: shown } = await panel(tv, t);
  assert.equal(ofType(shown.root, "textInput").length, 0, "no text field on the TV");
  assert.equal(await press(tv, "send", t, { values: { chatText: "hola" } }), null);
  tv.fn = "panel";
  await tv.kino.room.send({ t: "msg", text: "escrito a mano" }, { session: tv.joined[0].handle });
  await press(tv, "emoji", t + 100, { arg: "6" });
  t = await rounds([host, phone, tv], t + 200, 2);
  for (const d of [host, phone]) {
    const h = hist(d);
    assert.ok(!h.some((e) => e.x === "escrito a mano"));
    const e = h.find((x) => x.x === "👏");
    assert.equal(e.r, "d");
    assert.equal(e.n, "Bea TV");
  }
  // A text entry by a display, even from a (hostile) host, is dropped by every client.
  assert.equal(p.readEntry({ c: SPAN + 9, k: "msg", by: "pbbbbbbbbbb", n: "Bea TV", x: "hola", at: 1, r: "d" }), null);
});

test("phoneLeavesTvKeepsEmojiOnly: the TV stays as a seat of nobody, reactions only, and may link another phone", async () => {
  let { host, phone, tv, qr, t } = await companion();
  phone.scans.push(qr);
  await press(phone, "addDevice", t);
  t = await rounds([host, phone, tv], t + 100, 1);
  await press(tv, "enterParty", t);
  t = await rounds([host, phone, tv], t + 100, 3);
  await press(phone, "leave", t);
  t = await rounds([host, tv], t + 100, 3);
  assert.equal(party(host).roster.find((m) => m.role === "display").of, null);
  const { panel: shown } = await panel(tv, t);
  assert.ok(texts(shown.root).some((x) => x.includes("Sin teléfono vinculado: solo reacciones")));
  assert.equal(all(shown.root).filter((n) => /^emoji[0-7]$/.test(n.key || "")).length, 8);
  await press(tv, "emoji", t, { arg: "0" });
  t = await rounds([host, tv], t + 100, 2);
  assert.equal(hist(host).at(-1).x, "👍");
  // Linking another phone opens a fresh link endpoint while the TV stays in the room.
  await press(tv, "linkStart", t);
  const { panel: again } = await panel(tv, t + 100);
  assert.ok(ofType(again.root, "qr")[0].value.startsWith("KINOLINK1|"));
});

test("wrongCodeLinkRefused: a tampered or foreign QR is refused; a malformed link message never moves the TV", async () => {
  let { net, phone, tv, qr, t } = await companion();
  const [, words, code, exp] = qr.split("|");
  const wrong = String((Number(code[0]) + 1) % 10) + code.slice(1);
  phone.scans.push(`KINOLINK1|${words}|${wrong}|${exp}`);
  const a = await press(phone, "addDevice", t);
  assert.deepEqual(a.state.error, { es: "Ese código no es el de la sala", en: "That is not the room's code", retry: "addDevice" }, "the error in place, with a retry");
  assert.deepEqual(a.ui, [{ hide: "busy.addDevice" }, { hide: "busy.retry" }, { enable: "btnAddDevice" }]);
  phone.scans.push(`KINOPARTY1|${words}|${code}`);
  assert.equal((await press(phone, "addDevice", t + 10)).toast.role, "error");
  // Someone with the link code but a bad message: ignored, the endpoint stays open for the real phone.
  const intruder = await device(net, "intruso");
  intruder.fn = "panelAction";
  const j = await intruder.kino.room.join({ words, code, name: "x" });
  intruder.fn = "panel";
  await intruder.kino.room.send({ t: "link", words: "a-b-c", code: "12", name: "x", memberId: "pxxxxxxxxxx", pair: "0123456789abcdef" }, { session: j.handle });
  await panel(tv, t + 100);
  assert.equal(party(tv).pending, null);
  assert.equal(net.endpoints.get(words).closed, false);
});

// ---------- review round 1: the adversarial cases (A1 to A8) and the fixes they forced ----------

const stored = (dev) => Buffer.byteLength(dev.kino.storage.get("party"));

test("A1 rosterFloodIgnored: one session, many hellos: one member, and the snapshots keep reaching everyone", async () => {
  let { net, host, guests: [bea, mal], t } = await room(["Bea", "Mal"]);
  const seq = party(bea).snapSeq;
  mal.fn = "panel";
  const h = mal.joined[0].handle;
  for (let i = 0; i < 12; i++) {
    net.now += 300;
    await mal.kino.room.send({ t: "hello", name: "Fake" + i, role: "seat" }, { session: h });
  }
  t = await rounds([host, bea, mal], t + 100, 6);
  assert.equal(party(host).roster.length, 3, "one member per session (its hellos may only rename it)");
  assert.ok(party(bea).snapSeq > seq, "Bea still accepts the host's snapshots");
  // And the room's maximum holds even for different sessions: a ninth hello is ignored.
  const p = await P();
  const s = p.newParty("Ana");
  Object.assign(s, { phase: "party", role: "host", epoch: 1, nextJs: 2 });
  s.roster = [{ id: "host", name: "Ana", js: 1, role: "seat", of: null }];
  for (let i = 1; i <= 9; i++) p.hostReceive(s, { from: "m000000" + i, kind: "msg", payload: { t: "hello", name: "P" + i, role: "seat" } }, T0);
  assert.equal(s.roster.length, 8);
});

test("A2 needAmplification: 20 needs and five newcomers never push the host's saved state near the store's 256 KB", async () => {
  let { net, host, guests: [bea, mal], code, words, t } = await room(["Bea", "Mal"]);
  for (let i = 0; i < 60; i++) {
    await say(host, '"\\'.repeat(140) + i, t);
    t += 2100;
    if (i % 4 === 0) t = await rounds([host, bea, mal], t, 1);
  }
  t = await rounds([host, bea, mal], t, 2);
  mal.fn = "panel";
  const h = mal.joined[0].handle;
  for (let i = 0; i < 20; i++) {
    net.now = t + i * 300;
    await mal.kino.room.send({ t: "need", from: 1 }, { session: h });
  }
  for (let i = 0; i < 5; i++) {
    const n = await device(net, "new" + i);
    await join(n, words, code, "Nuevo " + i, t + 6000 + i);
  }
  let max = 0;
  for (let i = 0; i < 10; i++) {
    await panel(host, t + 7000 + i * 3000);
    max = Math.max(max, stored(host));
    const p = party(host);
    assert.ok(p.outbox.length <= 24 && p.jobs.length <= 8, `outbox ${p.outbox.length}, jobs ${p.jobs.length}`);
  }
  assert.ok(max < 128 * 1024, `the host saved at most ${max} bytes`);
  const toMal = net.sent.filter((s) => s.from === "ana" && s.to === "mal" && s.payload.t === "hist");
  assert.ok(toMal.length <= 6, `Mal cost the host ${toMal.length} history chunks in 30 s`);
  // Bea keeps getting the host's state meanwhile (Mal never starves the room).
  await panel(bea, t + 37000);
  assert.ok(t + 37000 - party(bea).stAt <= 6000, "Bea's state is fresh");
});

test("C1 a full store degrades: the tab keeps working and keeps the room", async () => {
  let { host, guests: [bea], t } = await room(["Bea"]);
  // Another key fills the store almost to its 256 KB: the party no longer fits whole.
  host.kino.storage.set("other", "x".repeat(250 * 1024));
  for (let i = 0; i < 30; i++) { await say(host, "línea larga ".repeat(20) + i, t); t += 2100; }
  const r = await panel(host, t);
  assert.ok(r.panel.root, "the tab still draws");
  const saved = party(host);
  assert.equal(saved.phase, "party");
  assert.equal(saved.outbox.length, 0, "the outbox was dropped to fit");
  await panel(bea, t + 100);
});

test("A3 noClaimingDepartedSeat: a newcomer named like a member who left gets a place at the end; the election follows Kino's ids", async () => {
  let { net, host, guests: [bea, caro, mal], code, t } = await room(["Bea", "Caro", "Mal"]);
  await press(bea, "leave", t);
  t = await rounds([host, caro, mal], t + 100, 2);
  const impostor = await device(net, "impostor");
  await join(impostor, party(host).hostWords, code, "Bea", t);
  t = await rounds([host, caro, mal, impostor], t + 100, 4);
  const roster = party(host).roster;
  const fake = roster.find((m) => m.name === "Bea");
  assert.ok(fake.js > roster.find((m) => m.name === "Caro").js, "no seniority is inherited");
  assert.deepEqual(party(host).want, [roster.find((m) => m.name === "Caro").id, roster.find((m) => m.name === "Mal").id]);
  // A hello carrying another member's id is not even read.
  assert.equal((await P()).readGuestMessage({ t: "hello", pid: "pbbbbbbbbbb", name: "Bea", role: "seat" }), null);
});

test("A4 idleDropNoFalseFailover: a guest away for 3 minutes comes back with one press; nobody is promoted", async () => {
  let { host, guests: [bea, caro], t } = await room(["Bea", "Caro"]);
  t = await rounds([host, bea, caro], t, 3);
  assert.ok(party(bea).myWords, "Bea is a backup (the successor)");
  t = await rounds([host, caro], t, 60); // Bea's drawer closed: the host drops her after 2 minutes
  assert.ok(!party(host).roster.some((m) => m.name === "Bea"));
  await panel(bea, t);
  let b = party(bea);
  assert.deepEqual([b.role, b.epoch, b.banner.kind], ["guest", 1, "dropped"]);
  assert.equal(party(host).role, "host");
  assert.equal(party(host).banner, null, "the real host keeps its room, Caro is still there");
  await press(bea, "retryHost", t + 100);
  t = await rounds([host, bea, caro], t + 200, 3);
  b = party(bea);
  assert.deepEqual([b.role, b.epoch, b.banner], ["guest", 1, null]);
  assert.ok(party(host).roster.some((m) => m.name === "Bea"));
});

test("A4b ownOutageNoFalseFailover: 40 s offline, then a try while still offline, then back: no promotion", async () => {
  let { host, guests: [bea, caro], t } = await room(["Bea", "Caro"]);
  t = await rounds([host, bea, caro], t, 3);
  bea.offline = true;
  t = await rounds([host, bea, caro], t, 14);
  assert.deepEqual([party(bea).role, party(bea).banner.kind], ["guest", "noAnswer"]);
  await press(bea, "retryHost", t);
  assert.deepEqual([party(bea).role, party(bea).banner.kind], ["guest", "cantCheck"], "no other door answered: maybe its own connection");
  bea.offline = false;
  await press(bea, "retryHost", t + 3000);
  t = await rounds([host, bea, caro], t + 3100, 3);
  assert.deepEqual([party(bea).role, party(bea).epoch, party(bea).banner], ["guest", 1, null]);
  assert.equal(party(host).role, "host");
});

test("C2 a successor with no other door to check waits for the others: a member at its door is the proof", async () => {
  let { net, host, guests: [bea, caro], t } = await room(["Bea", "Caro"]);
  t = await rounds([host, bea, caro], t, 3);
  // Only Bea holds a door now (Caro gave hers up).
  await panel(caro, t);
  const pc = party(caro);
  caro.fn = "panel";
  await caro.kino.room.close({ session: "hosted" });
  pc.myWords = null;
  caro.kino.storage.set("party", JSON.stringify(pc));
  await caro.kino.room.send({ t: "nobackup" }, { session: caro.joined[0].handle });
  t = await rounds([host, bea, caro], t + 100, 5);
  assert.deepEqual(Object.keys(party(host).backups), [party(bea).me.mid]);
  net.down.add(party(host).hostWords);
  t = await rounds([host, bea, caro], t, 5);
  await press(bea, "retryHost", t);
  assert.deepEqual([party(bea).role, party(bea).banner.kind], ["guest", "waitOthers"]);
  await press(caro, "retryHost", t + 100); // Caro cannot reach the host either: she goes to Bea's door
  t = await rounds([bea, caro], t + 200, 2);
  // A hello alone never promotes: Bea is asked, and her press (the host's door failing again) takes over.
  assert.deepEqual([party(bea).role, party(bea).banner.kind], ["guest", "takeOver"]);
  assert.equal(party(caro).awaiting.name, "Bea");
  await press(bea, "retryHost", t);
  t = await rounds([bea, caro], t + 100, 2);
  assert.equal(party(bea).role, "host", "Caro's hello at Bea's door is the proof");
  assert.deepEqual(party(bea).roster.map((m) => m.name), ["Bea", "Caro"]);
});

test("A5 gapHostLacks: a gap nobody has is asked once, answered `gone`, and never asked again", async () => {
  let { net, host, guests: [bea], t } = await room(["Bea"]);
  for (const x of ["uno", "dos", "tres", "cuatro", "cinco"]) { await say(host, x, t); t = await rounds([host, bea], t + 100, 1); }
  for (const d of [host, bea]) { const p = party(d); p.hist = p.hist.filter((e) => e.x !== "dos"); d.kino.storage.set("party", JSON.stringify(p)); }
  net.sent.length = 0;
  t = await rounds([host, bea], t, 20);
  const needs = net.sent.filter((s) => s.from === "bea" && s.payload.t === "need");
  const answers = net.sent.filter((s) => s.from === "ana" && s.to === "bea" && ["hist", "gone"].includes(s.payload.t));
  assert.equal(needs.length, 1, JSON.stringify(needs.map((n) => n.payload)));
  assert.deepEqual(answers.map((a) => a.payload), [{ t: "gone", from: SPAN + 2, to: SPAN + 2 }]);
  assert.deepEqual(party(bea).holes, [[SPAN + 2, SPAN + 2]]);
});

test("A6 scrub: direction marks, blank fillers, tags, invisible separators and stacked marks", async () => {
  const p = await P();
  const fromCodes = (...c) => String.fromCodePoint(...c);
  assert.equal(p.scrub("a" + fromCodes(0x61c) + "b", 24), "ab");
  assert.equal(p.scrub(fromCodes(0x3164, 0x3164), 24), "");
  assert.equal(p.scrub(fromCodes(0x115f), 24), "");
  assert.equal(p.scrub("a" + fromCodes(0xad) + "b", 24), "ab");
  assert.equal(p.scrub("a" + fromCodes(0xe0041, 0xe0042) + "b", 24), "ab");
  assert.equal(p.scrub("a" + fromCodes(0x34f) + "b" + fromCodes(0x180e) + "c", 24), "abc");
  assert.equal(p.scrub(fromCodes(0x2800), 24), "");
  assert.equal(p.scrub(fromCodes(0x200d, 0x200d), 24), "");
  assert.equal(Array.from(p.scrub("a" + fromCodes(0x301).repeat(50), 300)).length, 3, "two marks per character at most");
  assert.equal(p.scrubName("Mal · anfitrión 📱 📺"), "Mal anfitrión");
  assert.equal(p.maskCode("1234.5678.9012", "123456789012"), "••••");
  assert.equal(p.maskCode(fromCodes(...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2].map((d) => 0xff10 + d)), "123456789012"), "••••");
  // Equal names are numbered; the host is a badge, never a part of a name.
  assert.deepEqual(plain(p.memberRows([{ id: "host", name: "Bea", js: 1, role: "seat" }, { id: "m0000001", name: "Bea", js: 2, role: "seat" }]).map((r) => r.name)), ["Bea", "Bea (2)"]);
});

test("A7 pairTokenEviction: another seat's pairing token survives any number of `pair` messages", async () => {
  let { net, host, guests: [bea, mal], t } = await room(["Bea", "Mal"]);
  const p = party(host);
  p.pairs.aaaaaaaaaaaaaaaa = { mid: party(bea).me.mid, at: t };
  host.kino.storage.set("party", JSON.stringify(p));
  mal.fn = "panel";
  for (let i = 0; i < 4; i++) { net.now = t + i * 300; await mal.kino.room.send({ t: "pair", token: String(i).repeat(16) }, { session: mal.joined[0].handle }); }
  t = await rounds([host], t + 2000, 1);
  assert.ok("aaaaaaaaaaaaaaaa" in party(host).pairs);
  assert.equal(Object.values(party(host).pairs).filter((v) => v.mid === party(mal).me.mid).length, 1, "one token per seat");
});

for (const stall of [1000, 2500, 4000]) {
  test(`A8 seekLoop: a seek that needs ${stall} ms to rebuffer costs at most 4 seeks a minute`, async () => {
    let { host, guests: [bea], t } = await room(["Bea"]);
    setPlayer(bea, t, { pos: posAt(host, t) - 10000 });
    let seeks = 0;
    let frozen = null;
    for (let i = 0; i < 20; i++) {
      t += 3000;
      await panel(host, t);
      if (frozen) setPlayer(bea, t, { pos: t < frozen.until ? frozen.pos : frozen.pos + (t - frozen.until) });
      const r = await panel(bea, t);
      if (r.raw.player && r.raw.player.seekToMs !== undefined) {
        seeks++;
        frozen = { pos: r.raw.player.seekToMs, until: t + stall };
        setPlayer(bea, t, { pos: r.raw.player.seekToMs });
      }
    }
    assert.ok(seeks >= 1 && seeks <= 4, `${seeks} seeks in 60 s`);
  });
}

test("the legacy fallback, the 200-node limit with eight people, and a room switched off", async () => {
  const p = await P();
  const s = p.newParty("Ana");
  Object.assign(s, { phase: "party", role: "host", epoch: 1, code: "123456789012", hostName: "Ana", hostWords: "brave-river-cat-moon", myWords: "brave-river-cat-moon" });
  s.roster = Array.from({ length: 8 }, (_, i) => ({ id: i ? "m000000" + i : "host", name: "Persona " + i, js: i + 1, role: i % 3 === 2 ? "display" : "seat", of: i % 3 === 2 ? "m000000" + (i - 1) : null }));
  s.hist = Array.from({ length: 200 }, (_, i) => ({ c: SPAN + i + 1, k: "msg", by: "host", n: "Ana", x: "línea " + i, at: i }));
  for (const tab of ["chat", "room"]) {
    const ctx = fakePanelScreenContext(foreignContext(fakeContext("movie:1", { tab }), "watch-party", LATINO));
    const r = checkPanelScreen(plain(p.view(s, ctx, T0)), "es");
    assert.deepEqual(r.dropped, [], tab);
  }
  const legacy = plain(p.view(s, fakeContext("movie:1"), T0));
  assert.equal(legacy.format, undefined);
  assert.equal(legacy.elements[0].type, "text");
  // The person switched rooms off for this plugin: Kino's refusal is shown, nothing breaks.
  const { kino } = createKino(MANIFEST, { room: createKitRoom(), callFunction: "panelAction", env: { KINO_ROOM_REVOKED: "1" }, fetchImpl: kitFetch() });
  const plugin = (await loadPlugin(PLUGIN, kino, { console: quiet })).plugin;
  const dev = { id: "off", kind: "phone", pos: 0, posAt: T0, paused: false, plugin, kino };
  const a = await press(dev, "create", T0, { values: { myName: "Ana" } });
  assert.equal(a.state.error.retry, "create");
  assert.deepEqual(a.ui, [{ hide: "busy.create" }, { hide: "busy.retry" }, { enable: "btnCreate" }]);
});

// ---------- review round 2: the re-review's scenarios (S1 to S9) as tests ----------

test("S1 hostCrashNonSuccessorFirst: Caro presses before Bea; Caro waits at Bea's door, Bea's press takes over, both converge", async () => {
  let { net, host, guests: [bea, caro], t } = await room(["Bea", "Caro"]);
  net.down.add(party(host).hostWords);
  t = await rounds([bea, caro], t, 5);
  await press(caro, "retryHost", t);
  t = await rounds([bea, caro], t + 100, 2);
  assert.equal(party(caro).awaiting.name, "Bea");
  assert.equal(party(caro).redirect, null, "never sent back to the host it could not reach");
  assert.ok(party(caro).myWords, "her own door stays open: an old snapshot never closes it");
  const { panel: waiting } = await panel(caro, t);
  assert.ok(texts(waiting.root).some((x) => x.includes("Esperando a que Bea siga como anfitrión")));
  assert.equal((await press(caro, "awaitRetry", t + 10)).toastEn, "We said again that you are here", "every button does something");
  await press(bea, "retryHost", t + 100);
  t = await rounds([bea, caro], t + 200, 4);
  assert.deepEqual([party(bea).role, party(bea).epoch], ["host", 2]);
  assert.deepEqual(party(bea).roster.map((m) => m.name), ["Bea", "Caro"]);
  assert.deepEqual([party(caro).epoch, party(caro).awaiting, party(caro).banner, party(caro).hostWords], [2, null, null, party(bea).myWords]);
});

test("S1b hostCrashSuccessorFirst: Bea presses first (Caro's door answers), then Caro: same end", async () => {
  let { net, host, guests: [bea, caro], t } = await room(["Bea", "Caro"]);
  net.down.add(party(host).hostWords);
  t = await rounds([bea, caro], t, 5);
  await press(bea, "retryHost", t);
  assert.equal(party(bea).role, "host");
  await press(caro, "retryHost", t + 100);
  t = await rounds([bea, caro], t + 200, 4);
  assert.deepEqual(party(bea).roster.map((m) => m.name), ["Bea", "Caro"]);
  assert.deepEqual([party(caro).epoch, party(caro).awaiting, party(caro).banner], [2, null, null]);
});

test("S2 threePeopleAnyOrder: Dani (no door) first, then Bea; Caro later with one press; all at epoch 2", async () => {
  let { net, host, guests: [bea, caro, dani], t } = await room(["Bea", "Caro", "Dani"]);
  net.down.add(party(host).hostWords);
  t = await rounds([bea, caro, dani], t, 5);
  await press(dani, "retryHost", t);
  t = await rounds([bea, caro, dani], t + 100, 2);
  assert.equal(party(dani).awaiting.name, "Bea");
  await press(bea, "retryHost", t);
  t = await rounds([bea, caro, dani], t + 100, 3);
  assert.equal(party(caro).banner.kind, "noAnswer");
  await press(caro, "retryHost", t);
  t = await rounds([bea, caro, dani], t + 100, 4);
  assert.deepEqual(party(bea).roster.map((m) => m.name), ["Bea", "Dani", "Caro"]);
  for (const d of [caro, dani]) assert.deepEqual([party(d).epoch, party(d).banner, party(d).redirect], [2, null, null]);
});

test("S3 singleDoorNonSuccessorFirst: only Bea holds a door, Caro presses first; Bea's press counts Caro's earlier hello", async () => {
  let { net, host, guests: [bea, caro], t } = await room(["Bea", "Caro"]);
  await panel(caro, t);
  const pc = party(caro);
  caro.fn = "panel";
  await caro.kino.room.close({ session: "hosted" });
  pc.myWords = null;
  caro.kino.storage.set("party", JSON.stringify(pc));
  await caro.kino.room.send({ t: "nobackup" }, { session: caro.joined[0].handle });
  t = await rounds([host, bea, caro], t + 100, 5);
  net.down.add(party(host).hostWords);
  t = await rounds([bea, caro], t, 5);
  await press(caro, "retryHost", t);
  t = await rounds([bea, caro], t + 100, 2);
  await press(bea, "retryHost", t);
  t = await rounds([bea, caro], t + 100, 3);
  assert.equal(party(bea).role, "host");
  assert.deepEqual([party(caro).epoch, party(caro).awaiting], [2, null]);
});

test("S4 offlineNonSuccessor: Dani's own outage never names a new host nor ends the room; back online, all is as before", async () => {
  let { host, guests: [bea, caro, dani], t } = await room(["Bea", "Caro", "Dani"]);
  dani.offline = true;
  t = await rounds([host, bea, caro, dani], t, 5);
  await press(dani, "retryHost", t);
  assert.equal(party(dani).banner.kind, "cantCheck");
  const { panel: shown } = await panel(dani, t + 10);
  assert.ok(texts(shown.root).some((x) => x.includes("Sin conexión con la sala")));
  assert.ok(!texts(shown.root).some((x) => /nuevo anfitrión|la sala terminó/.test(x)));
  dani.offline = false;
  await press(dani, "retryHost", t + 3000);
  t = await rounds([host, bea, caro, dani], t + 3100, 3);
  assert.deepEqual([party(dani).role, party(dani).epoch, party(dani).banner, party(dani).hostFailed], ["guest", 1, null, false]);
});

test("S5 forgedProbeSnapshot: a member's door answering the host's search at a far epoch moves nothing; numbering stays bounded", async () => {
  let { host, guests: [mal, bea], t } = await room(["Mal", "Bea"]);
  const door = party(mal).myWords;
  mal.fn = "panel";
  await mal.kino.room.close({ session: mal.joined[0].handle });
  t = await rounds([host], t + 100, 50);
  assert.ok(Object.keys(party(host).leftDoors).length > 0);
  await press(host, "findRoom", t);
  const box = await mal.kino.room.inbox({ session: "hosted" });
  const probe = box.events.filter((e) => e.kind === "join").at(-1).from;
  const forged = { t: "snap", seq: 1, epoch: 999999, hostName: "Ana", hostWords: door, maxCseq: 0, members: [{ id: "host", name: "Ana", js: 1, role: "seat" }], backups: {}, want: [], state: { pos: 3600000, paused: true, speed: 2, at: t }, chat: [] };
  await mal.kino.room.send(forged, { session: "hosted", to: probe });
  t = await rounds([host], t + 100, 8); // the search gives up after 20 s
  assert.deepEqual([party(host).role, party(host).epoch], ["host", 1]);
  assert.ok(!party(host).banner || party(host).banner.kind !== "moved");
  assert.equal((await P()).readSnapshot(forged), null, "an absurd epoch is refused outright");
  // Even epoch + 1 from that door is only SHOWN; the host's room closes only on the person's press.
  await press(host, "findRoom", t);
  const box2 = await mal.kino.room.inbox({ session: "hosted" });
  const probe2 = box2.events.filter((e) => e.kind === "join").at(-1).from;
  await mal.kino.room.send({ ...forged, epoch: 2, hostName: "Mal" }, { session: "hosted", to: probe2 });
  t = await rounds([host], t + 100, 2);
  assert.deepEqual([party(host).role, party(host).banner.kind], ["host", "moved"]);
});

test("S6 seekConverges: a cold 4 s first seek then 0.3 s seeks lands in step (no oscillation ahead); Sincronizar resets the back-off", async () => {
  let { host, guests: [bea], t } = await room(["Bea"]);
  setPlayer(bea, t, { pos: 0 });
  let stallUntil = 0, stalledPos = 0, stall = 4000, seeks = 0;
  for (let i = 0; i < 80; i++) {
    t += 3000;
    if (t < stallUntil) { bea.pos = stalledPos; bea.posAt = t; } else if (stallUntil && bea.posAt < stallUntil) { bea.pos = stalledPos; bea.posAt = stallUntil; }
    await panel(host, t);
    const { raw } = await panel(bea, t);
    if (raw.player && raw.player.seekToMs !== undefined) {
      seeks++;
      stalledPos = raw.player.seekToMs;
      stallUntil = t + stall;
      stall = 300;
      setPlayer(bea, t, { pos: raw.player.seekToMs });
    }
  }
  assert.ok(seeks <= 4, `${seeks} seeks in 4 minutes`);
  assert.ok(Math.abs(posAt(bea, t) - posAt(host, t)) <= 2000, `final offset ${posAt(bea, t) - posAt(host, t)}`);
  await press(bea, "sync", t + 10);
  assert.deepEqual([party(bea).lead, party(bea).seekPending, party(bea).seeks.length], [0, null, 0]);
});

test("S7 closedRoomNoDoor: Kino closed the host's room and no door answers: «tu sala terminó», never «sigue abierta»", async () => {
  let { host, guests: [bea], t } = await room(["Bea"]);
  await panel(bea, t);
  const pb = party(bea);
  bea.fn = "panel";
  if (pb.myWords) {
    await bea.kino.room.close({ session: "hosted" });
    pb.myWords = null;
    bea.kino.storage.set("party", JSON.stringify(pb));
    await bea.kino.room.send({ t: "nobackup" }, { session: bea.joined[0].handle });
  }
  t = await rounds([host, bea], t + 100, 3);
  host.fn = "panel";
  await host.kino.room.close({ session: "hosted" });
  t = await rounds([host, bea], t + 100, 2);
  assert.equal(party(host).banner.kind, "closedMine");
  const a = await press(host, "findRoom", t);
  assert.equal(a.toast.text, "No hay otra puerta: tu sala terminó");
  t = await rounds([host], t + 100, 2);
  const { panel: shown } = await panel(host, t);
  assert.ok(texts(shown.root).some((x) => x.includes("Tu sala terminó")));
});

test("S8 staleHostFailedNoSplit: a successor that failed offline, then was dropped, is never promoted by a hello", async () => {
  let { host, guests: [bea, caro, mal], code, t } = await room(["Bea", "Caro", "Mal"]);
  bea.offline = true;
  t = await rounds([host, bea, caro, mal], t, 5);
  await press(bea, "retryHost", t);
  assert.equal(party(bea).banner.kind, "cantCheck");
  bea.offline = false;
  t = await rounds([host, caro, mal], t + 100, 45);
  t = await rounds([host, bea, caro, mal], t, 1);
  mal.fn = "panelAction";
  const j = await mal.kino.room.join({ words: party(bea).myWords, code, name: "Mal" });
  mal.fn = "panel";
  await mal.kino.room.send({ t: "hello", name: "Mal", role: "seat" }, { session: j.handle });
  t = await rounds([host, bea, caro], t + 100, 2);
  assert.deepEqual([party(bea).role, party(bea).epoch], ["guest", 1]);
  assert.equal(party(host).role, "host");
});

test("S9 lobbyPerMember: two newcomers at a door within a second both get pointed to the host", async () => {
  let { net, guests: [, caro], code, t } = await room(["Bea", "Caro"]);
  const door = party(caro).myWords;
  const mal = await device(net, "mal");
  await join(mal, door, code, "Mal", t);
  const eva = await device(net, "eva");
  await join(eva, door, code, "Eva", t + 1000);
  t = await rounds([caro, mal, eva], t + 1100, 2);
  assert.equal(party(mal).banner.kind, "redirect");
  assert.equal(party(eva).banner.kind, "redirect");
});

test("the «alone» notice only after a real departure: members dropped for a closed drawer leave only a quiet search button", async () => {
  let { host, guests: [bea, caro], t } = await room(["Bea", "Caro"]);
  t = await rounds([host], t, 60); // both drawers closed: the room drops them after 2 minutes
  assert.ok(!party(host).roster.some((m) => m.id !== "host"));
  assert.ok(!party(host).banner, "no «Todos salieron» for an idle drop");
  host.tab = "room";
  const { panel: shown } = await panel(host, t);
  assert.ok(texts(shown.root).includes("Buscar la sala en otra puerta"));
  // A real goodbye, by contrast, counts.
  const r = await room(["Bea"]);
  await press(r.guests[0], "leave", r.t);
  await rounds([r.host], r.t + 100, 12);
  assert.equal(party(r.host).banner.kind, "alone");
});

// ---------- owner changes 2026-10-27: a 4-digit party code, and loading feedback on every press that waits ----------

test("the party room uses Kino's default 12-digit code (no codeDigits) and a 5-digit short code from the service", async () => {
  const asked = [];
  const svc = createShortService();
  const spyKino = createKino(MANIFEST, { env: {}, fetchImpl: kitFetch(svc) }).kino;
  const { plugin } = await loadPlugin(PLUGIN, {
    ...spyKino,
    fetch: (url, o) => svc.fetch(url, o),
    storage: { get: () => null, set() {}, remove() {}, keys: () => [] },
    room: {
      async open(o) { asked.push(plain(o)); return { code: "123456789012", words: "brave-river-cat-moon", expiresAtMs: T0 + 3600000 }; },
      async send() {}, async inbox() { return { events: [], last: 0, more: false, reachable: true }; }, async close() {}, async members() { return []; }, async state() { return { role: "host", joined: [], hosted: null }; }, async join() { throw new Error("no"); },
    },
  }, { console: quiet });
  const ctx = ctxOf({ kind: "phone", pos: 0, posAt: T0, paused: false }, T0);
  const a = plain(await plugin.panelActionAt({ trigger: "press", name: "create", values: { myName: "Ana" } }, ctx, T0));
  assert.equal(asked[0].codeDigits, undefined, "the platform's default code");
  assert.equal(a.toast.text, "Sala creada: comparte el código 41 408");
  assert.deepEqual(svc.calls.map((c) => [c.method, c.url, c.timeoutMs, c.redirect]), [["POST", "https://url-code.kinotv.workers.dev/", 5000, "manual"]]);
  assert.deepEqual(plain(svc.calls[0].body), { json: { url: "https://brave-river-cat-moon.trycloudflare.com/?c=123456789012" } });
  // On the fake network: the host shows the short code; a guest types it and joins; the TV link keeps its 12 digits.
  let { host, code, words, net, t } = await room(["Bea"]);
  assert.match(code, /^[0-9]{12}$/);
  const short = party(host).short;
  assert.match(short, /^[0-9]{5}$/);
  host.tab = "room";
  const { panel: shown } = await panel(host, t);
  assert.ok(texts(shown.root).includes(`${short.slice(0, 2)} ${short.slice(2)}`));
  assert.equal(ofType(shown.root, "qr")[0].value, `https://${words}.trycloudflare.com/?c=${code}`);
  const eva = await device(net, "eva");
  const j = await press(eva, "joinShort", t + 100, { value: { joinShortCode: ` ${short.slice(0, 2)}-${short.slice(2)} ` }, values: { myName: "Eva" } });
  assert.equal(j.toast.role, "success");
  assert.deepEqual(j.ui.slice(0, 3), [{ hide: "busy.joinShort" }, { hide: "busy.retry" }, { enable: "btnJoinShort" }]);
  t = await rounds([host, eva], t + 200, 2);
  assert.ok(party(host).roster.some((m) => m.name === "Eva"));
  const tv = await device(net, "tv", { kind: "tv" });
  await press(tv, "linkStart", t, { values: { myName: "Bea" } });
  assert.match(party(tv).link.code, /^[0-9]{12}$/);
});

test("30 wrong codes close the room (Kino's rule for short codes): the host's tab says its room closed", async () => {
  let { net, host, words, code, t } = await room(["Bea"]);
  const stranger = await device(net, "extraño");
  stranger.fn = "panelAction";
  const wrong = code === "0000" ? "1111" : "0000";
  for (let i = 0; i < 30; i++) { try { await stranger.kino.room.join({ words, code: wrong, name: "x" }); } catch (e) { /* refused */ } }
  t = await rounds([host], t + 100, 2);
  assert.equal(party(host).banner.kind, "closedMine");
});

// ---------- owner request: «Copiar invitación» and a join form that reads a pasted invitation ----------

const W = "integrating-salad-alto-kurt";
const fw = (digits) => digits.split("").map((d) => String.fromCodePoint(0xff10 + Number(d))).join("");

test("invitationText: the short code only (<= 6 lines, < 500), or words + code without one; nothing else", async () => {
  const p = await P();
  const media = { source: LATINO, tmdb: 438631, imdb: "tt1160419", kind: "movie", season: null, episode: null, title: "Dune", year: 2021 };
  const text = p.invitationText({ short: "41408", words: W, code: "123456789012", media });
  assert.equal(text, [
    "Únete a mi fiesta en Kino 🎬",
    "Película: Dune (2021), con «Latino»",
    "Código: 41408",
    "En Kino: reproduce el mismo título ▸ panel ▸ Fiesta ▸ escribe el código ▸ Entrar.",
    "(Join my Kino watch party: type the code above in Kino.)",
  ].join("\n"));
  assert.ok(!text.includes(W) && !text.includes("123456789012"), "the words and the room code stay out of it");
  const series = p.invitationText({ short: "41408", words: W, code: "1234", media: { ...media, kind: "series", title: "Breaking Bad", year: 2008, season: 2, episode: 3 } });
  assert.ok(series.includes("Serie: Breaking Bad (2008), T2 E3, con «Latino»"));
  const long = p.invitationText({ short: "41408", media: { ...media, title: "Una película con un título larguísimo ".repeat(10) } });
  const fallback = p.invitationText({ words: W, code: "123456789012", media });
  assert.ok(fallback.includes(`Palabras: ${W}`) && fallback.includes("Código: 123456789012"), "without a short code: words + code");
  for (const t of [text, series, long, fallback]) {
    assert.ok(Array.from(t).length < 500);
    assert.ok(t.split("\n").length <= 6, "at most 6 lines (go.copy's limit)");
    assert.ok(!/https?:|trycloudflare|\bm[0-9a-z]{7}\b|host/.test(t), t);
  }
  assert.deepEqual(plain(p.parseInvitation(text)), { short: "41408" }, "a pasted short invitation reads back as the short code");
  assert.deepEqual(plain(p.parseInvitation(fallback)), { words: W, code: "123456789012" });
});

test("parseInvitation: a table of realistic pastes", async () => {
  const p = await P();
  const ok = (words, code) => ({ words, code });
  const missing = { error: "missing" };
  const ambiguous = { error: "ambiguous" };
  const cases = [
    ["our own invitation", p.invitationText({ words: W, code: "1234", media: { source: LATINO, tmdb: 1, imdb: null, kind: "movie", season: null, episode: null, title: "Dune", year: 2021 } }), ok(W, "1234")],
    ["WhatsApp bold labels", `*Palabras:* ${W}\n*Código:* 1234`, ok(W, "1234")],
    ["WhatsApp bold inline", `*Palabras:* ${W} *Código:* 12 34`, ok(W, "1234")],
    ["with emoji around", `🎉🍿 ${W} 🎬 1234 🙌`, ok(W, "1234")],
    ["the year in the title and a Código label", `Película: Dune (2021)\nPalabras: ${W}\nCódigo: 7788`, ok(W, "7788")],
    ["a year without parentheses but a label", `Dune 2021 ${W} código 7788`, ok(W, "7788")],
    ["a year in parentheses, no label", `Dune (2021) ${W} 7788`, ok(W, "7788")],
    ["upper case", `PALABRAS: ${W.toUpperCase()}, CÓDIGO: 1234.`, ok(W, "1234")],
    ["trailing punctuation", `${W}, 1234!`, ok(W, "1234")],
    ["full-width digits", `${W} ${fw("1234")}`, ok(W, "1234")],
    ["the tunnel address form", `https://${W.toUpperCase()}.trycloudflare.com code 1234`, ok(W, "1234")],
    ["words with spaces after a label", `Palabras: integrating salad alto kurt\nCódigo: 1234`, ok(W, "1234")],
    ["English labels", `Words: ${W}\nCode: 4321`, ok(W, "4321")],
    ["PIN label, two numbers", `${W} pedido 5555 pin 9876`, ok(W, "9876")],
    ["two numbers and no label", `${W} 5555 9876x 1111`, ambiguous],
    ["a hyphenated title and the words", `Spider-Man (2002) ${W} 1234`, ok(W, "1234")],
    ["two different word groups", `alpha-beta-gamma-delta y otra-cosa-mas-larga 1234`, ambiguous],
    ["a 12-digit code from an older room, grouped", `${W} 1234 5678 9012`, ok(W, "123456789012")],
    ["a code with hyphens", `${W} código 12-34`, ok(W, "1234")],
    ["only digits", "1234", missing],
    ["only the words", W, missing],
    ["a code too short", `${W} código 123`, missing],
    ["words with digits are not words", "abc-123-def 1234", missing],
    ["empty", "   ", missing],
    ["garbage", "¿?¡!", missing],
  ];
  assert.ok(cases.length >= 20);
  for (const [name, text, want] of cases) assert.deepEqual(plain(p.parseInvitation(text)), want, name);
  // Never throws, whatever it gets.
  for (const junk of [null, undefined, 42, {}, [], "x".repeat(5000), "-".repeat(300), "1".repeat(300), String.fromCodePoint(0xd800)]) {
    assert.ok(p.parseInvitation(junk).error);
  }
});

test("the Sala tab opens with one line «Sala: 41 408» (copy icon at its end on the host's phone); the chat never has copy buttons", async () => {
  let { host, t } = await room([]);
  const copyNodes = (root) => all(root).filter((n) => /^btnCopy/.test(n.key || ""));
  // The chat tab, even with the room still empty: no invitation, no copy; the empty state and the input.
  for (const kind of ["phone", "tv"]) {
    host.kind = kind;
    const { raw } = await panel(host, t);
    assert.equal(copyNodes(raw.root).length, 0, `${kind}: no copy in the chat`);
    assert.ok(!/Sala abierta|Room open/.test(JSON.stringify(raw)));
    assert.equal(raw.root.children.find((n) => n.key === "chat").items.length, 0);
    assert.ok(raw.root.children.some((n) => n.key === "inputRow"));
  }
  host.tab = "room";
  for (const kind of ["phone", "tv"]) {
    host.kind = kind;
    const { raw } = await panel(host, t + 100);
    const kids = raw.root.children;
    const head = kids.indexOf(kids.find((n) => n.key === "headerRow"));
    const line = kids[head + 1];
    assert.equal(line.key, "roomLine", "the room line right under the header, no title above it");
    assert.deepEqual(line.children.slice(0, 2).map((n) => [n.text, n.style || "", !!n.bold]), [["Sala:", "", false], [groupShortOf(party(host).short), "h5", true]]);
    assert.equal(line.children[0].color, "muted");
    assert.ok(!/"text":"(Invitar|Código: )/.test(JSON.stringify(raw)), "no «Invitar» heading, no separate code block");
    const copies = copyNodes(raw.root);
    if (kind === "tv") { assert.equal(copies.length, 0, "a TV gets no copy (Kino drops the copy there)"); continue; }
    assert.equal(copies.length, 1, "only «Copiar invitación»");
    const b = copies[0];
    assert.equal(line.children.at(-1), b, "at the right end of the same line");
    assert.deepEqual([b.type, b.icon, b.labelText, b.labelTextEn], ["IconButton", "copy", "Copiar invitación", "Copy invitation"]);
    const go = b.onPressed.go;
    assert.deepEqual(Object.keys(go), ["copy"]);
    assert.equal(go.copy.sensitive, true);
    assert.equal(go.copy.text, (await P()).invitationText({ short: party(host).short, words: party(host).hostWords, code: party(host).code, media: party(host).media }));
    // Opciones avanzadas stays collapsed, below the members.
    const keys = kids.map((n) => n.key);
    assert.equal(kids[keys.indexOf("advanced")].hidden, true);
    assert.ok(keys.indexOf("advanced") > keys.indexOf("roomLine"));
  }
  // A guest sees the line (when it knows the short code) but no copy button.
  const r2 = await room(["Bea"]);
  r2.guests[0].tab = "room";
  const { raw: guestRaw } = await panel(r2.guests[0], r2.t);
  assert.equal(copyNodes(guestRaw.root).length, 0);
});

test("the kit and go.copy: until Task 8x lands it drops exactly the copy go of each button (and nothing else)", async () => {
  const r = checkPanelScreen({ format: "screen", root: { type: "Column", children: [{ type: "TextButton", labelText: "Copiar", icon: "copy", onPressed: { go: { copy: { text: "x", sensitive: true } } } }] } }, "es");
  const knows = r.dropped.length === 0;
  if (!knows) assert.deepEqual(r.dropped, [COPY_DROP], "re-run this file once 8x lands: the drop disappears");
});

// ---------- owner feedback from a real TV: no clipboard and no camera there ----------

// ---------- the owner's short-code service (url-code.kinotv.workers.dev), used as it is today ----------

const SVC = "https://url-code.kinotv.workers.dev/";

test("parseRoomUrl: only https://<words>.trycloudflare.com/?c=<4..12 digits>, strictly (a table of valid and hostile addresses)", async () => {
  const p = await P();
  const ok = (words, code) => ({ words, code });
  const cases = [
    ["https://integrating-salad-alto-kurt.trycloudflare.com/?c=123456789012", ok("integrating-salad-alto-kurt", "123456789012")],
    ["https://integrating-salad-alto-kurt.trycloudflare.com?c=123456789012", ok("integrating-salad-alto-kurt", "123456789012")],
    ["https://ab-cd.trycloudflare.com/?c=1234", ok("ab-cd", "1234")],
    ["https://a-b-c-d-e-f.trycloudflare.com/?c=1234", ok("a-b-c-d-e-f", "1234")],
    ["http://integrating-salad-alto-kurt.trycloudflare.com/?c=123456789012", null],
    ["HTTPS://integrating-salad-alto-kurt.trycloudflare.com/?c=123456789012", null],
    ["https://Integrating-Salad-Alto-Kurt.trycloudflare.com/?c=123456789012", null],
    ["https://integrating-salad-alto-kurt.trycloudflare.com.evil.com/?c=123456789012", null],
    ["https://evil.com/?c=123456789012", null],
    ["https://integrating-salad-alto-kurt.evil.trycloudflare.com/?c=123456789012", null],
    ["https://user@integrating-salad-alto-kurt.trycloudflare.com/?c=123456789012", null],
    ["https://user:pw@integrating-salad-alto-kurt.trycloudflare.com/?c=123456789012", null],
    ["https://integrating-salad-alto-kurt.trycloudflare.com:443/?c=123456789012", null],
    ["https://integrating-salad-alto-kurt.trycloudflare.com:8443/?c=123456789012", null],
    ["https://integrating-salad-alto-kurt.trycloudflare.com./?c=123456789012", null],
    ["https://integrating-salad-alto-kurt.trycloudflare.com/x?c=123456789012", null],
    ["https://integrating-salad-alto-kurt.trycloudflare.com//?c=123456789012", null],
    ["https://integrating-salad-alto-kurt.trycloudflare.com/?c=123456789012&x=1", null],
    ["https://integrating-salad-alto-kurt.trycloudflare.com/?x=1&c=123456789012", null],
    ["https://integrating-salad-alto-kurt.trycloudflare.com/?c=123456789012#frag", null],
    ["https://integrating-salad-alto-kurt.trycloudflare.com/?c=123", null],
    ["https://integrating-salad-alto-kurt.trycloudflare.com/?c=1234567890123", null],
    ["https://integrating-salad-alto-kurt.trycloudflare.com/?c=12ab", null],
    ["https://integrating-salad-alto-kurt.trycloudflare.com/?c=", null],
    ["https://integrating-salad-alto-kurt.trycloudflare.com/", null],
    ["https://xn--mnchen-3ya.trycloudflare.com/?c=123456789012", null],
    ["https://word.trycloudflare.com/?c=123456789012", null],
    ["https://a-b-c-d-e-f-g.trycloudflare.com/?c=123456789012", null],
    ["https://abc1-def.trycloudflare.com/?c=123456789012", null],
    ["https://-abc-def.trycloudflare.com/?c=123456789012", null],
    ["https://abc--def.trycloudflare.com/?c=123456789012", null],
    ["https://" + "a".repeat(30) + "-" + "b".repeat(30) + "-cc.trycloudflare.com/?c=1234", null],
    [" https://integrating-salad-alto-kurt.trycloudflare.com/?c=123456789012", null],
    ["https://integrating-salad-alto-kurt.trycloudflare.com/?c=123456789012\n", null],
    ["javascript:alert(1)", null],
    ["", null],
    [null, null],
    [42, null],
  ];
  assert.ok(cases.length >= 30);
  for (const [url, want] of cases) assert.deepEqual(plain(p.parseRoomUrl(url)), want, JSON.stringify(url));
});

test("normShort: 5 digits, spaces, hyphens and dots ignored, full-width digits read; anything else null", async () => {
  const p = await P();
  for (const [raw, want] of [["41408", "41408"], ["41 408", "41408"], ["41-408", "41408"], ["4.14.08", "41408"], [fw("41408"), "41408"], [41408, "41408"], ["4140", null], ["414080", null], ["4140a", null], ["", null], [null, null], [{}, null]]) {
    assert.equal(p.normShort(raw), want, JSON.stringify(raw));
  }
  assert.equal(p.groupShort("41408"), "41 408");
});

test("the service calls: create (POST, 5 s, one retry), lookup (GET), every non-200 a failure, hostile answers refused", async () => {
  const p = await P();
  const svc = createShortService();
  const f = (url, o) => svc.fetch(url, o);
  // Create: one retry after a network failure.
  let fails = 1;
  svc.answer = null;
  const flaky = async (url, o) => { if (fails-- > 0) { const e = new Error("network"); e.code = "network"; throw e; } return f(url, o); };
  const made = plain(await p.createShortCode(flaky, W, "123456789012", T0));
  assert.deepEqual([made.ok, made.short], [true, "41408"]);
  assert.equal(made.until, T0 + 28800000);
  svc.down = true;
  assert.deepEqual(plain(await p.createShortCode(f, W, "123456789012", T0)), { ok: false, error: "network" });
  assert.equal(svc.calls.filter((c) => c.method === "POST").length, 3, "1 + the retry, then 2 more for the failed create");
  svc.down = false;
  // The service must give back the very address it stored, with a 5-digit code.
  svc.answer = () => [200, { code: "41408", url: "https://evil.example/", expires_in_seconds: 28800 }];
  assert.equal((await p.createShortCode(f, W, "123456789012", T0)).ok, false);
  svc.answer = () => [201, { code: "41408", url: p.roomUrlOf(W, "123456789012") }];
  assert.equal((await p.createShortCode(f, W, "123456789012", T0)).ok, false, "only 200 counts");
  svc.answer = () => [200, "not json"];
  assert.equal((await p.createShortCode(f, W, "123456789012", T0)).ok, false);
  svc.answer = () => [200, { code: "123", url: p.roomUrlOf(W, "123456789012") }];
  assert.equal((await p.createShortCode(f, W, "123456789012", T0)).ok, false);
  // Lookup.
  svc.answer = null;
  svc.codes.set("12345", p.roomUrlOf(W, "123456789012"));
  assert.deepEqual(plain(await p.lookupShortCode(f, "12 345")), { ok: true, words: W, code: "123456789012" });
  assert.deepEqual(plain(await p.lookupShortCode(f, "99999")), { ok: false, error: "notFound" });
  for (const [status, body, error] of [
    [200, "{broken", "invalid"], [200, { code: "12345" }, "invalid"], [200, { url: 42 }, "invalid"], [200, [], "invalid"],
    [200, { url: "https://evil.example/?c=1234" }, "invalid"], [200, { url: `http://${W}.trycloudflare.com/?c=1234` }, "invalid"],
    [302, { url: p.roomUrlOf(W, "1234") }, "invalid"], [500, {}, "network"], [503, {}, "network"], [429, {}, "invalid"],
  ]) {
    svc.answer = () => [status, body];
    assert.deepEqual(plain(await p.lookupShortCode(f, "12345")), { ok: false, error }, JSON.stringify([status, body]));
  }
  svc.answer = null;
  svc.down = true;
  assert.deepEqual(plain(await p.lookupShortCode(f, "12345")), { ok: false, error: "network" });
  // Never the returned address itself: every call went to the service.
  assert.ok(svc.calls.every((c) => c.url.startsWith(SVC)), JSON.stringify(svc.calls.map((c) => c.url)));
});

test("joining with a short code: 404, network and invalid answers say so in place (with a retry); the returned address is never fetched", async () => {
  let { net, host, t } = await room(["Bea"]);
  const eva = await device(net, "eva");
  const tryCode = async (code) => (await press(eva, "joinShort", t, { value: { joinShortCode: code }, values: { myName: "Eva" } }));
  let a = await tryCode("99999");
  assert.deepEqual(a.state.error, { es: "Ese código no existe o ya venció", en: "That code does not exist or has expired", retry: "joinShort" });
  a = await tryCode("123");
  assert.equal(a.state.error.es, "Escribe los 5 números del código");
  net.service.codes.set("55555", "https://evil.example/steal?c=1234");
  a = await tryCode("55555");
  assert.equal(a.state.error.es, "Ese código no es válido");
  net.service.down = true;
  a = await tryCode(party(host).short);
  assert.equal(a.state.error.es, "No pude consultar el código; reintenta");
  assert.equal(a.state.error.retry, "joinShort");
  net.service.down = false;
  a = await tryCode(party(host).short);
  assert.equal(a.toast.role, "success");
  assert.ok(net.service.calls.every((c) => c.url.startsWith(SVC)), "only the service, never the room's address");
  assert.ok(!net.service.calls.some((c) => c.url.includes("evil.example")));
});

test("the service down when the room opens: the room works, the host gets the QR and the advanced options, and one press asks again", async () => {
  const net = createNet();
  net.service.down = true;
  const ana = await device(net, "ana");
  const a = await press(ana, "create", T0, { values: { myName: "Ana" } });
  assert.equal(a.toast.role, "warning");
  assert.equal(party(ana).phase, "party");
  assert.equal(party(ana).short, null);
  ana.tab = "room";
  let { panel: shown } = await panel(ana, T0 + 100);
  const keys = all(shown.root).map((n) => n.key);
  for (const k of ["btnShort", "btnAdvanced", "advanced"]) assert.ok(keys.includes(k), k);
  assert.ok(texts(shown.root).some((x) => x.startsWith("Código de la sala: ")), "the room's own code, in the collapsed advanced options");
  assert.equal(all(shown.root).find((n) => n.key === "advanced").hidden, true);
  net.service.down = false;
  const again = await press(ana, "shortCode", T0 + 200);
  assert.equal(again.toast.role, "success");
  assert.match(party(ana).short, /^[0-9]{5}$/);
  assert.deepEqual(again.ui.slice(0, 3), [{ hide: "busy.shortCode" }, { hide: "busy.retry" }, { enable: "btnShort" }]);
});

test("revoking: the host's leave DELETEs its code once (after closing the room); failures never block it; guests never revoke", async () => {
  let { net, host, guests: [bea], t } = await room(["Bea"]);
  const short = party(host).short;
  net.service.calls.length = 0;
  await press(bea, "leave", t);
  assert.equal(net.service.calls.length, 0, "a guest never revokes the host's code");
  await press(host, "leave", t + 100);
  assert.deepEqual(net.service.calls.map((c) => [c.method, c.url, c.timeoutMs]), [["DELETE", SVC + short, 3000]]);
  assert.equal(host.kino.storage.get("party"), null, "the code is forgotten with the room");
  // A failing service: the leave still closes everything at once.
  const r2 = await room([]);
  r2.net.service.down = true;
  const left = await press(r2.host, "leave", r2.t);
  assert.equal(left.toastEn, "You left the room");
  assert.equal(r2.host.kino.storage.get("party"), null);
  // No code was ever created: no DELETE.
  const net3 = createNet();
  net3.service.down = true;
  const ana = await device(net3, "ana");
  await press(ana, "create", T0, { values: { myName: "Ana" } });
  net3.service.down = false;
  net3.service.calls.length = 0;
  await press(ana, "leave", T0 + 100);
  assert.equal(net3.service.calls.filter((c) => c.method === "DELETE").length, 0);
});

test("revoking: asking for a new code revokes the old one first; nothing secret is ever logged", async () => {
  const net = createNet();
  const logged = [];
  const ana = await device(net, "ana");
  ana.kino.log = { info: (x) => logged.push(String(x)), warn: (x) => logged.push(String(x)), error: (x) => logged.push(String(x)) };
  await press(ana, "create", T0, { values: { myName: "Ana" } });
  const first = party(ana).short;
  net.service.calls.length = 0;
  await press(ana, "shortCode", T0 + 100);
  assert.deepEqual(net.service.calls.map((c) => [c.method, c.url]), [["DELETE", SVC + first], ["POST", SVC]]);
  assert.notEqual(party(ana).short, first);
  const bea = await device(net, "bea");
  bea.kino.log = ana.kino.log;
  await press(bea, "joinShort", T0 + 200, { value: { joinShortCode: party(ana).short }, values: { myName: "Bea" } });
  await press(ana, "leave", T0 + 300);
  const secrets = [first, party(bea).short, party(bea).code, party(bea).hostWords].filter(Boolean);
  for (const line of logged) for (const x of secrets) assert.ok(!line.includes(x), "no code or words in the logs");
});

// ---------- the step-by-step tab when not in a room (owner, 2026-10-27), inline loading, focus, small text ----------

/** Kino's panel state after an answer: its `state` merged (a null removes a key). */
function applyAnswer(dev, a) {
  if (!a || !a.state) return;
  const st = { ...(dev.state || {}) };
  for (const [k, v] of Object.entries(a.state)) { if (v === null) delete st[k]; else st[k] = v; }
  dev.state = st;
}

/** The tree of [step] for a fresh party on [device] (a saved name or none), as Kino reads it. */
async function stepTree(step, { device = "phone", name = "", target = null, extra = {} } = {}) {
  const p = await P();
  const party0 = p.newParty(name);
  const state = { inputs: {}, ui: {}, wizStep: step, ...(target ? { joinTarget: target } : {}), ...extra };
  const ctx = fakePanelScreenContext(foreignContext(fakeContext("movie:1", { device }), "watch-party", LATINO), { state });
  const raw = plain(p.view(party0, ctx, T0));
  const r = checkPanelScreen(raw, "es");
  assert.deepEqual(r.dropped, [], `${step}/${device}`);
  return { raw, root: r.panel.root };
}
const visible = (root) => all(root).filter((n) => !n.hidden);
const buttonsOf = (root) => visible(root).filter((n) => n.type === "button");
const inputsOf = (root) => visible(root).filter((n) => ["textInput", "textArea"].includes(n.type));
/** Every waiting trigger (raw tree) is followed at once by its own progress row, in the same list. */
function rowsFollowTriggers(raw) {
  const walk = (n) => {
    const kids = Array.isArray(n && n.children) ? n.children : [];
    kids.forEach((c, i) => {
      const tap = c.onPressed || c.onTap || c.onSubmitted || (c.action && c.action.onTap);
      const show = tap && Array.isArray(tap.ui) ? tap.ui.find((op) => typeof op.show === "string" && op.show.startsWith("busy.")) : null;
      if (show) {
        assert.equal(kids[i + 1] && kids[i + 1].key, show.show, `${c.key || c.type}: its row right after it`);
        assert.equal(kids[i + 1].hidden, true);
        assert.equal(kids[i + 1].children.length, 1, "one progress, one label");
      }
      walk(c);
    });
  };
  walk(raw.root);
}

test("wizard: each step's visible controls on phone and TV (home: two buttons; one input per name/code step), small trees", async () => {
  const target = { words: "integrating-salad-alto-kurt", code: "123456789012", short: "41408" };
  for (const device of ["phone", "tv"]) {
    for (const name of ["", "Ana"]) {
      const home = await stepTree("home", { device, name });
      assert.equal(buttonsOf(home.root).length, 2, "home: exactly two buttons");
      assert.equal(inputsOf(home.root).length, 0);
      assert.deepEqual(buttonsOf(home.root).map((b) => b.label), ["Crear sala", "Unirme a sala"]);
      rowsFollowTriggers(home.raw);
    }
    const c1 = await stepTree("c1", { device });
    assert.deepEqual(inputsOf(c1.root).map((n) => n.key), ["myName"]);
    assert.deepEqual(buttonsOf(c1.root).map((b) => b.key), ["btnCreate", "btnBack"]);
    const j1 = await stepTree("j1", { device });
    assert.deepEqual(inputsOf(j1.root).map((n) => n.key), ["joinShortCode"]);
    assert.equal(all(j1.root).find((n) => n.key === "joinShortCode").kind, "number");
    const j1keys = buttonsOf(j1.root).map((b) => b.key);
    if (device === "tv") assert.deepEqual(j1keys, ["btnLookup", "btnLink", "btnWords", "btnBack"]);
    else assert.deepEqual(j1keys, ["btnLookup", "btnPaste", "btnScan", "btnWords", "btnBack"]);
    const j1b = await stepTree("j1b", { device });
    assert.deepEqual(inputsOf(j1b.root).map((n) => n.key), ["joinWords", "joinCode"]);
    const j2 = await stepTree("j2", { device, target });
    assert.deepEqual(inputsOf(j2.root).map((n) => n.key), ["myName"]);
    assert.deepEqual(buttonsOf(j2.root).map((b) => b.key), ["btnJoinTarget", "btnBack"]);
    const jp = await stepTree("jp", { device });
    if (device === "tv") assert.deepEqual(inputsOf(jp.root).map((n) => n.key), ["joinShortCode"], "a TV never shows the paste step");
    else assert.deepEqual(inputsOf(jp.root).map((n) => n.key), ["joinPaste"]);
    for (const t of [c1, j1, j1b, j2, jp]) {
      assert.ok(all(t.root).length <= 25, `${all(t.root).length} nodes`);
      assert.ok(buttonsOf(t.root).some((b) => b.key === "btnBack"), "«Atrás» on every step after the first");
      rowsFollowTriggers(t.raw);
    }
    // j2 without a checked room falls back to the code step.
    assert.deepEqual(inputsOf((await stepTree("j2", { device })).root).map((n) => n.key), ["joinShortCode"]);
  }
});

test("wizard: transitions and «Atrás» are pure state changes with a focus on the new step's first control", async () => {
  const net = createNet();
  const eva = await device(net, "eva");
  const go = async (to) => { const a = await press(eva, "wiz", T0, { arg: to }); applyAnswer(eva, a); return a; };
  for (const [to, focus] of [["c1", "myName"], ["home", "btnHomeJoin"], ["j1", "joinShortCode"], ["j1b", "joinWords"], ["j1", "joinShortCode"], ["jp", "joinPaste"], ["j1", "joinShortCode"], ["home", "btnHomeJoin"]]) {
    const a = await go(to);
    assert.equal(a.state.wizStep, to);
    assert.equal(a.focus, focus, to);
  }
  assert.equal(eva.kino.storage.get("party"), null, "a step change opens no room and keeps nothing");
});

test("wizard: no saved name → the name is asked once (after the code was checked) and saved; Back from it keeps the code", async () => {
  let { net, host, t } = await room([]);
  const short = party(host).short;
  const eva = await device(net, "eva");
  eva.state = { wizStep: "j1" };
  let a = await press(eva, "lookupShort", t, { values: { joinShortCode: short } });
  assert.deepEqual([a.state.wizStep, a.focus], ["j2", "myName"]);
  applyAnswer(eva, a);
  // «Atrás» from the name step: the code step with the code still typed.
  a = await press(eva, "wiz", t + 10, { arg: "j1" });
  applyAnswer(eva, a);
  const { raw } = await panel(eva, t + 20);
  const field = JSON.stringify(raw).includes(`"value":"${short}"`);
  assert.ok(field, "the typed code is kept");
  a = await press(eva, "lookupShort", t + 30, { values: { joinShortCode: short } });
  applyAnswer(eva, a);
  a = await press(eva, "joinTarget", t + 40, { values: { myName: "Eva" } });
  assert.equal(a.toast.role, "success");
  assert.equal(eva.kino.storage.get("name"), "Eva", "saved for next time");
  assert.equal(a.state.wizStep, "home");
  t = await rounds([host, eva], t + 100, 2);
  assert.ok(party(host).roster.some((m) => m.name === "Eva"));
});

test("wizard: with a saved name, «Crear sala» creates at once and «Siguiente» joins at once (no name step)", async () => {
  const net = createNet();
  const ana = await device(net, "ana");
  ana.kino.storage.set("name", "Ana");
  const { panel: shown0 } = await panel(ana, T0);
  const create = all(shown0.root).find((n) => n.key === "btnCreate");
  assert.deepEqual(create.onTap.ui, [{ show: "busy.create" }, { disable: "btnCreate" }], "home's «Crear sala» waits on the room itself");
  const a = await press(ana, "create", T0, { values: {} });
  assert.equal(a.toast.role, "success");
  assert.equal(party(ana).me.name, "Ana");
  const bea = await device(net, "bea");
  bea.kino.storage.set("name", "Bea");
  bea.state = { wizStep: "j1" };
  const { raw } = await panel(bea, T0 + 10);
  rowsFollowTriggers(raw);
  assert.ok(JSON.stringify(raw).includes("Uniéndose a la sala…"), "with a saved name the lookup's row says it is joining");
  const j = await press(bea, "lookupShort", T0 + 20, { values: { joinShortCode: party(ana).short } });
  assert.equal(j.toast.role, "success");
  assert.equal(j.state.wizStep, "home");
  assert.equal(party(bea).phase, "party");
  // The other ways in follow the same rule: a scanned QR and words + code join at once with a saved name.
  const caro = await device(net, "caro");
  caro.kino.storage.set("name", "Caro");
  caro.scans.push(`https://${party(ana).hostWords}.trycloudflare.com/?c=${party(ana).code}`);
  assert.equal((await press(caro, "scanJoin", T0 + 30)).toast.role, "success");
  const dani = await device(net, "dani");
  const w = await press(dani, "wordsNext", T0 + 40, { values: { joinWords: party(ana).hostWords, joinCode: party(ana).code } });
  assert.deepEqual([w.state.wizStep, w.focus], ["j2", "myName"], "no saved name: the name step");
});

test("wizard: errors stay in place on the code step (404, invalid, network) with a retry whose row follows it", async () => {
  const net = createNet();
  const eva = await device(net, "eva");
  eva.state = { wizStep: "j1" };
  for (const [code, setup, es, retry] of [
    ["99999", () => {}, "Ese código no existe o ya venció", true],
    ["55555", () => net.service.codes.set("55555", "https://evil.example/?c=1234"), "Ese código no es válido", false],
    ["12345", () => { net.service.down = true; }, "No pude consultar el código; reintenta", true],
    ["12", () => { net.service.down = false; }, "Escribe los 5 números del código", false],
  ]) {
    setup();
    const a = await press(eva, "lookupShort", T0, { values: { joinShortCode: code } });
    assert.equal(a.state.error.es, es);
    assert.equal(a.state.wizStep, undefined, "still on the code step");
    assert.equal(a.focus, retry ? "btnRetry" : "joinShortCode", "a failed lookup: on «Reintentar»; a typing mistake: back on the field");
    applyAnswer(eva, a);
    const { raw, panel: shown } = await panel(eva, T0 + 1);
    const kids = raw.root.children;
    assert.deepEqual([kids[0].key, kids[0].text, kids[0].color], ["errText", es, "error"], "the error in place, at the top");
    if (retry) {
      assert.deepEqual([kids[1].key, kids[1].type, kids[1].labelText], ["btnRetry", "ElevatedButton", "Reintentar"]);
      assert.deepEqual(kids[1].onPressed, { ui: [{ show: "busy.retry" }], event: "lookupShort" });
      assert.equal((await P()).focusables(raw.root)[0], "btnRetry", "the first control in D-pad order");
    } else assert.ok(!kids.some((n) => n.key === "btnRetry"));
    rowsFollowTriggers(raw);
    assert.ok(all(shown.root).some((n) => n.key === a.focus), "the focus is on screen");
  }
});

test("«Cambiar mi nombre»: a one-field screen in the room; it renames now (host and guest) and is saved for next time", async () => {
  let { host, guests: [bea], t } = await room(["Bea"]);
  bea.tab = "room";
  let a = await press(bea, "renameOpen", t);
  assert.equal(a.focus, "myName");
  applyAnswer(bea, a);
  const { panel: shown } = await panel(bea, t + 1);
  assert.deepEqual(inputsOf(shown.root).map((n) => n.key), ["myName"]);
  a = await press(bea, "rename", t + 2, { values: { myName: "Beatriz" } });
  applyAnswer(bea, a);
  assert.equal(bea.kino.storage.get("name"), "Beatriz");
  t = await rounds([host, bea], t + 10, 3);
  assert.ok(party(host).roster.some((m) => m.name === "Beatriz"), "the host's list shows the new name");
  a = await press(host, "rename", t, { values: { myName: "Anita" } });
  t = await rounds([host, bea], t + 10, 3);
  assert.equal(party(bea).hostName, "Anita");
});

test("focus: every answer names a control that exists in the view it leads to (steps, loading done, errors, joined, the link QR)", async () => {
  let { net, host, t } = await room([]);
  const short = party(host).short;
  const tv = await device(net, "tv", { kind: "tv" });
  tv.state = { wizStep: "j1" };
  const answers = [];
  const record = async (dev, name, o) => {
    const a = await press(dev, name, t, o);
    answers.push([dev, a]);
    applyAnswer(dev, a);
    const { panel: shown } = await panel(dev, t + 1);
    assert.ok(all(shown.root).some((n) => n.key === a.focus), `${dev.id} after ${name}: ${a.focus}`);
    return a;
  };
  await record(tv, "linkStart", { values: {} });
  const { raw: linkRaw } = await panel(tv, t);
  assert.equal(linkRaw.root.children.find((n) => n.type === "QrImage") ? linkRaw.root.children.findIndex((n) => n.type === "QrImage") : -1, 0, "the QR first");
  assert.equal(answers.at(-1)[1].focus, "btnLinkCancel");
  const eva = await device(net, "eva");
  eva.state = { wizStep: "j1" };
  await record(eva, "lookupShort", { values: { joinShortCode: "99999" } });
  await record(eva, "lookupShort", { values: { joinShortCode: short } });
  await record(eva, "wiz", { arg: "j1" });
  await record(eva, "lookupShort", { values: { joinShortCode: short } });
  await record(eva, "joinTarget", { values: { myName: "Eva" } });
  assert.ok(answers.every(([, a]) => typeof a.focus === "string"), "every answer names a focus");
});

test("text sizes: no style above h4 but the short code; every text and banner line at most 120 characters", async () => {
  const raws = [];
  for (const device of ["phone", "tv"]) {
    for (const step of ["home", "c1", "j1", "j1b", "jp"]) raws.push((await stepTree(step, { device })).raw);
    raws.push((await stepTree("j2", { device, target: { words: "integrating-salad-alto-kurt", code: "1234", short: "41408" } })).raw);
  }
  let { host, guests: [bea], net, t } = await room(["Bea"]);
  await say(bea, "una línea de chat bastante larga ".repeat(8), t);
  t = await rounds([host, bea], t + 10, 2);
  for (const d of [host, bea]) for (const tab of [undefined, "room"]) { d.tab = tab; raws.push((await panel(d, t)).raw); }
  net.down.add(party(host).hostWords);
  t = await rounds([bea], t, 5);
  raws.push((await panel(bea, t)).raw);
  let shortSeen = 0;
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.key === "chat") return; // people's own messages
    if (n.key === "emojiPalette") return; // the reactions' glyphs are meant to be large
    assert.ok(!(typeof n.style === "string" && /^h[1-4]$/.test(n.style)), JSON.stringify(n).slice(0, 120));
    if (n.key === "shortCode") { assert.deepEqual([n.style, n.bold], ["h5", true]); shortSeen++; }
    if ((n.type === "Text" || n.type === "MaterialBanner") && typeof n.text === "string") assert.ok(Array.from(n.text).length <= 120, n.text);
    for (const c of Array.isArray(n.children) ? n.children : []) walk(c);
  };
  for (const r of raws) walk(r.root);
  assert.ok(shortSeen >= 1, "the short code: bold, modest");
});

// ---------- owner feedback from the real TV on the room view (2026-10-27) ----------

test("room view: no «Fiesta» or room-name heading; a header row (status left, sync icon right for guests); messages above the input", async () => {
  let { host, guests: [bea], t } = await room(["Bea"]);
  await say(bea, "hola", t);
  t = await rounds([host, bea], t + 10, 2);
  for (const device of ["phone", "tv"]) {
    for (const d of [host, bea]) {
      d.kind = device;
      d.tab = undefined;
      const { raw } = await panel(d, t);
      const json = JSON.stringify(raw.root);
      assert.ok(!/"text":"(Fiesta|Sala de [^"]*)"/.test(json), "no redundant heading");
      const kids = raw.root.children;
      const header = kids.find((n) => n.key === "headerRow");
      assert.ok(header, "a header row");
      assert.equal(header.children[0].type, "Text");
      const sync = header.children.find((n) => n.key === "btnSync");
      if (d === bea) {
        assert.equal(header.children.at(-1), sync, "the sync icon on the right");
        assert.deepEqual([sync.type, sync.icon, sync.labelText, sync.labelTextEn], ["IconButton", "sync", "Sincronizar", "Sync"]);
        assert.equal(kids[kids.indexOf(header) + 1].key, "busy.sync", "its progress row right under the header");
      } else assert.equal(sync, undefined, "the host has nothing to sync to");
      // Order: messages, then the (hidden) reactions, then the input row with the field, the emoji toggle and the send arrow.
      const keys = kids.map((n) => n.key);
      const list = keys.indexOf("chat");
      const palette = keys.indexOf("emojiPalette");
      const input = keys.indexOf("inputRow");
      assert.ok(list > keys.indexOf("headerRow") && list < palette && palette < input, keys.join(","));
      assert.equal(kids[palette].hidden, true, "reactions hidden until the emoji button");
      const row = kids[input];
      assert.deepEqual(row.children.map((n) => n.key), ["chatText", "emojiToggle"], "the field (its send icon inside it) and the emoji toggle");
      assert.equal(row.gap, device === "tv" ? 4 : 0);
      const field = row.children[0];
      assert.equal(field.onSubmitted, "send", "the keyboard's own send action");
      assert.deepEqual([field.trailingIcon, field.trailingLabel, field.trailingLabelEn, field.onTrailingTap], ["send", "Enviar", "Send", "send"], "the send icon inside the field");
      const toggle = row.children[1];
      assert.deepEqual([toggle.type, toggle.icon, toggle.labelText, toggle.labelTextEn], ["IconButton", "mood", "Emojis", "Emoji"], "icon-only (the label is for screen readers)");
      assert.deepEqual(row.children[1].onPressed, { ui: [{ toggle: "emojiPalette" }] });
      assert.deepEqual(kids[palette].children[0].onTap, { ui: [{ hide: "emojiPalette" }], event: "emoji", arg: "0" }, "one reaction sent closes them");
      assert.deepEqual(bubblesOf(kids[list]).at(-1), { mine: d === bea, text: "hola" }, "the newest at the bottom");
      // As Kino reads it: the icon buttons keep their label as the accessible name and draw no text.
      const { panel: shown } = await panel(d, t);
      // Kino keeps the send icon in the field (its own D-pad stop on a TV: field, send, emoji) and nothing is dropped.
      const shownField = all(shown.root).find((n) => n.key === "chatText");
      assert.deepEqual([shownField.trailing.icon, shownField.trailing.label], ["send", "Enviar"]);
      assert.ok(!all(shown.root).some((n) => n.key === "btnSend"), "no separate send button");
      const toggleNode = all(shown.root).find((n) => n.key === "emojiToggle");
      assert.deepEqual([toggleNode.variant, toggleNode.icon, toggleNode.label], ["icon", "mood", "Emojis"]);
    }
  }
});

test("room view: a TV display seat sees its reactions directly and no input row", async () => {
  const p = await P();
  const s = p.newParty("Bea TV");
  Object.assign(s, { phase: "party", role: "guest", code: "123456789012", hostWords: "ana-door-a", handle: "j1", hostName: "Ana" });
  s.me = { ...s.me, role: "display", of: "m0000001", mid: "m0000002" };
  const ctx = fakePanelScreenContext(foreignContext(fakeContext("movie:1", { device: "tv" }), "watch-party", LATINO));
  const raw = plain(p.view(s, ctx, T0));
  const kids = raw.root.children;
  const palette = kids.find((n) => n.key === "emojiPalette");
  assert.equal(palette.hidden, undefined, "shown: reactions are all a display seat can send");
  assert.deepEqual(palette.children[0].onTap, { event: "emoji", arg: "0" });
  assert.ok(!kids.some((n) => n.key === "inputRow"));
  assert.deepEqual(checkPanelScreen(raw, "es").dropped, []);
});

test("recovery screens: ordinary text and an ordinary button (no banner, no large text), the explanation in at most 120 characters", async () => {
  let { net, host, guests: [bea, caro], t } = await room(["Bea", "Caro"]);
  net.down.add(party(host).hostWords);
  t = await rounds([bea, caro], t, 5);
  await press(caro, "retryHost", t);
  for (const d of [bea, caro]) {
    for (const device of ["phone", "tv"]) {
      d.kind = device;
      const { raw, panel: shown } = await panel(d, t + 100);
      const kids = raw.root.children;
      assert.ok(!kids.some((n) => n.type === "MaterialBanner"), "a screen, not a banner");
      const text = kids.find((n) => n.type === "Text");
      assert.equal(text.style, "p");
      assert.ok(Array.from(text.text).length <= 120);
      const main = kids.find((n) => n.key === "btnRecover");
      assert.equal(main.type, "ElevatedButton");
      if (main.onPressed && main.onPressed.ui) assert.ok(kids[kids.indexOf(main) + 1].key.startsWith("busy."), "a waiting press has its progress right under it");
      assert.ok(kids.some((n) => n.key === "btnLeave"));
      assert.ok(!/"style":"h[1-4]"/.test(JSON.stringify(raw)));
      assert.ok(!texts(shown.root).some((x) => /^Sala de /.test(x)));
    }
  }
});

test("the chat looks like a chat: mine on the right in primary, the others on the left with the name once per run, notes centred", async () => {
  let { host, guests: [bea, caro], t } = await room(["Bea", "Caro"]);
  await say(bea, "hola", t);
  await say(bea, "¿empezamos?", t + 1);
  t = await rounds([host, bea, caro], t + 10, 2);
  await say(host, "sí", t);
  t = await rounds([host, bea, caro], t + 10, 2);
  await press(caro, "emoji", t, { arg: "0" });
  t = await rounds([host, bea, caro], t + 10, 2);
  for (const device of ["phone", "tv"]) {
    bea.kind = device;
    const { raw } = await panel(bea, t);
    const items = rawChat(raw).items.filter((n) => n.type === "Column");
    assert.equal(items.length, 3, "three runs: Bea twice, Ana, Caro");
    const [mine, ana, caroRun] = items;
    // Mine: right-aligned, an 80 dp gutter on the left, no name, primary bubbles.
    assert.deepEqual([mine.crossAxisAlignment, mine.fill, mine.padding, mine.margin], ["end", true, { start: 48 }, { start: 32 }]);
    assert.deepEqual(mine.children.map((n) => [n.type, n.color, n.borderRadius, n.children[0].text]), [["Card", "primary", "large", "hola"], ["Card", "primary", "large", "¿empezamos?"]]);
    // The others: left-aligned, the gutter on the right, the name once above the run, neutral bubbles.
    assert.deepEqual([ana.crossAxisAlignment, ana.padding, ana.margin], ["start", { end: 48 }, { end: 32 }]);
    assert.deepEqual(ana.children.map((n) => n.type === "Card" ? ["Card", n.variant, n.children[0].text] : [n.type, n.style, n.color, n.text]), [["Text", "caption", "muted", "Ana"], ["Card", "filled", "sí"]]);
    // A reaction: a larger glyph, no bubble.
    assert.deepEqual(caroRun.children.map((n) => [n.type, n.style || "", n.text]), [["Text", "caption", "Caro"], ["Text", device === "tv" ? "h3" : "h2", party(caro).hist.at(-1).x]]);
    assert.deepEqual(checkPanelScreen(raw, "es").dropped.filter((l) => l !== COPY_DROP), []);
  }
  // A note (on the host: someone left) is a small centred muted line at the end of the list.
  await press(caro, "leave", t);
  t = await rounds([host, bea], t + 100, 2);
  const note = rawChat((await panel(host, t)).raw).items.at(-1);
  assert.deepEqual([note.type, note.style, note.color, note.crossAxisAlignment, note.fill], ["Text", "caption", "muted", "center", true]);
});

test("the chat's tree stays small: 40 messages alternating between two people take at most 150 nodes", async () => {
  let { host, guests: [bea], t } = await room(["Bea"]);
  for (let i = 0; i < 20; i++) {
    await say(bea, "b" + i, t);
    t = await rounds([host, bea], t + 1, 1, 100);
    await say(host, "a" + i, t);
    t = await rounds([host, bea], t + 1, 1, 100);
    t += 2000;
  }
  t = await rounds([host, bea], t, 2);
  const { raw } = await panel(bea, t);
  const list = rawChat(raw);
  const nodes = all({ children: list.items }).length - 1;
  assert.equal(bubblesOf(list).length, 40);
  assert.ok(nodes <= 150, `${nodes} nodes`);
});

test("focus on a TV: joining or creating opens the chat with the D-pad on its input; send and reactions bring it back; ticks keep the input's key", async () => {
  const inputOf = (raw) => all(raw.root).find((n) => n.key === "chatText");
  const net = createNet();
  const ana = await device(net, "ana");
  ana.kind = "tv";
  const created = await press(ana, "create", T0, { values: { myName: "Ana" } });
  assert.deepEqual([created.state.tab, created.focus], ["chat", "chatText"]);
  ana.state = { ...(ana.state || {}), ...created.state };
  let t = T0 + 100;
  const bea = await device(net, "bea");
  bea.kind = "tv";
  const short = party(ana).short;
  const joined = await press(bea, "joinShort", t, { value: { joinShortCode: short }, values: { myName: "Bea" } });
  assert.deepEqual([joined.state.tab, joined.focus], ["chat", "chatText"]);
  bea.state = { ...(bea.state || {}), ...joined.state };
  t = await rounds([ana, bea], t + 100, 2);
  // The tab the answer leads to has that field, in the input row at the bottom.
  const first = (await panel(bea, t)).raw;
  assert.equal(inputOf(first).type, "TextField");
  const order = (raw) => raw.root.children.map((n) => n.key).filter((k) => ["chat", "emojiPalette", "inputRow"].includes(k));
  // Messages arriving on ticks: the same key, in the same place.
  for (let i = 0; i < 3; i++) {
    await say(ana, "mensaje " + i, t);
    t = await rounds([ana, bea], t + 10, 2);
    const raw = (await panel(bea, t)).raw;
    assert.equal(raw.focus, undefined, "a tick never moves the focus (Kino keeps it by key)");
    assert.deepEqual(order(raw), ["chat", "emojiPalette", "inputRow"]);
    assert.equal(all(raw.root).find((n) => n.key === "inputRow").children[0].key, "chatText");
  }
  // Sending (the keyboard's action or the arrow) and a reaction from the palette answer with the focus on the input.
  assert.equal((await say(bea, "hola", t + 20)).focus, "chatText");
  assert.equal((await press(bea, "emoji", t + 30, { arg: "1" })).focus, "chatText");
});

test("focus on recovery: every recovery state opens on its one way on, «btnRecover», first in D-pad order (errors add no second button)", async () => {
  const p = await P();
  const kinds = ["newHost", "lost", "redirect", "dropped", "noAnswer", "cantCheck", "waitOthers", "takeOver", "moved", "closedMine", "ended", "linked", "awaiting"];
  for (const kind of kinds) {
    for (const error of [null, { es: "El anfitrión no responde", en: "The host is not answering", retry: "retryHost" }]) {
      const s = p.newParty("Bea");
      Object.assign(s, { phase: "party", role: "guest", code: "123456789012", hostWords: "ana-door-a", handle: "j1", hostName: "Ana" });
      if (kind === "awaiting") s.awaiting = { name: "Caro" };
      else s.banner = { kind, name: "Caro", count: 2, at: T0 };
      const ctx = fakePanelScreenContext(foreignContext(fakeContext("movie:1", { device: "tv" }), "watch-party", LATINO), { state: { inputs: {}, ui: {}, ...(error ? { error } : {}) } });
      const raw = plain(p.view(s, ctx, T0));
      const keys = p.focusables(raw.root);
      assert.equal(keys[0], "btnRecover", `${kind}: ${keys}`);
      assert.equal(all(raw.root).filter((n) => n.type === "ElevatedButton").length, 1, `${kind}: one primary button`);
      assert.ok(!keys.includes("btnRetry") && !keys.includes("chatText"), kind);
      assert.ok(keys.length <= 2, `${kind}: the way on and at most «Salir de la sala»`);
    }
  }
});

test("focus on recovery: from the chat input to «btnRecover» (a tick keeps the key in place; a failed press names it)", async () => {
  let { net, host, guests: [bea], t } = await room(["Bea"]);
  bea.kind = "tv";
  const before = (await panel(bea, t)).raw;
  assert.equal(focusFirstField(before), "chatText");
  net.down.add(party(host).hostWords);
  t = await rounds([bea], t, 5);
  const after = (await panel(bea, t)).raw;
  const p = await P();
  assert.equal(p.focusables(after.root)[0], "btnRecover", "the screen that replaced the chat opens on its way on");
  assert.equal((await panel(bea, t + 10)).raw.root.children.findIndex((n) => n.key === "btnRecover"), after.root.children.findIndex((n) => n.key === "btnRecover"), "same key, same place on the next tick");
  const a = await press(bea, "retryHost", t + 20);
  assert.equal(a.focus, "btnRecover", "the press that fails again keeps the D-pad on it");
});

test("the emoji palette on phone and TV: hidden until the toggle, the toggle shows and hides it, a reaction sends, hides it and focuses the input", async () => {
  let { host, guests: [bea], t } = await room(["Bea"]);
  await say(host, "hola", t);
  t = await rounds([host, bea], t + 10, 2);
  for (const kind of ["phone", "tv"]) {
    bea.kind = kind;
    const { raw } = await panel(bea, t);
    const kids = raw.root.children;
    const palette = kids.find((n) => n.key === "emojiPalette");
    assert.equal(palette.hidden, true, `${kind}: hidden by default`);
    assert.deepEqual([palette.wrap, palette.children.length, palette.children.every((b) => b.span === 3)], [true, 8, true], "one compact block: two lines of four");
    assert.deepEqual(palette.children.map((b) => b.key), Array.from({ length: 8 }, (_, i) => "emoji" + i), "stable keys");
    const toggle = all(raw.root).find((n) => n.key === "emojiToggle");
    assert.deepEqual(toggle.onPressed, { ui: [{ toggle: "emojiPalette" }] }, "no round trip: Kino shows it, and hides it on the next press");
    // The list keeps the room left (flex) and is the same with the palette shown: nothing pushed off.
    const list = kids.find((n) => n.key === "chat");
    assert.equal(list.flex, 1);
    const shown = plain({ ...raw, root: { ...raw.root, children: kids.map((n) => n.key === "emojiPalette" ? { ...n, hidden: false } : n) } });
    assert.equal(JSON.stringify(shown.root.children.find((n) => n.key === "chat")), JSON.stringify(list), "the list's nodes do not change");
    assert.deepEqual(palette.children[2].onTap, { ui: [{ hide: "emojiPalette" }], event: "emoji", arg: "2" });
    const a = await press(bea, "emoji", t + 1, { arg: "2" });
    assert.equal(a.focus, "chatText", `${kind}: back on the input`);
    t = await rounds([host, bea], t + 20, 2);
    const after = (await panel(bea, t)).raw;
    assert.equal(after.root.children.find((n) => n.key === "emojiPalette").hidden, true, "still hidden after a reaction");
    assert.equal(bubblesOf(rawChat(after)).at(-1).text, (await P()).EMOJIS[2], "the reaction is in the list");
  }
});

test("the host steps out of Kino (its tab closed, its door still answering): a soft notice for up to 2 minutes, no retry, no failover; back at once on its return", async () => {
  let { host, guests: [bea, caro], t } = await room(["Bea", "Caro"]);
  const epoch = party(bea).epoch;
  // The host's Kino goes to the background: its tab runs no more (no panel calls), its door keeps answering.
  t = await rounds([bea, caro], t, 20); // 60 s
  for (const d of [bea, caro]) {
    const p = party(d);
    assert.equal(p.banner && p.banner.kind, "hostAway", d.id);
    assert.equal(p.hostFailed, false, "no failover");
    assert.equal(p.epoch, epoch, "no change of host");
    const { raw } = await panel(d, t);
    assert.ok(!(await P()).recoveryScreen(p), "the chat stays: not a recovery screen");
    assert.ok(all(raw.root).some((n) => n.type === "MaterialBanner" && n.text === "El anfitrión salió un momento; la sala sigue abierta." && !n.action), "a soft notice, no retry");
    assert.ok(all(raw.root).some((n) => n.key === "chatText"));
  }
  // Nothing in the room says the host left: its tab closing sends no goodbye (a «bye» would have set hostFailed above), and
  // the plugin sends one only from «Salir de la sala» (and a TV moving to another phone's room).
  assert.equal(PLUGIN_SOURCE.match(/enqueue\([^;]*\{ t: "bye" \}\)/g).length, 2);
  // The host's tab comes back (Kino reopens the panel): the same room, and a snapshot at once; the guests recover.
  const seq = party(bea).snap.seq;
  await panel(host, t);
  assert.equal(party(host).phase, "party");
  t = await rounds([bea, caro], t + 100, 1);
  for (const d of [bea, caro]) {
    assert.equal(party(d).banner, null, `${d.id}: the notice cleared`);
    assert.ok(party(d).snap.seq > seq, `${d.id}: a fresh snapshot`);
  }
});

test("the host silent for more than 2 minutes with its door answering: the normal «no responde» path; a door that does not answer: at once", async () => {
  const { guests: [bea], t } = await room(["Bea"]);
  await rounds([bea], t, 45, 3000); // 135 s
  assert.equal(party(bea).banner.kind, "noAnswer");
  const r2 = await room(["Bea"]);
  r2.net.down.add(party(r2.host).hostWords);
  await rounds([r2.guests[0]], r2.t, 5);
  assert.equal(party(r2.guests[0]).banner.kind, "noAnswer", "the door itself is down: no soft notice");
});

// ---------- Task 11: a party on an En vivo channel ----------

const LA1 = { provider: "tdt", code: "la1", name: "La 1" };
const LA2 = { provider: "tdt", code: "la2", name: "La 2" };

test("the manifest's tab joins titles and live channels (kinds), and the kit runs it on a channel", async () => {
  const m = validateManifest(MANIFEST_TEXT);
  assert.equal(m.ok, true, m.message);
  assert.deepEqual(m.manifest.panel.kinds, ["title", "live"]);
});

test("live: the room carries the host's channel, read strictly from a peer; never a position to sync", async () => {
  const p = await P();
  const ctx = fakePanelScreenContext(liveContext(LA1, { device: "tv", lang: "es-CO" }, "TDT"));
  const media = plain(p.mediaOf(ctx));
  assert.deepEqual(media, { source: { pluginId: "tdt", name: "TDT" }, tmdb: null, imdb: null, kind: "live", season: null, episode: null, title: "La 1", year: null, channel: LA1 });
  assert.deepEqual(plain(p.readMedia(media)), media, "a peer's copy reads back the same (sameMedia holds)");
  // A forged channel is dropped, never tuned to: «Mis canales», a wire-form provider, a code with a colon.
  for (const bad of [{ ...LA1, provider: "own" }, { ...LA1, provider: "plugin:tdt" }, { ...LA1, code: "la:1" }, { provider: "tdt" }]) {
    assert.equal(p.readMedia({ ...media, channel: bad }).channel, undefined, JSON.stringify(bad));
    assert.equal(p.mediaOf({ ...ctx, channel: bad }), null);
  }
  // Same channel: chat only, said in the header; another channel (or a title): offer the room's channel; never `ok`.
  assert.deepEqual(plain(p.mediaMatch(ctx, media)), { ok: false, reason: "sameChannel" });
  const other = fakePanelScreenContext(liveContext(LA2, {}, "TDT"));
  assert.deepEqual(plain(p.mediaMatch(other, media)), { ok: false, reason: "otherChannel" });
  assert.deepEqual(plain(p.mediaMatch(ctxOf({ kind: "phone", pos: 0, posAt: T0, paused: false }, T0), media)), { ok: false, reason: "otherChannel" });
  assert.deepEqual(plain(p.liveChannelGoOf(media)), { liveChannel: { provider: "tdt", code: "la1" } });
  assert.equal(p.liveChannelGoOf({ ...media, channel: undefined }), null);
  assert.equal(p.titleByIdsOf(media), null);
  // No sync on live: whatever the host's state says, a guest gets no player action.
  assert.equal(p.syncAction({ local: { pos: 0, paused: false, speed: 1 }, st: { pos: 99999, paused: true, speed: 1, at: T0 }, stAt: T0, now: T0, match: p.mediaMatch(other, media) }), null);
});

test("live: the invitation names the channel and asks for a live channel, still 6 lines", async () => {
  const p = await P();
  const media = plain(p.mediaOf(fakePanelScreenContext(liveContext(LA1, {}, "TDT"))));
  const text = p.invitationText({ short: "41408", words: "a-b-c-d", code: "1234", media });
  assert.equal(text.split("\n").length, 5);
  assert.ok(text.includes("En vivo: La 1, con «TDT»"), text);
  assert.ok(text.includes("En Kino: pon un canal en vivo ▸ panel ▸ Fiesta"), text);
  assert.ok(Array.from(text).length < 500);
});

test("live: the guest is offered the host's channel (one tap), and after the host zaps gets the new one as a suggestion", async () => {
  let { host, guests: [bea], t } = await room(["Bea"]);
  host.live = LA1;
  bea.live = LA2;
  t = await rounds([host, bea], t + 1000, 4);
  assert.equal(party(bea).media.channel.code, "la1");
  let r = await panel(bea, t);
  assert.equal(r.raw.player, undefined, "nothing to keep in step on live");
  let banner = ofType(r.panel.root, "banner").find((b) => /canal «La 1»/.test(b.text));
  assert.ok(banner, texts(r.panel.root).join(" | "));
  assert.deepEqual(plain(banner.action.onTap.go), { liveChannel: { provider: "tdt", code: "la1" } });
  // On the same channel: no banner, the header says so.
  bea.live = LA1;
  r = await panel(bea, t + 3000);
  assert.equal(ofType(r.panel.root, "banner").filter((b) => /canal «/.test(b.text)).length, 0);
  assert.ok(texts(r.panel.root).some((x) => x.includes("✓ Mismo canal")));
  // The host zaps: Kino asks its tab again with the new channel; the guest is offered it, never moved.
  host.live = LA2;
  t = await rounds([host, bea], t + 6000, 4);
  assert.equal(party(bea).media.channel.code, "la2");
  r = await panel(bea, t);
  assert.equal(r.raw.player, undefined);
  banner = ofType(r.panel.root, "banner").find((b) => /canal «La 2»/.test(b.text));
  assert.deepEqual(plain(banner.action.onTap.go), { liveChannel: { provider: "tdt", code: "la2" } });
  // The chat still works on live.
  await say(bea, "¿viste ese gol?", t + 500);
  t = await rounds([host, bea], t + 1000, 3);
  assert.ok(hist(host).some((e) => e.x === "¿viste ese gol?"));
});

test("regression (field report): a reaction pressed in the palette reaches the plugin with its index, is sent, and shows on both sides; the glyphs are large", async () => {
  let { host, guests: [bea], t } = await room(["Bea"]);
  const p = await P();
  for (const [who, other, i] of [[bea, host, 3], [host, bea, 5]]) {
    for (const kind of ["phone", "tv"]) {
      who.kind = kind;
      // What Kino draws: the toggle shows the palette (a ui op); each reaction a card with a large glyph, 48 dp at least.
      const { raw, panel: shown } = await panel(who, t);
      const card = all(raw.root).find((n) => n.key === "emoji" + i);
      assert.deepEqual([card.type, card.minHeight, card.children[0].style, card.children[0].text], ["Card", 48, kind === "tv" ? "h4" : "h3", p.EMOJIS[i]]);
      // As Kino reads the press: the event and its arg come from the action object (a node's own `arg` is not used there).
      const tap = all(shown.root).find((n) => n.key === "emoji" + i).onTap;
      assert.deepEqual(plain(tap.event), { name: "emoji", arg: String(i) });
      assert.deepEqual(plain(tap.ui), [{ hide: "emojiPalette" }]);
      const a = await press(who, tap.event.name, t, { arg: tap.event.arg });
      assert.equal(a.focus, "chatText");
      t = await rounds([host, bea], t + 100, 2);
      for (const d of [who, other]) {
        const last = hist(d).at(-1);
        assert.deepEqual([last.k, last.x], ["emoji", p.EMOJIS[i]], `${who.id} on ${kind}: ${d.id} has the reaction`);
        const glyph = bubblesOf(rawChat((await panel(d, t)).raw)).at(-1);
        assert.deepEqual(glyph, { mine: d === who, text: p.EMOJIS[i] }, `${d.id} shows it, on the ${d === who ? "right" : "left"}`);
      }
      t += 3000;
    }
  }
});

test("the chat fills the panel: layout fill on the Chat tab only, the list takes the room left and sticks to the newest message, the input row last", async () => {
  let { host, guests: [bea], t } = await room(["Bea"]);
  await say(bea, "hola", t);
  t = await rounds([host, bea], t + 10, 2);
  for (const kind of ["phone", "tv"]) {
    for (const d of [host, bea]) {
      d.kind = kind;
      d.tab = undefined;
      const { raw, panel: shown } = await panel(d, t);
      assert.equal(raw.layout, "fill", `${d.id} ${kind}: the chat answers layout fill`);
      assert.equal(shown.layout, "fill", "Kino reads it");
      const kids = raw.root.children;
      const list = kids.find((n) => n.key === "chat");
      assert.deepEqual([list.flex, list.stickToBottom], [1, true]);
      assert.equal(all(shown.root).find((n) => n.key === "chat").stickToBottom, true);
      const flexed = kids.filter((n) => n.flex);
      assert.deepEqual(flexed.map((n) => n.key), ["chat"], "only the list takes the room left");
      assert.equal(kids.at(-1).key, "inputRow", "the input row is the last child: at the bottom of the panel");
      d.tab = "room";
      const room2 = (await panel(d, t)).raw;
      assert.equal(room2.layout, undefined, "the Sala tab scrolls as usual");
      d.tab = undefined;
    }
  }
});

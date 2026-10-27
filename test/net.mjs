// A small fake Internet for several devices running the Watch Party at once (the kit's own room shim models ONE device with
// two simulated members). Each device gets a `kino` with its own storage, a `room` with the app's rules as far as a plugin
// sees them (contract.kinoRoom: open/join only from a press, at most two of the device's three slots for one plugin, a join with
// the code of a joined session replaces it, the host relays, a guest writes to the host or to "all", payloads checked like the
// app's, the per-member rates of 5 a second, 100 and 256 KB a minute), the host's 2-minute idle drop (a dropped member's
// requests then answer `room_closed`, as the app's guest does after a 403), and a fake `qr.scan` that answers what the test
// queued. `net.now` is the test's clock; `net.down` makes an endpoint unreachable to its guests; `dev.offline` takes a whole
// device off the Internet; `net.drop` drops chosen messages on their way to a guest. `memStorage` refuses past 256 KB.
import { contract } from "../sdk/contract.mjs";
import { roomCode, roomName, roomPayloadVerdict } from "../sdk/kino-shim.mjs";

const RL = contract.kinoRoom.limits;
/** A typed code as Kino reads it (the kit's own rule since Task 8w: spaces and hyphens dropped, codeDigits.min..max digits). */
const typedCode = roomCode;
const R = contract.kinoRoom;

function kinoErr(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function mailbox() {
  const events = [];
  let next = 1;
  return {
    add(from, kind, payload, name) {
      const e = { seq: next++, from, kind };
      if (payload !== undefined) e.payload = JSON.parse(JSON.stringify(payload));
      if (name !== undefined) e.name = name;
      events.push(e);
      while (events.length > RL.mailboxEvents) events.shift();
    },
    after(since, limit) {
      const out = events.filter((e) => e.seq > since);
      return { events: out.slice(0, limit).map((e) => JSON.parse(JSON.stringify(e))), more: out.length > limit };
    },
  };
}

export function createNet() {
  return { endpoints: new Map(), down: new Set(), drop: null, n: 0, m: 0, sent: [], now: 0, devices: new Map() };
}

/** One sender's budget (RoomRateWindow): perSecond, perMinute and bytesPerMinute. */
function rateWindow(net) {
  const sent = [];
  return (bytes) => {
    const t = net.now;
    while (sent.length && t - sent[0].at >= 60000) sent.shift();
    if (sent.filter((s) => t - s.at < 1000).length >= RL.perSecond) return false;
    if (sent.length >= RL.perMinute) return false;
    if (sent.reduce((n, s) => n + s.bytes, 0) + bytes > RL.bytesPerMinute) return false;
    sent.push({ at: t, bytes });
    return true;
  };
}

/** Whether [words] can be reached from the Internet now (its holder online, not taken down by the test). */
const reachable = (net, ep) => ep && !ep.closed && !net.down.has(ep.words) && !(net.devices.get(ep.holder) || {}).offline;

/** The host drops members it has not heard from for idleMs (a `leave` in its mailbox); their next request is room_closed. */
function sweep(net, ep) {
  for (const [mid, m] of ep.members) {
    if (net.now - m.heard > RL.idleMs) {
      ep.members.delete(mid);
      ep.dropped.add(mid);
      ep.hostBox.add(mid, "leave");
    }
  }
}

/** One device's room API on [net]. `dev.fn` is the export being run (the test sets it), for the app's call gates. */
export function deviceRoom(net, dev) {
  net.devices.set(dev.id, dev);
  dev.hosted = null; // words
  dev.joined = []; // { handle, words, code, mid }
  dev.created = new Set();
  const gate = (op) => {
    if ((op === "open" || op === "join") && !R.openFrom.includes(dev.fn)) throw kinoErr("permission_denied", `kino.room.${op} only runs from the person's own action`);
    if (["send", "inbox", "members"].includes(op) && !R.trafficFrom.includes(dev.fn)) throw kinoErr("permission_denied", `kino.room.${op} only from an open panel`);
  };
  const select = (o = {}) => {
    const s = o.session;
    if (s === undefined || s === null) {
      if (dev.joined[0]) return { joined: dev.joined[0] };
      if (dev.hosted) return { hosted: net.endpoints.get(dev.hosted) };
    } else if (s === "hosted" && dev.hosted) return { hosted: net.endpoints.get(dev.hosted) };
    else {
      const j = dev.joined.find((x) => x.handle === s);
      if (j) return { joined: j };
    }
    throw kinoErr("room_closed", "kino.room: not in that room");
  };
  const slots = () => dev.joined.length + (dev.hosted ? 1 : 0);
  const leaveEndpoint = (j) => {
    const ep = net.endpoints.get(j.words);
    if (ep && ep.members.has(j.mid)) {
      ep.members.delete(j.mid);
      ep.hostBox.add(j.mid, "leave");
    }
  };
  return {
    async open(o = {}) {
      gate("open");
      if (dev.hosted) throw kinoErr("room_busy", "this device already hosts a room");
      if (slots() >= RL.maxSlotsPerPlugin) throw kinoErr("room_busy", "this plugin holds two rooms already");
      let code = null;
      if (o.code !== undefined) {
        code = typedCode(o.code);
        if (!code) throw kinoErr("bad_request", "code");
        if (!dev.joined.some((j) => j.code === code) && !dev.created.has(code)) throw kinoErr("permission_denied", "not a member of that room");
      }
      // Task 8w: `codeDigits` (contract.kinoRoom.codeDigits: min..max, default) for a NEW room's code.
      const D = R.codeDigits;
      const digits = o.codeDigits === undefined ? D.default : o.codeDigits;
      if (!Number.isInteger(digits) || digits < D.min || digits > D.max) throw kinoErr("bad_request", `codeDigits must be ${D.min}..${D.max}`);
      code = code || Array.from({ length: digits }, () => Math.floor(Math.random() * 10)).join("");
      // Letters only, as real tunnel names are (four English words): the device's name, "door", and the count in letters.
      const n = ++net.n;
      const letters = (k) => (k < 26 ? "" : letters(Math.floor(k / 26) - 1)) + String.fromCharCode(97 + (k % 26));
      const words = `${dev.id.replace(/[^a-z]/g, "x")}-door-${letters(n - 1)}`;
      if (dev.offline) throw kinoErr("room_unreachable", "no Internet");
      const ep = { words, code, holder: dev.id, max: o.max || RL.defaultMembers, name: roomName(o.name, RL.maxHostNameChars), hostBox: mailbox(), members: new Map(), dropped: new Set(), closed: false, rate: rateWindow(net) };
      net.endpoints.set(words, ep);
      dev.hosted = words;
      dev.created.add(code);
      return { code, words, expiresAtMs: Date.UTC(2030, 0, 1) };
    },
    async join(o = {}) {
      gate("join");
      const words = typeof o.words === "string" ? o.words.trim().toLowerCase() : "";
      const code = typedCode(o.code);
      if (!words || !code) throw kinoErr("bad_request", "words and code");
      const same = dev.joined.find((j) => j.code === code);
      if (!same && dev.joined.length >= RL.maxJoined) throw kinoErr("room_busy", "two joined already");
      if (!same && slots() >= RL.maxSlotsPerPlugin) throw kinoErr("room_busy", "this plugin holds two rooms already");
      const ep = net.endpoints.get(words);
      if (dev.offline || !reachable(net, ep)) throw kinoErr("room_unreachable", "the room can't be reached");
      sweep(net, ep);
      if (ep.holder === dev.id) throw kinoErr("bad_request", "that is this device's own room");
      if (ep.code !== code) {
        // Task 8w: a room closes itself after limits.maxFailedJoins wrong codes (the kit models it only for its remote room).
        ep.wrong = (ep.wrong || 0) + 1;
        if (ep.wrong >= RL.maxFailedJoins) { ep.closed = true; for (const m of ep.members.values()) m.box.add("host", "closed"); }
        throw kinoErr("room_denied", "wrong code");
      }
      if (ep.members.size + 1 >= ep.max) throw kinoErr("room_full", "full");
      if (same) { leaveEndpoint(same); dev.joined.splice(dev.joined.indexOf(same), 1); }
      const mid = "m" + String(++net.m).padStart(7, "0");
      const handle = "j" + dev.id + net.m;
      const name = roomName(o.name, RL.maxMemberNameChars);
      ep.members.set(mid, { name, device: dev.id, box: mailbox(), heard: net.now, rate: rateWindow(net) });
      ep.hostBox.add(mid, "join", undefined, name);
      dev.joined.push({ handle, words, code, mid });
      return { handle, memberId: mid, host: { name: ep.name }, expiresAtMs: Date.UTC(2030, 0, 1) };
    },
    async send(payload, o = {}) {
      gate("send");
      const v = roomPayloadVerdict(JSON.stringify(payload));
      if (!v.ok) throw kinoErr("bad_request", v.why);
      const s = select(o);
      if (s.hosted) {
        const ep = s.hosted;
        if (!ep || ep.closed) throw kinoErr("room_closed", "closed");
        const targets = o.to === undefined || o.to === "all" ? [...ep.members.entries()] : [...ep.members.entries()].filter(([mid]) => mid === o.to);
        if (o.to !== undefined && o.to !== "all" && !targets.length) throw kinoErr("bad_request", "no such member");
        if (!ep.rate(Buffer.byteLength(JSON.stringify(payload)))) throw kinoErr("rate_limited", "too many messages");
        for (const [mid, m] of targets) {
          net.sent.push({ from: dev.id, to: m.device, payload: v.value });
          if (net.drop && net.drop({ from: dev.id, to: m.device, mid, payload: v.value })) continue;
          m.box.add("host", "msg", v.value);
        }
        return undefined;
      }
      const j = s.joined;
      const ep = net.endpoints.get(j.words);
      if (!ep || ep.closed) throw kinoErr("room_closed", "closed");
      if (dev.offline || !reachable(net, ep)) throw kinoErr("room_unreachable", "unreachable");
      sweep(net, ep);
      if (!ep.members.has(j.mid)) throw kinoErr("room_closed", "not a member");
      const me = ep.members.get(j.mid);
      me.heard = net.now;
      if (!me.rate(Buffer.byteLength(JSON.stringify(payload)))) throw kinoErr("rate_limited", "too many messages");
      if (o.to !== undefined && o.to !== "host" && o.to !== "all") throw kinoErr("bad_request", "a guest writes to the host or all");
      net.sent.push({ from: dev.id, to: ep.holder, payload: v.value });
      ep.hostBox.add(j.mid, "msg", v.value);
      if (o.to === "all") for (const [mid, m] of ep.members) if (mid !== j.mid) m.box.add(j.mid, "msg", v.value);
      return undefined;
    },
    async inbox(o = {}) {
      gate("inbox");
      const s = select(o);
      const since = Number.isFinite(o.since) ? o.since : 0;
      const limit = o.limit || RL.defaultInboxLimit;
      if (s.hosted) {
        if (s.hosted.closed) throw kinoErr("room_closed", "closed");
        sweep(net, s.hosted);
        const { events, more } = s.hosted.hostBox.after(since, limit);
        return { events, last: events.length ? events[events.length - 1].seq : since, more, reachable: true };
      }
      const ep = net.endpoints.get(s.joined.words);
      if (dev.offline || !ep || !reachable(net, ep)) {
        if (ep && ep.closed) { const box = ep.members.get(s.joined.mid); if (box) { const { events, more } = box.box.after(since, limit); return { events, last: events.length ? events[events.length - 1].seq : since, more, reachable: true }; } }
        return { events: [], last: since, more: false, reachable: false };
      }
      sweep(net, ep);
      const me = ep.members.get(s.joined.mid);
      // Dropped by the host (idle): the app's guest reads the 403 as "this session is over".
      if (!me) throw kinoErr("room_closed", "this session is over");
      me.heard = net.now;
      const { events, more } = me.box.after(since, limit);
      return { events, last: events.length ? events[events.length - 1].seq : since, more, reachable: true };
    },
    async members(o = {}) {
      gate("members");
      const s = select(o);
      const ep = s.hosted || net.endpoints.get(s.joined.words);
      return [{ memberId: "host", name: ep.name, host: true }, ...[...ep.members.entries()].map(([mid, m]) => ({ memberId: mid, name: m.name, host: false }))];
    },
    async close(o = {}) {
      let s;
      try { s = select(o); } catch { return undefined; }
      if (s.hosted) {
        s.hosted.closed = true;
        for (const m of s.hosted.members.values()) m.box.add("host", "closed");
        dev.hosted = null;
      } else {
        leaveEndpoint(s.joined);
        dev.joined.splice(dev.joined.indexOf(s.joined), 1);
      }
      return undefined;
    },
    async state() {
      return {
        role: dev.hosted ? "host" : dev.joined.length ? "guest" : "none",
        joined: dev.joined.map((j) => ({ handle: j.handle, memberId: j.mid, host: { name: "" }, expiresAtMs: 0, reachable: !net.down.has(j.words) })),
        hosted: dev.hosted ? { code: net.endpoints.get(dev.hosted).code, words: dev.hosted, expiresAtMs: 0, members: net.endpoints.get(dev.hosted).members.size + 1 } : null,
      };
    },
  };
}

/** A string store like kino.storage: 256 KB for the whole plugin (keys and values, UTF-8), else `too_large` (ttl ignored). */
export function memStorage(cap = contract.storage.maxTotalBytes) {
  const m = new Map();
  const size = (map) => [...map].reduce((n, [k, v]) => n + Buffer.byteLength(k) + Buffer.byteLength(v), 0);
  return {
    get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => {
      if (typeof v !== "string") throw new Error("storage values are strings");
      const next = new Map(m);
      next.set(k, v);
      if (size(next) > cap) throw kinoErr("too_large", "kino.storage is full");
      m.set(k, v);
    },
    remove: (k) => m.delete(k),
    keys: () => [...m.keys()],
    map: m,
  };
}

/** A device's whole `kino` for the plugin: its room on [net], its storage, a QR scanner answering [dev.scans] in order. */
export function deviceKino(net, dev) {
  dev.scans = dev.scans || [];
  const room = deviceRoom(net, dev);
  const qr = {
    async scan() {
      if (!R.openFrom.includes(dev.fn)) throw kinoErr("not_allowed", "kino.qr.scan only from a press");
      if (dev.kind === "tv") throw kinoErr("unavailable", "no camera");
      return dev.scans.length ? dev.scans.shift() : null;
    },
  };
  return { apiVersion: 14, room, storage: memStorage(), qr, log: { info() {}, warn() {}, error() {} } };
}

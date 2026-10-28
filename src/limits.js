// The plugin's own limits (Kino's room limits are stricter where they overlap), the eight reactions and the speeds.

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
  awayMaxMs: 120000, // the host silent while its door answers (Kino in the background): a soft notice this long, then noAnswer
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

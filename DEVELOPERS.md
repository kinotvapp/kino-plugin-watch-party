# Party Chat: for developers

How the plugin works inside, how to test it and how a new version is made. The person-facing documentation is
[README.md](README.md) ([español](README.es.md)).

## Where the code comes from

`plugin.js` and `test/` are kept in sync with the `watch-party` example of Kino's plugin guide, where the player panel
tabs, `kino.room` and `playerControl` this plugin uses are developed. Kino's repository is the source of truth for the
code; this repository owns the publishing metadata (`id`, `name`, `version`, `description`, `author`, `homepage`, `icon`,
`color`, `categories`, `signature`) and the documents. To bring a newer example in:

```sh
node scripts/sync-from-example.mjs <kino>/docs/plugins/examples/watch-party --dry-run   # what would change
node scripts/sync-from-example.mjs <kino>/docs/plugins/examples/watch-party
```

It copies `plugin.js` (only its first comment line changes), mirrors `test/` with the kit imports pointed at `sdk/`,
takes the manifest's working fields (`apiVersion`, `entry`, `hosts`, `capabilities`, `panel`...) and never the ones
listed above, refreshes the Node kit (`sdk/`, `contract.json`, `kino.d.ts`) from the same Kino checkout (`--no-kit` to
skip), and rewrites the section below. When the code or a working field changed it drops the stale `signature` and tells
you what comes next.

## Testing and signing

```sh
npm test            # node --test test/*.test.mjs: the kit's sandbox, its room, a fake network of devices, a fake clock; no network
npm run validate    # node sdk/validate.mjs . --repo kinotvapp/kino-plugin-watch-party
npm run sign        # signs plugin.js with the author key (~/.config/kino/kino-author-key.pem, or $KINO_AUTHOR_KEY)
```

Try it by hand with the kit, as a tab contributed to another plugin's title:

```sh
node sdk/run.mjs --foreign latino:Latino . panel movie:438631
KINO_ROOM_REVOKED=1 node sdk/run.mjs --foreign latino:Latino . panel movie:438631            # the room switched off
KINO_PLAYER_CONTROL_REVOKED=1 node sdk/run.mjs --foreign latino:Latino . panel movie:438631  # no player control
```

A new version: sync (or change the code), raise `version` in `kino-plugin.json`, add a `CHANGELOG.md` entry, `npm test`,
`npm run sign`, `npm run validate`, commit and push. Every change to `plugin.js` or to `version` needs a new signature,
always with the same key: Kino refuses an update signed by another one.

## How it works

<!-- sync:begin example-readme -->
_Synced by `scripts/sync-from-example.mjs` from `docs/plugins/examples/watch-party` in Kino's repository at `a97783476`. Do not edit by hand: change the example and sync again._

### What Kino asks the person (the red lines are Kino's)

At install Kino shows its own consent lines, in red, and the person can switch each one off later in the plugin's tab in
Ajustes. The plugin cannot word or hide them:

- `playerPanelTab`: the tab SEES what the person watches (title, year, ids, position) while it is open.
- `playerControl`: it may pause, resume and move the video by itself. Kino announces every such action ("Party Chat: pausado")
  and drops it under Kino's dialogs, while the person seeks, and beyond 30 a minute.
- `room`: it opens a room that people reach over the Internet through this device, through Kino's own tunnel. The plugin
  never sees a URL, only the words and the code.
- `qrScan`: Kino's own scanner opens only when the person presses a button; the plugin gets only the decoded text.
- The declared host `url-code.kinotv.workers.dev` (the short-code service): listed in Kino's sheet with the other hosts. The
  plugin reaches no other address (no `fetchHosts: "any"`), and never the room address the service returns.

### What the code protects, and what it does not

- **The 5-digit short code is the only secret.** The service stores the room's words and room code for 8 hours under it, so
  ANYONE who guesses or enumerates a valid code can join the room; rate limiting lives in the service, not in the plugin.
  The «30 wrong codes close the room» protection only covers the words + code path, not the short code.
- **The service sees things.** It is run by Kino's author and sees the IP addresses of the host and of the guests who look a
  code up, and the room's address (words and room code). Revoking on close shortens that, it does not erase it.
- **The chat is NOT private** from the tunnel provider nor from the service (which holds the room code). Keep it
  low-sensitivity.
- **If the service is down**, use the QR or «Opciones avanzadas» (words + room code) and «Entrar con palabras y código».
- **Everyone who has the code is trusted with the room.** Anyone in the room can chat, react, hold a backup door and, if
  elected, host: the host's playback then moves the followers' players (within Kino's playerControl limits).
- **The code travels in the `link` message.** «Agregar dispositivo» sends the room's words and code to the TV whose QR the
  phone scanned. Scan only your own TV's code: whoever showed that QR gets the room.
- **The codes are kept on the device** (the room code and the short code) in `kino.storage` while the room lives (the entry
  expires with the room, at most 4 h 5 min; that store is part of the person's backup). The plugin never logs them, never
  logs the service's address answer, and never puts them in the chat: a code typed into a message is masked as «••••» where
  it stands alone (so a year like 2021 is not eaten by a short code).
- **Identity is Kino's.** A member is the id Kino gave its session at the door it joined; no message names its sender, so
  nobody can speak as somebody else or take somebody's place. Ids are per door: after a change of host everyone joins the
  new door with a new id and takes a new place in the order, the new host first, the others in the order they come back
  (so whoever comes back first after a failover is next in line). A place is freed only by Kino's own `leave`.
- **The TV's reactions-only rule is a convention of the clients**, not a security boundary: every client (host and guests)
  drops text from a seat that says it is a TV, but a device with the code may simply join as a phone.
- **After a failover**, the new host asks the first member with more chat than it for the missing lines. That member could
  invent lines of that gap; the authors' names come from the old snapshot (it cannot rename anyone), and only the gap is
  affected.
- **Names** are scrubbed (control, direction and invisible characters, stacked marks, blank-looking names), the marks the tab
  draws (📱 📺 ·) are removed from them, equal names are numbered («Bea (2)»), and the host is a badge, never part of a name.
- The only host the plugin reaches is the short-code service; the room's own address is only read out of its answer.

### Nobody is indispensable: backup doors and «elect + one tap»

- Every 10 s the host broadcasts a **snapshot** (at most 8 KB: members with their Kino ids and joining order, the title, the
  state, the last 20 chat entries; the chat is trimmed first). Every member keeps the newest one.
- The two oldest guests open a **backup door**: the same code, their own words (`room.open({ code })`), and publish its
  words a few seconds later (a fresh name takes a moment to resolve). The host lists them in the snapshot. A door given up
  is withdrawn (`nobackup`).
- **The host leaves or its room closes** (its own goodbye, or Kino's `closed` event: both come from the host's door
  itself): every member runs the same **election** on the host's last snapshot: the seat with the lowest joining order that
  holds a door. Nobody votes. The successor takes over at once; everybody else sees «El anfitrión se fue: Bea es el nuevo
  anfitrión» with **one button** that joins Bea's door.
- **The host only stepped out of Kino:** Kino closes a tab when its app leaves the front, so the host's tab stops sending,
  but its door keeps answering (Kino keeps it serving for a while) and its tab never says goodbye (only «Salir de la sala»
  does). While the guest's mailbox says the door is reachable, the host's silence shows a soft notice, «El anfitrión salió
  un momento; la sala sigue abierta», with no button, no retry and no failover, for up to 2 minutes (the host's own
  2-minute member drop); after that, or at once when the door itself does not answer, the path below. When the host
  comes back, Kino reopens its tab on the same room and its next round sends a snapshot at once: the notice clears.
- **The host only stops answering:** nothing is concluded from silence, because a guest cannot tell its own outage from the
  host's. After 10 s the tab says «El anfitrión no responde. Puede ser tu conexión o la suya» with «Reintentar». That press
  first tries the host's door again, fresh: if it answers, nothing happened. Only if it fails are the doors tried in the
  election's order, in the same press:
  - a door before this device that answers: the guest waits there («Esperando a que Bea siga como anfitrión», with a
    «Reintentar» that says hello again). It takes nothing from that door but its holder's own snapshot as host: no redirect
    back to the host it could not reach, and an old snapshot never closes its own backup door;
  - when this device's own turn comes (it is the successor, or every door before it failed), it hosts only on proof that the
    failure is not its own connection: a member's hello at its door in the last two minutes (in whatever order the people
    pressed), or a door after it that answers;
  - a hello that reaches the successor's door after the successor's own failed try only ASKS its person («Caro tampoco llega
    al anfitrión. ¿Sigues tú como anfitrión?»); the press tries the host once more and then takes over. A hello alone never
    promotes, and a failed try counts for one minute only;
  - if nothing answers at all, the tab says «Sin conexión con la sala…»: nobody is named host and nobody is marked gone.
- **A guest who was away:** the host drops a member it has not heard from for 2 minutes (Kino's rule), so a guest whose
  drawer was closed for more than 2 minutes finds «Estuviste fuera un rato y la sala te sacó» with one button that joins the
  host's door again. Nobody is elected for it.
- **Why one tap and not automatic:** Kino lets `room.open` and `room.join` run only from the person's own press (never from
  a refresh or a player event), so a plugin cannot move a person to another door, or open a door, behind their back. The
  backup door is opened in the same press as «Entrar» (for the first two guests) or with «Abrir puerta de respaldo»; the TV
  joins with one press too.
- **A host the room left behind:** when a member with a door really left (its goodbye, or a leave shortly after the host
  last heard from it) and nobody is left, it offers «Buscar la sala» (members dropped for a closed drawer leave only a quiet
  button in the Sala tab). The press tries the doors of the members who left (the newest 3), in the election's order,
  keeping its own room open. What it accepts as proof: a snapshot from the first door that answers, sent by that door's own
  holder as host, at exactly this host's epoch + 1. Even then nothing closes by itself: the tab shows «La sala siguió con Bea
  (2 personas). Si te unes, tu sala se cierra» and only «Unirme» closes the room. This trusts the holder of that door: a code
  holder who is the predicted successor can claim the room went on with them (the trust model above); the person sees who.
  When Kino closed the host's own room and no door answers, the tab says the room ended (never that it is still open).
- The chat is replicated incrementally: every entry has a room-wide `cseq` (`epoch × 1,000,000 + n`, so a new host never
  reuses the old one's numbers). A member that notices a gap asks `need` for that range; the host answers what it still has,
  `have` when the range starts before its window, or `gone` when it has none of it; the member then stops asking for it (and
  gives a gap up after 3 unanswered tries, waiting longer each time). A newcomer gets the last 50 entries.
- The host's answers are budgeted: history is sent from the history itself when the turn comes (never stored as queued
  messages), at most 6 chunks per member a minute, one `sync` answer per member every 5 s, broadcasts first, and a send budget
  below the room's (4 a second, 90 and 200 KB a minute). What the plugin keeps in `kino.storage` stays under 120 KB (the
  store holds 256 KB); a refused write drops the queued messages and shrinks the kept chat instead of breaking the tab.

### Untrusted peers

Every message is checked: its kind, its exact fields (an extra field drops it), sizes and types. Rates are limited per
member (and the room's own limits apply). Only the door holder's messages count for a guest, only the host moves anyone's
player, a session's second hello adds nobody, the member list never grows past the room's 8, a pairing token is one per seat
and cannot be pushed out by another member. Epochs: a hello carries none; a guest takes a snapshot only from the holder of the
door it joined, moving the epoch by one at most; epochs above 1000 are refused outright (so the chat's numbering stays far
below its limit); a host's search believes only epoch + 1 from the predicted successor's own door, and only on its person's
press. What protects a claimed epoch is therefore Kino's id of the sender (the door's holder) and the person's press, not a
signature: a code holder at the right door can still lie.

### When it runs: keep the tab pinned

A contributed tab is called only while it is the selected tab of an open drawer. When the person closes the drawer or picks
another tab, everything stops: no chat polling, no snapshots, no following, and the host no longer sends its position (its
guests stop moving after 15 s and wait). After 2 minutes away a guest is dropped by the host and comes back with one press
(see above); a guest whose tab is open says so every 20 s, which is how the host tells a closed drawer from a real
departure. **Pin the panel** («Fijar»): docked next to the video (the right third on a TV or a phone held sideways, below
the video on a phone held upright) the tab keeps running while the video plays, and the layout is one narrow column made
for it. Pin it for the playback: Kino does not remember the pin, so a new playback starts with the panel closed and
unpinned. Kino also closes rooms after 5 minutes in the background.
<!-- sync:end example-readme -->

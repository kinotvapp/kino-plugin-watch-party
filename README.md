# Fiesta (Watch Party)

[Español](README.es.md) · [For developers](DEVELOPERS.md)

<img src="icon.png" width="96" alt="Watch Party icon" align="right">

A [Kino](https://github.com/kinotvapp/kino-light) plugin for **watching together**, each person on their own device: a
**Party** tab in the player with a chat, eight quick reactions and the video kept in step with the host's. The room lives
on the device of whoever creates it and is reached through Kino's own tunnel. There is no account and no sign-up. The only
outside service is a small short-code service run by the plugin's author (see [Privacy and security](#privacy-and-security)).

- **A 5-digit code to join**: the host gets a short code like **41 408**. Guests type those 5 digits, or scan the host's
  QR code.
- **A chat that looks like a chat**: your messages on the right, the others' on the left with their name. Plain text (up
  to 300 characters) and eight quick reactions (👍 😂 😮 😢 ❤️ 🔥 👏 🍿). No pictures, files, links or formatting: a link in
  a message is just text.
- **In sync**: the host leads. When the host pauses, resumes or jumps, everyone's video follows. A guest who pauses on
  their own stops following until **Sync again**.
- **Phone + TV**: watch on the TV and chat from your phone. The TV joins as a reactions-only seat linked to your phone.
- **Nobody is indispensable**: if the host leaves, the room carries on with the next person, through a backup door.
- Up to **8 devices** per room. A room lasts at most 4 hours.

## Screenshots

<!-- To capture before publishing, in screenshots/:
  1-home-phone.jpg       the Party tab before a room exists (Create room, Join a room)
  2-join-code-phone.jpg  the join step: Room code (5 digits) and Next
  3-room-phone.jpg       the Room tab of the host: «Room: 41 408» with the copy icon, members, QR
  4-chat-phone.jpg       the chat with bubbles, a reaction and the input with its send icon
  5-pinned-tv.jpg        the pinned panel next to the video on a TV
-->
_Coming soon._

## Install

It needs a Kino version that supports plugin `apiVersion` 14 (player panel tabs). An older Kino says "This plugin needs
a newer version of Kino".

1. On the phone, open **Menu ▸ Plugins** and tap **+** (Add plugin). On the TV, open **Plugins** and choose **Add
   plugin**.
2. Leave the type on **Kino**. In **Plugin address**, type `kinotvapp/kino-plugin-watch-party` and tap **Add**.
3. Kino shows **Install Fiesta**. Tap **See details**, read the lines (they are explained below), then **Install**.
4. Play any title of any plugin and open the player's panel: the **Party** tab is there.

Everyone in the party needs the plugin installed. It is **signed by its author** ("Signed by its author" on the install
sheet): Kino checks that every update is signed with the same key.

## Before you start: same plugin, same title

Everyone must play **the same title through the same content plugin** (the same movie, or the same episode). The same
plugin means the same cut and the same file, so positions match. When they do not:

- another title: the tab offers **Open this title**, Kino's own page for it, where you pick your source;
- another plugin: the tab names the plugin the room uses; you need that plugin installed;
- a title whose plugin gives no TMDB or IMDb id, a live channel or a video that is not from a plugin: chat only, no sync.

## Host a party

1. Play the title, open the panel and the **Party** tab, and tap **Create room**. The first time, it asks **What's your
   name?** (what the others see) and remembers it.
2. Opening a room takes a few seconds. The room opens on the chat, and the **Room** tab starts with one line:
   **Room: 41 408**.
3. Invite: say the 5 digits to your friends, let them scan the QR in the **Room** tab, or tap the copy icon at the end of
   that line (phone only) to copy an invitation for any chat app.
4. **Pin the panel** (see below) and press play. Everyone who joins follows your playback.

The invitation is plain text, without any link, for example:

```
Únete a mi fiesta en Kino 🎬
Película: Dune (2021), con «My plugin»
Código: 41408
En Kino: reproduce el mismo título ▸ panel ▸ Fiesta ▸ Unirme.
(Join my Kino watch party: code above.)
```

It carries the title with its year (and the season and episode), the plugin's name and the code. Nothing else: no address
of your device, no ids. Kino says "Copied" and keeps it out of clipboard previews. A TV has no copy button (Kino cannot
copy there).

If the short-code service does not answer, the room still opens: the tab says it could not create the code and offers
**Get a code**. Meanwhile the QR works, and **Advanced options** in the Room tab shows the room's words and its 12-digit
code for **Join with words and code**.

## Join a party

1. Play **the same title with the same plugin**, open the panel and the **Party** tab, and tap **Join a room**.
2. Type the **Room code** (5 digits; spaces and hyphens are fine) and tap **Next**. The code is checked first; then, the
   first time, it asks your name.
3. Other ways in, from the same step: **Paste invitation** and **Scan QR** on a phone, **Link with my phone** on a TV,
   and **Join with words and code**.

Every step after the first has **Back**, and nothing joins until you press a button. A pasted invitation works whatever
the chat app did to it: bold, emoji, line breaks or full-width digits.

## The chat

- The messages fill the tab, newest at the bottom: yours on the right, the others' on the left with their name once
  above each run. A reaction shows as a larger emoji, and room notes ("Bea joined") as small centred lines.
- Send with the **send icon inside the text field**, or with your keyboard's own send button.
- The eight reactions are hidden behind the **emoji button** next to the field. Press it to show them; picking one sends
  it and hides them again.
- At most 5 messages every 10 seconds per person.

## On a TV

- There is no clipboard and no camera on a TV: no paste, no scan, no copy buttons.
- The fields use Kino's TV text input, and the code step uses a number keyboard.
- The remote never loses its place:
  - creating or joining a room puts it on the chat's text field;
  - from the field, Right reaches the send icon and then the emoji button;
  - after sending or reacting it goes back to the field;
  - an error puts it on **Try again**;
  - a screen like "The host is not answering" puts it on its main button.

## Phone + TV

On the TV, open the **Party** tab, tap **Join a room** and choose **Link with my phone**. The TV shows a QR code that
works once and for 5 minutes. On the phone, inside the room, tap **Add device** and scan **your own** TV's code. The TV
then joins with one press: it plays the video, follows the host, shows the chat and can send the eight reactions (typing
stays on the phone). The member list shows one person with 📱 📺. If the phone leaves, the TV stays (reactions only) and
can link another phone.

## Keep the tab pinned

A tab only runs while the panel is open on it. Close the panel or switch tabs and the party pauses for that device: no
chat, no sync, and a host stops sending its position (guests wait). So:

- **Pin the panel** (**Pin**): it docks next to the video (the right third on a TV or a phone held sideways, below the
  video on a phone held upright) and keeps running while you watch.
- **Away for more than 2 minutes?** The host drops a guest it has not heard from in 2 minutes. When you come back, the tab
  says "You were away for a while and the room let you go" and **one button** joins again.
- **In the background for 5 minutes**, Kino closes the rooms of that device.

## Permissions, in plain words

What Kino shows when you install, and what each line means here:

| Kino says | What it means for this plugin |
| --- | --- |
| **Its tab in the player will see what you are watching (title, year, ids and position) while you have it open, and can send it to its services** (in red) | The tab reads the title you play, its year, its TMDB/IMDb ids and your position, only while the tab is open. It sends them to the **people in your room** (the room's title and the host's position), so everyone watches the same thing in step. Switch: **Show in the player**. |
| **Can pause, resume and move your video by itself** (in red) | A guest's tab follows the host: it pauses, resumes, jumps and sets the speed. Kino announces every such action ("Fiesta: paused"), ignores it while you seek or a Kino dialog is open, and allows at most 30 a minute. Only the host's messages move anyone's video. Switch: **Let it pause and move my video** (without it you can still chat). |
| **Can open a room that people reach over the Internet through this device, and send the room's messages to whoever joins** (in red) | **Create room** opens a room on your device, reached through Kino's tunnel, and the chat, the title and the playback go to the people who join. Joining someone else's room goes through theirs. A room opens or joins only when you press a button. Switch: **Let it open rooms over the Internet**. |
| (no line) camera scan | **Scan QR** and **Add device** open **Kino's own scanner**, only when you press them; the plugin gets only the text in the code. |
| The host `url-code.kinotv.workers.dev` | The short-code service, the only address the plugin reaches (see below). |

Each red permission can be switched off later in the plugin's tab in Kino's Settings, without uninstalling.

## Privacy and security

- **The short-code service.** `url-code.kinotv.workers.dev` is run by the plugin's author.
  - **What it receives:** when you create a room, the host's device sends it the room's address (its words and its
    12-digit room code) and gets back a 5-digit code. A guest's device sends it the 5 digits and gets back that address.
  - **How long it keeps it:** a code lasts at most **8 hours**. When the host leaves the room, the plugin asks the
    service to delete the code at once. If Kino itself closes the room, the plugin cannot ask, and the 8-hour limit
    covers it.
  - **What it can see:** the IP addresses of the host and of the guests who look a code up, and the room's address.
  - The service limits how often each IP address can ask.
- **The 5-digit code is the only secret.** Anyone who has it, or guesses a valid one, can join the room while the code
  lives. Share it only with the people you want in the room.
- **The chat is not private.** The room travels through a third-party tunnel, and the service holds the room's address.
  Keep the chat light: never passwords, addresses or anything sensitive.
- **Everyone with the code is trusted with the room**: they can chat, react, hold a backup door and, if the host leaves,
  become the host (and then move the followers' videos, within Kino's limits).
- **Add device sends the room's words and code to the TV you scan.** Scan only your own TV.
- **Your identity is Kino's.** Nobody can write as someone else: a message never names its sender, Kino does. Names are
  cleaned of invisible and look-alike characters, and equal names are numbered ("Bea (2)").
- **Kept on your device only while the room lives**: the codes and the chat (at most 200 messages), in the plugin's
  storage, which expires with the room. The codes and a pasted invitation are never written to a log, and a code typed
  into a message is masked («••••»).
- Removing the plugin deletes what it kept.

## Troubleshooting

- **"That code does not exist or has expired"**: check the 5 digits with the host. Codes last at most 8 hours, and a code
  stops working when the host leaves the room.
- **"I could not look the code up; try again"**: the short-code service did not answer. **Try again**, or ask the host for
  the QR, or for the words and code under **Advanced options** (**Join with words and code**).
- **"The room could not be reached"**: the host's device may be offline, asleep or with Kino in the background for more
  than 5 minutes. Ask the host, then **Try again**.
- **"The room is full"**: 8 devices at most (a linked TV counts as one).
- **The video does not follow**: check that you play the same title with the same plugin, that **Follow the host** (in
  the Room tab) is on, and that **Let it pause and move my video** is on in Settings. The **Sync** icon at the top asks
  the host now.
- **"The host is not answering"**: it may be your connection or theirs. **Try again** first tries the host again, and only
  then the backup doors.
- **The party stopped when I closed the panel**: pin the panel (see above).
- **"Watch party needs plugin screens switched on in Settings"**: turn plugin screens on in Kino's Settings.

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE).

Repository: [kinotvapp/kino-plugin-watch-party](https://github.com/kinotvapp/kino-plugin-watch-party)
(remote `git@github.com-kinotvapp:kinotvapp/kino-plugin-watch-party.git`). GitHub topic: `kino-plugin` (Kino's community
search finds the plugin by it).

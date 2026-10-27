# Fiesta (Watch Party)

[Español](README.es.md) · [For developers](DEVELOPERS.md)

<img src="icon.png" width="96" alt="Watch Party icon" align="right">

A [Kino](https://github.com/kinotvapp/kino-light) plugin for **watching together**, each person on their own device: a
**Party** tab in the player with a chat, eight quick reactions and the video kept in step with the host's. The room lives
on the device of whoever creates it and is reached through Kino's own tunnel: no account, no sign-up, no server of ours.

- **Chat**: plain text (up to 300 characters) and eight quick reactions (👍 😂 😮 😢 ❤️ 🔥 👏 🍿). No pictures, files,
  links or formatting: a link in a message is just text.
- **In sync**: the host leads. When the host pauses, resumes or jumps, everyone's video follows. A guest who pauses on
  their own stops following until **Sync again**.
- **Easy to invite**: the room has a few **words** (its address) and a **4-digit code**. Share them by voice, as a QR code,
  or with **Copy invitation**, a ready-to-paste text for any chat app.
- **Easy to join**: paste the whole invitation into the join form, tap **Read the invitation**, check what it found and
  tap **Join**. Or scan the host's QR code.
- **Phone + TV**: watch on the TV and chat from your phone. The TV joins as a reactions-only seat linked to your phone.
- **Nobody is indispensable**: if the host leaves, the room carries on with the next person, through a backup door.
- Up to **8 devices** per room. A room lasts at most 4 hours.

## Screenshots

<!-- To add before publishing, in screenshots/:
  1-create-phone.jpg     the Party tab before a room exists (name, Create room, Join a room)
  2-room-phone.jpg       the Room tab of the host: words, code, QR, Copy invitation
  3-chat-phone.jpg       the chat with a few messages and reactions
  4-join-paste.jpg       the join form after Read the invitation ("You are about to join: … · code …")
  5-pinned-tv.jpg        the pinned panel next to the video on a TV
-->
_Coming soon._

## Install

It needs a Kino version with player panel tabs (plugin `apiVersion` 14); an older Kino says "This plugin needs a newer
version of Kino".

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
- another plugin: the tab names the plugin the room uses ("This room uses “…”: open the title with that plugin"); you need
  that plugin installed;
- a title whose plugin gives no TMDB or IMDb id, a live channel or a video that is not from a plugin: chat only, no sync.

## Host a party

1. Play the title, open the panel and the **Party** tab.
2. Type **Your name** (what the others see) and tap **Create room**. Opening a room takes a few seconds ("Creating the
   room…").
3. The **Room** tab shows the room's **words**, its **4-digit code** and a **QR code** of both.
4. Invite: read the words and the code to your friends, let them scan the QR, or tap **Copy invitation** (phone only) and
   paste it in any chat. **Copy the code only** copies just the code.
5. **Pin the panel** (see below) and press play. Everyone who joins follows your playback.

The invitation is plain text, without any link, for example:

```
Únete a mi fiesta en Kino 🎬
Película: Dune (2021), con «My plugin»
Palabras: amber-river-candle
Código: 4821
En Kino: reproduce el mismo título ▸ panel ▸ Fiesta ▸ Unirme.
(Join my Kino watch party: words + code above.)
```

It carries the title with its year (and the season and episode), the plugin's name, the words and the code. Nothing else:
no address of your device, no ids. Kino says "Copied" and keeps it out of clipboard previews. A TV has no copy button
(Kino cannot copy there).

## Join a party

1. Play **the same title with the same plugin**, open the panel and the **Party** tab, type your name and tap **Join a
   room**.
2. Either:
   - **paste the invitation** you received into **Paste the invitation here** (or straight into the words field) and tap
     **Read the invitation**. The tab shows what it found ("You are about to join: amber-river-candle · code 4821"). If it
     cannot tell ("I cannot find the words or the code"), it says so instead of guessing;
   - type the **words** and the **code**;
   - or tap **Scan the QR code** and point the camera at the host's QR.
3. Tap **Join** ("Joining the room…"). Nothing joins until you press it.

A paste works whatever the chat app did to it: bold, emoji, line breaks, upper case or full-width digits. A year in
parentheses never counts as the code.

## Phone + TV

On the TV, open the **Party** tab and choose **Link with my phone**: the TV shows a QR code that works once and for
5 minutes. On the phone, inside the room, tap **Add device** and scan **your own** TV's code. The TV then joins with one
press: it plays the video, follows the host, shows the chat and can send the eight reactions (typing stays on the phone).
The member list shows one person with 📱 📺. If the phone leaves, the TV stays (reactions only) and can link another phone.

## Keep the tab pinned

A tab only runs while the panel is open on it. Close the panel or switch tabs and the party pauses for that device: no
chat, no sync, and a host stops sending its position (guests wait). So:

- **Pin the panel** (**Pin**): it docks next to the video (the right third on a TV or a phone held sideways, below the
  video on a phone held upright) and keeps running while you watch. The tab has a narrow layout made for it.
- **Away for more than 2 minutes?** The host drops a guest it has not heard from in 2 minutes. When you come back, the tab
  says "You were away for a while and the room let you go" and **one button** joins again.
- **In the background for 5 minutes**, Kino closes the rooms of that device.

## Permissions, in plain words

What Kino shows when you install, and what each line means here:

| Kino says | What it means for this plugin |
| --- | --- |
| **Its tab in the player will see what you are watching (title, year, ids and position) while you have it open, and can send it to its services** (in red) | The tab reads the title you play, its year, its TMDB/IMDb ids and your position, only while the tab is open. It sends them to the **people in your room** (the room's title and the host's position), so everyone watches the same thing in step. It has no other service. Switch: **Show in the player**. |
| **Can pause, resume and move your video by itself** (in red) | A guest's tab follows the host: it pauses, resumes, jumps and sets the speed. Kino announces every such action ("Fiesta: paused"), ignores it while you seek or a Kino dialog is open, and allows at most 30 a minute. Only the host's messages move anyone's video. Switch: **Let it pause and move my video** (without it you can still chat). |
| **Can open a room that people reach over the Internet through this device, and send the room's messages to whoever joins** (in red) | **Create room** opens a room on your device, reached through Kino's tunnel, and the chat, the title and the playback go to the people who join. Joining someone else's room goes through theirs. A room opens or joins only when you press a button. Switch: **Let it open rooms over the Internet**. |
| (no line) camera scan | **Scan the QR code** and **Add device** open **Kino's own scanner**, only when you press them; the plugin gets only the text in the code. |

Each red permission can be switched off later in the plugin's tab in Kino's Settings, without uninstalling. The manifest
declares the documentation host (`kinotvapp.github.io`) only because every plugin declares one: the plugin never
downloads anything.

## Privacy and security

- **The 4-digit code keeps strangers out, nothing more.** The words are the address and cannot be guessed; the code stops
  whoever has the words but not the code. Guessing only works online: Kino locks joining for a while after 5 wrong codes
  and **closes the room after 30 wrong joins**.
- **The chat is not private from the tunnel provider.** The room travels through a third-party tunnel; with a 4-digit
  code, whoever captures that traffic and knows the words can recover the code in moments. Keep the chat light: never
  passwords, addresses or anything sensitive.
- **Everyone with the code is trusted with the room**: they can chat, react, hold a backup door and, if the host leaves,
  become the host (and then move the followers' videos, within Kino's limits).
- **Add device sends the room's words and code to the TV you scan.** Scan only your own TV.
- **Your identity is Kino's.** Nobody can write as someone else: a message never names its sender, Kino does. Names are
  cleaned of invisible and look-alike characters, and equal names are numbered ("Bea (2)").
- **Kept on your device only while the room lives**: the code and the chat (at most 200 messages) in the plugin's storage,
  which expires with the room. The code and a pasted invitation are never written to a log, and a code typed into a
  message is masked («••••»).
- **No account and no server of ours.** Kino's tunnel and the devices in the room are the only places the room's data
  goes.
- Removing the plugin deletes what it kept.

## Troubleshooting

- **"That is not the room's code"**: check the 4 digits. After 5 wrong tries Kino makes you wait a moment; after 30 the
  room closes and the host must create a new one.
- **"The room could not be reached"**: the host's device may be offline, asleep or with Kino in the background for more
  than 5 minutes. Ask the host, then **Try again**.
- **"The room is full"**: 8 devices at most (a linked TV counts as one).
- **The video does not follow**: check that you play the same title with the same plugin, that **Follow the host** is on,
  and that **Let it pause and move my video** is on in Settings. **Sync** asks the host now.
- **"The host is not answering"**: it may be your connection or theirs. **Try again** first tries the host again, and only
  then the backup doors.
- **The party stopped when I closed the panel**: pin the panel (see above).
- **"Watch party needs plugin screens switched on in Settings"**: turn plugin screens on in Kino's Settings.

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE).

Repository: [kinotvapp/kino-plugin-watch-party](https://github.com/kinotvapp/kino-plugin-watch-party)
(remote `git@github.com-kinotvapp:kinotvapp/kino-plugin-watch-party.git`). GitHub topic: `kino-plugin` (Kino's community
search finds the plugin by it).

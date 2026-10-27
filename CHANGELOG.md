# Changelog

## 1.1.0

- **A 5-digit code to join:** the host's device asks Kino's short-code service (`url-code.kinotv.workers.dev`, the plugin's
  only host) for a code. Guests type those 5 digits, or scan the QR. The room's words and its 12-digit code stay under
  **Advanced options** for when the service does not answer. A code is revoked when its room closes.
- **Step-by-step create and join:** one thing per screen, and the name is asked only when none is saved. On a TV there is
  no paste and no scan.
- **The Room tab** opens with one line, **Room: 41 408**, and on the host's phone an icon to **Copy invitation**. **Copy
  the code only** is gone.
- **The chat looks like a chat:**
  - your messages on the right, the others' on the left with the name once per run;
  - reactions as larger glyphs, room notes as small centred lines;
  - the newest at the bottom (40 on a phone, 25 on a TV).
- **The chat input:** send with the icon inside the field or the keyboard's own button. The eight reactions are hidden
  behind the emoji button, and sending one closes them. Reactions are large: 48 dp buttons in the palette, a big glyph in
  the list.
- **The room view:**
  - a header row with the room's status and, for guests, a **Sync** icon;
  - **Follow the host** in the Room tab;
  - recovery screens with one clear way on.
- **On a TV** the remote never loses its place:
  - creating or joining opens the chat on its input;
  - sending and reacting bring it back there;
  - errors focus **Try again**, and recovery screens focus their main button.
- **A host who steps out of Kino is not "gone":** while the host's room still answers, guests see "The host stepped away;
  the room is still open" for up to 2 minutes instead of "The host is not answering". The room catches up as soon as the
  host is back.

## 1.0.0

The first public version (Kino plugin `apiVersion` 14).

- A **Party** tab (**Fiesta** in Spanish) in the player panel of any plugin's title: watch the same title together, each
  on their own device.
- A chat of plain text (300 characters) and eight quick reactions, nothing else: no pictures, files, links or formatting.
- The video kept in step with the host's (pause, resume, jumps, speed) through Kino's `playerControl`, with **Sync**,
  **Sync again** and **Follow the host**.
- Rooms hosted on the person's own device through Kino's tunnel (`kino.room`), up to 8 devices, at most 4 hours: a few
  words and a 4-digit code, shown as a QR code too; Kino closes a room after 30 wrong joins.
- **Copy invitation** and **Copy the code only** on the host's phone: a plain text, without links, for any chat app.
  The join form reads a pasted invitation and shows what it found before **Join**.
- Joining by scanning the host's QR code with Kino's own scanner (`qrScan`).
- A phone and a TV as one person: the TV joins as a reactions-only seat linked to the phone.
- Nobody is indispensable: backup doors and a one-tap change of host when the host leaves.
- Progress rows while a room opens or joins, and errors shown in place with **Try again**.
- Signed by its author.

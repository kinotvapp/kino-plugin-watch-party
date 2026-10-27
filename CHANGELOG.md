# Changelog

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

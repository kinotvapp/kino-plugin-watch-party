#!/usr/bin/env node
// Signs plugin.js for kinotvapp/kino-plugin-watch-party with the Kino author key, on any OS (npm runs scripts through cmd.exe
// on Windows, where `~` is not expanded). The key: $KINO_AUTHOR_KEY, or ~/.config/kino/kino-author-key.pem.
// Never copy the key into this folder: *.pem is ignored, and sdk/validate.mjs fails when one is tracked.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const key = process.env.KINO_AUTHOR_KEY || join(homedir(), ".config", "kino", "kino-author-key.pem");
if (!existsSync(key)) {
  console.error(`no author key at ${key}: set KINO_AUTHOR_KEY to its path`);
  process.exit(1);
}
const r = spawnSync(process.execPath, [join(repo, "sdk", "seal.mjs"), "--sign", "--repo", "kinotvapp/kino-plugin-watch-party",
  "--manifest", join(repo, "kino-plugin.json"), "--key", key], { cwd: repo, stdio: "inherit" });
process.exit(r.status ?? 1);

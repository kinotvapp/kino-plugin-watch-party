// The shipped plugin.js is generated from src/ (`npm run build`): it must be exactly what src/ builds to, so the file
// Kino installs (and its signature) never drifts from the source people read. The other tests run the shipped bundle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BANNER, buildText } from "../scripts/build.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

let esbuildMissing = null;
try {
  await import("esbuild");
} catch (e) {
  esbuildMissing = "esbuild is not installed here (run `npm install`): the plugin.js-is-built-from-src check is skipped";
}

test("plugin.js is exactly what src/ builds to (npm run build), with its generated-file header", { skip: esbuildMissing || false }, async () => {
  const committed = readFileSync(join(DIR, "plugin.js"), "utf8");
  assert.ok(committed.startsWith(BANNER + "\n"), "plugin.js starts with the generated-file header");
  const built = await buildText(DIR);
  assert.ok(built === committed, "plugin.js differs from what src/ builds to: run `npm run build`, never edit plugin.js by hand");
});

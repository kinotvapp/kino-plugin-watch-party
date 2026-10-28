#!/usr/bin/env node
// Re-syncs this repository from the watch-party example it was born from, in Kino's own repository.
//
//   node scripts/sync-from-example.mjs <kino>/docs/plugins/examples/watch-party [--no-kit] [--kit <kino>/plugins/sdk] [--dry-run]
//
// What it copies (the example is the source of truth for the code; this repository owns the publishing metadata):
//   - plugin.js, as it is, except its first comment line, which stops calling it an example;
//   - test/ (every file, mirrored: a test or fixture the example dropped is dropped here too), with the kit's imports
//     rewritten from `../../../../../plugins/sdk/` to `../sdk/`;
//   - from kino-plugin.json, only the fields that make the plugin work (apiVersion, entry, hosts, fetchHosts,
//     capabilities, jobs, screen, settings and any other field this repository does not own). The fields listed in
//     OWNED below (id, name, version, description, homepage, icon, color...) are never touched;
//   - the technical part of the example's README.md into DEVELOPERS.md, between its sync markers;
//   - unless --no-kit: the Node kit (sdk/*.mjs, without its own tests), contract.json and kino.d.ts, found next to the
//     example in Kino's repository (or at --kit).
//
// When plugin.js or a manifest field changed, the old `signature` no longer matches: it is removed, and the script
// reminds you to raise `version` (and CHANGELOG.md) and run `npm run sign`.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Manifest fields this repository owns: the example's values never replace them. */
const OWNED = ["id", "name", "version", "description", "author", "homepage", "icon", "color", "theme", "categories",
  "discoverable", "telemetry", "debug", "signature"];
const MARK_BEGIN = "<!-- sync:begin example-readme -->";
const MARK_END = "<!-- sync:end example-readme -->";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--kit");
if (positional.length !== 1) {
  console.error("usage: node scripts/sync-from-example.mjs <example folder> [--no-kit] [--kit <sdk folder>] [--dry-run]");
  process.exit(2);
}
const EXAMPLE = resolve(positional[0]);
const DRY = flag("--dry-run");
for (const f of ["plugin.js", "kino-plugin.json"]) {
  if (!existsSync(join(EXAMPLE, f))) { console.error(`not an example folder: ${join(EXAMPLE, f)} is missing`); process.exit(2); }
}

const changes = [];
const sha = (b) => createHash("sha256").update(b).digest("hex");
function write(path, content) {
  const old = existsSync(path) ? readFileSync(path) : null;
  const next = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  if (old && sha(old) === sha(next)) return false;
  changes.push(`${old ? "updated" : "added"} ${relative(REPO, path).replaceAll("\\", "/")}`);
  if (!DRY) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, next); }
  return true;
}
function remove(path) {
  changes.push(`removed ${relative(REPO, path).replaceAll("\\", "/")}`);
  if (!DRY) rmSync(path, { recursive: true, force: true });
}
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p).map((x) => join(n, x)) : [n];
});

// 1. plugin.js: the code as it is; only the opening comment stops calling it an example.
const code = readFileSync(join(EXAMPLE, "plugin.js"), "utf8")
  .replace(/^\/\/ Watch Party: an example plugin that adds/, "// Party Chat: a Kino plugin that adds");
const codeChanged = write(join(REPO, "plugin.js"), code);

// 2. test/: mirrored, with the kit's imports pointed at this repository's sdk/.
const rewriteTest = (text) => text
  .replace(/(["'])(?:\.\.\/)+plugins\/sdk\//g, "$1../sdk/")
  .replace(/join\(HERE,(?: "\.\.",)+ "plugins", "sdk"/g, 'join(HERE, "..", "sdk"')
  .replace(/^\/\/ The Watch Party example run with Kino's Node kit \(plugins\/sdk\)/, "// Party Chat run with Kino's Node kit (sdk/)");
const exampleTests = join(EXAMPLE, "test");
const wanted = new Set();
if (existsSync(exampleTests)) {
  for (const rel of walk(exampleTests)) {
    wanted.add(rel);
    const src = readFileSync(join(exampleTests, rel));
    const isText = /\.(mjs|js|json)$/.test(rel);
    const out = isText && rel.endsWith(".mjs") ? rewriteTest(src.toString("utf8")) : src;
    if (isText && rel.endsWith(".mjs") && /plugins\/sdk|"plugins", "sdk"/.test(out)) {
      console.error(`test/${rel} still names Kino's plugins/sdk after the rewrite: fix the rewrite rules first`);
      process.exit(1);
    }
    write(join(REPO, "test", rel), out);
  }
}
if (existsSync(join(REPO, "test"))) for (const rel of walk(join(REPO, "test"))) if (!wanted.has(rel)) remove(join(REPO, "test", rel));

// 3. kino-plugin.json: the example's working fields, this repository's own metadata.
const manifestPath = join(REPO, "kino-plugin.json");
const ours = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
const theirs = JSON.parse(readFileSync(join(EXAMPLE, "kino-plugin.json"), "utf8"));
const merged = {};
let fieldsChanged = false;
for (const k of Object.keys(ours)) {
  if (OWNED.includes(k)) merged[k] = ours[k];
  else if (k in theirs) merged[k] = theirs[k];
  else { fieldsChanged = true; changes.push(`manifest: removed "${k}" (the example no longer has it)`); }
}
for (const k of Object.keys(theirs)) {
  if (OWNED.includes(k) || k in merged) continue;
  merged[k] = theirs[k];
}
for (const k of Object.keys(merged)) {
  if (OWNED.includes(k)) continue;
  if (JSON.stringify(ours[k]) !== JSON.stringify(merged[k])) { fieldsChanged = true; changes.push(`manifest: "${k}" from the example`); }
}
if ((codeChanged || fieldsChanged) && merged.signature) {
  delete merged.signature;
  changes.push("manifest: signature removed (it no longer matches)");
}
write(manifestPath, JSON.stringify(merged, null, 2) + "\n");

// 4. DEVELOPERS.md: the example README's technical sections, between the markers.
const readme = readFileSync(join(EXAMPLE, "README.md"), "utf8");
const from = readme.indexOf("\n## ");
const to = readme.indexOf("\n## Try it");
if (from >= 0) {
  let part = readme.slice(from + 1, to > from ? to : undefined).trim();
  part = part.replace(/^## /gm, "### ");
  let where = relative(REPO, EXAMPLE).replaceAll("\\", "/");
  try {
    const head = execFileSync("git", ["-C", EXAMPLE, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["-C", EXAMPLE, "status", "--porcelain", "--", "."], { encoding: "utf8" }).trim();
    const top = execFileSync("git", ["-C", EXAMPLE, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    where = `\`${relative(top, EXAMPLE).replaceAll("\\", "/")}\` in Kino's repository at \`${head}\`${dirty ? " (with uncommitted changes)" : ""}`;
  } catch { /* not a git checkout: the plain path is enough */ }
  const block = `${MARK_BEGIN}\n_Synced by \`scripts/sync-from-example.mjs\` from ${where}. Do not edit by hand: change the example and sync again._\n\n${part}\n${MARK_END}`;
  const devPath = join(REPO, "DEVELOPERS.md");
  const dev = existsSync(devPath) ? readFileSync(devPath, "utf8") : `# Developers\n\n${MARK_BEGIN}\n${MARK_END}\n`;
  const a = dev.indexOf(MARK_BEGIN), b = dev.indexOf(MARK_END);
  if (a < 0 || b < a) { console.error("DEVELOPERS.md has no sync markers"); process.exit(1); }
  // The provenance line changes on every run; only write when the synced text itself changed.
  const strip = (s) => s.replace(/^_Synced by .*_$/m, "");
  const next = dev.slice(0, a) + block + dev.slice(b + MARK_END.length);
  if (strip(next) !== strip(dev) || !dev.includes("_Synced by")) write(devPath, next);
}

// 5. The kit, contract.json and kino.d.ts from Kino's repository.
if (!flag("--no-kit")) {
  let kit = option("--kit") ? resolve(option("--kit")) : null;
  let docs = null;
  for (let d = EXAMPLE; !kit || !docs; ) {
    if (!kit && existsSync(join(d, "plugins", "sdk", "contract.mjs"))) kit = join(d, "plugins", "sdk");
    if (!docs && existsSync(join(d, "docs", "plugins", "contract.json"))) docs = join(d, "docs", "plugins");
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  if (!kit || !docs) { console.error("Kino's plugins/sdk or docs/plugins not found above the example: pass --kit or --no-kit"); process.exit(1); }
  const files = readdirSync(kit).filter((n) => n.endsWith(".mjs"));
  for (const n of files) write(join(REPO, "sdk", n), readFileSync(join(kit, n)));
  if (existsSync(join(REPO, "sdk"))) for (const n of readdirSync(join(REPO, "sdk"))) if (!files.includes(n)) remove(join(REPO, "sdk", n));
  write(join(REPO, "contract.json"), readFileSync(join(docs, "contract.json")));
  write(join(REPO, "kino.d.ts"), readFileSync(join(docs, "kino.d.ts")));
}

console.log(changes.length ? changes.join("\n") : "already in sync: nothing changed");
if (DRY) console.log("(dry run: nothing written)");
if (codeChanged || fieldsChanged) {
  console.log("\nThe plugin changed. Next: raise \"version\" in kino-plugin.json, add it to CHANGELOG.md, then\n" +
    "  npm test && npm run sign && npm run validate");
}

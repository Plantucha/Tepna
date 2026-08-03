#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * served-link-check.mjs — which local links are DEAD on a deployed box?
 * ----------------------------------------------------------------------------
 * `CAPTURE-HOST-DEEP-AUDIT-FOLLOWUPS` §1.2 records two dead-link residues on the served tree and
 * says plainly what is missing: *"A link-checker over the SERVED tree is the honest gate, and would
 * have caught both."* This is it.
 *
 * ── WHY IT READS `sync-apps.sh` INSTEAD OF LISTING THE PAGES ────────────────────────────────────
 *
 * The served set is defined in exactly one place — `capture-host/deploy/sync-apps.sh`: the
 * provenance-gated apps (one `provenance/<App>.json` fragment each, so the app list cannot drift from
 * the gate), plus `PAGES`, `ASSETS` and `ASSET_DIRS`. A checker with its own copy of that list would
 * drift from the deploy script, and then agree with itself while the box served something else —
 * the same shape of defect §C7 already fixed once. So the arrays are parsed out of the script.
 *
 * ── WHAT COUNTS AS DEAD ─────────────────────────────────────────────────────────────────────────
 *
 * A local `href`/`src` on a served page that resolves to a path NOT in the served set. Skipped:
 * absolute URLs, `mailto:`, `data:`, `javascript:`, and pure `#fragment` links — none of them can
 * 404 on the box. A link into an `ASSET_DIRS` subtree is resolved against the real directory, so a
 * page linking `papers/foo.html` is only dead when that file genuinely is not there.
 *
 * The check is deliberately about EXISTENCE ON THE BOX, not about whether the file exists in the
 * repo: a page that links a harness which exists in the repo but is not served is still a dead link
 * for the person using the appliance, and that is §1.2's first residue.
 *
 * USAGE  node tools/served-link-check.mjs [--strict]
 *        --strict → exit 1 if any dead link is found
 * ════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const STRICT = process.argv.includes('--strict');
const SH = path.join(ROOT, 'capture-host/deploy/sync-apps.sh');
if (!fs.existsSync(SH)) {
  console.log('capture-host/deploy/sync-apps.sh not found — cannot know what is served');
  process.exit(1);
}
const sh = fs.readFileSync(SH, 'utf8');

/* Pull a bash array literal, e.g. PAGES=("a.html" "b.html"\n  "c.html") */
function bashArray(name) {
  const m = sh.match(new RegExp(name + '=\\(([\\s\\S]*?)\\)', 'm'));
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}
const PAGES = bashArray('PAGES');
const ASSETS = bashArray('ASSETS');
const ASSET_DIRS = bashArray('ASSET_DIRS');
/* The apps come from the provenance fragments, exactly as the script derives them. */
const APPS = fs
  .readdirSync(path.join(ROOT, 'provenance'))
  .filter((f) => f.endsWith('.json') && !f.startsWith('_') && f !== 'index.json')
  .map((f) => f.replace(/\.json$/, '') + '.html');

/* The served set, as relative POSIX paths. */
const served = new Set();
for (const f of [...APPS, ...PAGES, ...ASSETS]) if (fs.existsSync(path.join(ROOT, f))) served.add(f);
for (const d of ASSET_DIRS) {
  const abs = path.join(ROOT, d);
  if (!fs.existsSync(abs)) continue;
  (function walk(cur) {
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) walk(p);
      else served.add(path.relative(ROOT, p).split(path.sep).join('/'));
    }
  })(abs);
}

const pagesToScan = [...served].filter((f) => f.endsWith('.html')).sort();
const SKIP = /^(https?:|mailto:|tel:|data:|javascript:|#|\/\/)/i;
const dead = [];
let refs = 0;

for (const page of pagesToScan) {
  const src = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const dir = path.posix.dirname(page);
  const seen = new Set();
  /* SCAN INSIDE HTML TAGS ONLY, and require the attribute name to stand alone.
     Two false-positive classes made a naive /(?:href|src)=/ useless here:
       · the bundles are PLAIN-INLINE, so every inlined asset carries `data-inline-src="clock.js"`
         recording where its text came from — it never fetches. That alone reported the entire
         module graph of every bundle as dead (295 findings, ~95 % noise).
       · inlined JS contains plain assignments like `var src = 'chest-acc';`, which is not a link.
     Matching per-TAG kills both while still catching attributes written inside a JS template
     string (`html += '<a href="x.html">'`), because those are still `<...>` constructs. */
  for (const tag of src.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const m = /(?<![-\w])(?:href|src)\s*=\s*["']([^"']+)["']/i.exec(tag[0]);
    if (!m) continue;
    let raw = m[1].trim();
    if (!raw || SKIP.test(raw)) continue;
    raw = raw.split('#')[0].split('?')[0];
    if (!raw) continue;
    /* Percent-decode before resolving. The guide filenames contain spaces, so pages link them as
       `OxyDex%20Reference.html`; comparing the encoded form against a real path reported all seven
       served guides as "does not exist at all". */
    try {
      raw = decodeURIComponent(raw);
    } catch {
      /* a malformed escape is itself a broken link — leave it as-is and let it be reported */
    }
    const target = path.posix.normalize(dir === '.' ? raw : path.posix.join(dir, raw));
    if (seen.has(target)) continue;
    seen.add(target);
    refs++;
    if (!served.has(target)) dead.push({ page, ref: m[1], target, inRepo: fs.existsSync(path.join(ROOT, target)) });
  }
}

console.log('Served-tree link check — the set is parsed from capture-host/deploy/sync-apps.sh\n');
console.log(`  apps (provenance fragments) : ${APPS.length}`);
console.log(`  whitelisted PAGES           : ${PAGES.length}`);
console.log(`  ASSETS / ASSET_DIRS         : ${ASSETS.length} / ${ASSET_DIRS.length} (${served.size} files served in total)`);
console.log(`  pages scanned               : ${pagesToScan.length}`);
console.log(`  distinct local refs         : ${refs}`);
console.log(`  DEAD on the box             : ${dead.length}\n`);

const byPage = new Map();
for (const d of dead) {
  if (!byPage.has(d.page)) byPage.set(d.page, []);
  byPage.get(d.page).push(d);
}
for (const [page, list] of [...byPage.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${page} — ${list.length} dead`);
  for (const d of list) {
    /* "in repo, not served" is a DIFFERENT defect from "does not exist": the first is a whitelist
       decision, the second is a broken reference. Reporting them the same way would hide which. */
    console.log(`      ${d.ref.padEnd(46)} ${d.inRepo ? 'exists in repo, NOT SERVED' : 'does not exist at all'}`);
  }
  console.log('');
}
if (!dead.length) console.log('  every local link on every served page resolves inside the served set.');

if (STRICT && dead.length) process.exitCode = 1;

/*
 * tests/verify-manifest.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 */
/* ════════════════════════════════════════════════════════════════════════
   tests/verify-manifest.mjs — headless GATE A + GATE B (provenance, pure-Node)
   ────────────────────────────────────────────────────────────────────────
   EXPORT-IDENTITY-FOLLOWUPS-IV §1 (GATE A) + SIGNAL-ADAPTER-AND-FRONTIER Phase 7
   (GATE B). The PROVENANCE lane's pure-Node sibling of verify-provenance.html:
   GATE A — for all 8 bundles, recompute the executed-code manifestHash (SHA-256
   [0:12] of the bundle FILE's `__bundler/manifest` projection) and assert it equals
   BUILD-MANIFEST.json. GATE B — the CONTENT-ADDRESSED known-answer audit: for each
   FIXTURE-PROVENANCE.json record, recompute sha256[0:16] of every committed input +
   the committed output and assert the known-answer triple (input + manifestHash ->
   output) still holds. Exit 0 = all pass, 1 = drift / missing / stale-manifest, 2 =
   setup error.

   GATE B is BEST-EFFORT in Node: uploads/ is gitignored (personal health data), so
   its committed fixtures/inputs may be ABSENT in CI — those rows SKIP (not fail),
   mirroring the equiv-gate's existsSync self-skip. Where uploads/ IS present (local /
   this environment) GATE B fully verifies. The browser page (uploads/ served) is the
   authoritative GATE-B surface; this lane adds a fast Node check with no buildHash.

   WHY THIS EXISTS — EXPORT-IDENTITY-FOLLOWUPS-II FOUND a pre-existing CPAPDex /
   Integrator drift (BUILD-MANIFEST recorded one hash, the on-disk bundles hashed
   another) that had been verify-provenance GATE-A red for an unknown window. It
   was caught ONLY because that pass happened to recompute every bundle's hash by
   hand. Nothing caught the class CONTINUOUSLY: GATE A bit only when a human opened
   verify-provenance.html (the heavier Playwright browser-gates lane aside). This
   wires that exact recompute into the FAST pure-Node lane (tests.yml), so
   "re-bundled but forgot BUILD-MANIFEST" (or edited the manifest without
   re-bundling) reds automatically on every push/PR.

   GATE SEPARATION (CLAUDE.md): this is a PROVENANCE / content recompute, NOT a
   behavior assertion — it stays OUT of dex-tests.js / Dex-Test-Suite.html
   ("Behavior is gated separately"). It SHARES both gate cores (manifest extraction
   + hash + compare for GATE A; sha16 + gateBFiles + gateBEvaluate for GATE B) with
   the verify-provenance PAGE via manifest-gate.js, so the page and CI can't drift
   (the provenance-banner.js precedent). Zero npm deps; uses Node's Web Crypto
   (globalThis.crypto), the same algorithm the browser runs, so digests are
   byte-identical to the page's.
   ════════════════════════════════════════════════════════════════════════ */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guarantee the shared module's globalThis.crypto.subtle resolves on any Node >= 16. It is a
// global from v18 (CI pins node 20); this is belt-and-suspenders and uses the SAME Web Crypto
// SHA-256, so it introduces no algorithm drift vs the browser path.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const require = createRequire(import.meta.url);
const ManifestGate = require(join(ROOT, 'manifest-gate.js'));

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
const paint = (s, c) => (process.stdout.isTTY ? c + s + C.reset : s);
const die = (code, msg) => {
  console.error(paint('\u2715 ' + msg, C.red));
  process.exit(code);
};

/* Section filter (SECTION-SCOPED-RUNS 2026-07-01) — `node tests/verify-manifest.mjs --bundle=oxydex`
   (aliases --only / --group / -b, or the DEX_BUNDLE env var) scopes BOTH gates to the matching
   bundle(s): compute + compare only those manifestHashes, and audit only the fixtures they produced.
   Same comma=OR, regex-or-substring grammar as verify-provenance.html's ?bundle= and the suite's
   --group. A DEV CONVENIENCE, never the merge gate — prints a FILTERED banner; a zero-match filter is
   a hard error, not a pass. */
const BUNDLE_FILTER = (() => {
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const m = a[i].match(/^--?(?:bundle|bundles|only|group|b)=(.+)$/i);
    if (m) return m[1];
    if (/^--?(?:bundle|only|group|b)$/i.test(a[i]) && a[i + 1]) return a[i + 1];
  }
  return process.env.DEX_BUNDLE || process.env.DEX_GROUP || '';
})();
function bundleMatcher(filter) {
  if (!filter) return () => true;
  const tests = String(filter)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => {
      let rx = null;
      try {
        rx = new RegExp(t, 'i');
      } catch (_) {
        rx = null;
      }
      const lc = t.toLowerCase();
      return (s) => {
        s = String(s == null ? '' : s);
        return rx ? rx.test(s) : s.toLowerCase().indexOf(lc) >= 0;
      };
    });
  return (name) => tests.some((fn) => fn(name));
}

async function main() {
  // committed truth
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(ROOT, 'BUILD-MANIFEST.json'), 'utf8'));
  } catch (e) {
    return die(2, 'BUILD-MANIFEST.json failed to load/parse: ' + e.message);
  }
  const committed = (manifest && manifest.bundles) || null;
  if (!committed) return die(2, 'BUILD-MANIFEST.json has no `bundles` map');

  // scope (SECTION-SCOPED-RUNS): which bundles this run checks — all, or the --bundle= filtered set
  const _bmatch = bundleMatcher(BUNDLE_FILTER);
  const BUNDLES = BUNDLE_FILTER ? ManifestGate.MANIFEST_BUNDLES.filter(_bmatch) : ManifestGate.MANIFEST_BUNDLES;
  if (BUNDLE_FILTER) {
    console.log(
      paint('▸ FILTERED RUN', C.yellow) +
        paint('  --bundle="' + BUNDLE_FILTER + '"  →  ' + BUNDLES.length + ' of ' + ManifestGate.MANIFEST_BUNDLES.length + ' bundle(s)  (dev convenience — NOT the full provenance gate)', C.dim)
    );
    if (!BUNDLES.length) return die(2, 'filter matched ZERO bundles — check the pattern (nothing was checked; a scoped run that checks nothing is not a pass)');
  }

  // recompute each bundle's CURRENT manifestHash via the SAME core the page uses
  const current = {};
  for (const f of BUNDLES) {
    const p = join(ROOT, f);
    if (!existsSync(p)) {
      current[f] = null;
      continue;
    }
    current[f] = await ManifestGate.manifestHashFromText(readFileSync(p, 'utf8'));
  }

  const g = ManifestGate.gateACompare(current, committed, BUNDLES);

  console.log(paint('\u25b8 GATE A — manifestHash \u2194 BUILD-MANIFEST.json', C.bold) + paint('  (' + g.checked + '/' + BUNDLES.length + ' checked)', C.dim));
  for (const r of g.results) {
    if (r.status === 'match') console.log(paint('  \u2713', C.green) + ' ' + r.file + paint('  ' + r.current, C.dim));
    else if (r.status === 'drift') console.log(paint('  \u2715', C.red) + ' ' + r.file + paint('  current ' + r.current + ' \u2260 committed ' + r.committed, C.yellow));
    else if (r.status === 'missing-current') console.log(paint('  \u2715', C.red) + ' ' + r.file + paint('  bundle missing / no __bundler/manifest (committed ' + r.committed + ')', C.yellow));
    else console.log(paint('  \u2715', C.red) + ' ' + r.file + paint('  no committed manifestHash in BUILD-MANIFEST.json', C.yellow));
  }

  // Single-source guard (kept in THIS provenance-lane runner, NOT the behavior suite): the page
  // must CONSUME manifest-gate.js rather than re-inline a copy that could drift from this check.
  const vpPath = join(ROOT, 'verify-provenance.html');
  if (existsSync(vpPath)) {
    const vp = readFileSync(vpPath, 'utf8');
    const wired = /<script src="manifest-gate\.js"><\/script>/.test(vp) && /ManifestGate\.manifestHashFromText/.test(vp);
    const reInlinedHash = /\.match\(\/<script type="__bundler\\\/manifest">/.test(vp);
    if (!wired || reInlinedHash) {
      console.error(paint('  \u2715 verify-provenance.html does not source the shared GATE-A core (manifest-gate.js) — page and CI could drift', C.red));
      g.ok = false;
      g.fail++;
    } else {
      console.log(paint('  \u2713 verify-provenance.html sources the shared GATE-A core (manifest-gate.js)', C.green));
    }
  }

  // ── GATE B — content-addressed known-answer audit (Phase 7), best-effort (uploads/ may be gitignored) ──
  let gb = { fail: 0, checked: 0, absent: 0, ok: true, results: [] };
  let fixprov = null;
  try {
    fixprov = JSON.parse(readFileSync(join(ROOT, 'FIXTURE-PROVENANCE.json'), 'utf8'));
  } catch (e) {
    return die(2, 'FIXTURE-PROVENANCE.json failed to load/parse: ' + e.message);
  }
  const fixturesAll = (fixprov && fixprov.fixtures) || null;
  if (!fixturesAll) return die(2, 'FIXTURE-PROVENANCE.json has no `fixtures` map');
  // scope GATE B to the filtered bundle(s) too, so --bundle audits only their fixtures
  const fixtures = BUNDLE_FILTER ? Object.fromEntries(Object.entries(fixturesAll).filter(([, v]) => v && v.bundle && _bmatch(v.bundle))) : fixturesAll;
  // sha256[0:16] of each referenced committed file's RAW bytes (uploads/<f>); null = absent (CI skip).
  const fileHashes = {};
  for (const f of ManifestGate.gateBFiles(fixtures)) {
    const p = join(ROOT, 'uploads', f);
    fileHashes[f] = existsSync(p) ? await ManifestGate.sha16(new Uint8Array(readFileSync(p))) : null;
  }
  gb = ManifestGate.gateBEvaluate(fixtures, current, fileHashes);
  console.log(
    '\n' +
      paint('\u25b8 GATE B — content-addressed known-answer audit (input + manifestHash \u2192 output)', C.bold) +
      paint('  (' + gb.checked + ' reproducible, ' + gb.fail + ' drift, ' + gb.absent + ' skipped — uploads/ not served)', C.dim)
  );
  for (const r of gb.results) {
    if (r.status === 'reproducible' || r.status === 'historical-ok') console.log(paint('  \u2713', C.green) + ' ' + r.name + paint('  ' + r.status, C.dim));
    else if (/-absent$|unloaded$/.test(r.status)) console.log(paint('  \u2218', C.yellow) + ' ' + r.name + paint('  ' + r.status + ' (skip) — ' + r.detail, C.dim));
    else console.log(paint('  \u2715', C.red) + ' ' + r.name + paint('  ' + r.status + ' — ' + r.detail, C.yellow));
  }
  if (gb.fail === 0 && gb.checked > 0)
    console.log(paint('  \u2713 GATE B PASS — ' + gb.checked + ' fixture(s) content-addressed reproducible' + (gb.absent ? ' (' + gb.absent + ' skipped)' : ''), C.green));
  else if (gb.checked === 0 && gb.absent > 0)
    console.log(paint('  \u2218 GATE B skipped — uploads/ not served (gitignored); browser verify-provenance.html is the authoritative GATE-B surface', C.yellow));

  if (!g.ok || gb.fail > 0) {
    const why = [];
    if (g.fail) why.push(g.fail + ' bundle(s) drifted/missing (GATE A)');
    if (g.missing) why.push(g.missing + ' bundle(s) with no committed manifestHash');
    if (!g.complete) why.push('manifest incomplete (' + g.checked + '/' + BUNDLES.length + ')');
    if (gb.fail) why.push(gb.fail + ' fixture(s) drifted (GATE B: code/input/output content hash)');
    return die(
      1,
      'PROVENANCE GATE FAILED — ' +
        (why.join(', ') || 'see above') +
        '.\n  GATE A fix: re-bundle the drifted app(s) and hand-update BUILD-MANIFEST.json with the new manifestHash.\n' +
        '  GATE B fix: re-run the producing app on its committed inputs + re-export (never hand-edit), then re-record the\n' +
        '  fixture (manifestHash + inputHashes + outputHash) in FIXTURE-PROVENANCE.json.'
    );
  }
  console.log(
    '\n' + paint('\u2713 PROVENANCE PASS — GATE A all ' + g.checked + ' bundles match; GATE B ' + gb.checked + ' fixture(s) reproducible' + (gb.absent ? ' (' + gb.absent + ' skipped)' : ''), C.green)
  );
  process.exit(0);
}

main().catch((e) => die(2, 'unexpected: ' + ((e && e.stack) || e)));

#!/usr/bin/env node
/*
 * tools/verify-fixtures.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE ONLY TOOL ALLOWED TO WRITE `verifiedUnder` (FIXTURE-VERIFICATION-GATE-2026-07-14 §2).
 *
 * WHY IT EXISTS. `build.mjs` re-stamps a fixture's `manifestHash` whenever the bundle moves. That
 * re-stamp silently upgrades "this output CAME FROM code X" into "this output IS REPRODUCIBLE under
 * code Y" — an assertion nobody tested. On 2026-07-14 that fabricated claim shipped a pre-fix GlucoDex
 * DSP to real users: the leg that would have caught it (the real-recording equiv leg) SKIPS wherever
 * uploads/ is absent, GATE B is static and never re-runs the app, and every gate stayed green.
 *
 * So the reproducibility claim moves OUT of `manifestHash` and into `verifiedUnder`, which only a tool
 * that ACTUALLY RE-RAN THE APP may write. That tool is this one. `build.mjs` must never touch it
 * (gate-asserted: a source scan proves the string does not appear in build.mjs).
 *
 * WHAT IT VERIFIES. A fixture is VERIFIED iff `verifiedUnder === computeHash(its bundle)` —
 * computeHash being manifestHash's projection over the export's COMPUTE CLOSURE (manifest-gate.js §1),
 * so a render/CSS edit does NOT expire a verification and a DSP edit DOES.
 *
 * HOW IT VERIFIES — no per-leg plumbing, no re-implemented parsers:
 *   1. every corpus INPUT the ledger names must be present (else we cannot verify — ABORT, never stamp);
 *   2. run the REAL suite (`tests/run-tests.mjs`), which already re-runs every code-gated fixture
 *      through its own dynamic leg — a fact the `fixture-reproducibility` group itself gates
 *      ("every code-gated fixture has a dynamic leg that re-runs it");
 *   3. a fully GREEN run ⇒ every leg reproduced its fixture under the current code ⇒ stamp.
 *      A single failure ⇒ stamp NOTHING and say which. Partial credit is how false claims are born.
 *
 *   node tools/verify-fixtures.mjs            # verify + stamp verifiedUnder
 *   node tools/verify-fixtures.mjs --check    # report UNVERIFIED fixtures, write nothing (CI-safe)
 *
 * WHERE IT LOOKS. The corpus is 435 gitignored recordings; a worktree gets the tracked fifth and none
 * of them, so this searches $DEX_UPLOADS → the PRIMARY checkout's uploads/ → this checkout's, and
 * prints the search on refusal. docs/CORPUS-LOCATIONS.md lists the four places the data actually is.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import { corpusSearch, formatCorpusSearch } from './regen-goldens-core.mjs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ManifestGate = createRequire(import.meta.url)(path.join(REPO, 'manifest-gate.js'));
const CHECK = process.argv.includes('--check');
// P3 — fixtures live as per-app provenance/<App>.json fragments; verify-fixtures reads them directly
// (keeping the fragment objects as write targets) and only rewrites the fragment(s) it stamps.
const PROV_DIR = path.join(REPO, 'provenance');
// ONE resolver, shared with the regen family so the two halves of the fixture workflow cannot look
// in different places again (REGEN-CORPUS-PATH-FOLLOWUPS §3.1). It SEARCHES rather than assuming —
// the worktree CLAUDE.md §👥.1 mandates holds only the tracked fifth of `uploads/`, so the corpus this
// tool needs lives in the primary checkout (FIXTURE-CORPUS-REACHABILITY §1). Every candidate and its
// verdict is kept so a refusal can SHOW the search instead of asserting an absence.
const SEARCH = corpusSearch(REPO);
const UPLOADS = SEARCH.dir;

const C = { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', yellow: '\x1b[33m', reset: '\x1b[0m' };
const paint = (s, c) => (process.stdout.isTTY ? c + s + C.reset : s);

/* ── which fixtures owe a `verifiedUnder` ───────────────────────────────────────────────────
   A fixture whose inputs are ALL git-tracked is re-run from committed bytes on every CI push, so it
   cannot go stale unnoticed — exempt. Everything else (a gitignored recording, or a fixture generated
   from code with no input file) is only ever re-run where the corpus lives, so its claim needs a
   recorded verification. Fail CLOSED: anything we cannot prove is CI-re-runnable owes a stamp. */
function trackedUploads() {
  try {
    return new Set(
      execFileSync('git', ['ls-files', 'uploads'], { cwd: REPO, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
        .map((p) => p.replace(/^uploads\//, ''))
    );
  } catch {
    return null; // no git (tarball) — cannot classify; treat every fixture as owing a stamp
  }
}

function needsVerification(rec, tracked) {
  if (!rec || rec.historical || !rec.manifestHash) return false; // not a code claim
  const ins = rec.inputs || [];
  if (!tracked) return true;
  return !(ins.length > 0 && ins.every((f) => tracked.has(f)));
}

const _apps = JSON.parse(fs.readFileSync(path.join(PROV_DIR, 'index.json'), 'utf8')).apps;
const _frags = {}; // app -> fragment object (the write target)
const _fixtureApp = {}; // fixture name -> owning app (for targeted write-back)
const fixtures = {}; // fixture name -> record (a live reference into _frags[app].fixtures)
for (const app of _apps) {
  const fr = JSON.parse(fs.readFileSync(path.join(PROV_DIR, app + '.json'), 'utf8'));
  _frags[app] = fr;
  for (const name of Object.keys(fr.fixtures || {})) {
    fixtures[name] = fr.fixtures[name];
    _fixtureApp[name] = app;
  }
}
const tracked = trackedUploads();
const owing = Object.keys(fixtures).filter((k) => k[0] !== '_' && needsVerification(fixtures[k], tracked));

/* ── computeHash per bundle (the code identity a verification is pinned to) ── */
const computeHashes = {};
for (const k of owing) {
  const b = fixtures[k].bundle;
  if (b && !(b in computeHashes)) {
    const p = path.join(REPO, b);
    computeHashes[b] = fs.existsSync(p) ? await ManifestGate.computeHashFromText(fs.readFileSync(p, 'utf8')) : null;
  }
}

/* ── FIRST-GENERATION SET (the bootstrap exemption's ONLY input) ──────────────────────────────
   A brand-new code-gated fixture is unstamped by definition, and dex-tests' §3.1 fails closed on
   exactly that. But this tool refuses to stamp anything while the suite is red — so the stamp needs
   a green suite and the suite needs the stamp. Measured 2026-09-02 standing up the apnea-null twins
   (DEEP-AUDIT-VI-FOLLOWUPS §4.3): 8995 assertions, ONE failing, and it named the very fixture the
   run existed to stamp. No new `inputs: []` fixture had been added since §3.1 landed 2026-07-14, so
   the path had never been walked. Same class as the gap `newRecord` closed for the ledger RECORD.

   WHY NOT A `--bootstrap <fixture>` FLAG (considered and rejected): a flag is an OPERATOR CLAIM —
   it asserts "this one is new, trust me" — and the failure mode of this whole tool is exactly a
   claim nobody checked. The run already holds the evidence: which fixtures owe a stamp and have
   none is derivable here, before the suite runs. So the exemption is DERIVED, never asserted, and
   it cannot be pointed at a fixture that already had a stamp. */
const firstStamp = owing.filter((k) => !fixtures[k].verifiedUnder);
/* The §3.1 assertion label this tool matches on. It is asserted EQUAL to dex-tests.js's own label by
   the `fixture-verification` gate: a rename there would otherwise silently widen this exemption (or,
   worse, quietly re-close the deadlock) with nobody seeing why. */
const S31_LABEL = '§3.1 · every corpus-backed fixture carries a verifiedUnder';

/* The exemption as a PURE function of (failing lines, first-generation set) — extracted so the
   decision can be driven by `--selftest` over adversarial inputs instead of only by a >10-min corpus
   lap that reaches it once. Returns true ONLY when every failing assertion is §3.1 and every fixture
   it names is one this run would be minting a first stamp for. */
export function bootstrapExempt(failLines, firstStamp) {
  const only31 = failLines.length > 0 && failLines.every((l) => l.includes(S31_LABEL));
  const named = [];
  for (const l of failLines) {
    const m = l.match(/got \[([^\]]*)\]/);
    if (m) for (const q of m[1].split(',')) { const n = q.trim().replace(/^["']|["']$/g, ''); if (n) named.push(n); }
  }
  const allFirst = named.length > 0 && named.every((n) => firstStamp.includes(n));
  return { exempt: only31 && allFirst, named };
}

/* SELFTEST — runs under `npm run check` via tools/selftest-all.mjs, so the refusal is exercised on
   every gate rather than on the rare day someone adds a fixture. Placed before any corpus work so it
   needs neither the corpus nor the ledger. */
if (process.argv.includes('--selftest')) {
  const L = (names) => `  ✕ ${S31_LABEL} (a claim nothing in CI can re-run must record what DID)  — got [${names.map((n) => '"' + n + '"').join(',')}] · want []`;
  const OTHER = '  ✕ [GlucoDex equiv] compute() ≡ committed export  — 3 fields differ';
  const NEW = ['integrator_apnea_null_twins.node-export.json'];
  const cases = [
    ['§3.1 alone, naming a first-generation fixture → the real bootstrap', [L(NEW)], NEW, true],
    ['a SECOND failing assertion beside §3.1', [L(NEW), OTHER], NEW, false],
    ['§3.1 naming a fixture that ALREADY carried a stamp', [L(['glucodex_clean_golden.node-export.json'])], NEW, false],
    ['§3.1 naming one new AND one already-stamped', [L([NEW[0], 'oxydex_1056.node-export.json'])], NEW, false],
    ['a moved fixture and no §3.1 at all', [OTHER], NEW, false],
    ['an EMPTY failure set must not stamp', [], NEW, false]
  ];
  let bad = 0;
  for (const [name, lines, fs2, want] of cases) {
    const got = bootstrapExempt(lines, fs2).exempt;
    if (got !== want) bad++;
    console.log(`  ${got === want ? '✓' : '✗'} ${String(got).padEnd(5)} (want ${String(want).padEnd(5)})  ${name}`);
  }
  console.log(bad ? `selftest: ${cases.length - bad} ok, ${bad} failed` : `selftest: ${cases.length} ok, 0 failed`);
  process.exit(bad ? 1 : 0);
}

const stale = owing.filter((k) => {
  const ch = computeHashes[fixtures[k].bundle];
  return !ch || fixtures[k].verifiedUnder !== ch;
});

if (CHECK) {
  console.log(`▸ fixture verification — ${owing.length} corpus-backed fixture(s) owe a verifiedUnder`);
  for (const k of owing) {
    const ch = computeHashes[fixtures[k].bundle];
    const ok = ch && fixtures[k].verifiedUnder === ch;
    console.log(
      ok
        ? paint('  ✓', C.green) + ' ' + k + paint('  verified under ' + ch, C.dim)
        : paint('  ✕', C.red) + ' ' + k + paint('  UNVERIFIED — verifiedUnder=' + (fixtures[k].verifiedUnder || '(none)') + ' but the compute closure is now ' + ch, C.yellow)
    );
  }
  if (stale.length) {
    console.error(
      paint(`\n✕ ${stale.length} fixture(s) UNVERIFIED under the current compute closure.`, C.red) +
        '\n  Their producing code changed and NOTHING has re-run them since. Fix:\n' +
        '    node tools/verify-fixtures.mjs\n' +
        '  (it searches for the corpus itself, including the primary checkout when you are in a worktree;\n' +
        '   DEX_UPLOADS=<corpus> overrides — see docs/CORPUS-LOCATIONS.md)\n' +
        '  (or, if the change genuinely moved an export, regenerate first: tools/regen-<node>-goldens.mjs)'
    );
    process.exit(1);
  }
  console.log(paint('✓ every corpus-backed fixture is verified under the current compute closure', C.green));
  process.exit(0);
}

/* ── STAMP MODE — verify for real, then record ────────────────────────────────────────────── */

// 0 · say WHERE the corpus was found before reading a byte of it — an unstated path is how a
//     worktree run's "absent" got read as a fact about the machine (FIXTURE-CORPUS-REACHABILITY §2).
console.log('▸ corpus: ' + UPLOADS + paint(' (' + (SEARCH.candidates.find((c) => c.chosen) || {}).label + ')', C.dim));

// 1 · every named corpus input must be PRESENT. Absent ⇒ we cannot verify ⇒ we do not stamp.
const missing = [];
for (const k of owing) for (const f of fixtures[k].inputs || []) if (!fs.existsSync(path.join(UPLOADS, f))) missing.push(f);
if (missing.length) {
  console.error(
    paint('✕ cannot verify — ' + [...new Set(missing)].length + ' corpus input(s) absent:', C.red) +
      '\n  ' + [...new Set(missing)].slice(0, 6).join('\n  ') +
      '\n\n  These are gitignored personal recordings, so they are NOT in a fresh worktree: a worktree off\n' +
      '  origin/main gets only the tracked fifth of uploads/, and the corpus lives in the PRIMARY checkout.\n' +
      '  Searched, in order:\n' +
      formatCorpusSearch(SEARCH) +
      '\n\n  If none of those is your corpus, name it (docs/CORPUS-LOCATIONS.md lists the four it may be in):\n' +
      '    DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs\n' +
      '  Refusing to stamp: a verification you did not run is exactly the false claim this gate exists to abolish.'
  );
  process.exit(2);
}

// 2 · run the REAL suite. It re-runs every code-gated fixture through its own dynamic leg (the
//     `fixture-reproducibility` group gates that fact), so a green run IS the verification.
console.log('▸ re-running every fixture through the real suite (this is the verification) …');
try {
  execFileSync(process.execPath, [path.join(REPO, 'tests', 'run-tests.mjs')], {
    cwd: REPO,
    env: { ...process.env, DEX_UPLOADS: UPLOADS },
    /* stderr is INHERITED so the suite's progress reaches the operator. This tool runs the FULL
       suite — >10 min — against the real corpus, and it is what `release.mjs` refuses to cut
       without; capturing both streams meant it printed one line and then went silent for the whole
       run, which is precisely the blind wait the progress line exists to end. Only stdout is piped,
       and that is where the `✕` lines the failure parse reads are written. */
    stdio: ['ignore', 'pipe', 'inherit']
  });
} catch (e) {
  const out = String((e.stdout || '') + (e.stderr || ''));
  /* EVERY failing line, not a printed sample. The old code sliced to 8 for display and would have
     decided on that slice — the §4b family: a verdict read off a truncated view. Display is capped
     below; the DECISION reads all of them. */
  const failLines = out.split('\n').filter((l) => /^\s*✕/.test(l));
  /* The bootstrap exemption, derived. It applies ONLY when both hold:
       (a) every failing assertion is §3.1 itself, and
       (b) the fixtures §3.1 names are a SUBSET of the first-generation set computed above.
     A second failing assertion, a moved fixture, or a name that already carried a stamp all fail
     one of these and refuse exactly as before. */
  const { exempt, named } = bootstrapExempt(failLines, firstStamp);
  if (exempt) {
    /* LOUD, because an exemption invisible in the log is indistinguishable from a gate that did not
       run. The operator must be able to see what was excused and why, without reading this file. */
    console.log(
      paint('\n▸ BOOTSTRAP EXEMPTION APPLIED — §3.1 named exactly ' + named.length + ' first-generation fixture(s) this run stamps;', C.yellow) +
        paint('\n  every other assertion in the suite is GREEN. Excused: ' + named.join(', '), C.yellow) +
        paint('\n  (a first stamp cannot exist before the stamp — the exemption is derived from the ledger, never claimed by a flag.)', C.dim)
    );
  } else {
    console.error(paint('✕ the suite is RED — stamping NOTHING.', C.red));
    for (const l of failLines.slice(0, 8)) console.error('  ' + l.trim());
    if (failLines.length > 8) console.error(paint('  … and ' + (failLines.length - 8) + ' more (all were read; only the first 8 are shown)', C.dim));
    console.error(
      '\n  A fixture that does not reproduce is a live stale-fixture finding, not a stamping problem:\n' +
        '  regenerate it (tools/regen-<node>-goldens.mjs) and re-run this. Partial credit is how false claims are born.'
    );
    process.exit(1);
  }
}

// 3 · green ⇒ every leg reproduced its fixture under this exact code ⇒ record it.
let stamped = 0;
const _touchedApps = new Set();
for (const k of owing) {
  const ch = computeHashes[fixtures[k].bundle];
  if (!ch) {
    console.log(paint('  ⚠ ', C.yellow) + k + ' — bundle has no computeHash (not plain-inline?); NOT stamped');
    continue;
  }
  if (fixtures[k].verifiedUnder === ch) continue;
  fixtures[k].verifiedUnder = ch; // mutates the live fragment record
  _touchedApps.add(_fixtureApp[k]);
  stamped++;
  console.log(paint('  ↻ ', C.green) + k + paint('  verifiedUnder → ' + ch, C.dim));
}
if (stamped) for (const app of _touchedApps) fs.writeFileSync(path.join(PROV_DIR, app + '.json'), JSON.stringify(_frags[app], null, 2) + '\n');
console.log(paint(`\n✓ suite green — ${stamped} fixture(s) stamped, ${owing.length - stamped} already current`, C.green));

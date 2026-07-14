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
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ManifestGate = createRequire(import.meta.url)(path.join(REPO, 'manifest-gate.js'));
const CHECK = process.argv.includes('--check');
const FP_PATH = path.join(REPO, 'FIXTURE-PROVENANCE.json');
const UPLOADS = process.env.DEX_UPLOADS || path.join(REPO, 'uploads');

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

const fp = JSON.parse(fs.readFileSync(FP_PATH, 'utf8'));
const fixtures = fp.fixtures || {};
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
        '    DEX_UPLOADS=<corpus> node tools/verify-fixtures.mjs\n' +
        '  (or, if the change genuinely moved an export, regenerate first: tools/regen-<node>-goldens.mjs)'
    );
    process.exit(1);
  }
  console.log(paint('✓ every corpus-backed fixture is verified under the current compute closure', C.green));
  process.exit(0);
}

/* ── STAMP MODE — verify for real, then record ────────────────────────────────────────────── */

// 1 · every named corpus input must be PRESENT. Absent ⇒ we cannot verify ⇒ we do not stamp.
const missing = [];
for (const k of owing) for (const f of fixtures[k].inputs || []) if (!fs.existsSync(path.join(UPLOADS, f))) missing.push(f);
if (missing.length) {
  console.error(
    paint('✕ cannot verify — ' + [...new Set(missing)].length + ' corpus input(s) absent:', C.red) +
      '\n  ' + [...new Set(missing)].slice(0, 6).join('\n  ') +
      '\n\n  These are gitignored personal recordings. Point DEX_UPLOADS at the corpus:\n' +
      '    DEX_UPLOADS=/path/to/uploads node tools/verify-fixtures.mjs\n' +
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
    stdio: ['ignore', 'pipe', 'pipe']
  });
} catch (e) {
  const out = String((e.stdout || '') + (e.stderr || ''));
  const fails = out.split('\n').filter((l) => /^\s*✕/.test(l)).slice(0, 8);
  console.error(paint('✕ the suite is RED — stamping NOTHING.', C.red));
  for (const l of fails) console.error('  ' + l.trim());
  console.error(
    '\n  A fixture that does not reproduce is a live stale-fixture finding, not a stamping problem:\n' +
      '  regenerate it (tools/regen-<node>-goldens.mjs) and re-run this. Partial credit is how false claims are born.'
  );
  process.exit(1);
}

// 3 · green ⇒ every leg reproduced its fixture under this exact code ⇒ record it.
let stamped = 0;
for (const k of owing) {
  const ch = computeHashes[fixtures[k].bundle];
  if (!ch) {
    console.log(paint('  ⚠ ', C.yellow) + k + ' — bundle has no computeHash (not plain-inline?); NOT stamped');
    continue;
  }
  if (fixtures[k].verifiedUnder === ch) continue;
  fixtures[k].verifiedUnder = ch;
  stamped++;
  console.log(paint('  ↻ ', C.green) + k + paint('  verifiedUnder → ' + ch, C.dim));
}
if (stamped) fs.writeFileSync(FP_PATH, JSON.stringify(fp, null, 2) + '\n');
console.log(paint(`\n✓ suite green — ${stamped} fixture(s) stamped, ${owing.length - stamped} already current`, C.green));

#!/usr/bin/env node
/*
 * tests/check-dex.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 */
/* ════════════════════════════════════════════════════════════════════════
   tests/check-dex.mjs — the "did I break ONE dex?" one-liner (SECTION-SCOPED-RUNS 2026-07-01, #2)
   ────────────────────────────────────────────────────────────────────────
   A thin, zero-dependency wrapper that runs the TWO fast pure-Node gate lanes SCOPED to one dex:
       node tests/check-dex.mjs oxydex
       node tests/check-dex.mjs oxydex,pulsedex        (comma = OR — same grammar as the filters)
   It spawns, in order:
     1. `node tests/run-tests.mjs   --group=<f>`   → the shared behavior assertions for matching groups
     2. `node tests/verify-manifest.mjs --bundle=<f>` → GATE A + GATE B scoped to matching bundle(s)
   and reports a combined verdict. Exit 0 iff BOTH scoped lanes passed.

   This is deliberately the HEADLESS pair only — it does NOT boot the browser render-coverage rigs
   (that lives in Dex-Test-Suite.html?full&group=<f>) and it is NOT a substitute for the full,
   UNFILTERED merge gate. It is the tight inner-loop check you run WHILE iterating on a single
   *-dsp.js / registry, before the full sweep. It prints a FILTERED reminder so a scoped green is
   never mistaken for the canonical pass. A filter matching nothing is a hard error in each lane
   (they exit 2), which this wrapper surfaces as a failure — a check that checks nothing is not a pass.

   WHY A WRAPPER (not just two commands): one word, one exit code, one place that documents the
   canonical follow-up ("now run the full sweep + ?full render-coverage"). Pure orchestration —
   it owns NO gate logic; both lanes remain the single source for what they check.
   ════════════════════════════════════════════════════════════════════════ */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
const paint = (s, c) => (process.stdout.isTTY ? c + s + C.reset : s);

// The dex filter: first non-flag arg, or --group=/--bundle=, or the DEX_GROUP/DEX_BUNDLE env var.
const FILTER = (() => {
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const m = a[i].match(/^--?(?:group|bundle|only|g|b)=(.+)$/i);
    if (m) return m[1];
    if (/^--?(?:group|bundle|only|g|b)$/i.test(a[i]) && a[i + 1]) {
      return a[i + 1];
    }
    if (!a[i].startsWith('-')) return a[i];
  }
  return process.env.DEX_GROUP || process.env.DEX_BUNDLE || '';
})();

if (!FILTER) {
  console.error(paint('✕ usage: node tests/check-dex.mjs <dex>   e.g. oxydex   (comma = OR: oxydex,pulsedex)', C.red));
  console.error(paint('  runs the two scoped headless lanes (run-tests --group + verify-manifest --bundle).', C.dim));
  console.error(paint('  for the FULL gate run each lane unfiltered + Dex-Test-Suite.html?full for render-coverage.', C.dim));
  process.exit(2);
}

function run(label, file, arg) {
  return new Promise((resolve) => {
    console.log('\n' + paint('▸ ' + label, C.cyan) + paint('  node tests/' + file + ' ' + arg, C.dim));
    const child = spawn(process.execPath, [join(__dirname, file), arg], { stdio: 'inherit' });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', (e) => {
      console.error(paint('  ✕ failed to spawn ' + file + ': ' + e.message, C.red));
      resolve(false);
    });
  });
}

(async () => {
  console.log(paint('Tepna check-dex', C.bold) + paint('  — scoped headless gates for "' + FILTER + '"', C.dim));
  const behavior = await run('BEHAVIOR — shared assertions (scoped)', 'run-tests.mjs', '--group=' + FILTER);
  const provenance = await run('PROVENANCE — GATE A + GATE B (scoped)', 'verify-manifest.mjs', '--bundle=' + FILTER);

  const ok = behavior && provenance;
  console.log('\n' + paint('══════════════════════════════════════════', C.dim));
  console.log(
    (ok ? paint('✓ SCOPED GREEN', C.green) : paint('✕ SCOPED FAIL', C.red)) +
      '  behavior ' +
      (behavior ? paint('✓', C.green) : paint('✕', C.red)) +
      '  ·  provenance ' +
      (provenance ? paint('✓', C.green) : paint('✕', C.red)) +
      paint('  [FILTERED: ' + FILTER + ' — NOT the full gate]', C.yellow)
  );
  if (ok) console.log(paint('  next: full sweep = `node tests/run-tests.mjs` + `node tests/verify-manifest.mjs` (both UNFILTERED),', C.dim));
  if (ok) console.log(paint('        plus Dex-Test-Suite.html?full for browser render-coverage.', C.dim));
  process.exit(ok ? 0 : 1);
})();

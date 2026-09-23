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
import { aggregateChildren, makeVerdict, Verdict } from '../tools/verdict-emit.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ── VERDICT-CONTRACT §3d — a runner over TWO lanes, filtered by construction ────────────────────
   Children = the two scoped lanes. Under --json each lane runs with --json and its OWN object is read
   (run-tests' rides under `verdict` in its payload; verify-manifest's is the whole stdout), so the
   child's provenance is `object`; a lane that printed no valid object falls back to its exit code
   (`exit-code`: 0 ⇒ UNKNOWN by provenance, ≠ 0 ⇒ FAIL). The dex filter is the declared exclusion —
   check-dex is NEVER the gate, so the object is always filtered:true with the consumer rule. The
   exit code stays (0 iff both lanes exited 0). Pure builder + --selftest + --verdict-sample. */
export function checkDexVerdict(lanes, filter, { commit, commitReason, at } = {}) {
  const children = lanes.map((l) =>
    l.verdict && Verdict.validate(l.verdict).ok ? { name: l.name, provenance: 'object', status: l.verdict.status } : { name: l.name, provenance: 'exit-code', code: l.code == null ? 1 : l.code }
  );
  /* eligible counts the two lanes; the filter excludes the rest of each lane's population, which the
     lanes' own objects state — here it is declared as ONE exclusion so the count stays an equality. */
  const agg = aggregateChildren(children, { eligible: lanes.length + 1, declaredExcluded: ['every group and bundle outside the filter'], excludedBy: `--group=${filter}` });
  let { result } = agg;
  if (result) result = { ...result, filter, lanes: lanes.map((l) => ({ name: l.name, code: l.code, population: l.verdict ? l.verdict.population : null })) };
  return makeVerdict({
    gate: 'check-dex',
    status: agg.status,
    population: agg.population,
    criterion: {
      name: 'lanes_failing (run-tests --group and verify-manifest --bundle, each read from its own object; a scoped run is never the gate)',
      threshold: 0,
      unit: 'failing lanes',
      direction: 'eq'
    },
    result,
    evidence: ['tests/run-tests.mjs', 'tests/verify-manifest.mjs'],
    reason: agg.reason,
    tool: 'tests/check-dex.mjs',
    commit,
    commitReason,
    at
  });
}

export function verdictSample() {
  const AT = { commit: null, commitReason: '--verdict-sample: two scratch lane objects, nothing run, no code identity claimed', at: '2026-09-22T00:00:00Z' };
  const lane = (gate, checked, eligible) =>
    makeVerdict({
      gate,
      status: 'PASS',
      population: { checked, eligible, excluded: eligible - checked },
      criterion: { name: 'x', threshold: 0, unit: '', direction: 'eq' },
      result: { filtered: true, excludedBy: '--group=scratch' },
      evidence: ['e'],
      reason: null,
      tool: 't',
      ...AT
    });
  return checkDexVerdict(
    [
      { name: 'run-tests --group=scratch', code: 0, verdict: lane('run-tests', 3, 640) },
      { name: 'verify-manifest --bundle=scratch', code: 0, verdict: lane('verify-manifest', 6, 48) }
    ],
    'scratch',
    AT
  );
}

function selftest() {
  let n = 0;
  const eq = (a, b, msg) => {
    n++;
    if (a !== b) {
      console.log(`✗ ${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
      process.exit(1);
    }
    console.log(`✓ ${msg}`);
  };
  const AT = { commit: null, commitReason: 'selftest', at: '2026-09-22T00:00:00Z' };
  const V = (status) =>
    makeVerdict({
      gate: 'g',
      status,
      population: { checked: 1, eligible: 2, excluded: 1 },
      criterion: { name: 'x', threshold: 0, unit: '', direction: 'eq' },
      result: status === 'NOT_RUN' ? null : { filtered: true },
      evidence: ['e'],
      reason: status === 'PASS' ? null : 'planted',
      tool: 't',
      ...AT
    });
  const both = checkDexVerdict(
    [
      { name: 'a', code: 0, verdict: V('PASS') },
      { name: 'b', code: 0, verdict: V('PASS') }
    ],
    'oxydex',
    AT
  );
  eq(both.status, 'PASS', '§3d · both lane objects PASS ⇒ PASS');
  eq(
    both.result.filtered === true && both.result.excludedBy === '--group=oxydex' && /NOT the gate/.test(both.result.consumerRule),
    true,
    '§3d · …always filtered, with the consumer rule — check-dex is never the gate'
  );
  eq(JSON.stringify(both.population), JSON.stringify({ checked: 2, eligible: 3, excluded: 1 }), '§3d · population = the two lanes + the declared exclusion');
  eq(
    checkDexVerdict(
      [
        { name: 'a', code: 0, verdict: V('PASS') },
        { name: 'b', code: 1, verdict: V('FAIL') }
      ],
      'x',
      AT
    ).status,
    'FAIL',
    '§3d plant · a FAIL lane object ⇒ FAIL'
  );
  const exitOnly = checkDexVerdict(
    [
      { name: 'a', code: 0, verdict: null },
      { name: 'b', code: 0, verdict: V('PASS') }
    ],
    'x',
    AT
  );
  eq(exitOnly.status === 'UNKNOWN' && exitOnly.result.exitCodeOnly === 1, true, '§3d plant · a lane with no object is exit-code only ⇒ UNKNOWN by provenance');
  eq(
    checkDexVerdict(
      [
        { name: 'a', code: 2, verdict: null },
        { name: 'b', code: 0, verdict: V('PASS') }
      ],
      'x',
      AT
    ).status,
    'FAIL',
    '§3d plant · a lane that exited 2 with no object ⇒ FAIL (a red exit is never made greener)'
  );
  eq(
    checkDexVerdict(
      [
        { name: 'a', code: 0, verdict: { schema: 'tepna.verdict/1', status: 'PASSED' } },
        { name: 'b', code: 0, verdict: V('PASS') }
      ],
      'x',
      AT
    ).status,
    'UNKNOWN',
    '§3d plant · an INVALID lane object counts as no object'
  );
  eq(
    verdictSample().status === 'PASS' && verdictSample().result.filtered === true && verdictSample().producedBy.commit === null,
    true,
    '§3d · --verdict-sample: a filtered PASS over two scratch lanes, no commit'
  );
  console.log(`all ${n} selftests passed`);
}

const ARGV = process.argv.slice(2);
if (ARGV.includes('--selftest')) {
  selftest();
  process.exit(0);
}
if (ARGV.includes('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample()));
  process.exit(0);
}
const JSON_OUT = ARGV.includes('--json');

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m', yellow: '\x1b[33m', cyan: '\x1b[36m' };
const paint = (s, c) => (process.stdout.isTTY ? c + s + C.reset : s);
const out = (...a) => (JSON_OUT ? console.error(...a) : console.log(...a)); // --json: stdout carries ONE object

// The dex filter: first non-flag arg, or --group=/--bundle=, or the DEX_GROUP/DEX_BUNDLE env var.
const FILTER = (() => {
  const a = ARGV;
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
  console.error(paint('✕ usage: node tests/check-dex.mjs <dex> [--json]   e.g. oxydex   (comma = OR: oxydex,pulsedex)', C.red));
  console.error(paint('  runs the two scoped headless lanes (run-tests --group + verify-manifest --bundle).', C.dim));
  console.error(paint('  for the FULL gate run each lane unfiltered + Dex-Test-Suite.html?full for render-coverage.', C.dim));
  process.exit(2);
}

/* Each lane is run with --json when this runner is, its object read off stdout (run-tests wraps it
   under `verdict`) and its report forwarded to stderr; without --json the lanes inherit stdio as before. */
function run(label, file, arg, key) {
  return new Promise((resolve) => {
    out('\n' + paint('▸ ' + label, C.cyan) + paint('  node tests/' + file + ' ' + arg, C.dim));
    const args = [join(__dirname, file), arg, ...(JSON_OUT ? ['--json'] : [])];
    const child = spawn(process.execPath, args, { stdio: JSON_OUT ? ['inherit', 'pipe', 'inherit'] : 'inherit' });
    let stdout = '';
    if (JSON_OUT) child.stdout.on('data', (d) => (stdout += d));
    const name = `${file.replace('.mjs', '')} ${arg}`;
    child.on('close', (code) => {
      let verdict = null;
      if (JSON_OUT) {
        try {
          const j = JSON.parse(stdout.slice(stdout.indexOf('{')));
          verdict = key ? j[key] : j;
        } catch (_) {
          verdict = null;
        }
      }
      resolve({ name, ok: code === 0, code, verdict });
    });
    child.on('error', (e) => {
      console.error(paint('  ✕ failed to spawn ' + file + ': ' + e.message, C.red));
      resolve({ name, ok: false, code: null, verdict: null });
    });
  });
}

(async () => {
  out(paint('Tepna check-dex', C.bold) + paint('  — scoped headless gates for "' + FILTER + '"', C.dim));
  const bLane = await run('BEHAVIOR — shared assertions (scoped)', 'run-tests.mjs', '--group=' + FILTER, 'verdict');
  const pLane = await run('PROVENANCE — GATE A + GATE B (scoped)', 'verify-manifest.mjs', '--bundle=' + FILTER, null);
  const behavior = bLane.ok;
  const provenance = pLane.ok;

  const ok = behavior && provenance;
  const verdict = checkDexVerdict([bLane, pLane], FILTER);
  out('\n' + paint('══════════════════════════════════════════', C.dim));
  out(
    (ok ? paint('✓ SCOPED GREEN', C.green) : paint('✕ SCOPED FAIL', C.red)) +
      '  behavior ' +
      (behavior ? paint('✓', C.green) : paint('✕', C.red)) +
      '  ·  provenance ' +
      (provenance ? paint('✓', C.green) : paint('✕', C.red)) +
      paint('  [FILTERED: ' + FILTER + ' — NOT the full gate]', C.yellow)
  );
  if (JSON_OUT) console.log(JSON.stringify(verdict));
  else
    out(
      paint(
        `  tepna.verdict/1: ${verdict.status}  ·  ${verdict.population.checked} checked / ${verdict.population.eligible} eligible / ${verdict.population.excluded} excluded  ·  FILTERED (${verdict.result ? verdict.result.excludedBy : ''}) — not the gate`,
        verdict.status === 'PASS' ? C.green : verdict.status === 'FAIL' ? C.red : C.yellow
      )
    );
  if (ok) out(paint('  next: full sweep = `node tests/run-tests.mjs` + `node tests/verify-manifest.mjs` (both UNFILTERED),', C.dim));
  if (ok) out(paint('        plus Dex-Test-Suite.html?full for browser render-coverage.', C.dim));
  /* THE EXIT CODE STAYS — 0 iff both lanes exited 0 (§3d). */
  process.exit(ok ? 0 : 1);
})();

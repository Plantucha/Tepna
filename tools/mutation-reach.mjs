#!/usr/bin/env node
/*
 * tools/mutation-reach.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * REACHED vs ASSERTED — the two halves of a survivor, which the queue currently fuses.
 *
 * A mutant on a line NO test executes cannot be killed. Running it is guaranteed waste, and
 * reporting the result as "survived" fuses two findings that have OPPOSITE fixes:
 *
 *     UNREACHED   no test executes this line          -> write a test that reaches it
 *     UNASSERTED  tests execute it and do not notice  -> strengthen an assertion
 *
 * MUTATION-PROGRAM-FOLLOWUPS §4 established that the JS fleet's gap is assertion strength, not
 * coverage — Python at 100 % branch coverage kills 74.6 %, JS at 77.3 % kills 38.5 %, and a 23-point
 * coverage gap cannot explain a 36-point kill gap. That conclusion is about the FLEET. Per MUTANT it
 * is still unknown which of the two a given survivor is, and 5885 undifferentiated survivors is a
 * queue nobody can plan against. This tool splits it.
 *
 * PRIOR ART. Suppressing mutants on lines without statement coverage is one of the three levers that
 * made mutation analysis tractable across Google's ~2 billion-line repository, alongside diff-scoping
 * (which `.github/workflows/mutation.yml` already does) and "arid line" suppression (which nothing
 * here does yet).
 *   Petrović, G. & Ivanković, M. (2018). "State of Mutation Testing at Google."
 *   ICSE-SEIP '18, pp. 163–171. doi:10.1145/3183519.3183521
 *
 * ⚠️ THIS IS A SKIP LIST, SO IT MUST FAIL CLOSED. Every failure mode — coverage absent, a file not
 * in the report, a path that does not resolve, a malformed record — resolves to REACHED, i.e. "run
 * the mutant". A skip list that fails OPEN quietly stops testing code and reports the silence as
 * progress, which is this repo's central anxiety (CLAUDE.md §🔒, the computeHash denylist, decided
 * for exactly this reason: "an allowlist that forgets a module fails OPEN — the gate goes blind").
 * Over-running mutants costs time. Under-running them costs the programme its meaning.
 *
 * ⚠️ AND IT IS AGGREGATE, NOT PER-TEST. c8 here runs the WHOLE suite (`npm run coverage`), so this
 * answers "does ANY test execute this line", never "which test". That is enough to skip the
 * unreachable, and NOT enough for test SELECTION (FOLLOWUPS §6's 10–100×) nor for soundly reusing a
 * SURVIVED verdict across sweeps (`tools/mutate.mjs` §INCREMENTAL SWEEPS is explicit that this needs
 * per-test coverage). Do not read this file as if it provided either.
 *
 * USAGE
 *   node tools/mutation-reach.mjs --cov <coverage-final.json>              # fleet summary
 *   node tools/mutation-reach.mjs --cov C --file ppgdex-dsp.js            # one file
 *   node tools/mutation-reach.mjs --cov C --sweep S --file F              # split that file's survivors
 *   node tools/mutation-reach.mjs --json
 *   node tools/mutation-reach.mjs --selftest
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const IS_MAIN = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/* The verdict vocabulary. `REACHED` is also the refusal value — see the fail-closed note above. */
export const REACHED = 'REACHED';
export const UNREACHED = 'UNREACHED';

/* ── coverage → executed line numbers ────────────────────────────────────────────────────────
   c8's `--reporter=json` emits Istanbul-shaped records: `statementMap` maps a statement id to
   `{start:{line},end:{line}}`, and `s` maps the same id to an execution COUNT. A line counts as
   executed if any statement overlapping it ran at least once.

   Both `branchMap`/`b` and `fnMap`/`f` are deliberately IGNORED. A branch that was never taken still
   sits on a line the interpreter reached, and a mutant there IS reachable by an existing test — that
   is precisely an UNASSERTED mutant, and treating it as unreachable would skip the most interesting
   population in the file. Statement coverage is the correct (and Google's) criterion here. */
export function executedLines(covRecord) {
  const out = new Set();
  if (!covRecord || typeof covRecord !== 'object') return out;
  const sm = covRecord.statementMap,
    s = covRecord.s;
  if (!sm || !s) return out;
  for (const id of Object.keys(sm)) {
    const n = s[id];
    if (!(typeof n === 'number' && n > 0)) continue;
    const rec = sm[id];
    const a = rec && rec.start && rec.start.line,
      b = rec && rec.end && rec.end.line;
    if (!Number.isFinite(a)) continue;
    const hi = Number.isFinite(b) && b >= a ? b : a;
    for (let ln = a; ln <= hi; ln++) out.add(ln);
  }
  return out;
}

/* Match a coverage key to a source file by BASENAME. c8 keys are absolute and this repo loads DSPs
   through `vm.runInContext` with a filename that has been both relative and absolute across the
   programme's life (FOLLOWUPS §4: a relative one made c8 report 499 statements instead of 56 800).
   Basename is the one form that survives both. Ambiguity is treated as NOT FOUND, which fails closed:
   two files sharing a basename would otherwise silently answer for each other. */
export function findRecord(cov, file) {
  if (!cov || typeof cov !== 'object') return null;
  const want = basename(String(file || ''));
  if (!want) return null;
  const hits = Object.keys(cov).filter((k) => basename(k) === want);
  return hits.length === 1 ? cov[hits[0]] : null;
}

/* THE DECISION, isolated and pure so it can be gated without a coverage run.
   `null`/absent coverage ⇒ REACHED. See the fail-closed note in the header. */
export function verdictFor(executed, line) {
  if (!(executed instanceof Set) || executed.size === 0) return REACHED;
  if (!Number.isFinite(line)) return REACHED;
  return executed.has(line) ? REACHED : UNREACHED;
}

/* Split a sweep's survivors. Returns counts plus the unreached lines, so a caller can report
   "these N mutants were never worth running" rather than silently dropping them. */
export function partitionSurvivors(survivors, executed) {
  const unreached = [],
    unasserted = [];
  for (const m of survivors || []) {
    const ln = Number(m && m.line);
    (verdictFor(executed, ln) === UNREACHED ? unreached : unasserted).push(m);
  }
  return { unreached, unasserted };
}

// ── selftest ────────────────────────────────────────────────────────────────────────────────
if (IS_MAIN && has('--selftest')) {
  let pass = 0,
    fail = 0;
  const ok = (n, c, d) => {
    if (c) {
      pass++;
      console.log('  ✓ ' + n + (d ? '  — ' + d : ''));
    } else {
      fail++;
      console.log('  ✗ ' + n + (d ? '  — ' + d : ''));
    }
  };

  const REC = {
    statementMap: { 0: { start: { line: 10 }, end: { line: 10 } }, 1: { start: { line: 20 }, end: { line: 22 } }, 2: { start: { line: 40 }, end: { line: 40 } } },
    s: { 0: 3, 1: 1, 2: 0 }
  };
  const ex = executedLines(REC);
  ok('an executed single-line statement is reached', ex.has(10));
  ok('a MULTI-line statement marks every line it spans', ex.has(20) && ex.has(21) && ex.has(22), [...ex].join(','));
  ok('a zero-count statement is NOT reached', !ex.has(40));
  ok('a line with no statement at all is not reached', !ex.has(99));

  /* The fail-closed property, stated four ways. Each of these inputs is a FAILURE of the coverage
     lookup, and each must answer "run the mutant" rather than "skip it". */
  ok('absent coverage ⇒ REACHED (never skip)', verdictFor(new Set(), 10) === REACHED);
  ok('a non-Set ⇒ REACHED', verdictFor(null, 10) === REACHED);
  ok('a non-finite line ⇒ REACHED', verdictFor(ex, NaN) === REACHED);
  ok('a malformed record yields an EMPTY set, not a crash', executedLines({ statementMap: null, s: null }).size === 0);
  ok('…and an empty set then reads as REACHED for every line', verdictFor(executedLines({}), 12345) === REACHED);

  /* Ambiguity must not resolve. Two files sharing a basename answering for each other would skip
     mutants using the wrong file's coverage — a wrong skip, which is the unrecoverable direction. */
  ok('a unique basename resolves', findRecord({ '/a/b/ppgdex-dsp.js': REC }, 'ppgdex-dsp.js') === REC);
  ok('an AMBIGUOUS basename resolves to null (⇒ fails closed)', findRecord({ '/a/ppgdex-dsp.js': REC, '/b/ppgdex-dsp.js': REC }, 'ppgdex-dsp.js') === null);
  ok('an absent file resolves to null', findRecord({ '/a/other.js': REC }, 'ppgdex-dsp.js') === null);
  ok('…and null coverage does too', findRecord(null, 'ppgdex-dsp.js') === null);

  const P = partitionSurvivors([{ line: 10 }, { line: 21 }, { line: 40 }, { line: 99 }], ex);
  ok('survivors on executed lines are UNASSERTED', P.unasserted.length === 2, String(P.unasserted.length));
  ok('survivors on unexecuted lines are UNREACHED', P.unreached.length === 2, String(P.unreached.length));
  ok('the split loses nothing', P.unasserted.length + P.unreached.length === 4);
  ok('with NO coverage every survivor is UNASSERTED, not skipped', partitionSurvivors([{ line: 1 }, { line: 2 }], new Set()).unreached.length === 0);

  console.log('\n' + (fail ? `✗ ${fail} failed, ${pass} passed` : `✓ all ${pass} selftests passed`));
  process.exit(fail ? 1 : 0);
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────
if (IS_MAIN && !has('--selftest')) {
  const covPath = opt('--cov', '');
  if (!covPath || !existsSync(covPath)) {
    console.log('🔴 NO COVERAGE — pass --cov <coverage-final.json>.\n');
    console.log('   Generate it with:  npx -y c8@10.1.2 --reporter=json --report-dir=.cov node tests/run-tests.mjs');
    console.log('   Without it every line reads as REACHED, so nothing would be skipped — which is the');
    console.log('   safe direction, but it means this tool has nothing to say.');
    process.exit(2);
  }
  const cov = JSON.parse(readFileSync(covPath, 'utf8'));
  const only = opt('--file', '');
  const sweepPath = opt('--sweep', '');

  const FILES = only ? [only] : ['oxydex-dsp.js', 'ecgdex-dsp.js', 'integrator-dsp.js', 'ppgdex-dsp.js', 'glucodex-dsp.js', 'cpapdex-dsp.js', 'hrvdex-dsp.js', 'motiondex-dsp.js'];

  const rows = [];
  for (const f of FILES) {
    const rec = findRecord(cov, f);
    const ex = executedLines(rec);
    const srcPath = join(ROOT, f);
    const nLines = existsSync(srcPath) ? readFileSync(srcPath, 'utf8').split('\n').length : 0;
    rows.push({ file: f, resolved: !!rec, executed: ex.size, lines: nLines, set: ex });
  }

  if (sweepPath && only) {
    if (!existsSync(sweepPath)) {
      console.log(`🔴 sweep not found: ${sweepPath}`);
      process.exit(2);
    }
    const d = JSON.parse(readFileSync(sweepPath, 'utf8'));
    const r = rows[0];
    const P = partitionSurvivors(d.survivors || [], r.set);
    const tot = P.unreached.length + P.unasserted.length;
    if (has('--json')) {
      console.log(JSON.stringify({ file: only, coverageResolved: r.resolved, survivors: tot, unreached: P.unreached.length, unasserted: P.unasserted.length }, null, 2));
      process.exit(0);
    }
    console.log(`▸ ${only} — ${tot} survivors split\n`);
    if (!r.resolved) console.log('  ⚠ coverage did NOT resolve for this file — everything reads UNASSERTED (fail-closed).\n');
    const pct = tot ? ((100 * P.unreached.length) / tot).toFixed(1) : '0.0';
    console.log(`  UNREACHED   ${String(P.unreached.length).padStart(5)}  ${pct}%  no test executes the line — write a test that reaches it`);
    console.log(`  UNASSERTED  ${String(P.unasserted.length).padStart(5)}  ${(100 - +pct).toFixed(1)}%  tests run it and do not notice — strengthen an assertion\n`);
    console.log('  The UNREACHED mutants cannot be killed by the current suite, so running them in a');
    console.log('  sweep is measurable waste. They are still WORK — just a different kind.');
    process.exit(0);
  }

  if (has('--json')) {
    console.log(JSON.stringify({ files: rows.map(({ set, ...r }) => r) }, null, 2));
    process.exit(0);
  }
  console.log('▸ REACHABILITY BY FILE  (aggregate coverage — "any test", never "which test")\n');
  console.log('  file                   resolved   executed lines   of total');
  for (const r of rows) {
    const flag = r.resolved ? '  yes   ' : '  NO ⚠  ';
    console.log(`  ${r.file.padEnd(20)}  ${flag}  ${String(r.executed).padStart(10)}   ${String(r.lines).padStart(8)}`);
  }
  const unresolved = rows.filter((r) => !r.resolved);
  if (unresolved.length) {
    console.log(`\n  ⚠ ${unresolved.length} file(s) did not resolve in the coverage report. They FAIL CLOSED —`);
    console.log('    every line reads REACHED, so no mutant is skipped on their account.');
  }
}

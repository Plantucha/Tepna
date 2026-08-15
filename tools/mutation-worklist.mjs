#!/usr/bin/env node
/*
 * tools/mutation-worklist.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * THE RANKED REMAINING WORK — regenerated, never transcribed.
 *
 * The target is 99 % OF DISTINGUISHABLE (owner-ratified 2026-08-11, raised from 90 %). The arithmetic
 * of that number is the whole reason this tool exists:
 *
 *     at ANY kill/classify split, ~98.5 % of the outstanding survivors must be RESOLVED —
 *     killed if killable, classified if not. There is no ratio that avoids the work.
 *
 *         equivalents found    kills needed    survivors resolved
 *              0 %                5497            5497 / 5590   98.3 %
 *             30 %                3837            5514 / 5590   98.6 %
 *             60 %                2177            5531 / 5590   98.9 %
 *
 * So the work list is EVERY SURVIVOR, grouped by the function that holds it, ranked by count. A static
 * list of that goes stale the moment a test lands — and this programme has already been bitten twice
 * by transcribed numbers (the fleet map's sampled column; `mutate-equivalence.json` entries orphaned
 * by a line move). So it is computed from the sweeps and the ledger every time it is asked.
 *
 * WHAT IT IS NOT. A survivor count is a measure of SIZE, not of value or of difficulty. Measured
 * conversion rates on this fleet run 16 % (`cvhrFromNN`) to 88 % (`applySessionCorrections`), and the
 * most valuable capture-host find was the SMALLEST family in its module. Rank orders the queue; it
 * does not promise a return.
 *
 * USAGE
 *   node tools/mutation-worklist.mjs                 # the ranked list + the projection
 *   node tools/mutation-worklist.mjs --top 40
 *   node tools/mutation-worklist.mjs --file oxydex-dsp.js
 *   node tools/mutation-worklist.mjs --json          # machine-readable, for tracking progress
 *   node tools/mutation-worklist.mjs --sweep-dir D   # read sweeps from D (also: DEX_SWEEP_DIR)
 *   node tools/mutation-worklist.mjs --selftest
 *
 * SWEEPS LIVE IN `.mutation-sweeps/` (gitignored), NOT `/tmp` — a tmpfs loses them on reboot, and
 * this tool then reported a FINISHED queue rather than a lost one. It now EXITS 2 with `NO SWEEP
 * DATA` instead of printing `0/0 = NaN%`. Regenerate one with:
 *
 *     node tools/mutate.mjs --file ppgdex-dsp.js --json > .mutation-sweeps/ppgdex-dsp.json
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executedLines, findRecord, partitionSurvivors } from './mutation-reach.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const IS_MAIN = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/* Where each file's newest sweep lives. A sweep is a large JSON that is NOT committed (it is a
   measurement, not a source), so this resolves the agreed scratch paths. A missing sweep is
   reported, never silently skipped — an absent file must not read as "no work left".

   🔴 NOT `/tmp`, AND THAT IS THE WHOLE POINT OF THIS BLOCK. Until 2026-08-14 these were eight
   hard-coded `/tmp/*-sweep*.json` paths. `/tmp` is a tmpfs: a reboot wipes it. On 2026-08-14 a box
   restart destroyed all eight at once, and the failure presented as SUCCESS — the tool warned about
   the missing files, then printed

       ▸ FLEET  0/0 distinguishable = NaN%   0 survivors unresolved   target 99%
       0 functions hold 0 unresolved survivors.

   which reads as a finished queue rather than a lost one. The equivalence LEDGER survived (it is
   committed), so only the survivor inventory was lost — the cheap half to rebuild, but only if
   somebody notices it is gone. See §NO-SWEEP below for the refusal that now replaces `NaN%`.

   The paths were also DRIFTING: three of the eight carried ad-hoc suffixes (`-fresh`, `2`) accreted
   by whoever last re-swept that file, which is the usual sign that a hand-maintained path list has
   started to rot. A directory has no such failure mode — the name is derived, so it cannot drift.

   `.mutation-sweeps/` sits in the repo root and is gitignored, exactly as `.mutation-crawl/` already
   is. Override with `DEX_SWEEP_DIR` or `--sweep-dir` for a scratch volume elsewhere. */
export const SWEEP_FILES = ['oxydex-dsp.js', 'ecgdex-dsp.js', 'integrator-dsp.js', 'ppgdex-dsp.js', 'glucodex-dsp.js', 'cpapdex-dsp.js', 'hrvdex-dsp.js', 'motiondex-dsp.js'];

export function sweepDir() {
  const flag = opt('--sweep-dir', '');
  return flag || process.env.DEX_SWEEP_DIR || join(ROOT, '.mutation-sweeps');
}

/* Derived, never hand-written: `ppgdex-dsp.js` -> `<dir>/ppgdex-dsp.json`. */
export function sweepPathFor(file, dir) {
  return join(dir || sweepDir(), String(file).replace(/\.js$/, '') + '.json');
}

export function resolveSweeps(dir) {
  const d = dir || sweepDir();
  const out = {};
  for (const f of SWEEP_FILES) out[f] = sweepPathFor(f, d);
  return out;
}

/* Same shape as the old literal — `tools/killcheck.mjs` reads `SWEEPS[file]`. */
export const SWEEPS = resolveSweeps();

/* Innermost enclosing `function NAME(` for every line. Brace-counting rather than a parser: the same
   approach probe-equivalence uses, so a function this cannot see is invisible to BOTH and the two
   never disagree about what a range is. */
export function functionRanges(src) {
  const lines = String(src || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(?:^|[^\w$.])function\s+(\w+)\s*\(/);
    if (!m) continue;
    let depth = 0,
      seen = false;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') {
          depth++;
          seen = true;
        } else if (ch === '}') {
          depth--;
          if (seen && depth === 0) {
            out.push({ fn: m[1], start: i + 1, end: j + 1 });
            j = lines.length;
            break;
          }
        }
      }
      if (out.length && out[out.length - 1].start === i + 1) break;
    }
  }
  return out;
}

/* Attribute a line to the SMALLEST range containing it — a helper nested inside a big function is
   its own work item, not part of its parent's count. */
export function attribute(ranges, line) {
  let best = null;
  for (const r of ranges) {
    if (line < r.start || line > r.end) continue;
    if (!best || r.end - r.start < best.end - best.start) best = r;
  }
  return best ? best.fn : '(top level)';
}

/* The projection. PURE so the arithmetic behind the target is testable without a sweep. */
export function project(killed, distinguishable, survivors, targetPct, equivFrac) {
  const eqFound = survivors * equivFrac;
  const newDis = distinguishable - eqFound;
  const killsNeeded = Math.max(0, (targetPct / 100) * newDis - killed);
  return { eqFound, killsNeeded, resolved: killsNeeded + eqFound };
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
  const SRC = ['function outer(a) {', '  var x = 1;', '  function inner(b) {', '    return b;', '  }', '  return x;', '}', 'function other() { return 2; }'].join('\n');
  const R = functionRanges(SRC);
  ok('every declaration gets a range', R.length === 3, JSON.stringify(R.map((r) => r.fn)));
  ok('a line in the nested function attributes to the INNER one', attribute(R, 4) === 'inner', attribute(R, 4));
  ok('…and a sibling line attributes to the outer', attribute(R, 2) === 'outer', attribute(R, 2));
  ok('a line in no function is (top level)', attribute(R, 99) === '(top level)');
  ok('a one-line function is found', attribute(R, 8) === 'other', attribute(R, 8));

  /* The load-bearing arithmetic: at any equivalence rate the resolved count barely moves, which is
     the argument that 99 % means "resolve everything". */
  const a = project(3702, 9292, 5590, 99, 0);
  const b = project(3702, 9292, 5590, 99, 0.6);
  ok('at 0 % equivalence, ~5497 kills are needed', Math.round(a.killsNeeded) === 5497, String(Math.round(a.killsNeeded)));
  ok('at 60 % equivalence, far fewer kills — but…', Math.round(b.killsNeeded) === 2177, String(Math.round(b.killsNeeded)));
  ok('…the RESOLVED count is within 1 % either way', Math.abs(a.resolved - b.resolved) / 5590 < 0.01, `${Math.round(a.resolved)} vs ${Math.round(b.resolved)}`);
  ok('a target already met needs no kills', project(100, 100, 0, 99, 0).killsNeeded === 0);

  /* ── sweep-path resolution (2026-08-14) ────────────────────────────────────────────────────
     The regression these pin is not a wrong number, it is a wrong PLACE: eight `/tmp` paths that a
     reboot wiped, after which the tool reported a finished queue. */
  ok('all eight DSPs are expected', SWEEP_FILES.length === 8, String(SWEEP_FILES.length));
  ok('a sweep path is DERIVED from the filename, not hand-written', sweepPathFor('ppgdex-dsp.js', '/d') === '/d/ppgdex-dsp.json', sweepPathFor('ppgdex-dsp.js', '/d'));
  ok('…so the ad-hoc suffixes that had accreted cannot come back', !SWEEP_FILES.some((f) => /-fresh|2\.json/.test(sweepPathFor(f, '/d'))));
  ok('NO sweep path lives in /tmp — a tmpfs loses the queue on reboot', !Object.values(resolveSweeps()).some((p) => p.startsWith('/tmp/')), Object.values(resolveSweeps())[0]);
  ok('the default dir is inside the repo, beside .mutation-crawl', sweepDir().startsWith(ROOT), sweepDir());
  ok('DEX_SWEEP_DIR overrides it', sweepPathFor('oxydex-dsp.js', '/elsewhere') === '/elsewhere/oxydex-dsp.json');
  ok('every expected file resolves to a distinct path', new Set(Object.values(resolveSweeps())).size === 8);

  /* The honesty property, stated as arithmetic: a zero denominator must not become a percentage.
     `0/0` is NaN, and `NaN.toFixed(1)` is the string "NaN" — which printed beside "target 99%" and
     read as a finished programme. */
  ok('a zero denominator is not a percentage', Number.isNaN((100 * 0) / 0), 'the NaN% that shipped');
  /* Bound to locals: biome's noSelfCompare reads a literal `0 > 0` as a mistake, and it is normally
     right — the same accommodation the suite's comparator group makes for `ser(x) === ser(x)`. */
  const zeroDis = 0,
    negDis = -29;
  ok('…and the guard catches it (dis>0 is false for 0 and for negatives)', !(zeroDis > 0) && !(negDis > 0));

  /* ABSENT and DEGENERATE are different failures with different fixes, and a single `dis > 0` guard
     reported both as missing data. Caught by testing the HAPPY path: a sweep of 100 tested against
     ppgdex's 129 committed equivalents gives dis = −29, and the tool blamed a file that was present.
     `loaded` is what separates them, so these pin the decision rather than the message. */
  const verdict = (loadedN, disN) => (loadedN === 0 ? 'NO SWEEP DATA' : disN <= 0 ? 'DEGENERATE DENOMINATOR' : 'ok');
  ok('nothing read ⇒ absent, not degenerate', verdict(0, 0) === 'NO SWEEP DATA', verdict(0, 0));
  ok('read but ledger ≥ tested ⇒ DEGENERATE, not absent', verdict(1, -29) === 'DEGENERATE DENOMINATOR', verdict(1, -29));
  ok('…and exactly zero distinguishable is degenerate too, not a 0 % rate', verdict(1, 0) === 'DEGENERATE DENOMINATOR', verdict(1, 0));
  ok('a healthy sweep reports normally', verdict(8, 1060) === 'ok', verdict(8, 1060));
  ok('the two failures are never the same verdict', verdict(0, 0) !== verdict(1, 0));

  console.log('\n' + (fail ? `✗ ${fail} failed, ${pass} passed` : `✓ all ${pass} selftests passed`));
  process.exit(fail ? 1 : 0);
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────
if (IS_MAIN && !has('--selftest')) {
  const only = opt('--file', '');
  const top = Number(opt('--top', '60')) || 60;
  const led = JSON.parse(readFileSync(join(ROOT, 'tools/mutate-equivalence.json'), 'utf8'));

  const rows = [];
  const missing = [];
  let loaded = 0; // sweeps actually READ — distinguishes "absent" from "present but degenerate"
  let T = 0,
    K = 0,
    I = 0,
    E = 0;

  /* OPTIONAL reachability split. Without --cov the tool behaves exactly as before; a survivor count
     is then a single undifferentiated number, which is what makes 5885 of them unplannable. With it,
     each survivor is additionally UNREACHED (no test executes the line — write a test) or UNASSERTED
     (tests execute it and do not notice — strengthen an assertion). Those have opposite fixes, so
     fusing them is a planning error, not just a reporting one.
     Fails closed via mutation-reach: absent or unresolvable coverage ⇒ everything UNASSERTED, i.e.
     nothing is ever quietly written off as unreachable. */
  const covPath = opt('--cov', '');
  const COV = covPath && existsSync(covPath) ? JSON.parse(readFileSync(covPath, 'utf8')) : null;
  let UNREACHED = 0,
    UNASSERTED = 0;
  const covUnresolved = [];
  for (const [file, sweep] of Object.entries(SWEEPS)) {
    if (only && file !== only) continue;
    if (!existsSync(sweep) || !existsSync(join(ROOT, file))) {
      missing.push(file);
      continue;
    }
    const d = JSON.parse(readFileSync(sweep, 'utf8'));
    loaded++;
    const src = readFileSync(join(ROOT, file), 'utf8');
    const ranges = functionRanges(src);
    const eq = new Set((led[file] || []).map((e) => e.line + '|' + e.op + '|' + String(e.before).trim()));
    T += d.tested;
    K += d.killed;
    I += d.invalid || 0;
    E += (led[file] || []).length;
    const per = new Map();
    const unclassified = [];
    for (const m of d.survivors || []) {
      if (eq.has(m.line + '|' + m.op + '|' + String(m.before).trim())) continue;
      unclassified.push(m);
      const fn = attribute(ranges, m.line);
      per.set(fn, (per.get(fn) || 0) + 1);
    }
    for (const [fn, n] of per) rows.push({ file, fn, n });

    if (COV) {
      const rec = findRecord(COV, file);
      if (!rec) covUnresolved.push(file);
      const P = partitionSurvivors(unclassified, executedLines(rec));
      UNREACHED += P.unreached.length;
      UNASSERTED += P.unasserted.length;
    }
  }
  rows.sort((a, b) => b.n - a.n);

  if (missing.length) console.log(`  ⚠ NO SWEEP for ${missing.length} file(s): ${missing.join(', ')} — their work is NOT counted below.\n`);

  /* ── §NO-SWEEP · AN EMPTY DENOMINATOR IS AN UNKNOWN QUEUE, NOT A FINISHED ONE ─────────────────
     With every sweep absent this printed `0/0 distinguishable = NaN%   0 survivors unresolved`
     beside `target 99%`, and `0 functions hold 0 unresolved survivors` — the exact shape of a
     completed programme. It also exited 0, so nothing downstream could tell the difference either.
     That is CLAUDE.md §👥.4b's family: the check ran and reported success about something it never
     examined. Measured 2026-08-14, after a reboot wiped the eight `/tmp` sweeps.

     Refuse instead. There is no percentage to report when nothing was measured, and printing one
     anyway is the failure — `NaN` is not a small number, it is the absence of a measurement wearing
     the shape of one. Exit 2 so a script cannot mistake it for a clean queue. */
  const dis = T - I - E;
  const surv = T - I - K - E;
  const where = sweepDir();

  /* TWO DISTINCT FAILURES, and collapsing them hides the second. "No sweep was read" and "a sweep
     was read but its denominator is not positive" have different causes and different fixes, and a
     single `dis > 0` guard reports both as missing data. Caught 2026-08-14 testing the HAPPY path:
     a sweep claiming `tested: 100` against ppgdex's 129 committed equivalents yields dis = −29, and
     the tool blamed an absent file that was sitting right there. A stale sweep — one taken before
     the ledger grew past it — is a real condition and deserves its own name. */
  if (dis <= 0 && loaded > 0) {
    const m = {
      error: 'DEGENERATE DENOMINATOR',
      loaded,
      tested: T,
      invalid: I,
      equivalent: E,
      distinguishable: dis,
      detail:
        'the ledger records at least as many equivalents as the sweep tested — the sweep is STALE relative to tools/mutate-equivalence.json, or the two disagree about which file they describe. Re-sweep; do not read a rate off this.'
    };
    if (has('--json')) console.log(JSON.stringify(m, null, 2));
    else {
      console.log(`🔴 DEGENERATE DENOMINATOR — ${T} tested − ${I} invalid − ${E} equivalent = ${dis}.\n`);
      console.log('   A sweep was read, so this is NOT missing data. The equivalence ledger records at');
      console.log('   least as many entries as the sweep tested, which means the sweep predates them');
      console.log('   or the two describe different files. Re-sweep — a rate computed here is meaningless.');
    }
    process.exit(2);
  }

  if (loaded === 0) {
    const msg = {
      error: 'NO SWEEP DATA',
      swept: 0,
      expected: only ? [only] : SWEEP_FILES,
      sweepDir: where,
      detail: 'the queue is UNKNOWN, not empty — re-sweep before reading any progress from this tool'
    };
    if (has('--json')) console.log(JSON.stringify(msg, null, 2));
    else {
      console.log('🔴 NO SWEEP DATA — the queue is UNKNOWN, not empty.\n');
      console.log(`   Looked in: ${where}`);
      console.log(`   Expected:  ${(only ? [only] : SWEEP_FILES).map((f) => sweepPathFor(f, where).split('/').pop()).join(', ')}\n`);
      console.log('   A sweep is a MEASUREMENT and is not committed, so an absent one means it was');
      console.log('   never run or was destroyed — never that the work is done. Regenerate with');
      console.log(`   \`node tools/mutate.mjs --file <f> --json > ${where}/<f-without-.js>.json\`.\n`);
      console.log('   The equivalence LEDGER (tools/mutate-equivalence.json) is committed and is not');
      console.log('   affected by this — only the survivor inventory needs rebuilding.');
    }
    process.exit(2);
  }

  if (has('--json')) {
    console.log(JSON.stringify({ fleet: { tested: T, killed: K, invalid: I, equivalent: E }, work: rows }, null, 2));
    process.exit(0);
  }

  console.log(`▸ FLEET  ${K}/${dis} distinguishable = ${((100 * K) / dis).toFixed(1)}%   ${surv} survivors unresolved   target 99%\n`);

  if (COV) {
    const tot = UNREACHED + UNASSERTED;
    const pct = tot ? ((100 * UNREACHED) / tot).toFixed(1) : '0.0';
    console.log(`  SPLIT   UNREACHED ${UNREACHED} (${pct}%) — no test executes the line; write a test that reaches it`);
    console.log(`          UNASSERTED ${UNASSERTED} — tests execute it and do not notice; strengthen an assertion\n`);
    if (covUnresolved.length) console.log(`  ⚠ coverage did not resolve for ${covUnresolved.length} file(s): ${covUnresolved.join(', ')} — counted UNASSERTED (fail-closed).\n`);
  }
  console.log('  THE TARGET IN ONE LINE: at any kill/classify split, ~98.5% of those survivors must be');
  console.log('  RESOLVED — killed if killable, classified if not. No ratio avoids the work.\n');
  console.log('    rank   n   file                 function                     cumulative   % of work');
  let cum = 0;
  const tot = rows.reduce((s, r) => s + r.n, 0);
  rows.slice(0, top).forEach((r, i) => {
    cum += r.n;
    console.log(`    ${String(i + 1).padStart(4)} ${String(r.n).padStart(4)}   ${r.file.padEnd(20)} ${r.fn.padEnd(28)} ${String(cum).padStart(6)}      ${((100 * cum) / tot).toFixed(1)}%`);
  });
  const rest = rows.length - top;
  if (rest > 0) console.log(`\n    …and ${rest} more functions holding ${tot - cum} survivors (${((100 * (tot - cum)) / tot).toFixed(1)}% of the work)`);
  console.log(`\n  ${rows.length} functions hold ${tot} unresolved survivors.`);
}

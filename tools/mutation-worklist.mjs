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
 *   node tools/mutation-worklist.mjs --selftest
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const IS_MAIN = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/* Where each file's newest sweep lives. A sweep is a large JSON that is NOT committed (it is a
   measurement, not a source), so this is a lookup of the agreed scratch paths. A missing sweep is
   reported, never silently skipped — an absent file must not read as "no work left". */
export const SWEEPS = {
  'oxydex-dsp.js': '/tmp/oxydex-sweep.json',
  'ecgdex-dsp.js': '/tmp/ecgdex-sweep.json',
  'integrator-dsp.js': '/tmp/integrator-sweep.json',
  'ppgdex-dsp.js': '/tmp/ppgdex-sweep-fresh.json',
  'glucodex-dsp.js': '/tmp/glucodex-sweep2.json',
  'cpapdex-dsp.js': '/tmp/cpapdex-sweep.json',
  'hrvdex-dsp.js': '/tmp/hrvdex-sweep.json',
  'motiondex-dsp.js': '/tmp/motiondex-sweep.json'
};

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
  let T = 0,
    K = 0,
    I = 0,
    E = 0;
  for (const [file, sweep] of Object.entries(SWEEPS)) {
    if (only && file !== only) continue;
    if (!existsSync(sweep) || !existsSync(join(ROOT, file))) {
      missing.push(file);
      continue;
    }
    const d = JSON.parse(readFileSync(sweep, 'utf8'));
    const src = readFileSync(join(ROOT, file), 'utf8');
    const ranges = functionRanges(src);
    const eq = new Set((led[file] || []).map((e) => e.line + '|' + e.op + '|' + String(e.before).trim()));
    T += d.tested;
    K += d.killed;
    I += d.invalid || 0;
    E += (led[file] || []).length;
    const per = new Map();
    for (const m of d.survivors || []) {
      if (eq.has(m.line + '|' + m.op + '|' + String(m.before).trim())) continue;
      const fn = attribute(ranges, m.line);
      per.set(fn, (per.get(fn) || 0) + 1);
    }
    for (const [fn, n] of per) rows.push({ file, fn, n });
  }
  rows.sort((a, b) => b.n - a.n);

  if (missing.length) console.log(`  ⚠ NO SWEEP for ${missing.length} file(s): ${missing.join(', ')} — their work is NOT counted below.\n`);

  if (has('--json')) {
    console.log(JSON.stringify({ fleet: { tested: T, killed: K, invalid: I, equivalent: E }, work: rows }, null, 2));
    process.exit(0);
  }

  const dis = T - I - E;
  const surv = T - I - K - E;
  console.log(`▸ FLEET  ${K}/${dis} distinguishable = ${((100 * K) / dis).toFixed(1)}%   ${surv} survivors unresolved   target 99%\n`);
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

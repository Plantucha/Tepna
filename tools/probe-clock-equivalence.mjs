#!/usr/bin/env node
/*
 * tools/probe-clock-equivalence.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * IS A SURVIVING clock.js MUTANT A TEST GAP, OR IS IT UNKILLABLE?
 *
 * A survivor is not automatically a gap: `if (lo < 0) lo = 0` mutated to `<=` still assigns 0 when
 * lo IS 0, and no input will ever separate them. This loads the original and each mutant in separate
 * vm realms and runs a battery through both, so the question is answered by execution.
 *
 * THE POSITIVE CONTROL IS THE WHOLE DESIGN, and it is not optional. A battery that never reaches the
 * code under test reports "equivalent" — about ITSELF, not about the code — and that reading is
 * indistinguishable from a real equivalence. So every run first replays mutants the sweep actually
 * KILLED: a test caught them, therefore a sound battery must separate them too. If any control comes
 * back equivalent the run prints BLIND and every verdict below it is void.
 *
 * That is not hypothetical. The first run of this probe (2026-08-09) came back 3-of-14 blind, and both
 * causes were the battery's:
 *   · `_ckDMY(a, b, preferDMY, locked)` was being called with ONE argument, so `locked` was undefined
 *     and the entire locked branch — where L56's day-range guard lives — never executed.
 *   · L94 is `if (b > 12)`; separating `>` from `>=` needs b EXACTLY 12, which no list supplied.
 * Both are invisible without controls, and the preceding sweep had reported those survivors as
 * "no distinguishing input" on a battery whose only control sat in a different function.
 *
 *   node tools/probe-clock-equivalence.mjs                    # uses a fresh dry-run + --sweep
 *   node tools/probe-clock-equivalence.mjs --sweep /tmp/m.json
 *
 * --sweep takes the NDJSON that `tools/mutate.mjs --file clock.js --json` writes; its `survivors` are
 * probed and every other generated mutant becomes a control.
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const SWEEP = opt('--sweep', '');
if (!SWEEP) {
  console.error('usage: node tools/probe-clock-equivalence.mjs --sweep <mutate --json output>');
  console.error('  (produce one with: node tools/mutate.mjs --file clock.js --limit 200 --json > sweep.json)');
  process.exit(2);
}
const SRC = readFileSync(join(ROOT, 'clock.js'), 'utf8');
const LINES = SRC.split('\n');
/* Enumerate the mutants fresh rather than trusting a cached list — a stale enumeration would silently
   probe mutants that no longer exist on this clock.js. */
const dry = JSON.parse(
  execFileSync(process.execPath, [join(ROOT, 'tools/mutate.mjs'), '--file', 'clock.js', '--dry-run', '--limit', '200', '--json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
).files[0].mutants;
const sweep = JSON.parse(readFileSync(SWEEP, 'utf8').split('\n')[0]);

const key = (m) => m.line + '|' + m.op + '|' + (m.after || '').trim();
const survKeys = new Set(sweep.survivors.map(key));
const PARSE = (m) => m.line < 270;
const survivors = dry.filter((m) => PARSE(m) && survKeys.has(key(m)));
// controls: parse-family mutants the sweep KILLED — a test caught them, so a sound battery must too
let killedAll = dry.filter((m) => PARSE(m) && !survKeys.has(key(m)));
// Sample the controls evenly across the family — enough to prove reach in every function without
// paying for ~60 realms. Even stride, not head, so late functions are represented.
const step = Math.max(1, Math.floor(killedAll.length / 14));
const killed = killedAll.filter((_, i) => i % step === 0).slice(0, 14);

function realm(src) {
  const ctx = { console, Date, Math, JSON, Number, String, Array, Object, isFinite, isNaN, parseInt, parseFloat, RegExp, Error };
  ctx.globalThis = ctx;
  try {
    vm.runInNewContext(src.replace(/^export\s.*$/gm, ''), ctx, { timeout: 5000 });
  } catch (e) {
    return { err: String(e.message).slice(0, 60) };
  }
  return ctx.DexClock ? { dc: ctx.DexClock } : { err: 'no DexClock' };
}
const apply = (m) => {
  const L = LINES.slice();
  L[m.line - 1] = L[m.line - 1].match(/^\s*/)[0] + (m.after || '').trim();
  return L.join('\n');
};

const A = Date.UTC(2026, 7, 5);
const STAMPS = [
  // zoned — _ckZoneMin (L45)
  '2026-08-05T23:15:42+02:00',
  '2026-08-05T23:15:42-05:30',
  '2026-08-05T23:15:42+14:00',
  '2026-08-05T23:15:42-00:45',
  '2026-08-05T23:15:42+00:30',
  '2026-08-05T23:15:42-11:15',
  '2026-08-05T23:15:42Z',
  // fractional / end-of-day — _ckMk time band (L120)
  '2026-08-05T23:15:42.000',
  '2026-08-05T23:15:42.999',
  '2026-08-05T23:15:42.5',
  '2026-08-05T24:00:00',
  // out-of-range components — _ckMk date validity (L118) and time band (L120)
  '2026-02-30 10:00:00',
  '2026-04-31 10:00:00',
  '2026-06-31 10:00:00',
  '2026-13-01 10:00:00',
  '2026-00-10 10:00:00',
  '2026-01-00 10:00:00',
  '2026-01-32 10:00:00',
  '2026-01-10 24:00:01',
  '2026-01-10 25:00:00',
  '2026-01-10 10:60:00',
  '2026-01-10 10:00:60',
  '2026-01-10 23:59:59',
  '2026-02-29 10:00:00',
  '2027-02-29 10:00:00',
  '2024-02-29 10:00:00',
  '1900-02-29 10:00:00',
  '2000-02-29 10:00:00',
  // FULL vendor stamps — resolveDMY (L78) needs complete stamps, bare dates never reach it
  '10:00:00 13/05/2026',
  '10:00:00 05/13/2026',
  '10:00:00 12/08/2026',
  '10:00:00 08/12/2026',
  '10:00:00 01/01/2026',
  '13/05/2026 10:00:00',
  '05/13/2026 10:00:00',
  '2026/05/13 10:00:00',
  '20260513100000',
  // numeric epoch — _ckNumEpoch (L147)
  '1785763530',
  '1785763530000',
  '0',
  '9999999999',
  '9999999999999',
  '00000000001785763530',
  // time-only — the roll (L198)
  '23:59:59',
  '00:00:01',
  '12:00:00',
  '00:00:00',
  '',
  'not a date',
  null,
  12345,
  '2026-08-05'
];
const OPTS = [
  {},
  { preferDMY: true },
  { preferDMY: false },
  { dateAnchorMs: A },
  { dateAnchorMs: A, prevTMs: A + 86399000 },
  { dateAnchorMs: A, prevTMs: A + 1000 },
  { dateAnchorMs: A, prevTMs: A + 86400000 - 1 },
  { dateAnchorMs: A, prevTMs: A },
  { dateAnchorMs: A, prevTMs: A - 1000 },
  { dateAnchorMs: 'x' },
  { dateAnchorMs: NaN },
  { dateAnchorMs: null },
  { dateAnchorMs: A, prevTMs: NaN },
  { dateAnchorMs: A, prevTMs: null },
  { dateAnchorMs: A, prevTMs: 'x' }
];
const DMY_LISTS = [
  ['10:00:00 13/05/2026'],
  ['10:00:00 05/13/2026'],
  ['10:00:00 12/08/2026'],
  ['10:00:00 12/08/2026', '10:00:00 13/05/2026'],
  ['10:00:00 13/05/2026', '10:00:00 05/13/2026'],
  ['10:00:00 12/08/2026', '10:00:00 11/07/2026'],
  ['10:00:00 05/12/2026'],
  ['10:00:00 12/12/2026'],
  ['10:00:00 12/05/2026'],
  ['10:00:00 05/12/2026', '10:00:00 13/05/2026'],
  ['10:00:00 31/01/2026'],
  [],
  ['garbage']
];

function fp(dc) {
  const o = [];
  for (const s of STAMPS)
    for (const op of OPTS) {
      try {
        o.push(JSON.stringify(dc.parseTimestamp(s, op)));
      } catch (e) {
        o.push('T');
      }
    }
  for (const l of DMY_LISTS) {
    try {
      o.push(JSON.stringify(dc.resolveDMY ? dc.resolveDMY(l) : null));
    } catch (e) {
      o.push('T');
    }
  }
  for (const f of ['_ckZoneMin', '_ckNumEpoch', '_ckP2']) {
    if (typeof dc[f] !== 'function') {
      o.push(f + ':absent');
      continue;
    }
    for (const a of ['+02:00', '-05:30', '+0000', 'Z', '1785763530', '0', 5, '05', '5', null]) {
      try {
        o.push(f + JSON.stringify(dc[f](a)));
      } catch (e) {
        o.push('T');
      }
    }
  }
  /* _ckDMY takes (a, b, preferDMY, locked) and L56 lives in the LOCKED branch — calling it with one
     argument leaves `locked` undefined and never runs that code. Sweep boundaries on both components:
     0/1 (lower), 12/13 (the DMY-vs-MDY pivot), 31/32 (the day bound L56 tests). */
  if (typeof dc._ckDMY === 'function') {
    for (const a of [0, 1, 5, 12, 13, 30, 31, 32])
      for (const b of [0, 1, 5, 12, 13, 30, 31, 32])
        for (const pref of [true, false])
          for (const locked of [true, false]) {
            try {
              o.push('D' + JSON.stringify(dc._ckDMY(a, b, pref, locked)));
            } catch (e) {
              o.push('T');
            }
          }
  } else o.push('_ckDMY:absent');
  return o.join('~');
}

const base = realm(SRC);
if (base.err) {
  console.log('BASE FAILED', base.err);
  process.exit(1);
}
const B = fp(base.dc);

console.log(`battery: ${STAMPS.length} stamps x ${OPTS.length} opts + ${DMY_LISTS.length} DMY lists + helper probes\n`);
console.log('### CONTROLS — parse-family mutants the sweep KILLED. Any "equivalent" here voids everything below.');
let blind = 0,
  ctlN = 0;
for (const m of killed) {
  const r = realm(apply(m));
  if (r.err) continue;
  ctlN++;
  let f;
  try {
    f = fp(r.dc);
  } catch (e) {
    f = 'T';
  }
  if (f === B) {
    blind++;
    console.log(`  ⚠ BLIND  L${m.line} [${m.op}]  ${(m.after || '').trim().slice(0, 54)}`);
  }
}
console.log(`  ${ctlN - blind}/${ctlN} killed mutants are DISTINGUISHABLE${blind ? '  <-- BATTERY IS PARTIALLY BLIND' : '  — battery reaches this code'}\n`);

console.log('### SURVIVORS');
for (const m of survivors) {
  const r = realm(apply(m));
  if (r.err) {
    console.log(`  REALM-FAIL       L${m.line} [${m.op}] ${r.err}`);
    continue;
  }
  let f;
  try {
    f = fp(r.dc);
  } catch (e) {
    f = 'THREW';
  }
  console.log(`  ${f !== B ? 'DISTINGUISHABLE ' : 'no-distinguishing'}  L${String(m.line).padEnd(4)} [${m.op.padEnd(14)}] ${(m.after || '').trim().slice(0, 50)}`);
}

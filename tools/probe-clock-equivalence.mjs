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
 * THE VERDICT (VERDICT-CONTRACT adoption, 2026-09-22) IS KEYED ON THE CONTROLS, NOT THE SURVIVORS.
 * A survivor here is the thing under INVESTIGATION — the sweep could not kill it and this probe asks
 * whether that is a test gap or a genuine equivalence — so `FAIL` on a survivor would convict the
 * `if (lo < 0) lo = 0` → `<=` case above, which is correct code. The criterion is instead the tool's
 * own soundness gate, the one already written into this header: every control (a mutant a test DID
 * kill) must be distinguishable by this battery. PASS = 0 blind. FAIL = the BATTERY is blind and every
 * equivalence verdict below it is void — it convicts the instrument, never the code. NOT_RUN = the base
 * realm did not build (nothing was examined). UNDERPOWERED = no control survived to be evaluated, so
 * the criterion cannot bind. Population is in CONTROLS; the survivor findings are counts in `result`.
 *
 * ⚠️ A CONTROL WHOSE REALM FAILS USED TO VANISH. The control loop's `if (r.err) continue;` dropped it
 * before `ctlN` counted it — so a control set reduced 14 → 8 by build failures reported `8/8
 * DISTINGUISHABLE`, a clean bill of health for a battery that had just lost 6 of its 14 probes. The
 * survivor loop printed `REALM-FAIL` all along; the control loop did not, and that asymmetry is what
 * hid it. Now counted, named, and carried in the population equality as `excluded`.
 *
 *   node tools/probe-clock-equivalence.mjs                    # uses a fresh dry-run + --sweep
 *   node tools/probe-clock-equivalence.mjs --verdict-sample   # the emitted object, no sweep, no realms
 *   node tools/probe-clock-equivalence.mjs --selftest
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
import { gitShort, makeVerdict } from './verdict-emit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
/* ── THE VERDICT, PURE ─────────────────────────────────────────────────────────────────────────
   Population in CONTROLS: eligible = controls the sweep offered · checked = controls whose realm
   built and was evaluated · excluded = controls whose realm failed to build. `blind` is how many of
   the CHECKED ones this battery could not separate. Survivor findings ride in `result` and never in
   the status — see the header for why a survivor cannot be a FAIL. */
export function probeVerdict({ offered, built, blind, survivors, baseErr = null, commit, at } = {}) {
  const excluded = Math.max(0, offered - built);
  const base = {
    gate: 'probe-clock-equivalence',
    tool: 'tools/probe-clock-equivalence.mjs',
    criterion: {
      name: 'every_control_mutant_a_test_killed_is_distinguishable_by_this_battery (the plant set under SURVIVORS may contain genuine equivalents and is NOT scored)',
      threshold: 0,
      unit: 'blind controls',
      direction: 'lte'
    },
    evidence: ['clock.js', 'tools/mutate.mjs --dry-run'],
    commit,
    at
  };
  if (baseErr) {
    return makeVerdict({
      ...base,
      status: 'NOT_RUN',
      population: { eligible: offered || 0, checked: 0, excluded: offered || 0 },
      result: null,
      reason: `the BASE realm did not build (${String(baseErr).slice(0, 80)}) — nothing was examined, so neither the controls nor the survivors were evaluated`
    });
  }
  if (built < 1) {
    return makeVerdict({
      ...base,
      status: 'UNDERPOWERED',
      population: { eligible: offered, checked: 0, excluded },
      result: { blind: 0, survivors },
      reason: `no control realm built (${offered} offered, ${excluded} failed) — with no control the battery's reach is unproven, and an equivalence read off an unproven battery is the failure this probe exists to prevent`
    });
  }
  const ok = blind === 0;
  return makeVerdict({
    ...base,
    status: ok ? 'PASS' : 'FAIL',
    population: { eligible: offered, checked: built, excluded },
    result: { blind, distinguishableControls: built - blind, survivors },
    reason: ok
      ? null
      : `${blind} of ${built} control mutant(s) — each one a test DID kill — are NOT separated by this battery, so it is partially blind and every equivalence verdict in this run is void. This convicts the INSTRUMENT, not clock.js.`
  });
}

/* The corpus-free sample: the measured 2026-08-09 first run, 3 of 14 controls blind. A sample that
   passed would exercise none of the reasoning above. */
export function sampleProbe() {
  return { offered: 14, built: 14, blind: 3, survivors: { distinguishable: 4, noDistinguishing: 9, realmFail: 1 } };
}

if (argv.includes('--verdict-sample')) {
  console.log(JSON.stringify(probeVerdict({ ...sampleProbe(), commit: gitShort() }), null, 2));
  process.exit(0);
}

if (argv.includes('--selftest')) {
  const fails = [];
  const ok = (c, m) => {
    if (!c) fails.push(m);
  };
  const S = { distinguishable: 2, noDistinguishing: 3, realmFail: 0 };
  const eq = (v) => v.population.checked + v.population.excluded === v.population.eligible;
  const clean = probeVerdict({ offered: 14, built: 14, blind: 0, survivors: S, commit: 'abc1234' });
  ok(clean.status === 'PASS' && clean.reason === null, `0 blind ⇒ PASS carrying reason null, got ${clean.status}`);
  ok(eq(clean) && clean.result.distinguishableControls === 14, 'PASS: checked + excluded = eligible, and the distinguishable count is published');
  const blind = probeVerdict({ ...sampleProbe(), commit: 'abc1234' });
  ok(blind.status === 'FAIL' && /partially blind/.test(blind.reason) && /INSTRUMENT/.test(blind.reason), `3 blind ⇒ FAIL naming the instrument, got ${blind.status}`);
  ok(blind.result.survivors.noDistinguishing === 9 && blind.result.survivors.distinguishable === 4, 'the survivor findings ride in result, never as a status');
  const dropped = probeVerdict({ offered: 14, built: 8, blind: 0, survivors: S, commit: 'abc1234' });
  ok(
    dropped.status === 'PASS' && dropped.population.excluded === 6 && eq(dropped),
    `a control set reduced 14 → 8 by realm failures is VISIBLE as excluded 6, not hidden: ${JSON.stringify(dropped.population)}`
  );
  const none = probeVerdict({ offered: 14, built: 0, blind: 0, survivors: S, commit: 'abc1234' });
  ok(none.status === 'UNDERPOWERED' && eq(none) && none.population.excluded === 14, `no control built ⇒ UNDERPOWERED, not PASS: ${none.status}`);
  const nr = probeVerdict({ offered: 14, built: 0, blind: 0, survivors: S, baseErr: 'ReferenceError: x', commit: 'abc1234' });
  ok(nr.status === 'NOT_RUN' && nr.result === null && eq(nr), `BASE FAILED ⇒ NOT_RUN with result null: ${nr.status}`);
  ok(/may contain genuine equivalents/.test(clean.criterion.name), 'criterion.name says the survivor plant set may contain equivalents, so nobody later scores it');
  const N = 8;
  if (fails.length) {
    console.log(fails.map((f) => '  ✗ ' + f).join('\n'));
    console.log(`SELFTEST FAIL (${fails.length} of ${N})`);
    process.exit(1);
  }
  console.log(`all ${N} selftests passed`);
  process.exit(0);
}

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
  ctlN = 0,
  ctlFail = 0;
for (const m of killed) {
  const r = realm(apply(m));
  if (r.err) {
    // NAMED, NOT DROPPED. A control that does not build is one the battery never proved reach with;
    // silently skipping it shrinks the control set and makes a blind battery read N/N. See the header.
    ctlFail++;
    console.log(`  REALM-FAIL  L${m.line} [${m.op}] ${r.err}`);
    continue;
  }
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
console.log(
  `  ${ctlN - blind}/${ctlN} killed mutants are DISTINGUISHABLE${ctlFail ? `  (${ctlFail} of ${killed.length} control realms did not build — excluded, not scored)` : ''}${blind ? '  <-- BATTERY IS PARTIALLY BLIND' : '  — battery reaches this code'}\n`
);

console.log('### SURVIVORS');
const sv = { distinguishable: 0, noDistinguishing: 0, realmFail: 0 };
for (const m of survivors) {
  const r = realm(apply(m));
  if (r.err) {
    sv.realmFail++;
    console.log(`  REALM-FAIL       L${m.line} [${m.op}] ${r.err}`);
    continue;
  }
  let f;
  try {
    f = fp(r.dc);
  } catch (e) {
    f = 'THREW';
  }
  if (f !== B) sv.distinguishable++;
  else sv.noDistinguishing++;
  console.log(`  ${f !== B ? 'DISTINGUISHABLE ' : 'no-distinguishing'}  L${String(m.line).padEnd(4)} [${m.op.padEnd(14)}] ${(m.after || '').trim().slice(0, 50)}`);
}

console.log('\nVERDICT ' + JSON.stringify(probeVerdict({ offered: killed.length, built: ctlN, blind, survivors: sv, commit: gitShort() })));

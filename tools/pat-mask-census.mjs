#!/usr/bin/env node
/*
 * tools/pat-mask-census.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * HOW FAR WOULD THE PAT FOOT SET MOVE IF THE O2RING BEAT MARKERS WERE HELD OVER FIRST?
 *
 * `pat-feasibility-worker.js ppgFootTimes` runs `PPGDSP.detectChannel` on the raw O2Ring pleth. The
 * node's own `analyze` does not: it runs `holdOverGaps(c, rec.gap)` first, so every shipped PpgDex
 * number is detected over a channel whose `156` beat markers were held over. The PAT lane detects
 * over the markers themselves, and a marker is not a sample the device measured (§∅).
 *
 * Row `2026-09-26-pat-finger-feet-detected-on-unmasked-156-rows` holds that defect. Wren measured it
 * on 2026-09-26 on the rig: masking shifts the finger feet by a constant -0.74..-0.49 ms per night
 * on 68 of 70 ring nights, which is harmless for PAT TIMING, and on 6 older nights 2.0-3.3 % of the
 * feet move past 40 ms, which is not harmless for the BEAT SET. The row concludes that masking "is
 * an owner yes/no, not a unit", and it stays OPEN.
 *
 * THIS IS THE INSTRUMENT THAT RE-ASKS THAT QUESTION OVER TODAY'S CORPUS AND TODAY'S CODE. It decides
 * nothing about the shipped default. It reports, per recording, how far the foot set moves, and it
 * judges that against the bar Wren pre-stated on 2026-09-26.
 *
 * THIS RUNS THE SHIPPED FUNCTION, NOT A PORT. Three tools copy `ppgFootTimes`, and #4220 measured
 * two copies drifting in opposite directions, so a move measured over a copy measures a third
 * pipeline. `tools/pat-pinned-move.mjs` states that rule for the pinned-span switch; this file
 * follows it and reuses that file's `loadWorker`, so one realm list serves both censuses. The worker
 * carries the optional `opts.holdGaps` for exactly this call, and absent it every line of it runs as
 * it did.
 *
 * THE POPULATION IS THE RING, AND THE DSP DECIDES THAT, NOT A FILENAME. `parsePPG` publishes `gap`
 * only for the finger layout (`ppgdex-dsp.js`, the `sent` site), because `156` is the O2Ring's marker
 * and an ordinary raw value in a Verity count stream. So a recording whose record reads
 * `wouldHoldGapSamples == null` is EXCLUDED with that reason: the hold cannot reach it, and counting
 * it as a recording that held still would dilute the share with recordings never at risk.
 *
 * ∅ AN EMPTY SAMPLE REPORTS ITS ABSENCE. A share over no recording is `null` with a named reason,
 * never 0, and a verdict over `checked: 0` is NOT_RUN or UNDERPOWERED — never a PASS.
 *
 * WHAT IT DOES NOT CLAIM. It measures the FOOT SET, not the published PAT lag: a lag move needs the
 * paired ECG leg and its own run. It also measures the move, never whether the hold is RIGHT — the
 * node already holds, so the two legs here are two defensible pipelines and the owner picks one.
 *
 * CLI: --check (default) · --json · --selftest · --verdict-sample · --limit <n> · --tree <path>
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { SAMPLE_FLOOR, displayTree, loadWorker, pairRecordings, sampleOf } from './pat-pinned-move.mjs';
import { resolveCorpus } from './regen-goldens-core.mjs';
import { makeVerdict, printVerdict } from './verdict-emit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = 'tools/pat-mask-census.mjs';

/* 🔴 PRE-STATED, and not by this file: Wren stated all four numbers on 2026-09-26 before the run
   that produced the row, and this census adopts them unchanged so the two runs are comparable. A
   threshold derived from the data it judges is `UNKNOWN` by §🧾, which is why none of these moves. */
export const PAIR_TOL_MS = 40;
export const BAR_MEDIAN_MS = 5;
export const BAR_IQR_MS = 10;
export const BAR_LOST_GAINED_PCT = 2;
export const SAMPLE_DEFAULT = 24;

/* ── the pairing ──────────────────────────────────────────────────────────────────────────────── */
/* FEET PAIR BY SAMPLE INDEX WITHIN THE TOLERANCE, which is the row's own rule. Both legs share one
   `t0Ms` and one `fs`, so an index distance and a time distance are the same statement; the index is
   what the detector produced and carries no axis arithmetic of its own.
   ∅ A FOOT WITH NO PARTNER IS NOT A FOOT THAT MOVED ZERO. The unpaired counts leave separately, in
   both directions: `lost` is a raw foot the held leg no longer finds, `gained` is a held-leg foot the
   raw leg never found. A census that dropped them would report a tiny median over the survivors and
   call a changed beat set unchanged. */
export function pairFeet(rawIdx, heldIdx, tolSamples) {
  const pairs = [];
  let i = 0,
    j = 0,
    lost = 0,
    gained = 0;
  while (i < rawIdx.length && j < heldIdx.length) {
    const d = heldIdx[j] - rawIdx[i];
    if (Math.abs(d) <= tolSamples) {
      /* A nearer partner for the SAME raw foot may sit one step along, so the greedy step takes the
         closer of the two rather than the first inside the window. */
      const dNext = j + 1 < heldIdx.length ? heldIdx[j + 1] - rawIdx[i] : null;
      if (dNext !== null && Math.abs(dNext) < Math.abs(d) && Math.abs(dNext) <= tolSamples) {
        gained++;
        j++;
        continue;
      }
      pairs.push([rawIdx[i], heldIdx[j]]);
      i++;
      j++;
      continue;
    }
    if (d < 0) {
      gained++;
      j++;
    } else {
      lost++;
      i++;
    }
  }
  lost += rawIdx.length - i;
  gained += heldIdx.length - j;
  return { pairs, lost, gained };
}

/* ── the statistics ──────────────────────────────────────────────────────────────────────────── */
export function medianOf(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantileOf(a, q) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/* ── one recording, both legs ────────────────────────────────────────────────────────────────── */
export function maskOne(worker, text) {
  const raw = worker.ppgFootTimes(text);
  /* ∅ THE EXCLUSION IS READ OFF THE RECORD, never guessed from a name. `wouldHoldGapSamples` is a
      number on every finger recording, 0 included, and `null` where `parsePPG` published no mask. */
  if (raw.wouldHoldGapSamples == null) {
    return { reachable: false, reason: 'parsePPG published no gap mask, so this is not a finger layout and the hold cannot reach it' };
  }
  const held = worker.ppgFootTimes(text, null, { holdGaps: true });
  const fs = raw.fs;
  const tolSamples = (PAIR_TOL_MS / 1000) * fs;
  const { pairs, lost, gained } = pairFeet(raw.feetIdx, held.feetIdx, tolSamples);
  const shifts = pairs.map(([a, b]) => ((b - a) / fs) * 1000);
  const med = medianOf(shifts);
  const q1 = quantileOf(shifts, 0.25);
  const q3 = quantileOf(shifts, 0.75);
  const iqr = q1 === null || q3 === null ? null : q3 - q1;
  const beyond = shifts.filter((s) => Math.abs(s) > PAIR_TOL_MS).length;
  /* ∅ The denominator is the RAW foot count, because the question is how far the published set moves
     and the raw leg is what is published today. A share over 0 feet is `null` with a reason. */
  const lostGainedPct = raw.n ? ((lost + gained) / raw.n) * 100 : null;
  const bar = med === null || iqr === null || lostGainedPct === null ? null : Math.abs(med) >= BAR_MEDIAN_MS || iqr >= BAR_IQR_MS || lostGainedPct > BAR_LOST_GAINED_PCT;
  return {
    reachable: true,
    reason: null,
    fs,
    gapSamples: raw.wouldHoldGapSamples,
    gapSamplesHeld: held.gapSamplesHeld,
    feetRaw: raw.n,
    feetHeld: held.n,
    paired: pairs.length,
    lost,
    gained,
    lostGainedPct,
    shiftMedianMs: med,
    shiftIqrMs: iqr,
    feetBeyondTol: beyond,
    /* `movesBar` is the pre-stated verdict for ONE recording; `moves` is the weaker fact that any
       number changed at all. A census that reported only the second would call a 0.5 ms constant
       shift a move, which the row already measured as harmless for timing. */
    moves: raw.n !== held.n || beyond > 0 || lost > 0 || gained > 0,
    movesBar: bar
  };
}

/* ── the summary ─────────────────────────────────────────────────────────────────────────────── */
export function summarise(rows) {
  if (!rows.length) {
    return {
      n: 0,
      movers: null,
      moverShare: null,
      medianOfMediansMs: null,
      worstLostGainedPct: null,
      reason: 'no reachable recording was read, so every share would be a quotient of nothing'
    };
  }
  const movers = rows.filter((r) => r.movesBar === true).length;
  const meds = rows.map((r) => r.shiftMedianMs).filter((m) => m !== null);
  const pcts = rows.map((r) => r.lostGainedPct).filter((p) => p !== null);
  return {
    n: rows.length,
    movers,
    moverShare: movers / rows.length,
    medianOfMediansMs: medianOf(meds),
    worstLostGainedPct: pcts.length ? Math.max(...pcts) : null,
    reason: null
  };
}

/* ── the verdict ─────────────────────────────────────────────────────────────────────────────── */
/* ONE BUILDER, so the sample and a real run print the same object. */
export function buildVerdict({ rows, refused, unreachable, eligible, scanned, treeReason }) {
  const reachable = rows.filter((r) => r.reachable === true);
  const sum = summarise(reachable);
  let status = 'UNKNOWN';
  let reason = null;
  if (sum.n === 0) {
    if (unreachable || refused) {
      status = 'UNDERPOWERED';
      reason = `${unreachable + refused} recording(s) read and none published a gap mask, so the sample holds no recording the hold can reach`;
    } else {
      status = 'NOT_RUN';
      reason = `${treeReason || 'no PPG recording was read, so the move was not measured'} (the walk saw ${scanned} recording(s))`;
    }
  } else if (sum.n < SAMPLE_FLOOR) {
    status = 'UNDERPOWERED';
    reason = `${sum.n} reachable recording(s), against a pre-stated floor of ${SAMPLE_FLOOR}`;
  } else if (sum.movers === 0) {
    status = 'PASS';
  } else {
    status = 'FAIL';
    reason = `${sum.movers} of ${sum.n} recording(s) move past the bar Wren pre-stated on 2026-09-26, so holding the markers over would move a published foot set and the default stays until the owner rules`;
  }
  return makeVerdict({
    tool: TOOL,
    gate: 'pat-mask-census',
    status,
    population: {
      checked: sum.n,
      eligible: sum.n + unreachable + refused,
      excluded: unreachable + refused
    },
    criterion: {
      name: 'recordings_whose_foot_set_moves_past_the_prestated_bar',
      threshold: 0,
      unit: 'recordings',
      direction: 'lte'
    },
    result:
      status === 'NOT_RUN'
        ? null
        : {
            movers: sum.movers,
            moverShare: sum.moverShare,
            medianOfMediansMs: sum.medianOfMediansMs,
            worstLostGainedPct: sum.worstLostGainedPct,
            barMedianMs: BAR_MEDIAN_MS,
            barIqrMs: BAR_IQR_MS,
            barLostGainedPct: BAR_LOST_GAINED_PCT,
            eligibleWalked: eligible
          },
    reason,
    evidence: [TOOL, 'pat-feasibility-worker.js', 'ppgdex-dsp.js']
  });
}

/* ── the record id a published verdict may carry ─────────────────────────────────────────────── */
/* A capture filename carries a device serial, so a member list holds the VENDOR and a digest. */
export function maskRecord(p) {
  const name = String(p).split('/').pop() || '';
  const vendor = /^Wellue|O2Ring/i.test(name) ? 'Wellue' : /^Polar/i.test(name) ? 'Polar' : 'unknown';
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 0xffffffff;
  return `${vendor}:${h.toString(16).padStart(8, '0')}`;
}

/* ── the synthetic finger record the selftest runs ───────────────────────────────────────────── */
/* ONE CHANNEL, so `deriveSiteFromLayout` returns 'finger' and the sentinel pass runs. The baseline
   sits far from the marker value, so `markO2BeatMarkers` reads each planted 156 as isolated and
   rejects it — a marker beside a near-156 neighbour is KEPT by the DSP, and a selftest that planted
   those would assert over a mask that is empty. */
export function syntheticFingerPpg({ fs = 125, secs = 90, hz = 1.1, markerEvery = 0 } = {}) {
  const rows = ['Phone timestamp;sensor timestamp [ns];channel 0'];
  const n = fs * secs;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const iso = new Date(Date.UTC(2026, 8, 26, 22, 0, 0) + Math.round(t * 1000)).toISOString().replace('Z', '');
    const beat = Math.sin(2 * Math.PI * hz * t) + 0.3 * Math.sin(4 * Math.PI * hz * t);
    const plant = markerEvery > 0 && i > 0 && i % markerEvery === 0;
    const v = plant ? 156 : Math.round(50000 + 4000 * beat);
    rows.push(`${iso};${(843960926087160899n + BigInt(Math.round(t * 1e9))).toString()};${v}`);
  }
  return rows.join('\n');
}

/* ── the selftest ────────────────────────────────────────────────────────────────────────────── */
/* The real ring captures are gitignored personal biosignal data, so `--selftest` is what CI can run:
   the pure legs over planted arrays, plus one leg that enters the REAL worker realm over a synthetic
   finger record. That last leg is what reds when a shared module the worker dereferences moves. */
let ran = 0;
const ok = (what, cond) => {
  ran++;
  if (cond) return;
  console.error(`✗ ${what}`);
  process.exitCode = 1;
};

export async function selftest() {
  const TOL = 5;
  const same = pairFeet([10, 120, 230], [10, 120, 230], TOL);
  ok('identical foot sets pair whole, with nothing lost or gained', same.pairs.length === 3 && same.lost === 0 && same.gained === 0);
  const shifted = pairFeet([10, 120, 230], [12, 122, 232], TOL);
  ok('a uniform shift inside the tolerance still pairs whole', shifted.pairs.length === 3 && shifted.lost === 0 && shifted.gained === 0);
  ok(
    'and the shift it reports is the planted one',
    shifted.pairs.every(([a, b]) => b - a === 2)
  );
  const dropped = pairFeet([10, 120, 230], [10, 230], TOL);
  ok('a foot the held leg no longer finds is LOST, never a pair with a huge shift', dropped.lost === 1 && dropped.gained === 0 && dropped.pairs.length === 2);
  const added = pairFeet([10, 230], [10, 120, 230], TOL);
  ok('a foot only the held leg finds is GAINED', added.gained === 1 && added.lost === 0 && added.pairs.length === 2);
  const empty = pairFeet([], [], TOL);
  ok('∅ two empty sets pair into nothing, and fabricate no member', empty.pairs.length === 0 && empty.lost === 0 && empty.gained === 0);
  ok('∅ an empty left set reports every right foot as gained', pairFeet([], [1, 2, 3], TOL).gained === 3);

  ok('the median of an odd set is its middle', medianOf([3, 1, 2]) === 2);
  ok('the median of an even set is the mean of the two middles', medianOf([1, 2, 3, 4]) === 2.5);
  ok('∅ the median of nothing is null, never 0', medianOf([]) === null);
  ok('the quartiles interpolate', quantileOf([0, 1, 2, 3, 4], 0.25) === 1 && quantileOf([0, 1, 2, 3, 4], 0.75) === 3);
  ok('∅ a quantile of nothing is null, never 0', quantileOf([], 0.25) === null);

  const sEmpty = summarise([]);
  ok('∅ a summary over no recording reports null shares and a reason, never 0', sEmpty.movers === null && sEmpty.moverShare === null && /quotient of nothing/.test(sEmpty.reason));

  /* 🔴 THE REGRESSION THIS CRITERION EXISTS TO REFUSE: recordings read, none of them reachable, 0
     movers — and a count-the-movers verdict would call that a PASS over an empty set. */
  const vNone = buildVerdict({ rows: [], refused: 0, unreachable: 4, eligible: 4, scanned: 4, treeReason: null });
  ok('a sample the hold cannot reach is UNDERPOWERED, never a PASS over 0 at risk', vNone.status === 'UNDERPOWERED');
  ok('and it names why rather than reporting them as recordings that held still', /none published a gap mask/.test(vNone.reason || ''));
  ok('an unreachable recording is EXCLUDED, not checked', vNone.population.checked === 0 && vNone.population.excluded === 4);

  const vNothing = buildVerdict({ rows: [], refused: 0, unreachable: 0, eligible: 0, scanned: 0, treeReason: 'the corpus tree is not here' });
  ok('a run that read nothing at all is NOT_RUN — it examined nothing', vNothing.status === 'NOT_RUN');
  ok('and NOT_RUN carries result null by contract', vNothing.result === null);
  ok('and the tree reason travels in the reason, where no reader takes it for a result', /corpus tree is not here/.test(vNothing.reason || ''));

  const mk = (movesBar, med) => ({ reachable: true, movesBar, moves: movesBar, shiftMedianMs: med, lostGainedPct: 0.1 });
  const vThin = buildVerdict({ rows: [mk(false, -0.6), mk(false, -0.5)], refused: 0, unreachable: 0, eligible: 2, scanned: 2 });
  ok('a reachable sample under the pre-stated floor is UNDERPOWERED', vThin.status === 'UNDERPOWERED' && /floor of 3/.test(vThin.reason || ''));
  const vHeld = buildVerdict({ rows: [mk(false, -0.6), mk(false, -0.5), mk(false, -0.7)], refused: 0, unreachable: 1, eligible: 4, scanned: 4 });
  ok('a sample at the floor where no recording passes the bar is a PASS', vHeld.status === 'PASS');
  ok('and the PASS carries the constant shift the row already measured as harmless', vHeld.result.medianOfMediansMs === -0.6);
  const vMove = buildVerdict({ rows: [mk(true, -0.6), mk(false, -0.5), mk(false, -0.7)], refused: 0, unreachable: 0, eligible: 3, scanned: 3 });
  ok('one recording past the bar reads FAIL, so the default stays until the owner rules', vMove.status === 'FAIL');
  ok('and the FAIL says whose bar it is', /Wren pre-stated on 2026-09-26/.test(vMove.reason || ''));
  ok('checked + excluded = eligible holds across the partition', vHeld.population.checked + vHeld.population.excluded === vHeld.population.eligible);
  ok(
    'every non-PASS carries a reason',
    [vNone, vNothing, vThin, vMove].every((v) => typeof v.reason === 'string' && v.reason.length > 0)
  );
  ok('∅ the bar travels in the result, so a reader never guesses which threshold judged the run', vHeld.result.barMedianMs === BAR_MEDIAN_MS && vHeld.result.barIqrMs === BAR_IQR_MS);

  ok('a masked record carries no serial', !/0C301E3F|S4AW/.test(maskRecord('/x/Wellue_O2Ring-S_S4AW1234_20260824052358_PPG.txt')));
  ok('a masked record still names the vendor', maskRecord('/x/Wellue_O2Ring-S_S4AW1234_20260824052358_PPG.txt').startsWith('Wellue:'));
  ok('and a Polar stream reads Polar', maskRecord('/x/Polar_VeritySense_0C301E3F_1_PPG.txt').startsWith('Polar:'));

  /* ══ THE REALM CARRIES THE WHOLE WORKER SPINE — MEASURED, NOT LISTED ══════════════════════════
     A list of expected module names drifts from the worker, so this leg runs BOTH legs of `maskOne`
     over a synthetic finger record inside the real realm. The next shared-module addition reds here
     with its own ReferenceError rather than refusing every recording in silence. */
  {
    const worker = await loadWorker();
    const marked = syntheticFingerPpg({ markerEvery: 113 });
    let row = null,
      err = null;
    try {
      row = maskOne(worker, marked);
    } catch (e) {
      err = String((e && e.message) || e);
    }
    ok(`both legs run over a synthetic finger record in the real realm — threw: ${err || 'nothing'}`, row != null && row.reachable === true);
    ok('the DSP published a gap mask for the one-channel layout, so the hold reaches it', row != null && row.gapSamples > 0);
    ok('the held leg reports holding exactly the samples the mask marks', row != null && row.gapSamplesHeld === row.gapSamples);
    ok('the raw leg finds feet on the synthetic pulse', row != null && Number.isFinite(row.feetRaw) && row.feetRaw > 10);
    ok('both legs report a finite shift median, so the pairing found partners', row != null && Number.isFinite(row.shiftMedianMs));
    ok('the realm defines ConsensusDissent by name — the module whose absence refuses every recording', typeof worker.ConsensusDissent === 'object' && worker.ConsensusDissent !== null);
    ok('CONTROL · a name no file defines reads undefined in the same realm, so the leg above is not vacuous', typeof worker.NoSuchModuleHere === 'undefined');

    /* ∅ CONTROL · A FINGER RECORD WITH NO MARKER IS REACHABLE WITH A MEASURED ZERO, which is not the
       same fact as a layout the mask never covered. Both read 0 movement; only one was looked at. */
    const clean = maskOne(worker, syntheticFingerPpg({ markerEvery: 0 }));
    ok('a finger record carrying no marker is REACHABLE with a measured zero', clean.reachable === true && clean.gapSamples === 0);
    ok('and holding nothing moves no foot', clean.feetRaw === clean.feetHeld && clean.lost === 0 && clean.gained === 0);

    /* ∅ CONTROL · THE WRIST LAYOUT IS EXCLUDED BY THE DSP'S OWN SITE RULE, not by a filename. */
    const wrist = ['Phone timestamp;sensor timestamp [ns];channel 0;channel 1;channel 2;ambient'];
    for (let i = 0; i < 125 * 60; i++) {
      const t = i / 125;
      const iso = new Date(Date.UTC(2026, 8, 26, 22, 0, 0) + Math.round(t * 1000)).toISOString().replace('Z', '');
      const beat = Math.sin(2 * Math.PI * 1.1 * t);
      const v = (g) => Math.round(-300000 + g * 4000 * beat);
      wrist.push(`${iso};${(843960926087160899n + BigInt(Math.round(t * 1e9))).toString()};${v(1)};${v(0.9)};${v(1.1)};-614694`);
    }
    const w = maskOne(worker, wrist.join('\n'));
    ok('a wrist layout is UNREACHABLE, because 156 carries no meaning in a count stream', w.reachable === false);
    ok('and the exclusion names the DSP rule rather than a guess', /not a finger layout/.test(w.reason || ''));
  }
  console.log(`selftest: all ${ran} assertions passed`);
}

/* ── main ────────────────────────────────────────────────────────────────────────────────────── */
/* THE ARGV HELPERS SIT AT MODULE SCOPE, not inside `main`: the flag-arity scan bounds a helper's
   body at the next column-0 declaration, so an indented pair reads as ONE body (row
   2026-11-01-the-flag-arity-scan-bounds-a-helper-body-at-column-0). */
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => {
  const i = argv.indexOf(f);
  return i === -1 ? null : argv[i + 1];
};
async function main() {
  refuseUnknownArgvOrExit(argv, { valued: ['--limit', '--tree'], boolean: ['--check', '--json', '--selftest', '--verdict-sample'] }, { tool: 'pat-mask-census' });
  if (has('--selftest')) {
    await selftest();
    process.exit(process.exitCode || 0);
  }
  if (has('--verdict-sample')) {
    /* A walk over a root that cannot exist: it reads no recording, so the one builder above prints
       NOT_RUN — the status that says it examined nothing, never a PASS over an empty set. */
    const paired = pairRecordings(resolve(ROOT, 'no-such-tree-for-a-verdict-sample'));
    printVerdict(buildVerdict({ rows: [], refused: 0, unreachable: 0, eligible: 0, scanned: paired.scanned, treeReason: paired.reason }));
    process.exit(0);
  }
  const limitRaw = valueOf('--limit');
  const limit = limitRaw == null ? SAMPLE_DEFAULT : Number(limitRaw);
  if (!Number.isFinite(limit) || limit < 1) {
    console.error(`${TOOL}: --limit must be a positive number, read ${String(limitRaw)}`);
    process.exit(2);
  }
  const tree = valueOf('--tree') || resolveCorpus(ROOT);
  /* THE POPULATION THIS ROOT OFFERS is published by `tools/pat-pinned-move.mjs`, which walks the
     same `_PPG.txt` set under the same root. One census per population movement claim is enough; a
     second snapshot here would print a second verdict about the same walk. */
  const paired = pairRecordings(String(tree));
  const all = [...paired.withCompanion, ...paired.withoutCompanion].sort();
  const sample = sampleOf(all, limit);
  const rows = [];
  let refused = 0;
  let unreachable = 0;
  let worker = null;
  if (sample.length) worker = await loadWorker();
  for (const p of sample) {
    const rec = maskRecord(p);
    let text = null;
    if (!existsSync(p)) {
      refused++;
      console.log(`  ⊘ ${rec} — it left the tree between the walk and the read`);
      continue;
    }
    try {
      text = readFileSync(p, 'utf8');
    } catch (e) {
      refused++;
      console.log(`  ⊘ ${rec} — unreadable: ${(e && e.message) || e}`);
      continue;
    }
    let row = null;
    try {
      row = maskOne(worker, text);
    } catch (e) {
      refused++;
      console.log(`  ⊘ ${rec} — ${String((e && e.message) || e)}`);
      text = null;
      continue;
    }
    text = null; // one recording at a time: the next read must not wait on this buffer
    if (!row.reachable) {
      unreachable++;
      console.log(`  ⊘ ${rec} — ${row.reason}`);
      continue;
    }
    rows.push({ rec, ...row });
    console.log(
      `  ${row.movesBar ? '△' : '='} ${rec} — ${row.gapSamples} marker sample(s) held · feet ${row.feetRaw} raw · ${row.feetHeld} held · shift median ${row.shiftMedianMs.toFixed(2)} ms · IQR ${row.shiftIqrMs.toFixed(2)} ms · ${row.lost} lost · ${row.gained} gained (${row.lostGainedPct.toFixed(2)} %) · ${row.feetBeyondTol} past ${PAIR_TOL_MS} ms`
    );
  }
  const verdict = buildVerdict({ rows, refused, unreachable, eligible: all.length, scanned: paired.scanned, treeReason: paired.reason });
  const sum = summarise(rows);
  console.log(
    `pat-mask-census: ${rows.length} of ${all.length} recording(s) reachable under ${displayTree(String(tree))} · ${unreachable} wrist layout · ${refused} refused · ${sum.movers === null ? 'no mover share' : `${sum.movers} past the bar`}`
  );
  printVerdict(verdict, { json: has('--json') });
  process.exit(verdict.status === 'FAIL' ? 1 : verdict.status === 'NOT_RUN' ? 2 : 0);
}

if (isCliEntry(import.meta.url)) await main();

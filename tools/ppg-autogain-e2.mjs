#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * ppg-autogain-e2.mjs — PPGDEX-ALGORITHM-DEEP-DIVE §6 experiment E-2, punch-list item 9
 * ------------------------------------------------------------------------------------------------
 * Item 9 reads "Autogain step detect + repair before filtering", and its risk column read
 * "One verifier measured net benefit ~= 0; measure before merging". That verdict had no apparatus
 * and no evidence path: `autogain` appeared in no source file in the tree, and the claim lived only
 * in the brief's own table cell. This tool is the measurement the cell asked for.
 *
 * WHAT IS BEING ASKED. §1.5: Polar confirms an automatic LED-intensity control that produces abrupt
 * DC level shifts, measured here at 39 steps in one night on ch0, 5-25x the pulse AC. `filtfilt` is
 * zero-phase, so the filter rings on BOTH sides of such a step. Does repairing the steps before
 * filtering move a beat-to-beat statistic at all?
 *
 * EVERY CRITERION IS PRE-STATED, in this header, because a threshold derived from the data it judges
 * is UNKNOWN (CLAUDE.md §🧾).
 *
 *  1 · DETECTOR, on the RAW chosen channel pre-filter (the row's own site). 1 s block medians; a step
 *      is the |delta| of consecutive block medians. The robust scale is the median over blocks of
 *      (p75-p25)/1.349 WITHIN a block, so a step — which sits BETWEEN blocks — cannot inflate the
 *      scale that judges it. That feedback is the one the widen derivation at `ppgdex-dsp.js`
 *      warns about in as many words.
 *  2 · DETECTION BOUND = 5 robust sd. §1.5's steps are 6k-33k counts against a ~1.2k peak-to-peak
 *      pulse AC, i.e. ~14-77 robust sd, and the shipped widen test plants 26 sd. 5 sd sits ~2.8x
 *      BELOW the smallest documented step, so the detector over-counts rather than under-counts and
 *      cannot be tuned toward an answer.
 *  3 · RINGING WINDOW = `PPGDSP.settlingWidenSec(displacement, scale, 0.5, true)` each side of the
 *      step. That is the node's own derived settling model — logarithmic in the excursion, tau
 *      doubled for a zero-phase filter — at the high-pass corner the detector path actually uses
 *      (`bandpass(chan, fs, 0.5, 8.0)`). The function is exported and unit-tested; this is its first
 *      reader over real recordings.
 *  4 · ENDPOINT = rMSSD. Removal is the CEILING of what a repair can buy: repairing the
 *      ringing-damaged beats and dropping them both converge on the clean population's statistic.
 *      So the measurement is |rMSSD(all pairs) - rMSSD(pairs clear of every window)|, and the
 *      pre-stated bar is 0.35 ms — a tenth of the 3.51 ms that §2.1's closed form puts at 1 % RMSSD
 *      bias. Below it, nothing a step repair can reach moves a whole-record statistic.
 *  5 · POSITIVE CONTROL, exact. The statistic is not reimplemented: `rmssdExact` mirrors
 *      `ppgdex-dsp.js`'s own successive-difference loop (same clean-pair rule, same adjacency rule,
 *      same fallback), and the run asserts that it reproduces the shipped `r.rmssd` to the node's own
 *      rounding on every night. rMSSD never reads `timeDomain`'s `omit` argument, which only filters
 *      SDNN's base, so `cleanMask` + `adj` — both reconstructible from the analyze result — are the
 *      whole input to the controlled endpoint. The first version of this probe DID reimplement the
 *      statistic and the control caught it at 1.3 ms on night one.
 *  6 · NEGATIVE CONTROL, and it is the one that decides this. Dropping ANY 1-6 % of the pairs moves
 *      rMSSD somewhat, so a delta means nothing until it is read against a null: the same number of
 *      windows with the same widths, re-centred uniformly at random over the record, 40 seeded draws.
 *      The window set then differs from the real one only in WHERE it sits, so the null carries the
 *      arithmetic of removal and not the hypothesis. An effect counts only above the null's p95.
 *  7 · ATTRIBUTION — `--ac-quiet`. A level-jump detector also fires on motion, which damages beats by
 *      its own mechanism, so the unfiltered table cannot attribute what it finds. §1.5 describes
 *      autogain as a change of LEVEL; motion moves the level AND inflates the AC. So the
 *      discriminator is the within-block AC on either side of the step against the night's own robust
 *      scale: a step is AC-QUIET when max(iqr[b-1], iqr[b]) < 2x scale. The 2x bound is generous
 *      toward CALLING a motion step autogain, so it over-states the autogain share — an effect that
 *      survives it is the conservative direction.
 *
 * MEASURED 2026-10-19 over 32 Verity nights. The positive control reproduced the shipped rMSSD on
 * 32 of 32. Fifteen nights carry a physiological rMSSD (28.9-42.0 ms); the other seventeen read
 * 158-315 ms, which no PPG HRV reading should produce, and every one of them fails its own null —
 * the negative control refuses them without a hand-drawn eligibility line, which is why none is
 * needed.
 *
 *   ALL level steps >= 5 sd:  1062 steps over the 15 nights, median 12.1/h, median widen 3.13 s each
 *                             side. Median |delta rMSSD| 0.476 ms; 11 of 15 nights clear BOTH the
 *                             0.35 ms bar and their own null p95, at 7-33x the null median. The
 *                             windows touch a median 1.68 % of kept intervals, and the shipped clean
 *                             mask had already excluded only 8 % of them (median).
 *   AC-QUIET steps only:      245 of those 1062 steps survive the discriminator (23 %). Median
 *                             |delta rMSSD| falls to 0.147 ms — 32 % of the unfiltered delta — and
 *                             only 2 of the 15 nights still clear the 0.35 ms bar.
 *
 * SO THE ANSWER TO E-2 IS NO, and now for a stated reason rather than an unsourced cell: the ceiling
 * on an autogain-attributable repair is 0.147 ms of rMSSD, measured, under a bar set from §2.1's
 * published closed form, and over-stated by a discriminator deliberately generous to the hypothesis.
 *
 * WHAT DOES NOT SURVIVE is the generalisation. The same detector WITHOUT the discriminator selects a
 * population that is small (median 1.68 % of kept intervals), almost entirely still counted as clean
 * (92 %), and carrying beat-to-beat variability far beyond a matched random window set. That residue
 * is motion-shaped, not autogain-shaped, and it belongs to a different item.
 *
 * WHAT THIS CANNOT SAY. The endpoint is PPG-internal: no ECG reference is read, so the measurement
 * says those intervals carry excess variability, never that they are WRONG. An ECG-paired follow-up
 * could say which direction the error runs — and should remember that an endpoint scoring only
 * ECG-paired beats is blind to any effect that lives where the pairing fails.
 *
 * THE POPULATION IS A STATED RULE, not a hand-picked list: every `*_PPG.txt` under `--dir` whose
 * name carries the wrist device's prefix and whose size is at least `--min-mb` (default 20 MB, which
 * at this sample rate is about 1.4 h of recording). The capture tree holds hundreds of
 * minute-long fragments beside the recordings, and a rule that admits them would report a population
 * nobody can reconstruct. Measured over the 37 recordings that rule finds in the August capture tree.
 *
 * USAGE
 *   node tools/ppg-autogain-e2.mjs --dir <captures> [--ac-quiet] [--max-nights 40] [--min-mb 20] [--json]
 *   node tools/ppg-autogain-e2.mjs --json          # no corpus: one NOT_RUN verdict object
 *   node tools/ppg-autogain-e2.mjs --selftest
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
import vm from 'node:vm';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
};
const SELFTEST = has('--selftest');
const JSON_OUT = has('--json');
const DIR = opt('--dir', null);
const AC_QUIET = has('--ac-quiet');
const MAX_NIGHTS = +opt('--max-nights', 40);
const MIN_MB = +opt('--min-mb', 20);
const DEVICE = String(opt('--device', 'verity')).toLowerCase();
const DEVICE_RE = DEVICE === 'any' ? /_PPG\.txt$/i : /Polar_(VeritySense|Sense)_.*_PPG\.txt$/i;

/* ═══════════════════════════ THE PRE-STATED CONSTANTS, IN ONE PLACE ════════════════════════════ */
export const SD_BOUND = 5; // detection bound, robust sd — §1.5's smallest step is ~2.8x this
export const AC_BOUND = 2; // a step is AC-quiet when the adjacent-block AC stays under 2x scale
export const BLOCK_SEC = 1; // block median width
export const F_HP = 0.5; // the detector path's high-pass corner
export const CEIL_MS = 0.35; // a tenth of §2.1's 3.51 ms (1 % RMSSD bias)
export const NULL_DRAWS = 40;
// An ELIGIBILITY bound, and the status below reads it: a night whose whole-record rMSSD runs to
// 200-320 ms is not a resting pulse the detector is stepping on, it is a record of motion, and the
// statistic the criterion is stated over does not describe it. 150 ms sits far above any plausible
// resting rMSSD and far below those nights, so no night lands near the line. The bound is stated
// here, before any count — and both medians print below, so a reader can see the answer does not
// turn on it.
export const RMSSD_PHYSIOLOGICAL_MAX = 150;

/* ═════════════════════════════════════ THE PURE PARTS ══════════════════════════════════════════ */
export function quantileSorted(a, p) {
  if (!a.length) return null;
  const b = Array.prototype.slice.call(a).sort((x, y) => x - y);
  const i = (b.length - 1) * p;
  const lo = Math.floor(i),
    hi = Math.ceil(i);
  return lo === hi ? b[lo] : b[lo] + (b[hi] - b[lo]) * (i - lo);
}

/* A block carrying fewer finite samples than this is ABSENT, not a level (§∅). */
export const MIN_FINITE_SHARE = 0.5;

/* Per-block median and robust AC. The AC is measured WITHIN a block, so a step between blocks never
   enters the scale that judges it (criterion 1). An absent block is NaN in both series and counted,
   never a level: the edge of a blanking run is not a gain change, and a zero-filled run would read as
   the largest step in the record. */
export function blockStats(x, width) {
  const nB = Math.floor(x.length / width);
  const med = new Float64Array(nB),
    iqr = new Float64Array(nB);
  const buf = new Float64Array(width);
  let absent = 0;
  for (let b = 0; b < nB; b++) {
    let m = 0;
    for (let k = 0; k < width; k++) {
      const v = x[b * width + k];
      if (Number.isFinite(v)) buf[m++] = v;
    }
    if (m < width * MIN_FINITE_SHARE) {
      med[b] = NaN;
      iqr[b] = NaN;
      absent++;
      continue;
    }
    const seen = buf.subarray(0, m);
    med[b] = quantileSorted(seen, 0.5);
    iqr[b] = (quantileSorted(seen, 0.75) - quantileSorted(seen, 0.25)) / 1.349;
  }
  const seenIqr = iqr.filter((v) => Number.isFinite(v));
  return { med, iqr, nB, absent, scale: seenIqr.length ? quantileSorted(seenIqr, 0.5) : null };
}

/* Steps as block-median jumps at or beyond `sdBound` robust sd. `acQuiet` applies criterion 7. */
export function detectLevelSteps(st, tOfBlock, sdBound, acQuiet, acBound) {
  const at = [],
    disp = [];
  let dropped = 0,
    absentSkipped = 0;
  /* No scale, no bound: the night keeps no step rather than measuring every jump against zero. */
  if (!(st.scale > 0)) return { at, disp, dropped, absentSkipped, refused: true };
  for (let b = 1; b < st.nB; b++) {
    if (!Number.isFinite(st.med[b]) || !Number.isFinite(st.med[b - 1])) {
      absentSkipped++;
      continue;
    }
    const d = Math.abs(st.med[b] - st.med[b - 1]);
    if (!(d >= sdBound * st.scale)) continue;
    if (acQuiet && Math.max(st.iqr[b - 1], st.iqr[b]) >= acBound * st.scale) {
      dropped++;
      continue;
    }
    at.push(tOfBlock(b));
    disp.push(d);
  }
  return { at, disp, dropped, absentSkipped, refused: false };
}

/* A seeded LCG, so a run is reproducible and no draw reads Math.random. */
export function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/* An exact mirror of ppgdex-dsp.js's successive-difference loop: the same clean-pair rule, the same
   adjacency rule, the same no-clean-pair fallback. `extra` is this tool's window exclusion. The node
   rounds its own rmssd to 1 dp, a grid too coarse to read a 0.35 ms bar off, which is why the
   measurement runs here and the node's `timeDomain` stays as the control. */
export function rmssdExact(nn, clean, adj, extra) {
  let sumSq = 0,
    cnt = 0;
  for (let i = 1; i < nn.length; i++) {
    if (clean && !(clean[i - 1] && clean[i])) continue;
    if (adj && adj[i] === false) continue;
    if (extra && (extra[i] || extra[i - 1])) continue;
    const d = nn[i] - nn[i - 1];
    sumSq += d * d;
    cnt++;
  }
  if (cnt < 1) {
    sumSq = 0;
    cnt = 0;
    for (let i = 1; i < nn.length; i++) {
      const d = nn[i] - nn[i - 1];
      sumSq += d * d;
      cnt++;
    }
  }
  return { rmssd: cnt ? Math.sqrt(sumSq / cnt) : null, nPairs: cnt };
}

/* Which kept intervals a window set touches. An interval is touched when EITHER endpoint falls in a
   window — an interval is a measurement between two beats, and a damaged beat at either end is
   enough to make it one. */
export function windowMask(tt, nn, centres, widens) {
  const ex = new Uint8Array(nn.length);
  const inW = (t) => {
    for (let i = 0; i < centres.length; i++) if (t >= centres[i] - widens[i] && t <= centres[i] + widens[i]) return true;
    return false;
  };
  let n = 0;
  for (let i = 0; i < nn.length; i++) {
    const t1 = tt[i],
      t0 = t1 - nn[i] / 1000;
    if (inW(t0) || inW(t1)) {
      ex[i] = 1;
      n++;
    }
  }
  return { ex, n };
}

/* The union of the windows, in seconds — reported so the share of the record under suspicion is
   visible beside the share of intervals. */
export function unionSec(centres, widens) {
  const iv = centres.map((t, i) => [t - widens[i], t + widens[i]]).sort((a, b) => a[0] - b[0]);
  let total = 0,
    cs = null,
    ce = null;
  for (const [a, b] of iv) {
    if (cs === null) {
      cs = a;
      ce = b;
    } else if (a <= ce) {
      if (b > ce) ce = b;
    } else {
      total += ce - cs;
      cs = a;
      ce = b;
    }
  }
  if (cs !== null) total += ce - cs;
  return total;
}

/* Criterion 6: the same windows, re-centred at random. */
export function nullDeltas(tt, nn, clean, adj, widens, durSec, base, draws, rand) {
  const out = [];
  for (let d = 0; d < draws; d++) {
    const centres = widens.map(() => rand() * durSec);
    const { ex } = windowMask(tt, nn, centres, widens);
    const k = rmssdExact(nn, clean, adj, ex);
    if (k.rmssd != null && base != null) out.push(Math.abs(k.rmssd - base));
  }
  return out;
}

/* ═══════════════════════════════════════ SELFTEST ══════════════════════════════════════════════ */
function selftest() {
  let fail = 0;
  const ok = (c, m) => {
    if (!c) fail++;
    console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`);
  };

  /* A plant with a known step: 200 blocks of a 1.1 Hz pulse, the level jumping by 20 sd at block 100. */
  const fs = 50,
    nBlk = 200;
  const x = new Float64Array(fs * nBlk);
  for (let i = 0; i < x.length; i++) x[i] = 1000 + 10 * Math.sin((2 * Math.PI * 1.1 * i) / fs) + (i >= fs * 100 ? 400 : 0);
  const st = blockStats(x, fs);
  ok(st.nB === nBlk, `blockStats splits the plant into ${st.nB} blocks of ${fs}`);
  ok(st.scale > 0, `the robust scale is positive (${st.scale.toFixed(2)})`);
  const steps = detectLevelSteps(st, (b) => b * BLOCK_SEC, SD_BOUND, false, AC_BOUND);
  ok(steps.at.length === 1, `exactly one step is found (${steps.at.length})`);
  ok(Math.abs(steps.at[0] - 100) <= 1, `and it is found at the planted block (t=${steps.at[0]} s)`);

  /* THE SCALE MUST NOT BE INFLATED BY THE STEP — criterion 1. A whole-record sd would be; the
     within-block AC is not, so adding the step must leave the scale essentially where it was. */
  const flat = new Float64Array(x.length);
  for (let i = 0; i < flat.length; i++) flat[i] = x[i] - (i >= fs * 100 ? 400 : 0);
  const sFlat = blockStats(flat, fs).scale;
  ok(Math.abs(st.scale - sFlat) < 0.02 * sFlat, `the step does not move the scale that judges it (${st.scale.toFixed(3)} vs ${sFlat.toFixed(3)})`);

  /* AC-QUIET — criterion 7. The same step with the AC inflated around it must be dropped. */
  const noisy = Float64Array.from(x);
  for (let i = fs * 99; i < fs * 101; i++) noisy[i] += 300 * Math.sin(i * 1.7);
  const dq = detectLevelSteps(blockStats(noisy, fs), (b) => b * BLOCK_SEC, SD_BOUND, true, AC_BOUND);
  ok(dq.dropped >= 1 && dq.at.length === 0, `an AC-inflated step is dropped by the discriminator (${dq.dropped} dropped, ${dq.at.length} kept)`);
  const dqClean = detectLevelSteps(st, (b) => b * BLOCK_SEC, SD_BOUND, true, AC_BOUND);
  ok(dqClean.at.length === 1, 'while the AC-quiet step survives it, so the filter is not simply empty');

  /* ABSENCE IS NOT A LEVEL (∅). A blanked run returned as non-finite samples must read as absent
     blocks, and the two edges of that run must not read as the two largest steps in the record. */
  const blanked = Float64Array.from(x);
  for (let i = fs * 150; i < fs * 160; i++) blanked[i] = NaN;
  const stB = blockStats(blanked, fs);
  ok(stB.absent === 10, `a 10 s blanked run reads as ${stB.absent} absent block(s)`);
  const dB = detectLevelSteps(stB, (b) => b * BLOCK_SEC, SD_BOUND, false, AC_BOUND);
  ok(dB.at.length === 1 && Math.abs(dB.at[0] - 100) <= 1, `and the only step found is still the planted one (${dB.at.length} step(s))`);
  ok(dB.absentSkipped === 11, `with ${dB.absentSkipped} block pair(s) skipped for absence`);

  /* A record with no measurable AC has no bound, so it REFUSES rather than judging every jump
     against zero. */
  const steppy = new Float64Array(fs * 4);
  for (let i = 0; i < steppy.length; i++) steppy[i] = i < fs * 2 ? 10 : 400;
  const dR0 = detectLevelSteps(blockStats(steppy, fs), (b) => b * BLOCK_SEC, SD_BOUND, false, AC_BOUND);
  ok(dR0.refused === true && dR0.at.length === 0, `a scale-less record refuses (refused=${dR0.refused}, ${dR0.at.length} step(s))`);

  /* THE MIRROR IS THE SHIPPED LOOP. A series with one bad pair, excluded two ways. */
  const nn = [900, 905, 898, 902, 1400, 899, 903];
  const adj = nn.map(() => true);
  const all = rmssdExact(nn, null, adj, null);
  const ex = new Uint8Array(nn.length);
  ex[4] = 1;
  const cut = rmssdExact(nn, null, adj, ex);
  ok(cut.rmssd < all.rmssd / 3, `dropping the one bad interval collapses rMSSD (${all.rmssd.toFixed(1)} -> ${cut.rmssd.toFixed(1)} ms)`);
  ok(cut.nPairs === all.nPairs - 2, 'and it removes BOTH pairs the interval sat in, not one');
  const clean = nn.map((_, i) => i !== 4);
  ok(Math.abs(rmssdExact(nn, clean, adj, null).rmssd - cut.rmssd) < 1e-9, 'the clean-pair rule and the window exclusion agree when they name the same interval');
  const noAdj = nn.map((_, i) => i !== 3);
  ok(rmssdExact(nn, null, noAdj, null).nPairs === all.nPairs - 1, 'a pair whose members were not input neighbours is not a pair');
  const allEx = new Uint8Array(nn.length).fill(1);
  ok(rmssdExact(nn, null, adj, allEx).nPairs === all.nPairs, 'excluding everything falls back to all pairs rather than returning null');

  /* THE NULL HAS TO BE ABLE TO FIRE. Re-centred windows over a series with ONE bad interval mostly
     miss it, so the null median must sit far below the real delta. */
  const tt = nn.map((_, i) => 10 + i * 10);
  const nd = nullDeltas(tt, nn, null, adj, [1.5], 400, all.rmssd, 200, prng(7));
  ok(nd.length === 200, `the null draws all 200 samples (${nd.length})`);
  ok(
    quantileSorted(nd, 0.5) < Math.abs(cut.rmssd - all.rmssd) / 2,
    `and its median sits well below the real delta (${quantileSorted(nd, 0.5).toFixed(2)} vs ${Math.abs(cut.rmssd - all.rmssd).toFixed(2)} ms)`
  );
  const r1 = nullDeltas(tt, nn, null, adj, [1.5], 400, all.rmssd, 20, prng(7));
  const r2 = nullDeltas(tt, nn, null, adj, [1.5], 400, all.rmssd, 20, prng(7));
  ok(r1.join(',') === r2.join(','), 'the seeded draw is reproducible');

  ok(Math.abs(unionSec([10, 12], [3, 3]) - 8) < 1e-9, `overlapping windows union rather than double-count (${unionSec([10, 12], [3, 3])} s)`);
  ok(Math.abs(unionSec([10, 100], [2, 2]) - 8) < 1e-9, 'and disjoint ones add');

  /* `tt[i]` is the time of the beat that CLOSES interval i, so interval i spans
     [tt[i] - nn[i]/1000, tt[i]] and one beat is shared by two intervals. */
  const wm = windowMask([10, 11, 12], [1000, 1000, 1000], [11], [0.1]);
  ok(wm.n === 2, `a window over one beat touches both intervals that beat bounds (${wm.n})`);
  /* A window that falls strictly BETWEEN two beats displaces neither, so it touches no interval.
     The rule is deliberate - ringing corrupts an interval by moving a beat, and the beats are the
     endpoints - and on the corpus it is moot: a measured widen is ~3.1 s each side against ~1.2 s
     intervals, so a real window always reaches an endpoint. */
  ok(windowMask([10, 11, 12], [1000, 1000, 1000], [11.5], [0.1]).n === 0, 'a window falling between two beats displaces neither, so it touches nothing');

  console.log(fail ? `\nselftest: ${fail} FAILURE(S)` : '\nselftest: all green');
  return fail;
}

if (SELFTEST) process.exit(selftest() ? 1 : 0);

/* ═══════════════════════════════════════ CORPUS RUN ════════════════════════════════════════════ */
const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
})();
const emit = (status, population, result, reason) => {
  const v = Verdict.make({
    gate: 'experiment-e2-autogain-step-repair',
    status,
    population,
    criterion: { name: 'ac_quiet_rmssd_delta_median', threshold: CEIL_MS, unit: 'ms', direction: 'lte' },
    result,
    evidence: ['tools/ppg-autogain-e2.mjs', 'briefs/PPGDEX-ALGORITHM-DEEP-DIVE-2026-07-21-BRIEF.md'],
    reason,
    producedBy: { tool: 'tools/ppg-autogain-e2.mjs', commit }
  });
  const bad = Verdict.validate(v);
  if (bad && bad.length) {
    console.error('verdict does not validate: ' + bad.join('; '));
    process.exit(2);
  }
  console.log(JSON.stringify(v)); // the object is the API; the table above it is the prose
  return v;
};

if (!DIR) {
  emit('NOT_RUN', { checked: 0, eligible: 0, excluded: 0 }, null, 'no --dir given, so no recording was read');
  if (!JSON_OUT) console.error('need --dir <captures>  (or --selftest)');
  process.exit(0);
}

const B = await import(join(ROOT, 'tools/build-core.js'));
const classicify = B.classicify || B.default?.classicify;
const { PPG_REALM } = await import(join(ROOT, 'tools/realm-manifest.js'));
function realm(files) {
  const noop = () => {};
  const el = () => ({
    style: {},
    dataset: {},
    textContent: '',
    innerHTML: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    removeAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    append: noop,
    removeChild: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop
  });
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    addEventListener: noop,
    removeEventListener: noop,
    navigator: { userAgent: 'v' },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    document: {
      getElementById: () => null,
      createElement: el,
      createTextNode: () => ({}),
      querySelector: () => null,
      querySelectorAll: () => [],
      head: el(),
      body: el(),
      documentElement: el(),
      addEventListener: noop,
      readyState: 'complete'
    }
  };
  sb.window = sb;
  sb.self = sb;
  sb.globalThis = sb;
  const ctx = vm.createContext(sb);
  ctx.__DEX_NAMESPACED__ = true;
  for (const f of files) vm.runInContext(classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
  return sb;
}
const P = realm(PPG_REALM).PPGDSP;

const walk = (d, out = []) => {
  let ents = [];
  try {
    ents = readdirSync(d);
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = join(d, e);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(p, out);
    else if (DEVICE_RE.test(e) && s.size >= MIN_MB * 1e6) out.push(p);
  }
  return out;
};
const files = walk(DIR).sort().slice(0, MAX_NIGHTS);

console.log(`# E-2 · autogain step repair${AC_QUIET ? ' · AC-QUIET STEPS ONLY (adjacent-block AC < ' + AC_BOUND + 'x scale)' : ''}`);
console.log(`# population: ${files.length} file(s) matching ${DEVICE_RE} at >= ${MIN_MB} MB under ${DIR}`);
console.log(`# bound ${SD_BOUND} robust sd · widen = settlingWidenSec(d, scale, ${F_HP}, zeroPhase) · block ${BLOCK_SEC} s · bar ${CEIL_MS} ms · ${NULL_DRAWS} null draws`);
console.log('# night              fs    steps  st/h  s>=10 s>=20  widenMed  winSec%  beats%  intv% preExcl%   rmssd  rmssdEx     dR  nullMed nullP95  vsNull  ctrl');

const rand = prng(20261019);
const rows = [];
let checked = 0,
  excluded = 0,
  ctrlFails = 0,
  sidecars = 0,
  absentBlocks = 0;
for (const f of files) {
  let txt, runsText;
  try {
    txt = readFileSync(f, 'utf8');
    /* The validity sidecar when the capture wrote one: absence travels OUT OF BAND, so a parser that
       does not read it cannot tell a blanked run from a dark one. Phone-app exports carry no sidecar
       and `parsePinnedRuns(undefined)` returns null, so that path is the unchanged one. */
    const runsPath = f.replace(/_PPG\.txt$/i, '_PPGRUNS.txt');
    if (existsSync(runsPath)) {
      runsText = readFileSync(runsPath, 'utf8');
      sidecars++;
    }
  } catch (e) {
    console.log(`# UNREADABLE ${basename(f)}: ${e.message}`);
    excluded++;
    continue;
  }
  let rec, r;
  try {
    rec = P.parsePPG(txt, { runsText });
    txt = null;
    r = P.analyze(rec);
  } catch (e) {
    console.log(`# THREW ${basename(f)}: ${e.message}`);
    excluded++;
    continue;
  }
  const chan = rec.ch && rec.ch[r.channel],
    rel = rec.relSec,
    fsHz = rec.fs;
  if (!chan || !rel || !(fsHz > 0) || !r.nn || r.nn.length < 3) {
    console.log(`# NO SERIES ${basename(f)}`);
    excluded++;
    rec = null;
    r = null;
    continue;
  }
  const W = Math.max(2, Math.round(BLOCK_SEC * fsHz));
  const st = blockStats(chan, W);
  const steps = detectLevelSteps(st, (b) => rel[b * W], SD_BOUND, AC_QUIET, AC_BOUND);
  absentBlocks += st.absent;
  if (st.absent > 0) console.log(`# ABSENT ${basename(f)}: ${st.absent} of ${st.nB} block(s) carry too few finite samples to hold a level`);
  if (steps.refused) {
    console.log(`# NO SCALE ${basename(f)}: no block holds a measurable AC, so no bound exists to judge a jump against`);
    excluded++;
    rec = null;
    r = null;
    continue;
  }
  let s10 = 0,
    s20 = 0;
  for (const d of steps.disp) {
    if (d >= 10 * st.scale) s10++;
    if (d >= 20 * st.scale) s20++;
  }
  const widens = steps.disp.map((d) => P.settlingWidenSec(d, st.scale, F_HP, true) || 0);
  const durSec = r.durSec || rel[rel.length - 1] - rel[0];
  const nn = r.nn,
    tt = r.tt,
    clean = r.ppiClean,
    kIdx = r.ppiKeptIdx;
  const adj = kIdx.map((i, j) => j === 0 || i === kIdx[j - 1] + 1);
  const { ex, n: nTouched } = windowMask(tt, nn, steps.at, widens);
  const base = rmssdExact(nn, clean, adj, null);
  const kept = rmssdExact(nn, clean, adj, ex);
  /* THE CONTROL: the node's own timeDomain over the same masks must return the same statistic. */
  const shipped = P.timeDomain(nn, clean, null, adj) || {};
  const ctrlOK = base.rmssd != null && Math.abs(Math.round(base.rmssd * 10) / 10 - shipped.rmssd) < 1e-9 && Math.abs(shipped.rmssd - r.rmssd) < 1e-9;
  if (!ctrlOK) ctrlFails++;
  const dR = base.rmssd != null && kept.rmssd != null ? Math.abs(kept.rmssd - base.rmssd) : null;
  const nulls = steps.at.length ? nullDeltas(tt, nn, clean, adj, widens, durSec, base.rmssd, NULL_DRAWS, rand) : [];
  const nullP95 = nulls.length ? quantileSorted(nulls, 0.95) : null;
  const nullMed = nulls.length ? quantileSorted(nulls, 0.5) : null;
  const above = dR != null && nullP95 != null && dR > nullP95;
  let already = 0;
  for (let i = 0; i < nn.length; i++) if (ex[i] && !clean[i]) already++;
  rows.push({
    steps: steps.at.length,
    dropped: steps.dropped,
    dR,
    nullMed,
    nullP95,
    above,
    over: dR != null && dR > CEIL_MS,
    rmssd: base.rmssd,
    touchedShare: nTouched / nn.length,
    already: nTouched ? already / nTouched : 0,
    stepsPerH: steps.at.length / (durSec / 3600)
  });
  checked++;
  console.log(
    [
      basename(f)
        .replace(/_PPG\.txt$/, '')
        .slice(-15)
        .padEnd(16),
      fsHz.toFixed(2).padStart(6),
      String(steps.at.length).padStart(6),
      (steps.at.length / (durSec / 3600)).toFixed(1).padStart(6),
      String(s10).padStart(5),
      String(s20).padStart(5),
      (widens.length ? quantileSorted(widens, 0.5) : 0).toFixed(2).padStart(9),
      ((unionSec(steps.at, widens) / durSec) * 100).toFixed(2).padStart(8),
      ((steps.at.length ? nTouched / Math.max(1, r.beatTimes.length) : 0) * 100).toFixed(2).padStart(7),
      ((nTouched / nn.length) * 100).toFixed(2).padStart(6),
      (nTouched ? (already / nTouched) * 100 : 0).toFixed(0).padStart(8),
      (base.rmssd ?? NaN).toFixed(2).padStart(7),
      (kept.rmssd ?? NaN).toFixed(2).padStart(7),
      (dR ?? NaN).toFixed(3).padStart(6),
      (nullMed == null ? 'n/a' : nullMed.toFixed(3)).padStart(7),
      (nullP95 == null ? 'n/a' : nullP95.toFixed(3)).padStart(7),
      (above ? '>null' : '~null').padStart(7),
      (ctrlOK ? '  ok' : 'FAIL').padStart(5),
      AC_QUIET ? ` acDrop ${steps.dropped}` : ''
    ].join(' ')
  );
  rec = null;
  r = null;
  if (global.gc) global.gc();
}

const cleared = rows.filter((x) => x.above && x.over);
// Report the eligible count beside it: a night outside the physiological band can clear the bar on a
// statistic that describes motion, and `cleared.length` alone reads as evidence about autogain.
const clearedPhys = cleared.filter((x) => x.rmssd != null && x.rmssd <= RMSSD_PHYSIOLOGICAL_MAX);
const dRs = rows.map((x) => x.dR).filter((x) => x != null);
const phys = rows.filter((x) => x.rmssd != null && x.rmssd <= RMSSD_PHYSIOLOGICAL_MAX);
const physD = phys.map((x) => x.dR).filter((x) => x != null);
console.log(
  `# nights ${checked} examined, ${excluded} excluded · ${rows.reduce((a, x) => a + x.steps, 0)} steps${AC_QUIET ? ` (${rows.reduce((a, x) => a + x.dropped, 0)} dropped by the discriminator)` : ''}`
);
console.log(
  `# median |delta rMSSD| ${dRs.length ? quantileSorted(dRs, 0.5).toFixed(3) : 'n/a'} ms over all nights, ${physD.length ? quantileSorted(physD, 0.5).toFixed(3) : 'n/a'} ms over the ${phys.length} with a physiological rMSSD`
);
console.log(
  `# ${cleared.length} night(s) clear both the ${CEIL_MS} ms bar and their own null p95, ${clearedPhys.length} of them in the physiological band · control reproduced the shipped rMSSD on ${checked - ctrlFails}/${checked}`
);
console.log(`# validity sidecars read: ${sidecars} of ${files.length} recording(s) · absent blocks skipped: ${absentBlocks}`);

const medPhys = physD.length ? quantileSorted(physD, 0.5) : null;
// medPhys is null when no readable night sits in the physiological rMSSD band: that is no population
// to decide over, and `null <= CEIL_MS` would read as a PASS.
const status = ctrlFails > 0 ? 'UNKNOWN' : checked === 0 ? 'NOT_RUN' : !AC_QUIET ? 'NOT_APPLICABLE' : medPhys == null ? 'UNDERPOWERED' : medPhys <= CEIL_MS ? 'PASS' : 'FAIL';
emit(
  status,
  { checked, eligible: checked + excluded, excluded },
  checked
    ? {
        acQuiet: AC_QUIET,
        steps: rows.reduce((a, x) => a + x.steps, 0),
        droppedByDiscriminator: rows.reduce((a, x) => a + x.dropped, 0),
        medianDeltaRmssdMs: dRs.length ? +quantileSorted(dRs, 0.5).toFixed(3) : null,
        medianDeltaRmssdPhysiologicalMs: medPhys != null ? +medPhys.toFixed(3) : null,
        physiologicalNights: phys.length,
        nightsClearingBarAndNull: cleared.length,
        nightsClearingBarAndNullPhysiological: clearedPhys.length,
        medianTouchedIntervalShare: phys.length
          ? +quantileSorted(
              phys.map((x) => x.touchedShare),
              0.5
            ).toFixed(4)
          : null,
        medianAlreadyExcludedShare: phys.length
          ? +quantileSorted(
              phys.map((x) => x.already),
              0.5
            ).toFixed(4)
          : null,
        recordingsWithValiditySidecar: sidecars,
        absentBlocksSkipped: absentBlocks,
        controlReproducedShippedRmssd: `${checked - ctrlFails}/${checked}`
      }
    : null,
  ctrlFails > 0
    ? `the positive control missed on ${ctrlFails} night(s), so no delta here is interpretable`
    : checked === 0
      ? `no readable recording under ${DIR}`
      : medPhys == null
        ? 'no readable night sits in the physiological rMSSD band, so there is nothing to decide over'
        : !AC_QUIET
          ? 'the criterion is stated over AC-QUIET steps; this run does not apply the discriminator and so decides nothing about autogain'
          : null
);

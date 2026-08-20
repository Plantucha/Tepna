#!/usr/bin/env node
/*
 * tools/buzz-fiducial-correlate.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * O2RING-BUZZ-FIDUCIAL step 2/3 — correlate a commanded APERIODIC buzz sequence against the ring's own
 * motion channel, and report the host-axis residual.
 *
 * THE IDEA. The box fires 0x83 on an aperiodic schedule (e.g. gaps [1,4,2,6,3] s); each buzz lands a
 * ~1.1 s spike in the ring's motion column (step 1, measured 2026-08-19: peak 22, motion is the detector).
 * Because the schedule is aperiodic, the alignment between the detected spikes and the commanded gaps is
 * UNIQUE — the mod-one-beat ambiguity that defeats a rhythmic tap cannot occur. Once aligned, the spread
 * of (onset gap − commanded gap) IS the host-axis residual: how faithfully the ring's motion timeline
 * tracks the box's command clock. Small residual → the ring pleth's host-axis placement is validated;
 * a large one localises the error.
 *
 * Input is the buzz capture in PSL/PPG2W column format (probe_buzz_fiducial.py's output): host-stamped
 * rows with a `motion` column. You supply the commanded GAP schedule (relative, seconds) — not absolute
 * command times — because the aperiodic gaps align the sequence on their own.
 *
 * A RULER, not a clock: onset timing is bounded by the ~1 s raw-buffer back-timing (step 1), so the
 * residual it reports is coarse until the 125 Hz pleth path is used. It still separates "the schedule
 * fired and was seen" from "it was not", and quantifies the gap-tracking error either way.
 *
 * Usage: node tools/buzz-fiducial-correlate.mjs --ppg2w <buzz.txt> --gaps 1,4,2,6,3 [--tol 1.5]
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';

const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};

/** Parse a PPG2W/PSL row's `YYYY-MM-DDThh:mm:ss.mmm` stamp → floating seconds (Clock Contract). PURE. */
export function parseHostS(s) {
  const m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})/.exec(s || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) / 1000 : null;
}

/** Read a PPG2W-format capture → [{t, motion}] in host seconds. */
export function readMotion(path) {
  const L = fs.readFileSync(path, 'utf8').trim().split('\n').slice(1);
  const out = [];
  for (const ln of L) {
    const p = ln.split(';');
    const t = parseHostS(p[0]);
    const mo = Number(p[4]);
    if (t != null && Number.isFinite(mo)) out.push({ t, motion: mo });
  }
  return out;
}

/** Motion-spike onsets: the leading edge of each run where motion rises above `thr` after being quiet
 *  for at least `refractoryS`. Returns onset times (s). PURE. `thr` defaults to a data-driven level:
 *  a fraction of the max above the median (a still baseline is ~0, so this is forgiving). */
export function detectOnsets(series, { thr = null, refractoryS = 0.5 } = {}) {
  if (series.length === 0) return [];
  const mo = series.map((r) => r.motion);
  const sorted = [...mo].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  const max = sorted[sorted.length - 1];
  const level = thr != null ? thr : median + 0.35 * (max - median);
  const onsets = [];
  let armed = true; // armed = ready to detect a new rising edge
  let lastOnset = -Infinity;
  for (const r of series) {
    if (armed && r.motion > level && r.t - lastOnset >= refractoryS) {
      onsets.push(r.t);
      lastOnset = r.t;
      armed = false;
    } else if (!armed && r.motion <= level) {
      armed = true; // fell back to quiet → ready for the next spike
    }
  }
  return onsets;
}

/** Align a run of detected onsets to a commanded aperiodic gap schedule. Slides a window of
 *  (gaps.length + 1) consecutive onsets and picks the offset whose inter-onset gaps best match the
 *  commanded gaps (min sum-abs-error). Returns the matched onset times, the per-gap error, and the
 *  residual (RMS of gap errors, ms) — or null if no window is within `tolS` on every gap. PURE. */
export function matchSchedule(onsets, gaps, tolS = 1.5) {
  const need = gaps.length + 1;
  if (onsets.length < need) return null;
  let best = null;
  for (let i = 0; i + need <= onsets.length; i++) {
    const win = onsets.slice(i, i + need);
    const errs = [];
    let ok = true;
    for (let k = 0; k < gaps.length; k++) {
      const e = win[k + 1] - win[k] - gaps[k];
      errs.push(e);
      if (Math.abs(e) > tolS) ok = false;
    }
    if (!ok) continue;
    const sae = errs.reduce((p, c) => p + Math.abs(c), 0);
    if (best === null || sae < best.sae) {
      const rms = Math.sqrt(errs.reduce((p, c) => p + c * c, 0) / errs.length);
      best = { sae, onsets: win, gapErrorsMs: errs.map((e) => e * 1000), residualMs: rms * 1000, startIndex: i };
    }
  }
  return best;
}

function selftest() {
  let pass = 0,
    fail = 0;
  const ok = (nm, c, d = '') => {
    c ? (pass++, console.log(`  ok   ${nm}`)) : (fail++, console.log(`  FAIL ${nm}${d ? ' — ' + d : ''}`));
  };

  ok('parseHostS is floating seconds', Math.abs(parseHostS('2026-08-19T23:39:09.065') - Date.UTC(2026, 7, 19, 23, 39, 9, 65) / 1000) < 1e-9);
  ok('parseHostS rejects junk', parseHostS('nope') === null);

  // synthesise a still capture (motion 0) at 100 Hz with a ~1.1 s spike at each commanded instant
  const gaps = [2, 4, 3, 6]; // all > the 1.1 s buzz width, else adjacent spikes merge
  const cmd = [10.0]; // first buzz at t=10s
  for (const g of gaps) cmd.push(cmd[cmd.length - 1] + g);
  const LAT = 0.4; // the measured ~419 ms onset latency
  const series = [];
  for (let t = 0; t < 40; t += 0.01) {
    let m = 0;
    for (const c of cmd) if (t >= c + LAT && t < c + LAT + 1.1) m = 20;
    series.push({ t, motion: m });
  }
  const onsets = detectOnsets(series);
  ok('detects one onset per commanded buzz', onsets.length === cmd.length, `got ${onsets.length}`);
  ok('onsets sit ~LAT after the commands', Math.abs(onsets[0] - (cmd[0] + LAT)) < 0.05, `${onsets[0]}`);

  const m = matchSchedule(onsets, gaps, 1.5);
  ok('the aperiodic schedule aligns', m !== null && m.onsets.length === gaps.length + 1);
  ok('gap-tracking residual is tiny (constant latency cancels in the gaps)', m.residualMs < 30, `${m.residualMs?.toFixed(1)}ms`);

  // CONTROL 1: flat motion → no onsets → no match (the detector does not invent buzzes)
  const flat = series.map((r) => ({ t: r.t, motion: 0 }));
  ok('a still capture yields no onsets', detectOnsets(flat).length === 0);
  ok('no onsets → no schedule match', matchSchedule(detectOnsets(flat), gaps) === null);

  // CONTROL 2: a WRONG schedule does not spuriously match this run
  ok('a mismatched schedule is rejected', matchSchedule(onsets, [5, 5, 5, 5, 5], 1.5) === null);

  // CONTROL 3: real gap jitter is measured, not hidden — perturb one gap by 300 ms
  const jittered = onsets.slice();
  jittered[2] += 0.3;
  const mj = matchSchedule(jittered, gaps, 1.5);
  ok('a 300 ms gap perturbation shows in the residual', mj !== null && mj.residualMs > 80, `${mj?.residualMs?.toFixed(0)}ms`);

  // too few onsets → null, never a partial claim
  ok('fewer onsets than the schedule → null', matchSchedule([1, 2], [1, 1, 1]) === null);

  console.log(fail ? `\n${fail} FAILURE(S)` : `\n${pass} assertions — all green`);
  return fail ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  const p = arg('--ppg2w');
  const gapsRaw = arg('--gaps');
  if (!p || !gapsRaw) {
    console.log('usage: --ppg2w <buzz.txt> --gaps 1,4,2,6,3 [--tol 1.5]');
    process.exit(2);
  }
  const gaps = gapsRaw.split(',').map(Number);
  const tol = Number(arg('--tol') || 1.5);
  const series = readMotion(p);
  const onsets = detectOnsets(series);
  console.log(`  ${series.length} motion samples, ${onsets.length} spike onset(s) detected`);
  const m = matchSchedule(onsets, gaps, tol);
  if (!m) {
    console.log(`  ✗ the commanded schedule [${gaps.join(',')}] did NOT align to the detected onsets — the`);
    console.log(`    aperiodic buzz was not seen (wrong file, buzz too weak, or the schedule differs).`);
    process.exit(1);
  }
  console.log(`  ✓ schedule aligned at onset #${m.startIndex} — the aperiodic pattern is present in the motion channel`);
  console.log(`  per-gap error (ms): ${m.gapErrorsMs.map((e) => e.toFixed(0)).join(', ')}`);
  console.log(`  HOST-AXIS RESIDUAL: ${m.residualMs.toFixed(1)} ms RMS  (bounded by the ~1 s raw-buffer back-timing)`);
}

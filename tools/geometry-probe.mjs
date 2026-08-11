/*
 * geometry-probe.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * GEOMETRIC PROBES FOR THE TIMELINE-ALIGNMENT CHAIN (PAT-GEOMETRY-PROBE-2026-08-11).
 *
 * Every timeline defect found in this project has been a SHAPE, not a wrong number, and each was
 * found by eye after the wrong conclusion had already been published:
 *
 *   SATURATION  `driftRange` is bounded by the 450 ms pairing window and pins there — nine box nights
 *               over ~6 h all read 420-442, i.e. the window width reported nine times. Gated on for
 *               months as if it were a measurement.
 *   SAWTOOTH    the ECG↔PPG offset ramps and wraps mod one RR (821-1162 ms), so a fixed window slices
 *               it into something that looks like slow physiological movement.
 *   CENSORING   `[200,650]` was read as a plausibility filter; it discards up to 97.4 % of beats and
 *               leaves an EDGE-BIASED remnant that still produces a confident number.
 *   DRAWN       an axis synthesized as `index x assumed_rate` has deltas concentrated on one value.
 *               It carries no timing information yet is smoother than a real clock, so it WINS any
 *               comparison that rewards smoothness.
 *   STEP        a discontinuity smeared across one anchor gap — the O2Ring's axis steps 3796-22416 ms
 *               against the H10's 16-40, and every guard passed it.
 *
 * The probes below detect those five shapes in any series. They are the geometric analogue of mutation
 * testing: the SIGNATURE IS THE MUTANT. A probe is only trustworthy if it fires on a planted instance
 * of its own shape AND stays silent on the other four — specificity is the whole point, because a
 * detector that fires on everything would have "found" all five defects and located none. The
 * `geometry-probe` test group plants all five and asserts exactly that matrix.
 *
 * Pure functions, no I/O, no clock. Guards its own main so importing fires nothing.
 */

const asc = (a) =>
  Array.from(a)
    .filter(Number.isFinite)
    .sort((x, y) => x - y);
const qt = (s, p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN);
const med = (a) => qt(asc(a), 0.5);
const diffs = (v) => {
  const d = [];
  for (let i = 1; i < v.length; i++) if (Number.isFinite(v[i]) && Number.isFinite(v[i - 1])) d.push(v[i] - v[i - 1]);
  return d;
};

/* SATURATION — is the series pinned against a bound rather than measuring within it?
   `share` is the fraction of values within `tol` of either bound. The tell that separates a saturated
   series from one that merely spans its range is that the mass PILES UP at the edge instead of thinning
   out, so a uniform spread over the same interval must NOT trigger: at the default edge band of 10 % of
   the width a uniform series puts ~20 % of its mass in the two bands, so the 50 % threshold sits well
   clear of it. 10 % is the band, not a tuned value — the real case it must catch is nine driftRange
   values at 93-98 % of a 450 ms ceiling, and a 5 % band splits that population in half. */
export function saturation(values, lo, hi, tol) {
  const v = asc(values);
  if (v.length < 8 || !Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return { share: NaN, saturated: false, n: v.length };
  const t = Number.isFinite(tol) ? tol : 0.1 * (hi - lo);
  let edge = 0;
  for (const x of v) if (x <= lo + t || x >= hi - t) edge++;
  const share = edge / v.length;
  return { share, saturated: share >= 0.5, n: v.length, lo, hi, tol: t };
}

/* SAWTOOTH — a ramp that wraps by a roughly constant amplitude, the mod-period signature.
   A wrap is a step opposing the prevailing ramp and larger than half the candidate period. Detection
   requires BOTH: at least one wrap, and the between-wrap segments ramping in a consistent direction.
   A pure ramp has no wraps; a random walk has steps in both directions with no consistent ramp; a step
   function has one jump but no ramp. Each of those must stay silent, or this reports sawtooth on
   everything that moves. */
export function sawtooth(values, period) {
  const v = Array.from(values).filter(Number.isFinite);
  if (v.length < 12) return { wraps: 0, isSawtooth: false, n: v.length };
  const d = diffs(v);
  const typical = med(d.map(Math.abs)) || 1e-9;
  const P = Number.isFinite(period) && period > 0 ? period : qt(asc(v), 0.98) - qt(asc(v), 0.02);
  const wrapMin = Math.max(P * 0.5, typical * 8);
  const wrapIdx = [];
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) >= wrapMin) wrapIdx.push(i);
  if (!wrapIdx.length) return { wraps: 0, isSawtooth: false, n: v.length, period: P };
  // ramp direction inside each inter-wrap segment, wraps excluded
  const segSlopes = [];
  let start = 0;
  for (const w of wrapIdx.concat([d.length])) {
    const seg = [];
    for (let i = start; i < w; i++) seg.push(d[i]);
    if (seg.length >= 4) segSlopes.push(med(seg));
    start = w + 1;
  }
  if (segSlopes.length < 2) return { wraps: wrapIdx.length, isSawtooth: false, n: v.length, period: P };
  const pos = segSlopes.filter((s) => s > 0).length,
    neg = segSlopes.filter((s) => s < 0).length;
  const consistent = Math.max(pos, neg) / segSlopes.length;
  // wraps must oppose the ramp — that is what distinguishes a sawtooth from a staircase
  const rampSign = pos >= neg ? 1 : -1;
  const opposing = wrapIdx.filter((i) => Math.sign(d[i]) === -rampSign).length / wrapIdx.length;
  const amps = wrapIdx.map((i) => Math.abs(d[i]));
  return {
    wraps: wrapIdx.length,
    period: P,
    rampConsistency: consistent,
    opposingShare: opposing,
    wrapAmplitude: med(amps),
    isSawtooth: wrapIdx.length >= 1 && consistent >= 0.75 && opposing >= 0.75 && segSlopes.length >= 2,
    n: v.length
  };
}

/* CENSORING — how much of the distribution falls OUTSIDE the admissible interval, and is what survives
   edge-biased? `outside` alone understates the damage: the survivors pile against the cut, so the
   share of KEPT mass sitting in the edge band is reported too. */
export function censoring(values, lo, hi, edgeBand) {
  const v = Array.from(values).filter(Number.isFinite);
  if (v.length < 8) return { outside: NaN, censored: false, n: v.length };
  const band = Number.isFinite(edgeBand) ? edgeBand : 0.1 * (hi - lo);
  let out = 0,
    kept = 0,
    keptEdge = 0;
  for (const x of v) {
    if (x < lo || x > hi) out++;
    else {
      kept++;
      if (x <= lo + band || x >= hi - band) keptEdge++;
    }
  }
  return {
    outside: out / v.length,
    keptEdgeShare: kept ? keptEdge / kept : NaN,
    censored: out / v.length > 0.02,
    n: v.length
  };
}

/* DRAWN — was this axis synthesized as `index x assumed_rate` rather than measured?
   A constructed ladder has its inter-sample deltas concentrated on a single value; a real clock's
   deltas scatter around it.

   ⚠️ ONE TOLERANCE IS NOT ENOUGH, and the first version got this wrong in a way that produced false
   findings on real data. At a 1e-3 relative tolerance a HOST-CORRECTED axis also reads as a perfect
   ladder, because the correction is ppm-scale: at 130 Hz the deltas are 7.69 ms and the tolerance is
   0.0077 ms, while a 20.7 ppm correction changes each delta by 0.00016 ms — 48x BELOW the tolerance.
   Measured consequence: the ECG sample axis read `drawn` at exactly 1.000 on six real nights whose
   host axis was applied and working.
   So the shares are computed at THREE tolerances and the verdict is taken at the fine one. A true
   ladder is constant to floating-point exactness and holds 1.000 at every level; a ppm-corrected axis
   holds 1.000 only at the coarse level and collapses at the fine one. The coarse share is retained
   because the SPREAD across levels is the diagnosis: `1.000 / 1.000 / 1.000` is synthesized, while
   `1.000 / low / low` is corrected and was never drawn at all. */
export function drawnAxis(times, tol) {
  const d = diffs(Array.from(times));
  if (d.length < 16) return { share: NaN, shares: null, drawn: false, n: d.length };
  const m = med(d);
  const at = (t) => {
    let same = 0;
    for (const x of d) if (Math.abs(x - m) <= t) same++;
    return same / d.length;
  };
  const rel = (f) => at(Math.max(Number.EPSILON, Math.abs(m) * f));
  const shares = { fine: rel(1e-6), mid: rel(1e-4), coarse: rel(1e-3) };
  const share = Number.isFinite(tol) ? at(tol) : shares.coarse;
  return { share, shares, modal: m, drawn: shares.fine >= 0.99, n: d.length };
}

/* STEP — one discontinuity far outside the local scatter. Reported as the ratio of the largest step to
   the typical one, which is scale-free, so it does not need units or a tuned millisecond bound. */
export function stepiness(values) {
  const d = diffs(Array.from(values)).map(Math.abs);
  if (d.length < 8) return { ratio: NaN, hasStep: false, n: d.length };
  const s = asc(d);
  const typical = qt(s, 0.5) || 1e-9;
  const worst = s[s.length - 1];
  return { ratio: worst / typical, worst, typical, hasStep: worst / typical >= 20, n: d.length };
}

/* Run every probe and name which shapes fired. A series should light up AT MOST one — a series that
   lights several has not been diagnosed, it has been described. */
export function probeAll(values, opts) {
  const o = opts || {};
  const r = {
    saturation: saturation(values, o.lo, o.hi, o.tol),
    sawtooth: sawtooth(values, o.period),
    censoring: Number.isFinite(o.lo) && Number.isFinite(o.hi) ? censoring(values, o.lo, o.hi, o.edgeBand) : { censored: false },
    drawn: drawnAxis(values, o.drawnTol),
    step: stepiness(values)
  };
  r.fired = [r.saturation.saturated && 'saturation', r.sawtooth.isSawtooth && 'sawtooth', r.censoring.censored && 'censoring', r.drawn.drawn && 'drawn', r.step.hasStep && 'step'].filter(Boolean);
  return r;
}

export const PROBES = ['saturation', 'sawtooth', 'censoring', 'drawn', 'step'];

/* Planted instances of each shape. Exported so the gate uses the SAME generators the probes are
   documented against — a planted shape is this file's equivalent of a mutant, and keeping the mutants
   beside the detector is what stops the two drifting apart. */
export function plant(kind, n) {
  const N = Number.isFinite(n) ? n : 120;
  const out = [];
  for (let i = 0; i < N; i++) {
    /* Every plant except `censoring` stays INSIDE [200,650]. The first cut did not, and the bounded
       probes fired on the unbounded plants — which reads as a specificity failure of the detector when
       it is a defect of the fixture. Same trap as a mutation fixture that trips two rules at once:
       it tests neither. A plant must isolate exactly one shape. */
    if (kind === 'saturation')
      out.push(i % 2 ? 205 : 645); // pinned to both bounds
    else if (kind === 'sawtooth')
      out.push(200 + ((i * 37) % 450)); // ramp, wrap, ramp
    else if (kind === 'censoring')
      out.push(i % 3 === 0 ? 90 + i : 300 + (i % 40)); // a third outside — by design
    else if (kind === 'drawn')
      out.push(300 + i * 0.5); // an exact ladder, constant delta, in bounds
    /* A ppm-CORRECTED axis: constant deltas at a coarse tolerance, varying at a fine one. This is the
       shape that fooled the single-tolerance probe on six real nights, so it is a first-class plant —
       it must read as NOT drawn while still showing coarse-share 1.000, which IS the diagnosis.
       Kept on the SAME scale as the `drawn` plant so it stays inside [200,650]: the first cut spanned
       0-952 ms and the bounded probes fired on it, which is the isolate-one-shape rule broken by the
       very file that states it — twice now, in the same session. */
    else if (kind === 'corrected') out.push(300 + i * 0.5 - 20e-6 * (i * 0.5) * (i / N) * 0.5);
    else if (kind === 'step')
      out.push(300 + (i % 7) + (i > N / 2 ? 200 : 0)); // one jump, in bounds
    else if (kind === 'clean') out.push(300 + 20 * Math.sin(i / 9) + ((i * 2654435761) % 11) - 5);
    /* A real trend always carries scatter. A NOISELESS ramp is geometrically identical to a drawn
       ladder — constant deltas — so `drawn` firing on one is correct, not a false positive; the honest
       control is a trend with SMOOTH scatter. Hash-shaped jitter was tried first and tripped `step`,
       correctly: a hash puts occasional jumps many times the typical delta into the series, which is a
       discontinuity, not drift. A physical slow drift wobbles smoothly. */ else if (kind === 'ramp') out.push(200 + i * 2 + 1.5 * Math.sin(i / 5));
    else if (kind === 'walk') {
      // deterministic pseudo-walk: no Date/Math.random, so the gate is reproducible
      let acc = 300,
        s = 12345;
      for (let k = 0; k <= i; k++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        acc += (s / 0x7fffffff - 0.5) * 12;
      }
      out.push(acc);
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const kinds = process.argv.slice(2);
  const list = kinds.length ? kinds : ['clean', 'ramp', 'walk', ...PROBES];
  console.log('planted shape   | probes that fired');
  for (const k of list) {
    const r = probeAll(plant(k), { lo: 200, hi: 650, period: 450 });
    console.log(k.padEnd(15) + ' | ' + (r.fired.length ? r.fired.join(', ') : '(none)'));
  }
}

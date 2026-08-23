/* ════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * pat-fiducial.mjs — HALF-AMPLITUDE pulse fiducial, for EXTERNAL-METHODS-SURVEY §1.
 *
 * Ajtay et al. (2023, Biomedical Signal Processing and Control) measured beat-to-beat
 * PAT at eight reference points on the PPG waveform and reported that relative
 * imprecision is MINIMUM at the 1/2-amplitude point and MAXIMUM at the base (foot).
 * PPGDex uses the foot — the point that paper ranks worst — and PAT recovers on
 * 6 of 38 nights. §1 asks whether the fiducial is the mechanism.
 *
 * ⚠️ THIS IS AN EXPERIMENT, NOT A PROPOSED FIX, and it deliberately does NOT touch
 * `ppgdex-dsp.js`. The half-amplitude point is DERIVED from what the shipped detector
 * already emits (`bandpass` → `detectChannel` → {peaks, feet}), so the comparison
 * changes the fiducial and nothing else. Three caveats the brief records and this
 * tool cannot settle: their cohort is 35 supine volunteers over 300 s (not overnight
 * free-living); the foot is correct for pulse-wave-velocity work precisely because it
 * resists wave reflection, so this trades precision for a different property; and
 * their PPG is a lab device where ours is an arm-worn optical sensor.
 *
 * SUB-SAMPLE BY CONSTRUCTION. At 55 Hz one sample is 18 ms, which is the same order as
 * the PAT differences being chased — so the crossing is LINEARLY INTERPOLATED between
 * the bracketing samples rather than rounded to the nearer one. Rounding would put a
 * quantisation floor on the very quantity the experiment measures.
 * ════════════════════════════════════════════════════════════════════════════ */

/** Half-amplitude crossing on the rising edge foot→peak, in SAMPLES (fractional).
 *  Returns null for a beat whose edge is unusable, so callers can count coverage
 *  rather than silently receive a fabricated point. */
export function halfAmplitudeIndex(bp, footI, peakI) {
  if (!(peakI > footI) || footI < 0 || peakI >= bp.length) return null;
  const lo = bp[footI];
  const hi = bp[peakI];
  if (!(hi > lo)) return null; // not a rising edge — reject, never guess
  const half = lo + 0.5 * (hi - lo);
  for (let i = footI + 1; i <= peakI; i++) {
    if (bp[i] >= half) {
      const a = bp[i - 1];
      const b = bp[i];
      if (b === a) return i;
      return i - 1 + (half - a) / (b - a); // linear interpolation, sub-sample
    }
  }
  return null;
}

/** Both fiducials for a beat list, as SECONDS from record start. */
export function fiducialTimes(bp, peaks, feet, fs) {
  const base = [];
  const half = [];
  let nUnusable = 0;
  const n = Math.min(peaks.length, feet.length);
  for (let k = 0; k < n; k++) {
    const f = feet[k];
    const p = peaks[k];
    const h = halfAmplitudeIndex(bp, f, p);
    if (h == null) {
      nUnusable++;
      continue;
    }
    base.push(f / fs);
    half.push(h / fs);
  }
  return { base, half, nUnusable, nBeats: n };
}

function selftest() {
  let fail = 0;
  const ok = (name, cond, detail) => {
    console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
    if (!cond) fail++;
  };

  console.log('\n### a synthetic rising edge — the crossing is where arithmetic says');
  // foot at 0 (value 0), peak at 10 (value 100): half = 50, linear ramp ⇒ index 5
  const ramp = Float64Array.from({ length: 11 }, (_, i) => i * 10);
  ok('linear ramp ⇒ exactly the midpoint index', Math.abs(halfAmplitudeIndex(ramp, 0, 10) - 5) < 1e-9, `${halfAmplitudeIndex(ramp, 0, 10)}`);

  console.log('\n### SUB-SAMPLE resolution — the reason this is interpolated, not rounded');
  // crossing deliberately between samples: values 0,40,90 ⇒ half=45 sits 5/50 past index 1
  const step = Float64Array.from([0, 40, 90]);
  const got = halfAmplitudeIndex(step, 0, 2);
  ok('a between-sample crossing is fractional, not rounded', Math.abs(got - 1.1) < 1e-9, `${got} (a rounded impl would say 1 or 2)`);

  console.log('\n### refusals — an unusable edge must yield null, never a guess');
  ok('flat edge (hi == lo) ⇒ null', halfAmplitudeIndex(Float64Array.from([5, 5, 5]), 0, 2) === null);
  ok('falling edge ⇒ null', halfAmplitudeIndex(Float64Array.from([90, 40, 0]), 0, 2) === null);
  ok('peak before foot ⇒ null', halfAmplitudeIndex(ramp, 8, 3) === null);

  console.log('\n### the half point LEADS the foot, and by less than one beat');
  const fs = 55;
  const bp = new Float64Array(fs * 10);
  const peaks = [];
  const feet = [];
  for (let b = 0; b < 9; b++) {
    const f = Math.round(b * fs + 5);
    const p = f + Math.round(fs * 0.12);
    for (let i = f; i <= p; i++) bp[i] = ((i - f) / (p - f)) * 100;
    for (let i = p + 1; i < f + fs && i < bp.length; i++) bp[i] = Math.max(0, 100 - (i - p) * 4);
    feet.push(f);
    peaks.push(p);
  }
  const ft = fiducialTimes(bp, peaks, feet, fs);
  ok('every clean beat yields both fiducials', ft.base.length === 9 && ft.half.length === 9 && ft.nUnusable === 0, `base=${ft.base.length} half=${ft.half.length} unusable=${ft.nUnusable}`);
  const leads = ft.half.map((h, i) => h - ft.base[i]);
  ok(
    'half-amplitude is LATER than the foot on every beat',
    leads.every((d) => d > 0),
    `min=${Math.min(...leads).toFixed(4)}s`
  );
  ok(
    '…and by well under one beat interval',
    leads.every((d) => d < 0.5),
    `max=${Math.max(...leads).toFixed(4)}s`
  );

  console.log(`\n${fail === 0 ? 'PASS — crossing, sub-sample resolution, refusals and ordering all hold' : `FAIL — ${fail} problem(s)`}`);
  return fail > 0 ? 1 : 0;
}

const IS_MAIN = !!process.argv[1] && process.argv[1].endsWith('pat-fiducial.mjs');
if (IS_MAIN && process.argv.includes('--selftest')) process.exit(selftest());
if (IS_MAIN) {
  console.error('usage: node tools/pat-fiducial.mjs --selftest   (library; the §1 comparison drives it)');
  process.exit(2);
}

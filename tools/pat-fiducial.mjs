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

/* 🔴 THE FOOT INDEX IS FRACTIONAL. `refineFeet` — the producer in `ppgdex-dsp.js` — already
   returns sub-sample foot positions (93.3275…, not 93), so `bp[footI]` on a typed array is
   `undefined`, `undefined > lo` is false, and EVERY beat is refused. The first version of this
   file indexed directly and its selftest passed, because the selftest planted integer feet: a
   check that ran, examined nothing, and reported cleanly. On the real corpus it rejected
   15295 of 15295 beats and the tool reported `no beat had a usable rising edge` — which reads
   as a fact about the data and was a fact about this function. Amplitudes are therefore
   INTERPOLATED at the foot, and the crossing scan starts at the first whole sample after it. */
function sampleAt(bp, i) {
  if (!(i >= 0) || i > bp.length - 1) return Number.NaN;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return bp[lo];
  return bp[lo] + (i - lo) * (bp[hi] - bp[lo]);
}

/** Fraction-amplitude crossing on the rising edge foot→peak, in SAMPLES (fractional).
 *  `frac` = 0.5 is the Ajtay half-amplitude point; `frac` = 0.10 is the digital
 *  constant-fraction discriminator (CFD) PPG-FOOT-PLACEMENT §3 measured — a trigger at a
 *  fixed fraction of each pulse's OWN foot→peak amplitude, amplitude-independent by
 *  construction (nuclear-instrumentation time-walk removal).
 *  `footI` may itself be fractional — that is what the shipped detector emits.
 *  Returns null for a beat whose edge is unusable, so callers can count coverage
 *  rather than silently receive a fabricated point. */
export function fractionAmplitudeIndex(bp, footI, peakI, frac) {
  if (!(peakI > footI) || !(footI >= 0) || peakI >= bp.length) return null;
  if (!(frac > 0 && frac < 1)) return null; // 0 is the foot itself, 1 the peak — neither is a crossing
  const lo = sampleAt(bp, footI);
  const hi = sampleAt(bp, peakI);
  if (!(hi > lo)) return null; // not a rising edge — reject, never guess
  const thr = lo + frac * (hi - lo);
  /* Left anchor of the first interval is the FOOT itself, not the whole sample before it — that
     sample lies before the foot, on the previous beat's decay, and using it would place the
     crossing outside the rising edge whenever the crossing falls in the first partial interval. */
  let prevI = footI;
  let prevV = lo;
  for (let i = Math.ceil(footI); i <= peakI; i++) {
    if (i <= footI) continue;
    const v = bp[i];
    if (v >= thr) {
      if (v === prevV) return i;
      return prevI + ((thr - prevV) / (v - prevV)) * (i - prevI); // linear, sub-sample
    }
    prevI = i;
    prevV = v;
  }
  return null;
}

/** The CFD fraction §3 measured (f = 0.10). One constant, so the oracle re-score and any
 *  future consumer cannot silently drift apart on what "CFD" means. */
export const CFD_FRAC = 0.1;

/** Half-amplitude crossing — the Ajtay et al. (2023) fiducial. Unchanged contract; now a
 *  projection of the general fraction crossing so there is one crossing implementation. */
export function halfAmplitudeIndex(bp, footI, peakI) {
  return fractionAmplitudeIndex(bp, footI, peakI, 0.5);
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

  console.log('\n### A FRACTIONAL FOOT — what `refineFeet` actually emits (the 15295/15295 bug)');
  ok('a fractional foot does NOT refuse', halfAmplitudeIndex(ramp, 0.5, 10) !== null, `${halfAmplitudeIndex(ramp, 0.5, 10)}`);
  /* Foot at 0.5 ⇒ value 5; peak 10 ⇒ 100; half = 52.5; the ramp is 10/sample ⇒ index 5.25. Checked
     against arithmetic, not against the integer-foot answer, so an implementation that quietly
     rounded the foot back to 0 (answer 5) fails here. */
  ok(
    '…and lands where arithmetic says, not at the integer-foot answer',
    Math.abs(halfAmplitudeIndex(ramp, 0.5, 10) - 5.25) < 1e-9,
    `${halfAmplitudeIndex(ramp, 0.5, 10)} (a foot-rounding impl says 5)`
  );
  ok(
    'a crossing inside the FIRST partial interval anchors on the foot',
    Math.abs(halfAmplitudeIndex(Float64Array.from([0, 100, 100]), 0.5, 2) - 0.75) < 1e-9,
    `${halfAmplitudeIndex(Float64Array.from([0, 100, 100]), 0.5, 2)}`
  );

  console.log('\n### CFD — the same crossing at f=0.10, checked against arithmetic');
  // linear ramp foot 0 (value 0) → peak 10 (value 100): thr = 10 ⇒ index 1 exactly
  ok('linear ramp at f=0.10 ⇒ index 1', Math.abs(fractionAmplitudeIndex(ramp, 0, 10, CFD_FRAC) - 1) < 1e-9, `${fractionAmplitudeIndex(ramp, 0, 10, CFD_FRAC)}`);
  // fractional foot 0.5 (value 5) → peak 10 (value 100): thr = 5 + 0.1·95 = 14.5 ⇒ index 1.45
  ok(
    'fractional foot at f=0.10 lands where arithmetic says',
    Math.abs(fractionAmplitudeIndex(ramp, 0.5, 10, CFD_FRAC) - 1.45) < 1e-9,
    `${fractionAmplitudeIndex(ramp, 0.5, 10, CFD_FRAC)} (a foot-rounding impl says 1)`
  );
  ok('half via the general crossing is unchanged', Math.abs(fractionAmplitudeIndex(ramp, 0, 10, 0.5) - halfAmplitudeIndex(ramp, 0, 10)) < 1e-12);
  ok('CFD leads the half point on the same edge', fractionAmplitudeIndex(ramp, 0, 10, CFD_FRAC) < halfAmplitudeIndex(ramp, 0, 10));
  ok('frac 0 refuses (the foot is not a crossing)', fractionAmplitudeIndex(ramp, 0, 10, 0) === null);
  ok('frac 1 refuses (the peak is not a crossing)', fractionAmplitudeIndex(ramp, 0, 10, 1) === null);

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

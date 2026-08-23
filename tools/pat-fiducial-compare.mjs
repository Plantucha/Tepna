/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * pat-fiducial-compare.mjs — EXTERNAL-METHODS-SURVEY §1's measurement.
 *
 * §1 asks a question the brief could not answer when it was written: PPGDex places PAT at the pulse
 * FOOT, and Ajtay et al. (2023) rank the foot WORST and the 1/2-amplitude point BEST for
 * beat-to-beat PAT imprecision. PAT recovers on only a handful of this corpus's nights. Is the
 * fiducial the reason? The brief's own acceptance is explicit: the recovery rate at each fiducial
 * on the SAME nights, each with its n, and the fiducial chosen on that number.
 *
 * ┌─ THREE ARMS, AND THE THIRD IS THE POINT ─────────────────────────────────────────────────────┐
 * │ The acceptance stage keeps a beat only if its R→fiducial lag lies in a PHYSIOLOGICAL window   │
 * │ (200–650 ms). The half-amplitude point sits LATER on the pulse than the foot by construction, │
 * │ so every lag moves later — and a foot-tuned window would push some of them out and report a   │
 * │ fiducial FAILURE that is purely a window artefact. `pat-sd-is-the-window` records that this   │
 * │ window already dominates the statistics here. So the half fiducial is scored TWICE:           │
 * │   • halfFixed    — the same window the foot uses. Window held constant, fiducial varied.      │
 * │   • halfCentred  — the train shifted back by THIS NIGHT's median (half − foot) offset, which  │
 * │                    is exactly equivalent to moving the window and keeps `rawLags` untouched.  │
 * │ halfCentred − halfFixed is the WINDOW. halfCentred − base is the FIDUCIAL. Reporting only     │
 * │ two arms cannot separate them, and the brief's question is about the fiducial.                │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Everything else is `pat-matchrate-strict.mjs`'s: the same night selection, the same ACC-anchor
 * clock alignment (anchored on the two ACCELEROMETERS, never the beat trains — so it cannot absorb
 * the fiducial offset and hide the effect), the same leave-one-block-out strict acceptance, and the
 * same circular-shift null. A fiducial comparison run on a forked pipeline would not be comparable
 * to the numbers the brief is asking about.
 *
 * Usage:
 *   node tools/pat-fiducial-compare.mjs --dir <corpus> [--only YYYY-MM-DD] [--surrogates 20]
 *   node tools/pat-fiducial-compare.mjs --selftest
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { halfAmplitudeIndex } from './pat-fiducial.mjs';
import { MIN_OVERLAP_MIN, alignFeet, bestPair, circShift, loadDsps, median, quantile, rawLags, strictMatchRate } from './pat-matchrate-strict.mjs';

const argv = process.argv.slice(2);
const av = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};

/* The observed rate alone says nothing: a permissive window plus a fast heart rate produces
   "matches" from unrelated trains. Every arm is quoted against its OWN circular-shift null, so a
   fiducial that merely widens the coincidence rate is not mistaken for one that couples better. */
function armStats(rTimes, fTimes, nSur) {
  const clean = Float64Array.from([...fTimes].filter(Number.isFinite)).sort();
  if (clean.length < 2 || rTimes.length < 2) return { n: 0, matchRate: Number.NaN, reason: 'empty train' };
  const obs = strictMatchRate(rawLags(rTimes, clean), rTimes.length);
  const span = clean[clean.length - 1] - clean[0];
  const nulls = [];
  for (let i = 1; i <= nSur; i++) {
    const s = strictMatchRate(rawLags(rTimes, circShift(clean, span, (i * 0.6180339887) % 1)), rTimes.length);
    if (Number.isFinite(s.matchRate)) nulls.push(s.matchRate);
  }
  const nullMed = nulls.length ? median(nulls) : Number.NaN;
  const nullHi = nulls.length ? quantile(nulls, 0.95) : Number.NaN;
  return {
    n: clean.length,
    matchRate: obs.matchRate,
    residIQRms: obs.residIQR,
    nBlocks: obs.nBlocks,
    nullMedian: nullMed,
    null95: nullHi,
    /* ABOVE THE NULL'S 95th, not above its median — a rate that beats the typical surrogate half the
       time is what chance looks like. */
    beatsNull: Number.isFinite(obs.matchRate) && Number.isFinite(nullHi) && obs.matchRate > nullHi
  };
}

export function compareNight(night, dir, nSur) {
  const pair = bestPair(dir);
  if (!pair) return { night, skipped: 'no parseable ECG+Verity-PPG pair' };
  if (pair.tooShort) return { night, skipped: `best overlap ${pair.overlapMin.toFixed(1)} min (< ${MIN_OVERLAP_MIN})` };
  const { ecg, ppg } = pair;
  if (!ppg.halfTimes) return { night, skipped: 'PPG record carries no halfTimes — stale pat-matchrate-strict' };

  /* Per-beat offset, on the INDEX-PARALLEL raw trains, before alignment. Alignment is a smooth
     function of time, so it shifts a foot and its own half by the same amount and cannot change
     this median; taking it here keeps the beat correspondence that alignment's sort would lose. */
  const offs = [];
  for (let i = 0; i < ppg.times.length; i++) {
    const d = ppg.halfTimes[i] - ppg.times[i];
    if (Number.isFinite(d)) offs.push(d);
  }
  if (!offs.length) return { night, skipped: 'no beat had a usable rising edge' };
  const medOff = median(offs);

  const aBase = alignFeet(dir, ecg, ppg);
  if (!aBase.ok) return { night, skipped: 'alignment: ' + aBase.reason };
  const aHalf = alignFeet(dir, ecg, ppg, ppg.halfTimes);
  if (!aHalf.ok) return { night, skipped: 'alignment(half): ' + aHalf.reason };
  const centred = Float64Array.from([...aHalf.times].map((t) => t - medOff));

  const R = ecg.times;
  return {
    night,
    overlapMin: +pair.overlapMin.toFixed(1),
    nR: R.length,
    nBeats: ppg.n,
    nHalfUnusable: ppg.nHalfUnusable,
    medHalfMinusFootMs: +medOff.toFixed(1),
    base: armStats(R, aBase.times, nSur),
    halfFixed: armStats(R, aHalf.times, nSur),
    halfCentred: armStats(R, centred, nSur)
  };
}

function selftest() {
  let fail = 0;
  const ok = (n, c, d) => {
    console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
    if (!c) fail++;
  };
  loadDsps();

  /* A synthetic pulse: a slow rise from a trough to a peak. The half-amplitude crossing of a LINEAR
     rise is the midpoint by construction, so this control has a known answer that does not depend on
     the detector — if `halfAmplitudeIndex` were returning the peak, or the foot, or an off-by-one,
     the midpoint check fails. */
  const bp = new Float32Array(101);
  for (let i = 0; i <= 100; i++) bp[i] = i; // foot 0, peak 100, half at 50
  const h = halfAmplitudeIndex(bp, 0, 100);
  ok('a linear rise puts the half-amplitude point at its midpoint', Math.abs(h - 50) < 1e-6, `h=${h}`);

  /* NON-VACUITY: the three arms must be able to DISAGREE, or the comparison proves nothing. Plant a
     foot train inside the window and a half train pushed past its top; the fixed-window arm must
     collapse and the centred arm must recover it. A run where all three agree by construction is
     the "examined nothing" failure this repo keeps finding. */
  const R = Array.from({ length: 400 }, (_, i) => 1e12 + i * 900);
  const F = Float64Array.from(R.map((t) => t + 300));
  const H = Float64Array.from(R.map((t) => t + 800)); // past PHYS_HI 650
  const base = armStats(R, F, 5);
  const fixed = armStats(R, H, 5);
  const cent = armStats(R, Float64Array.from([...H].map((t) => t - 500)), 5);
  ok('base recovers a planted in-window lag', base.matchRate > 0.9, `rate=${base.matchRate}`);
  ok('the SAME train outside the window collapses', !(fixed.matchRate > 0.05), `rate=${fixed.matchRate}`);
  ok('…and re-centring recovers it', cent.matchRate > 0.9, `rate=${cent.matchRate}`);
  ok('the three arms are not identical by construction', base.matchRate !== fixed.matchRate);

  /* The null must bite: a train with no relationship to R must not "beat" it. */
  const noise = Float64Array.from(R.map((t, i) => t + 200 + ((i * 137) % 450)));
  const rnd = armStats(R, noise, 20);
  /* Asserted against the null's CENTRE, not its 95th percentile: an unrelated train should score AT
     chance, and "just under the 95th" is a boundary that a different surrogate set would flip. The
     centre is the robust statement and it is the one that says the null is calibrated. */
  ok('an unrelated train scores AT its own null', Math.abs(rnd.matchRate - rnd.nullMedian) < 0.05, `rate=${rnd.matchRate?.toFixed(3)} nullMed=${rnd.nullMedian?.toFixed(3)}`);

  console.log(`\n${fail ? `FAIL — ${fail}` : 'PASS — fiducial, window sensitivity and null all bite'}`);
  return fail ? 1 : 0;
}

const IS_CLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_CLI) {
  if (argv.includes('--selftest')) process.exit(selftest());
  const DIR = av('--dir');
  const ONLY = av('--only');
  const NSUR = +av('--surrogates', 20);
  if (!DIR || !existsSync(DIR)) {
    console.error('pat-fiducial-compare: pass --dir <corpus>. The raw corpus is gitignored and is not in the repo.');
    process.exit(2);
  }
  loadDsps();
  const nights = readdirSync(DIR)
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n) && statSync(join(DIR, n)).isDirectory())
    .filter((n) => !ONLY || n === ONLY)
    .sort();
  const rows = [];
  for (const n of nights) {
    let r;
    try {
      r = compareNight(n, join(DIR, n), NSUR);
    } catch (e) {
      r = { night: n, skipped: 'threw: ' + e.message };
    }
    rows.push(r);
    console.error(
      r.skipped
        ? `  ${n}  SKIP  ${r.skipped}`
        : `  ${n}  base ${r.base.matchRate.toFixed(3)}${r.base.beatsNull ? '*' : ' '}  halfFixed ${r.halfFixed.matchRate.toFixed(3)}${r.halfFixed.beatsNull ? '*' : ' '}  halfCentred ${r.halfCentred.matchRate.toFixed(3)}${r.halfCentred.beatsNull ? '*' : ' '}  Δ(half−foot) ${r.medHalfMinusFootMs} ms`
    );
  }
  const used = rows.filter((r) => !r.skipped);
  /* [!] AN ARM CAN RETURN NaN — too few lags in the window to form two blocks — and that is a
     FAILURE of that arm, not a missing observation. Dropping NaN before the median would flatter
     precisely the arm the window hurts most, which is the arm under test. So the count that scored
     at all is reported beside every median, and the headline is `nightsBeatingNull`, whose
     denominator is every analysed night and for which NaN counts as a loss. */
  const rate = (k) => used.map((r) => r[k].matchRate).filter(Number.isFinite);
  const won = (k) => used.filter((r) => r[k].beatsNull).length;
  const summary = (k) => ({ medianMatchRate: median(rate(k)), nScored: rate(k).length, nightsBeatingNull: won(k) });
  console.log(
    JSON.stringify(
      {
        nights: rows.length,
        analysed: used.length,
        skipped: rows.filter((r) => r.skipped).length,
        of: used.length,
        base: summary('base'),
        halfFixed: summary('halfFixed'),
        halfCentred: summary('halfCentred'),
        medianHalfMinusFootMs: median(used.map((r) => r.medHalfMinusFootMs)),
        rows
      },
      null,
      2
    )
  );
}

// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/**
 * beat-injection-recovery — the artificial-star test for a beat detector.
 * (CROSS-DOMAIN-METHODS-FOLLOWUPS §7.2 names this as the instrument that supersedes capture–recapture
 * for this question on clean data.)
 *
 * THE PROBLEM IT SOLVES. "How many beats does the shipped detector miss?" has no answer from the data
 * alone: there are no adjudicated R-peaks, and capture–recapture across three detectors turned out to
 * be unidentifiable on quiet sleep because the detectors agree on every beat — which is equally
 * consistent with nothing missed and with all three missing the same beats.
 *
 * THE IMPORT. Astronomy has the same problem — a survey's true source count is unknown — and answers
 * it with the ARTIFICIAL STAR TEST: plant synthetic sources of known brightness into the real image,
 * re-run the real detection pipeline, and measure the recovered fraction as a function of brightness.
 * That yields a COMPLETENESS CURVE, and it needs no ground truth, no second detector and no
 * independence assumption. Gravitational-wave injection campaigns are the same idea. Here the image is
 * the raw waveform, the star is a beat, and brightness is amplitude relative to local noise.
 *
 * WHY IT BEATS PERTURBING THE BEAT TRAIN. `beat-error-recovery.mjs` deletes and duplicates entries in
 * an already-detected RR series, so it must ASSUME a miss rate and can only propagate its consequences
 * into rMSSD. This injects into the signal the detector actually reads, so the miss rate is MEASURED.
 *
 * DESIGN CHOICES THAT MATTER, each because the naive version is wrong:
 *   · The template is the subject's OWN averaged beat, not a synthetic QRS. A generic template would
 *     measure how well the detector likes our textbook waveform, not how well it finds this heart's.
 *   · Injections are placed only where they are PHYSIOLOGICALLY ADMISSIBLE — at least a refractory
 *     period from any existing beat. A beat planted 100 ms after a real one is correctly rejected by
 *     refractory logic, and counting that as a miss would measure the detector's correctness as if it
 *     were a failure.
 *   · Amplitude is expressed against LOCAL noise, not in absolute units, because the same microvolt
 *     amplitude is trivially detectable in a quiet passage and invisible under motion.
 *   · A NULL injection (amplitude 0) is always run: it must recover nothing, and any recovery there is
 *     the harness matching noise to itself.
 *
 * DETERMINISM. Seeded LCG only; no Math.random, no Date.now.
 *
 * Usage:
 *   node tools/beat-injection-recovery.mjs --self-test
 *   node tools/beat-injection-recovery.mjs --ecg <ECG.txt> [--n 200] [--seed 7]
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DexBuild = require(join(ROOT, 'tools/build-core.js'));

export function realm() {
  const noop = () => {};
  const s = {};
  s.window = s;
  s.self = s;
  s.globalThis = s;
  s.console = console;
  s.setTimeout = setTimeout;
  s.clearTimeout = clearTimeout;
  s.addEventListener = noop;
  s.removeEventListener = noop;
  s.document = {
    createElement: () => ({ style: {}, getContext: () => null, appendChild: noop }),
    addEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild: noop }
  };
  const ctx = vm.createContext(s);
  for (const f of ['clock.js', 'ecgdex-dsp.js']) {
    vm.runInContext(DexBuild.classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: join(ROOT, f) });
  }
  return ctx;
}

const lcg = (seed) => {
  let x = seed >>> 0;
  return () => (x = (1664525 * x + 1013904223) >>> 0) / 4294967296;
};

/** ECG column 3, host stamps column 0 — the capture-host layout. */
export function parseEcg(text) {
  const v = [];
  const lines = String(text).split('\n');
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(';');
    if (c.length < 4) continue;
    const x = +c[3];
    if (Number.isFinite(x)) v.push(x);
  }
  return v;
}

export function detect(ctx, v, fs) {
  const bp = ctx.ECGDSP.bandpass(Float64Array.from(v), fs);
  const i16 = Int16Array.from(v.map((x) => Math.max(-32768, Math.min(32767, Math.round(x)))));
  const p = ctx.ECGDSP.detectPeaks(i16, bp, fs);
  return (Array.isArray(p) ? p : (p && (p.peaks || p.idx)) || []).filter(Number.isFinite);
}

/**
 * SEARCHBACK-AWARE RECOVERY — attenuate REAL beats in place instead of planting new ones in gaps.
 *
 * WHY THIS EXISTS. `injectAndRecover` plants the template into gaps ≥350 ms from any beat, which makes
 * its completeness an UPPER bound on the miss rate: an isolated plant cannot benefit from Pan–Tompkins'
 * SEARCHBACK, the mechanism that reopens a detection window when an RR interval runs long — i.e. the one
 * mechanism that exists precisely for a low-amplitude beat arriving in sequence. Measured completeness
 * therefore understates what the detector achieves on beats in rhythm.
 *
 * THE FIX: keep the beat where it is and turn it DOWN. For a scattered subset (so every modified beat
 * keeps unmodified neighbours and every neighbouring RR is intact), fit the template's scale to the local
 * waveform and rewrite the window as `residual + alpha x fitted`, where `residual = window − fitted`.
 * That preserves the local noise exactly and reduces only the beat component, so the rhythm, the RR
 * sequence and the searchback context are all untouched. alpha = 1 rewrites the beat to itself.
 *
 * TWO CONTROLS MATTER MORE THAN THE CURVE:
 *   · alpha = 1 must recover ~100 %. If it does not, the excise-and-reinsert is itself damaging the beat
 *     and every number downstream measures this function's arithmetic rather than the detector. It is the
 *     amplitude-0 null of `injectAndRecover`, one level up.
 *   · alpha = 0 — beat fully removed, neighbours intact — measures how often SEARCHBACK FABRICATES a beat
 *     that is not there. Gap-planting is structurally blind to this: it can only ever add signal. A
 *     substantial recovery at alpha = 0 means the detector interpolates, which for rMSSD is the same
 *     class of damage as a miss, in the opposite direction.
 *
 * Returns SNR alongside alpha so the curve is directly comparable with `injectAndRecover`'s.
 */
export function attenuateAndRecover(ctx, v, fs, tpl, alpha, opts = {}) {
  const { fraction = 0.05, seed = 12345, tolMs = 100, neighbours = 0, scaleMode = 'template' } = opts;
  /* TWO WAYS TO MAKE A BEAT QUIETER, AND THEY ARE NOT THE SAME OBJECT.
     · 'template'  edited = (window − ownFit) + alpha x looFit
       Scales an AVERAGE beat but leaves the residual — this beat's departure from the population shape —
       at FULL size. At low alpha the residual is a large share of what remains, and a difference-of-two-
       beats has different frequency content from a beat. So a refusal here may be partly MORPHOLOGY
       ("that no longer looks like a beat") rather than threshold, and the two are confounded.
     · 'baseline'  edited = baseline + alpha x (window − baseline)
       Scales the beat INCLUDING its own morphology — genuinely the same beat, smaller — and at alpha = 0
       leaves flat baseline rather than a residual, so it is also a true removal.
     Running both at nb = 0 separates the threshold effect from the morphology effect. Confound
     identified in review; neither construction is wrong, they answer different questions. */
  /* `neighbours: k` also attenuates the k beats either side of each chosen beat, and scores ONLY the
     middle one. This is the falsifiable form of the adaptive-threshold mechanism (proposed by this
     session, test proposed by #1292's author): if in-rhythm detection is harder because full-amplitude
     neighbours hold Pan-Tompkins' running threshold high, then turning the neighbours down too must move
     the middle beat's recovery TOWARD the gap-planted curve. If it does not move, the mechanism is wrong
     and something else explains the difference. Either way the answer is measured, not asserted. */
  const base = detect(ctx, v, fs)
    .slice()
    .sort((a, b) => a - b);
  const half = tpl.half;
  const len = tpl.wave.length;

  /* ⚠️ THE OBVIOUS CONSTRUCTION MAKES THE alpha = 1 CONTROL VACUOUS, AND IT IS VACUOUS FOR ANY TEMPLATE.
     Writing `residual = window − fitted` and reconstructing `residual + alpha x fitted` gives, at
     alpha = 1, `window − fitted + fitted` — bit-identical to the original however badly the template
     fits. The control could not fail, so it certified nothing: a check reporting success about something
     it never examined, in the one place it was put to prevent exactly that. (Caught in review by the
     author of this file; it was mine.)

     THE FIX IS NOT LEAVE-ONE-OUT BY ITSELF — the identity is structural, not a property of the template.
     What breaks it is removing one thing and inserting a DIFFERENT one: excise the beat's OWN fitted
     waveform, then re-insert the LEAVE-ONE-OUT average shape at that beat's amplitude. alpha = 1 then
     means "replace this beat with the average of every OTHER beat, same amplitude, same position", which
     genuinely tests that the excise-and-reinsert preserves detectability — it can fail on a DC step at
     the window edge, on a poor template, or on arithmetic. It is also the same object `injectAndRecover`
     plants, so the two curves are measuring the detectability of the same waveform and are comparable. */
  const acc = new Float64Array(len);
  let nAcc = 0;
  for (const q of base) {
    const i2 = Math.round(q);
    if (i2 - half < 0 || i2 + half >= v.length) continue;
    for (let k = 0; k < len; k++) acc[k] += v[i2 - half + k];
    nAcc++;
  }
  if (nAcc < 3) return null;

  const step = Math.max(2, Math.round(1 / Math.max(1e-6, fraction)));
  const r = lcg(seed);
  const chosen = [];
  for (let i2 = 1; i2 < base.length - 1; i2 += step) {
    const j2 = i2 + Math.floor(r() * (step - 1));
    const q = Math.round(base[Math.min(j2, base.length - 2)]);
    if (q - half < 0 || q + half >= v.length) continue;
    if (chosen.length && q - chosen[chosen.length - 1] < 2 * half) continue;
    chosen.push(q);
  }
  if (!chosen.length) return null;

  /* expand each scored beat to the set actually attenuated; only `chosen` is ever scored */
  const idxOf = new Map();
  base.forEach((b, i2) => idxOf.set(Math.round(b), i2));
  const toEdit = [];
  for (const q of chosen) {
    toEdit.push(q);
    const at = idxOf.get(q);
    for (let d = 1; d <= neighbours && at != null; d++) {
      for (const nb of [base[at - d], base[at + d]]) {
        if (nb == null) continue;
        const r2 = Math.round(nb);
        if (r2 - half >= 0 && r2 + half < v.length) toEdit.push(r2);
      }
    }
  }

  const w = Float64Array.from(v);
  const snrs = [];
  const measured = [];
  let editDelta = 0; // max |edited − original| over modified windows — see the note on the return
  for (const q of toEdit) {
    /* leave-one-out average: this beat contributes to `acc`, so take it back out. */
    const loo = new Float64Array(len);
    for (let k = 0; k < len; k++) loo[k] = (acc[k] - v[q - half + k]) / (nAcc - 1);
    const ped = (loo[0] + loo[len - 1]) / 2; // same DC-pedestal removal buildTemplate does
    for (let k = 0; k < len; k++) loo[k] -= ped;

    /* the beat's OWN amplitude, measured against its own averaged shape */
    let vt = 0,
      tt2 = 0;
    for (let k = 0; k < len; k++) {
      vt += w[q - half + k] * tpl.wave[k];
      tt2 += tpl.wave[k] * tpl.wave[k];
    }
    const scale = vt / (tt2 || 1);

    if (scaleMode === 'baseline') {
      /* local baseline from the window's outer thirds, which exclude the QRS in the middle */
      const edge = Math.max(1, Math.round(len / 3));
      let bsum = 0,
        bn = 0;
      for (let k = 0; k < edge; k++) {
        bsum += w[q - half + k] + w[q + half - k];
        bn += 2;
      }
      const bl = bsum / bn;
      for (let k = 0; k < len; k++) {
        w[q - half + k] = bl + alpha * (w[q - half + k] - bl);
      }
    } else {
      for (let k = 0; k < len; k++) {
        w[q - half + k] = w[q - half + k] - scale * tpl.wave[k] + alpha * scale * loo[k];
      }
    }
    /* SNR uses the POPULATION template peak, not this beat's leave-one-out peak, so this curve's axis
       is identical BY CONSTRUCTION to `injectAndRecover`'s and to the real-beat SNR distribution the
       curve gets convolved with. The two differ by O(1/n) and would silently shift one axis relative to
       the other — which is the kind of discrepancy that survives review because both numbers look
       reasonable on their own. */
    snrs.push((Math.abs(alpha * scale) * tpl.peakAmp) / localNoise(v, q, fs));
    /* ⚠️ THE NOMINAL SNR ABOVE IS NOT WHAT THE DETECTOR SEES, and the gap between them is the reason
       alpha = 0 is not silence. Template subtraction is imperfect: what remains is `residual + alpha x
       fitted`, and the residual is beat-SHAPED and beat-POSITIONED, so at low alpha the window still holds
       signal the nominal axis reports as absent. Measured on the corpus: at alpha = 0 the local peak/noise
       falls 55.9 -> 13.1, not to 0 — which is why a lowered threshold (nb = 2) recovers 10.7 % of
       "removed" beats, and why those recoveries land a median 15.4 ms from the true position (~2 samples)
       rather than at the ~507 ms RR midpoint an inference-from-intervals would produce. They are the
       residual being detected, NOT beats invented from noise.
       So the honest axis is the POST-EDIT local peak/noise, measured. The nominal one is kept beside it
       because it is what `injectAndRecover` uses, and dropping it would silently break the comparison. */
    let pk = 0;
    for (let k = 0; k < len; k++) pk = Math.max(pk, Math.abs(w[q - half + k]));
    measured.push(pk / localNoise(v, q, fs));
    for (let k = 0; k < len; k++) {
      editDelta = Math.max(editDelta, Math.abs(w[q - half + k] - v[q - half + k]));
    }
  }

  const after = detect(ctx, w, fs)
    .slice()
    .sort((a, b) => a - b);
  const tol = (tolMs / 1000) * fs;
  const near = (arr, t) => {
    if (!arr.length) return Infinity;
    let lo = 0,
      hi = arr.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (arr[m] < t) lo = m + 1;
      else hi = m;
    }
    let d = Math.abs(arr[lo] - t);
    if (lo > 0) d = Math.min(d, Math.abs(arr[lo - 1] - t));
    return d;
  };
  const nearSigned = (arr, t) => {
    if (!arr.length) return Infinity;
    let lo = 0,
      hi = arr.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (arr[m] < t) lo = m + 1;
      else hi = m;
    }
    let best = arr[lo] - t;
    if (lo > 0 && Math.abs(arr[lo - 1] - t) < Math.abs(best)) best = arr[lo - 1] - t;
    return best;
  };
  let recovered = 0;
  /* SIGNED offset of each recovery from the true position of the beat that was there. At alpha = 0 this
     is the measurement that decides whether a "fabrication" is damage or inference: a detection AT the
     true beat time is the detector correctly inferring an invisible beat (a recovery, and good for rMSSD);
     one placed away from it — an interpolated RR midpoint, say — is a beat at the wrong time, which is
     timing error and inflates rMSSD. Same count, opposite conclusion. */
  const offsetsMs = [];
  for (const q of chosen) {
    const d = nearSigned(after, q);
    if (Math.abs(d) <= tol) {
      recovered++;
      offsetsMs.push((d / fs) * 1000);
    }
  }

  const untouched = base.filter((b) => !toEdit.some((c) => Math.abs(c - b) < 2 * half));
  let kept = 0;
  for (const b of untouched) if (near(after, b) <= tol) kept++;

  const med = snrs.slice().sort((a, b) => a - b)[snrs.length >> 1];
  return {
    alpha,
    scaleMode,
    /* ⚠️ THE ANTI-VACUITY MEASUREMENT. The first version of this function reconstructed as
       `residual + alpha x fitted`, which at alpha = 1 is bit-identical to the original for ANY template
       — so its "alpha = 1 must recover 100 %" control could not fail and certified nothing. Publishing
       the actual edit magnitude makes the triviality impossible to reintroduce silently: a gate asserts
       editDelta > 0 at alpha = 1, which the identity construction cannot satisfy. */
    editDelta,
    modified: chosen.length,
    attenuated: toEdit.length,
    neighbours,
    recovered,
    completeness: recovered / chosen.length,
    /* ⚠️ AT alpha = 0 THIS FIELD HAS TWO READINGS WITH OPPOSITE SIGNS OF DESIRABILITY, and which one
       applies depends on whether the gap is real — so it is named for the MEASUREMENT, not for either
       interpretation. The beat is gone and its neighbours are intact, so a detection at its position is
       searchback interpolating across a long RR. Read as SEARCHBACK EFFICACY it says how often a
       genuinely-missed beat is recovered — the mechanism that makes the gap-planted 1.4 % an
       over-estimate. Read as a FABRICATION RATE it says how often a truly-absent beat is invented, which
       is what matters at a real sinus pause. Same number; do not quote it without saying which. */
    interpolatedAcrossGap: alpha === 0 ? recovered / chosen.length : null,
    offsetsMs,
    medianAbsOffsetMs: offsetsMs.length ? offsetsMs.map(Math.abs).sort((a, b) => a - b)[offsetsMs.length >> 1] : null,
    medianSnr: med,
    /* what the detector actually faced, vs `medianSnr` which is what alpha nominally asked for */
    medianMeasuredSnr: measured.length ? measured.slice().sort((a, b) => a - b)[measured.length >> 1] : null,
    untouched: untouched.length,
    untouchedKept: kept,
    untouchedRetention: untouched.length ? kept / untouched.length : null
  };
}

/** Subject's own averaged beat, centred on the detected peak. */
export function buildTemplate(v, peaks, fs) {
  const half = Math.round(0.12 * fs); // ±120 ms spans QRS plus a little
  const len = 2 * half + 1;
  const acc = new Float64Array(len);
  let n = 0;
  for (const p of peaks) {
    const i = Math.round(p);
    if (i - half < 0 || i + half >= v.length) continue;
    for (let k = 0; k < len; k++) acc[k] += v[i - half + k];
    n++;
  }
  if (!n) return null;
  for (let k = 0; k < len; k++) acc[k] /= n;
  /* Remove the DC pedestal so injection ADDS a beat rather than a step. */
  const base = (acc[0] + acc[len - 1]) / 2;
  for (let k = 0; k < len; k++) acc[k] -= base;
  return { wave: acc, half, peakAmp: Math.max(...acc.map(Math.abs)) };
}

/** Robust local noise: MAD of the first difference, which is dominated by noise not by QRS. */
export function localNoise(v, at, fs) {
  const w = Math.round(1.0 * fs);
  const lo = Math.max(1, at - w),
    hi = Math.min(v.length, at + w);
  const d = [];
  for (let i = lo; i < hi; i++) d.push(Math.abs(v[i] - v[i - 1]));
  if (!d.length) return 1;
  d.sort((a, b) => a - b);
  return Math.max(1e-9, d[d.length >> 1] * 1.4826);
}

/**
 * Plant `n` beats at admissible positions and report what the SHIPPED detector recovers.
 * `snr` scales the template so its peak equals `snr x` the local noise.
 */
export function injectAndRecover(ctx, v, fs, tpl, snr, n, seed, tolMs = 100) {
  const r = lcg(seed);
  const base = detect(ctx, v, fs);
  const refractory = Math.round(0.35 * fs); // beyond the detector's 200 ms, so admissibility is not marginal
  const sorted = base.slice().sort((a, b) => a - b);
  const admissible = (i) => {
    if (i - tpl.half < 0 || i + tpl.half >= v.length) return false;
    let lo = 0,
      hi = sorted.length - 1,
      best = Infinity;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      const d = Math.abs(sorted[m] - i);
      if (d < best) best = d;
      if (sorted[m] < i) lo = m + 1;
      else hi = m - 1;
    }
    return best > refractory;
  };
  const planted = [];
  let guard = 0;
  while (planted.length < n && guard++ < n * 200) {
    const i = Math.floor(r() * v.length);
    if (!admissible(i)) continue;
    if (planted.some((p) => Math.abs(p - i) < refractory)) continue;
    planted.push(i);
  }
  planted.sort((a, b) => a - b);
  const out = v.slice();
  for (const i of planted) {
    const scale = snr === 0 ? 0 : (snr * localNoise(v, i, fs)) / tpl.peakAmp;
    for (let k = 0; k < tpl.wave.length; k++) out[i - tpl.half + k] += tpl.wave[k] * scale;
  }
  const after = detect(ctx, out, fs)
    .slice()
    .sort((a, b) => a - b);
  const tol = (tolMs / 1000) * fs;
  const isNew = (t) => {
    let lo = 0,
      hi = sorted.length - 1,
      best = Infinity;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      const d = Math.abs(sorted[m] - t);
      if (d < best) best = d;
      if (sorted[m] < t) lo = m + 1;
      else hi = m - 1;
    }
    return best > tol;
  };
  let recovered = 0;
  for (const p of planted) if (after.some((t) => Math.abs(t - p) <= tol)) recovered++;
  /* Detections that are neither a pre-existing beat nor a plant — the injection's collateral. */
  const spurious = after.filter((t) => isNew(t) && !planted.some((p) => Math.abs(t - p) <= tol)).length;
  return { snr, planted: planted.length, recovered, completeness: planted.length ? recovered / planted.length : null, spurious, baseline: base.length, afterCount: after.length };
}

function selfTest() {
  let fail = 0;
  const ok = (n, c, d = '') => {
    if (!c) fail++;
    console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  };
  const ctx = realm();
  const fs = 130;
  /* A synthetic ECG-like record: sharp biphasic beats on low noise, 60 bpm. */
  const N = fs * 240,
    v = new Array(N).fill(0);
  const r = lcg(3);
  for (let i = 0; i < N; i++) v[i] = (r() - 0.5) * 20;
  for (let b = fs; b < N - fs; b += fs) {
    for (let k = -3; k <= 3; k++) v[b + k] += 600 * Math.exp(-(k * k) / 2) * (k < 0 ? -0.3 : 1);
  }
  const base = detect(ctx, v, fs);
  ok('the shipped detector finds the synthetic beats', base.length > 200, `${base.length} beats`);
  const tpl = buildTemplate(v, base, fs);
  ok("a template is built from the subject's own beats", !!tpl && tpl.peakAmp > 0, tpl ? `peakAmp=${tpl.peakAmp.toFixed(0)}` : 'null');
  /* SNR here is amplitude / LOCAL NOISE, and the noise floor is small, so a real beat sits near
     SNR 60 rather than 5. Measured knee on this fixture: 0 % at 20, 98 % at 40, 100 % at 60 — the
     first version probed at 20 and read a correct 0 % as a broken harness. */
  const hi = injectAndRecover(ctx, v, fs, tpl, 60, 40, 11);
  ok('an injection at real-beat amplitude is recovered at high completeness', hi.completeness > 0.8, `completeness=${(hi.completeness * 100).toFixed(0)} % of ${hi.planted}`);
  /* THE CURVE IS THE PRODUCT, not any single point: completeness must be MONOTONE in amplitude. */
  const ladder = [10, 30, 60].map((x) => injectAndRecover(ctx, v, fs, tpl, x, 40, 11).completeness);
  ok('completeness is monotone in amplitude', ladder[0] <= ladder[1] && ladder[1] <= ladder[2], ladder.map((x) => (x * 100).toFixed(0) + '%').join(' -> '));
  const nul = injectAndRecover(ctx, v, fs, tpl, 0, 40, 11);
  ok('the NULL injection recovers ~nothing — the harness is not matching noise to itself', nul.completeness < 0.2, `completeness=${(nul.completeness * 100).toFixed(0)} %`);
  ok('…and completeness RISES with amplitude', hi.completeness > nul.completeness, `${(nul.completeness * 100).toFixed(0)} % -> ${(hi.completeness * 100).toFixed(0)} %`);
  ok('plants are placed clear of existing beats', hi.planted === 40);
  console.log(fail ? `\n${fail} self-test FAILURE(S)` : '\nself-test: all green');
  return fail ? 1 : 0;
}

function main(argv) {
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : null;
  };
  if (argv.includes('--self-test')) return selfTest();
  const f = arg('--ecg');
  if (!f) {
    console.error('usage: --ecg <ECG.txt> [--n 200] [--seed 7]');
    return 2;
  }
  const n = Number(arg('--n') || 200),
    seed = Number(arg('--seed') || 7);
  const ctx = realm();
  const v = parseEcg(readFileSync(f, 'utf8'));
  const fs = Number(arg('--fs') || 130.02);
  const base = detect(ctx, v, fs);
  const tpl = buildTemplate(v, base, fs);
  if (!tpl) {
    console.error('no template — the detector found no beats');
    return 1;
  }
  console.log(`samples=${v.length} (${(v.length / fs / 60).toFixed(1)} min)  baseline beats=${base.length}  template peak=${tpl.peakAmp.toFixed(0)} uV`);
  console.log('\n  SNR   planted  recovered  completeness  spurious');
  for (const snr of [0, 5, 10, 20, 30, 40, 60, 90, 140]) {
    const r = injectAndRecover(ctx, v, fs, tpl, snr, n, seed);
    console.log(
      `  ${String(snr).padStart(4)}  ${String(r.planted).padStart(7)}  ${String(r.recovered).padStart(9)}  ${((r.completeness || 0) * 100).toFixed(1).padStart(11)} %  ${String(r.spurious).padStart(8)}`
    );
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('beat-injection-recovery.mjs')) process.exit(main(process.argv.slice(2)));

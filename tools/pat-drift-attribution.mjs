/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * pat-drift-attribution.mjs — PAT-ROOT-CAUSE-FORENSICS §14: is the slow lag trend INSTRUMENTAL?
 *
 * §14 established that the 20–40 ms residual is a SLOW TREND on 8/8 nights — not white, not
 * respiratory, no coherent HR dependence. It did NOT establish the trend's ORIGIN: an uncorrected
 * inter-device clock (error) and a slow physiological trend (signal) both produce that shape.
 *
 * ┌─ WHY THE OBVIOUS TEST CANNOT WORK ───────────────────────────────────────────────────────────┐
 * │ Comparing the cross-device lag drift against each device's internal intervals is circular,     │
 * │ because it is an ALGEBRAIC IDENTITY:                                                          │
 * │                                                                                              │
 * │   lag_n − lag_0 = (foot_n − R_n) − (foot_0 − R_0) = Σ(footIntervals) − Σ(RR)                  │
 * │                                                                                              │
 * │ That holds whatever the cause, so it discriminates nothing. A clock-rate difference and a     │
 * │ physiological PAT trend BOTH appear as Σff − Σrr. The identity must be recognised rather than  │
 * │ measured, or the pass produces a confident number that means nothing.                         │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * SO THE TEST NEEDS A THIRD REFERENCE, and on box captures there is one: the capture HOST. Each
 * device carries its own `hostAxis.ppm` — its measured rate against that host. If the trend is
 * instrumental, it is the DIFFERENCE of the two devices' rates and is therefore PREDICTABLE:
 *
 *     predicted lag drift rate  =  (ppm_PPG − ppm_ECG) × 1e-6      [ms of lag per ms elapsed]
 *
 * and the test is whether the OBSERVED slope of lag-vs-time matches it. This works only where the
 * host is a real second clock — `independent === true` — which is exactly the box corpus §17
 * labelled (ECG `independent === false` on 0/448). On a phone capture there is no third reference
 * and the tool REFUSES rather than reporting a comparison it cannot make.
 *
 * ⚠️ READ `hostAxis` FROM THE PARSER, NEVER FROM A WRAPPER. `pat-matchrate-strict.mjs`'s
 * `ecgRpeakTimes`/`ppgFootTimes` RESHAPE the parser record and drop everything they do not name —
 * `rec.hostAxis` is one of the casualties, and reading it through them returns `undefined` on every
 * night, which this tool first reported as "no host reference" on 8 of 8. That is the same
 * drops-what-it-does-not-name trap `ppgdex-dsp.js` documents beside its own forwarding block, hit
 * one layer further out. Parse once and take the axis from the record.
 *
 * ⚠️ THE PPG LEG'S CORRECTION *DOES* REACH THE LAG **HERE** — and this block asserted the opposite
 * until 2026-09-05. It read that the correction "is computed and then discarded" because
 * `ppgFootTimes` indexed `relSec` with a FRACTIONAL foot index that returned `undefined` and fell
 * back to `idx / fs`, citing PAT-FORENSICS-AXIS-LEG-ASYMMETRY's `0/8948 feet`.
 *
 * That was a MIS-ATTRIBUTION ACROSS TWO CONSUMERS, not a stale number. The `0/8948` measurement is
 * live and correct — but it is about **`pat-feasibility-worker.js`**, which still reads
 * `rel[idx] ?? idx / fs`, a RAW SUBSCRIPT that a fractional index can never hit. This tool does not
 * use that path: it imports `ppgFootTimes` from `pat-matchrate-strict.mjs`, whose `timeAt`
 * INTERPOLATES — `rel[lo] + fr * (rel[hi] - rel[lo])` — and has since #1649 (2026-08-23). Two
 * functions, two behaviours, one citation applied to both.
 *
 * Re-measured 2026-09-05 through the exact function this file calls, over the three largest Verity
 * nights in `smoketest-captures`: **72514 of 72514 consensus feet resolve through `relSec`, 0 fall
 * back**, every one a fractional index. So the drift really has been divided out of the beat times
 * this tool measures, and `applied: true` on that record is truthful rather than a discarded
 * correction. The worker's defect is untouched by that and AXIS-LEG-ASYMMETRY remains open on it.
 *
 * The `fs` path is a third thing again, and it is where the correction genuinely IS erased —
 * `ppgdex-dsp.js:556` divides `fs` by (1 + ppm/1e6) and `:557` rounds `fs` to 2 dp, a 181.8 ppm step
 * at 55 Hz. True of `fs`, and not an observation about the lag: foot times come from `relSec` on
 * 100 % of the beats measured. Do not re-derive the discarded-correction conclusion from it.
 *
 * ⚠️ A DEVICE WHOSE CORRECTION WAS APPLIED CONTRIBUTES ~0, NOT ITS ppm. If `applied === true` the
 * rate was already divided out of that device's axis, so its residual contribution is ~0. Using the
 * raw ppm there would predict a drift that the pipeline has already removed — double-counting a
 * correction, which is the mirror of the §🔏 stale-fixture error.
 *
 * PRE-STATED BANDS (closed, on |observed − predicted| / |observed|):
 *   <= 0.30  -> CLOCK EXPLAINS
 *   0.30–0.70 -> PARTIAL
 *   >  0.70  -> CLOCK DOES NOT EXPLAIN  (the trend is physiological or something unnamed)
 *   observed slope ~ 0 -> UNDEFINED (no trend to attribute; reported, never forced into a band)
 *
 * 🔴 MEASURE THE SLOPE UNCENSORED. The oracle's accepted set keeps only beats inside mode±halfWidth,
 * so a drifting lag is TRUNCATED: the slope is biased toward zero, and where the window is
 * mis-centred the surviving beats are selected against the drift direction, which can flip the
 * apparent SIGN. Comparing an uncensored prediction against a censored observation is not a fair
 * test, and the first version of this tool did exactly that and reported a confident 8/8. Both arms
 * are now reported — `censored` (the oracle's accepted set) and `raw` (every nearest-forward lag
 * within the mode search) — and the RAW arm is the one the verdict uses.
 *
 * SECONDARY CUE — LINEARITY. A crystal offset is a FIXED ppm, so its drift is straight; a vasomotor
 * or BP trend need not be. R² of the linear fit is reported: high R² is consistent with (but does
 * not prove) a fixed-rate instrumental cause, and low R² argues against one.
 *
 * Usage:
 *   node tools/pat-drift-attribution.mjs --selftest
 *   node tools/pat-drift-attribution.mjs --dir <captures root> [--only a,b,c]
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BAND_EXPLAINS = 0.3;
export const BAND_PARTIAL = 0.7;
export const MIN_SLOPE_MS_PER_MS = 1e-6; // below this there is no trend worth attributing

/* Least-squares slope of y on x, plus R². */
export function linfit(xs, ys) {
  const n = xs.length;
  if (n < 20) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx <= 0 || syy <= 0) return null;
  const slope = sxy / sxx;
  return { slope, r2: (sxy * sxy) / (sxx * syy) };
}

/* A device contributes its ppm only if the correction was NOT already applied. */
export function effectivePpm(hostAxis) {
  if (!hostAxis || !hostAxis.ok || !Number.isFinite(hostAxis.ppm)) return null;
  if (hostAxis.independent === false) return null; // no real second clock — cannot predict
  /* ⚠️ A MISSING `applied` IS A CONTRACT BREACH, NOT A FALSE. The old line was
     `hostAxis.applied === true ? 0 : hostAxis.ppm`, so an absent key fell to the ppm branch —
     "this device's drift is still outstanding". That was correct for ECGDex, which has always
     written the key, and WRONG for PpgDex, which applies the correction
     (`relSec = devMs + correctionAt(devMs)`) and never wrote it: its already-absorbed drift was
     counted a second time. The reader looked right because the only node it was tested against
     happened to emit the key.
     `applied` is owned by the DSP THAT APPLIES THE AXIS, and both nodes now write it with the same
     meaning. So absence is no longer a defensible state: refuse rather than guess a direction,
     because both guesses are wrong half the time and neither is visible. */
  if (typeof hostAxis.applied !== 'boolean') {
    throw new Error(
      'hostAxis.applied missing — the emitting DSP must state whether the correction was applied. ' + 'Guessing it silently double-counts (absent→ppm) or silently discards (absent→0) a real drift.'
    );
  }
  return hostAxis.applied === true ? 0 : hostAxis.ppm;
}

export function attribute(observedSlope, predictedSlope) {
  if (!Number.isFinite(observedSlope) || Math.abs(observedSlope) < MIN_SLOPE_MS_PER_MS) return { verdict: 'UNDEFINED (no trend)', frac: Number.NaN };
  if (!Number.isFinite(predictedSlope)) return { verdict: 'UNDEFINED (no host reference)', frac: Number.NaN };
  const frac = Math.abs(observedSlope - predictedSlope) / Math.abs(observedSlope);
  if (frac <= BAND_EXPLAINS) return { verdict: 'CLOCK EXPLAINS', frac };
  if (frac <= BAND_PARTIAL) return { verdict: 'PARTIAL', frac };
  return { verdict: 'CLOCK DOES NOT EXPLAIN', frac };
}

function selftest() {
  const fails = [];
  const ok = (c, m) => {
    if (!c) fails.push(m);
  };
  /* A planted pure clock drift must be attributed to the clock. */
  const t = Array.from({ length: 500 }, (_, i) => i * 900);
  const ppmDiff = 120; // ppm
  const lag = t.map((x) => 300 + x * ppmDiff * 1e-6);
  const f = linfit(t, lag);
  ok(f && Math.abs(f.slope - ppmDiff * 1e-6) < 1e-9, `slope recovers the planted ppm, got ${f?.slope}`);
  ok(f.r2 > 0.999, `a pure ramp is near-perfectly linear, got r2 ${f?.r2}`);
  ok(attribute(f.slope, ppmDiff * 1e-6).verdict === 'CLOCK EXPLAINS', 'planted clock drift => CLOCK EXPLAINS');

  /* A drift the host cannot account for must NOT be attributed to the clock. */
  ok(attribute(f.slope, 5 * 1e-6).verdict === 'CLOCK DOES NOT EXPLAIN', 'a 24x mismatch => CLOCK DOES NOT EXPLAIN');
  ok(attribute(f.slope, 100 * 1e-6).verdict === 'CLOCK EXPLAINS', '120 vs 100 ppm is within 30% => EXPLAINS');
  ok(attribute(f.slope, 60 * 1e-6).verdict === 'PARTIAL', '120 vs 60 ppm is 50% => PARTIAL');

  /* Flat lag => nothing to attribute, and it must not be forced into a band. */
  ok(attribute(0, 1e-5).verdict.startsWith('UNDEFINED'), 'a flat lag yields UNDEFINED, not a verdict');

  /* effectivePpm: applied correction contributes 0; a non-independent host refuses. */
  ok(effectivePpm({ ok: true, ppm: 50, applied: true, independent: true }) === 0, 'applied correction contributes 0');
  ok(effectivePpm({ ok: true, ppm: 50, applied: false, independent: true }) === 50, 'unapplied correction contributes its ppm');
  ok(effectivePpm({ ok: true, ppm: 50, applied: false, independent: false }) === null, 'no independent host => null');

  /* THE IDENTITY, asserted so nobody re-derives the circular test: lag drift IS sum(ff) - sum(rr). */
  const R = [0, 900, 1800, 2700];
  const F = [310, 1215, 2122, 3031];
  const lagDelta = F[3] - R[3] - (F[0] - R[0]);
  const ffSum = F[3] - F[0];
  const rrSum = R[3] - R[0];
  ok(Math.abs(lagDelta - (ffSum - rrSum)) < 1e-9, 'lag drift IS sum(ff)-sum(rr) — identically, so it cannot discriminate');

  console.log(fails.length ? `SELFTEST FAIL (${fails.length})\n  ${fails.join('\n  ')}` : 'SELFTEST PASS (11/11)');
  return fails.length === 0;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);
  const DIR = argv[argv.indexOf('--dir') + 1];
  const ONLY = argv.includes('--only') ? new Set(argv[argv.indexOf('--only') + 1].split(',')) : null;
  if (!DIR || !existsSync(DIR)) {
    console.error('usage: node tools/pat-drift-attribution.mjs --selftest | --dir <root> [--only a,b]');
    process.exit(2);
  }
  const { getDsps, ecgRpeakTimes, ppgFootTimes } = await import(join(HERE, 'pat-matchrate-strict.mjs'));
  const { oracleNight, pickPair } = await import(join(HERE, 'pat-window-oracle.mjs'));
  const { acceptedSeries } = await import(join(HERE, 'pat-residual-structure.mjs'));
  const { ECGDSP, PPGDSP } = getDsps();
  console.log(`bands on |obs-pred|/|obs|: <=${BAND_EXPLAINS} CLOCK EXPLAINS · <=${BAND_PARTIAL} PARTIAL · else CLOCK DOES NOT EXPLAIN\n`);
  console.log('night         ppmECG  ppmPPG   predicted   censored      RAW    ratio  rawR2   verdict');
  for (const n of readdirSync(DIR)
    .filter((x) => /^2026-/.test(x) && (!ONLY || ONLY.has(x)))
    .sort()) {
    const dir = join(DIR, n);
    let files;
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    /* The oracle's picker, imported — NOT a third local copy. This file used to carry its own
       pre-#2082 version (two independent size-sorts, `readFileSync` in the comparator), so on a
       fragmented night it paired the largest ECG with the largest PPG from a different hour and
       then scored the result. See `pickPair`'s header. */
    const paired = pickPair(dir, files);
    if (paired.missing) continue;
    const { eF, pF } = paired;
    let E;
    let P;
    let eAx;
    let pAx;
    try {
      const eTxt = readFileSync(eF, 'utf8');
      const pTxt = readFileSync(pF, 'utf8');
      E = ecgRpeakTimes(eTxt);
      P = ppgFootTimes(pTxt);
      /* Straight from the parser — the wrappers above drop `hostAxis` (see header). */
      eAx = ECGDSP.parseECG(eTxt).hostAxis;
      pAx = PPGDSP.parsePPG(pTxt).hostAxis;
    } catch {
      continue;
    }
    const R = Array.from(E.times);
    const F = Array.from(P.times);
    const orc = oracleNight(R, F, 100);
    if (!orc || orc.refusal) continue; // a named refusal is a truthy object — skip it explicitly
    /* The oracle's OWN split, not a recomputed one — it derives `mid` from the two trains' overlap
       and its second half is bounded by `hi`, so scoring `t >= mid` over all of R would re-admit the
       beats after the PPG ends that #2034 removed. */
    const rB = R.filter((t) => t >= orc.mid && t <= orc.hi);
    const { lags } = acceptedSeries(rB, F, orc.mode, 100);
    if (lags.length < 50) continue;
    /* time axis = the accepted beats' own R times */
    const times = [];
    {
      let j = 0;
      let k = 0;
      for (let i = 1; i < rB.length && k < lags.length; i++) {
        while (j < F.length && F[j] < rB[i]) j++;
        if (j >= F.length) break;
        const lg = F[j] - rB[i];
        if (lg >= orc.mode - 100 && lg <= orc.mode + 100) {
          times.push(rB[i]);
          k++;
        }
      }
    }
    const fit = linfit(times, lags);
    /* UNCENSORED arm: every nearest-forward lag, no window — see header. */
    const rawT = [];
    const rawL = [];
    {
      let j = 0;
      for (const r of rB) {
        while (j < F.length && F[j] < r) j++;
        if (j >= F.length) break;
        const lg = F[j] - r;
        if (lg >= 0 && lg <= 2000) {
          rawT.push(r);
          rawL.push(lg);
        }
      }
    }
    const rawFit = linfit(rawT, rawL);
    const pE = effectivePpm(eAx);
    const pP = effectivePpm(pAx);
    const pred = pE == null || pP == null ? Number.NaN : (pP - pE) * 1e-6;
    const a = attribute(rawFit?.slope ?? Number.NaN, pred); // RAW arm decides
    console.log(
      `${n}  ${(pE == null ? '-' : pE.toFixed(1)).padStart(7)} ${(pP == null ? '-' : pP.toFixed(1)).padStart(7)}  ${(Number.isFinite(pred) ? (pred * 1e6).toFixed(1) : '-').padStart(10)}  ${(fit ? (fit.slope * 1e6).toFixed(1) : '-').padStart(9)} ${(rawFit ? (rawFit.slope * 1e6).toFixed(1) : '-').padStart(8)}  ${(Number.isFinite(a.frac) ? a.frac.toFixed(2) : '-').padStart(6)}  ${(rawFit ? rawFit.r2.toFixed(2) : '-').padStart(5)}   ${a.verdict}`
    );
  }
  console.log('\n(ppm columns and predicted/observed slopes are in ppm, i.e. ms of lag per 1e6 ms elapsed)');
}

if (process.argv[1]?.endsWith('pat-drift-attribution.mjs')) await main();

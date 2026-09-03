/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * pat-residual-structure.mjs — PAT-ROOT-CAUSE-FORENSICS §14: is the leftover 20–40 ms ERROR or SIGNAL?
 *
 * PAT-FORENSICS-WINDOW-ORACLE recovered narrow-window SDs of 15–45 ms out of sample. This campaign
 * has measured the sensor floor at ~11 ms (ECG axis 11.15 within-bin · PPG fractional-subscript bug
 * ~10 · fiducial <=6.3 by two independent routes). So 20–40 ms is unaccounted for, and it is now the
 * largest open term in the budget.
 *
 * ┌─ THE QUESTION IS NOT "HOW BIG" BUT "IS IT STRUCTURED" ───────────────────────────────────────┐
 * │ Those two readings point opposite ways and the charter's §14 turns on which is true:          │
 * │   · UNSTRUCTURED (white) -> it is error nothing has named, and the budget has a hole.         │
 * │   · STRUCTURED (autocorrelated, HR-dependent) -> it is PHYSIOLOGICAL PAT VARIATION, i.e. the   │
 * │     quantity the measurement exists to capture. Then the "gap" is SIGNAL and calling it error  │
 * │     would be the campaign's worst inversion — pathologising the thing we are trying to see.    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * TWO STATISTICS, both on the OUT-OF-SAMPLE accepted lags only (never the fitting half):
 *   · rho1  — lag-1 autocorrelation of the lag series in BEAT ORDER. White noise gives ~0;
 *             respiration- and BP-driven PAT gives a positive value.
 *   · rho(RR, lag) — Spearman against the concurrent RR interval. PAT shortening as HR rises is a
 *             well-established physiological dependence, so its presence is positive evidence for
 *             physiology and its absence is evidence against.
 *
 * 🔴 rho1 ALONE CANNOT SEPARATE PHYSIOLOGY FROM SLOW DRIFT, and the first real run proved it. Two
 * nights returned rho1 = 0.981 and 0.966 (shuffles 0.022 / 0.005) — but a 12-beat respiratory
 * sinusoid gives rho1 = cos(2*pi/12) = 0.866, so ~0.98 is SMOOTHER than respiration can be. A slow
 * monotone drift — an uncorrected clock, a warming sensor, a shifting cuff — also produces rho1 near
 * 1. Both readings are "structured", and they mean opposite things for the budget.
 *
 * THE DISCRIMINATOR IS THE SHAPE OF THE AUTOCORRELATION, NOT ITS FIRST VALUE. An oscillation decays
 * and CROSSES ZERO at about a quarter of its period, then rebounds negative; a drift decays slowly
 * and never crosses within the observed span. So the tool reports rho at several lags plus the first
 * zero-crossing beat index:
 *   · crossing within ~2-15 beats, with a negative trough  -> OSCILLATORY (respiration-like)
 *   · no crossing within 40 beats                          -> DRIFT-LIKE (monotone)
 * Reporting rho1 without the shape would have called a drift "physiological", which is precisely the
 * inversion this section exists to prevent.
 *
 * SHUFFLE CONTROL, and it is required: permuting the lag series destroys ordering while preserving
 * every marginal. If rho1 survives a shuffle the statistic is measuring something other than
 * temporal structure and the result is void.
 *
 * PRE-STATED BANDS (closed, declared before the first run):
 *   rho1 >= 0.30              -> STRUCTURED   (physiological; the residual is signal)
 *   0.10 <= rho1 < 0.30       -> PARTIAL
 *   rho1 <  0.10              -> UNSTRUCTURED (error; the budget has a hole)
 *   |rho(RR,lag)| >= 0.20     -> HR-DEPENDENT
 *
 * ⚠️ THE NARROW WINDOW CENSORS, AND CENSORING BIASES BOTH STATISTICS TOWARD ZERO. Beats whose lag
 * falls outside mode±halfWidth are dropped, truncating the distribution and breaking the beat
 * sequence. A dropped beat makes its neighbours non-adjacent, which attenuates rho1. So a LOW rho1
 * is weak evidence for "unstructured" while a HIGH one is strong evidence for "structured" — the
 * test is one-sided in its strength, and that asymmetry is stated rather than discovered later.
 *
 * Usage:
 *   node tools/pat-residual-structure.mjs --selftest
 *   node tools/pat-residual-structure.mjs --dir <captures root> [--half-width 100]
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BAND_STRUCTURED = 0.3;
export const BAND_PARTIAL = 0.1;
export const BAND_HR = 0.2;

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

export function autocorr1(xs) {
  if (xs.length < 20) return Number.NaN;
  const m = mean(xs);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    den += (xs[i] - m) * (xs[i] - m);
    if (i > 0) num += (xs[i] - m) * (xs[i - 1] - m);
  }
  return den > 0 ? num / den : Number.NaN;
}

function rank(xs) {
  const order = [...xs.keys()].sort((a, b) => xs[a] - xs[b]);
  const r = new Array(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && xs[order[j + 1]] === xs[order[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[order[k]] = avg;
    i = j + 1;
  }
  return r;
}
function pearson(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : Number.NaN;
}
export function spearman(a, b) {
  return a.length < 20 ? Number.NaN : pearson(rank(a), rank(b));
}

/* Deterministic shuffle — a control whose value changes run to run is not a control. */
export function shuffled(xs, seed = 12345) {
  const a = xs.slice();
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Autocorrelation at an arbitrary lag — the shape, not just the first value. */
export function autocorrK(xs, k) {
  if (xs.length < k + 20) return Number.NaN;
  const m = mean(xs);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    den += (xs[i] - m) * (xs[i] - m);
    if (i >= k) num += (xs[i] - m) * (xs[i - k] - m);
  }
  return den > 0 ? num / den : Number.NaN;
}

/* First lag at which the autocorrelation goes non-positive. null => no crossing in `maxK`. */
export function firstZeroCrossing(xs, maxK = 40) {
  for (let k = 1; k <= maxK; k++) {
    const r = autocorrK(xs, k);
    if (Number.isFinite(r) && r <= 0) return k;
  }
  return null;
}

export function shapeVerdict(xs) {
  const zc = firstZeroCrossing(xs);
  if (zc == null) return { zc: null, shape: 'DRIFT-LIKE' };
  if (zc >= 2 && zc <= 15) return { zc, shape: 'OSCILLATORY' };
  return { zc, shape: zc < 2 ? 'FAST/NOISY' : 'SLOW-OSC' };
}

export function band(r) {
  if (!Number.isFinite(r)) return 'UNDEFINED';
  if (r >= BAND_STRUCTURED) return 'STRUCTURED';
  if (r >= BAND_PARTIAL) return 'PARTIAL';
  return 'UNSTRUCTURED';
}

/* Accepted out-of-sample lags, with the concurrent RR interval for each. */
export function acceptedSeries(rTimes, fTimes, mode, halfWidth) {
  const lags = [];
  const rrs = [];
  let j = 0;
  for (let i = 1; i < rTimes.length; i++) {
    const r = rTimes[i];
    while (j < fTimes.length && fTimes[j] < r) j++;
    if (j >= fTimes.length) break;
    const lag = fTimes[j] - r;
    if (lag >= mode - halfWidth && lag <= mode + halfWidth) {
      lags.push(lag);
      rrs.push(rTimes[i] - rTimes[i - 1]);
    }
  }
  return { lags, rrs };
}

function selftest() {
  const fails = [];
  const ok = (c, m) => {
    if (!c) fails.push(m);
  };
  /* WHITE series -> rho1 ~ 0. */
  let s = 3;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2;
  const white = Array.from({ length: 2000 }, () => rnd() * 30);
  ok(Math.abs(autocorr1(white)) < 0.1, `white series rho1 ~ 0, got ${autocorr1(white).toFixed(3)}`);
  ok(band(autocorr1(white)) === 'UNSTRUCTURED', 'white reads UNSTRUCTURED');

  /* A SLOW OSCILLATION (respiration-like, ~12 beats/cycle) -> strongly autocorrelated. */
  const resp = Array.from({ length: 2000 }, (_, i) => 25 * Math.sin((2 * Math.PI * i) / 12) + rnd() * 4);
  ok(autocorr1(resp) >= 0.3, `respiration-like series must read STRUCTURED, got ${autocorr1(resp).toFixed(3)}`);
  ok(band(autocorr1(resp)) === 'STRUCTURED', 'oscillation reads STRUCTURED');

  /* THE CONTROL: shuffling must destroy the structure, or the statistic is not measuring order. */
  ok(Math.abs(autocorr1(shuffled(resp))) < 0.1, `shuffled oscillation rho1 must collapse, got ${autocorr1(shuffled(resp)).toFixed(3)}`);

  /* Spearman recovers a planted monotone relation and rejects an unrelated one. */
  const x = Array.from({ length: 500 }, (_, i) => i + rnd());
  const y = x.map((v) => 2 * v + rnd() * 3);
  ok(spearman(x, y) > 0.9, `planted monotone pair rho > 0.9, got ${spearman(x, y).toFixed(3)}`);
  ok(Math.abs(spearman(x, shuffled(y))) < 0.2, 'shuffled pair loses the relation');

  /* acceptedSeries applies the window and pairs RR correctly. */
  const R = [0, 900, 1800, 2700, 3600];
  const F = [300, 1200, 5000, 3000, 3900].sort((a, b) => a - b);
  const got = acceptedSeries(R, F, 300, 100);
  ok(got.lags.length === got.rrs.length, 'lags and RRs stay aligned');
  ok(
    got.lags.every((l) => Math.abs(l - 300) <= 100),
    'only in-window lags are kept'
  );

  /* THE DISCRIMINATOR: an oscillation must cross zero early; a drift must not cross at all. */
  const osc = Array.from({ length: 2000 }, (_, i) => 25 * Math.sin((2 * Math.PI * i) / 12));
  const so = shapeVerdict(osc);
  ok(so.shape === 'OSCILLATORY', `a 12-beat oscillation must read OSCILLATORY, got ${so.shape} (zc ${so.zc})`);
  const drift = Array.from({ length: 2000 }, (_, i) => i * 0.05);
  const sd2 = shapeVerdict(drift);
  ok(sd2.shape === 'DRIFT-LIKE', `a monotone ramp must read DRIFT-LIKE, got ${sd2.shape} (zc ${sd2.zc})`);
  ok(autocorr1(drift) > 0.95 && autocorr1(osc) > 0.8, 'both give a high rho1 — which is exactly why rho1 alone is insufficient');

  console.log(fails.length ? `SELFTEST FAIL (${fails.length})\n  ${fails.join('\n  ')}` : 'SELFTEST PASS (12/12)');
  return fails.length === 0;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);
  const DIR = argv[argv.indexOf('--dir') + 1];
  const HW = Number(argv.includes('--half-width') ? argv[argv.indexOf('--half-width') + 1] : 100);
  if (!DIR || !existsSync(DIR)) {
    console.error('usage: node tools/pat-residual-structure.mjs --selftest | --dir <captures root>');
    process.exit(2);
  }
  const { getDsps, ecgRpeakTimes, ppgFootTimes } = await import(join(HERE, 'pat-matchrate-strict.mjs'));
  const { oracleNight, pickPair } = await import(join(HERE, 'pat-window-oracle.mjs'));
  getDsps();
  console.log(`bands: rho1 >= ${BAND_STRUCTURED} STRUCTURED, >= ${BAND_PARTIAL} PARTIAL, else UNSTRUCTURED; |rho(RR,lag)| >= ${BAND_HR} HR-DEPENDENT`);
  console.log('⚠️ censoring biases both statistics TOWARD zero — a high value is strong, a low one is weak.\n');
  console.log('night          n     SD    rho1   rho5  rho20  shuffled  zeroX  shape         rho(RR,lag)  verdict');
  const tally = {};
  const ONLY = argv.includes('--only') ? new Set(argv[argv.indexOf('--only') + 1].split(',')) : null;
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
    try {
      E = ecgRpeakTimes(readFileSync(eF, 'utf8'));
      P = ppgFootTimes(readFileSync(pF, 'utf8'));
    } catch {
      continue;
    }
    const R = Array.from(E.times);
    const F = Array.from(P.times);
    const orc = oracleNight(R, F, HW);
    if (!orc || orc.refusal || !Number.isFinite(orc.narrowSd)) continue; // a named refusal is a truthy object
    /* The oracle's OWN split, not a recomputed one — it derives `mid` from the two trains' overlap
       and its second half is bounded by `hi`, so scoring `t >= mid` over all of R would re-admit the
       beats after the PPG ends that #2034 removed. */
    const rB = R.filter((t) => t >= orc.mid && t <= orc.hi);
    const { lags, rrs } = acceptedSeries(rB, F, orc.mode, HW);
    if (lags.length < 50) continue;
    const r1 = autocorr1(lags);
    const r1s = autocorr1(shuffled(lags));
    const rhr = spearman(rrs, lags);
    const v = band(r1);
    tally[v] = (tally[v] || 0) + 1;
    const hr = Math.abs(rhr) >= BAND_HR ? ' HR-DEP' : '';
    const sh = shapeVerdict(lags);
    console.log(
      `${n}  ${String(lags.length).padStart(5)}  ${orc.narrowSd.toFixed(1).padStart(5)}  ${r1.toFixed(3).padStart(6)} ${autocorrK(lags, 5).toFixed(3).padStart(6)} ${autocorrK(lags, 20).toFixed(3).padStart(6)}  ${r1s.toFixed(3).padStart(7)}  ${String(sh.zc ?? '-').padStart(5)}  ${sh.shape.padEnd(12)}  ${rhr.toFixed(3).padStart(10)}  ${v}${hr}`
    );
  }
  console.log('\nTALLY:', JSON.stringify(tally));
}

if (process.argv[1]?.endsWith('pat-residual-structure.mjs')) await main();

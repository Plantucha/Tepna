// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/**
 * beat-capture-recapture — how many beats did EVERY detector miss?
 * (CROSS-DOMAIN-METHODS-FOLLOWUPS §7; answers KNOWN-CLOCK-ADVERSARIAL-CAPTURE's largest open finding.)
 *
 * WHY. One missed beat in a thousand inflates rMSSD by 20.8 %, against ~0.003 % for the entire
 * clock-error family. Nothing in this suite instruments detector miss-rate on real recordings, and the
 * usual reason is that it needs adjudicated R-peaks nobody has. Epidemiology does not have ground truth
 * either and estimates the unobserved class from the OVERLAP between imperfect sources.
 *
 * WHY NOT TWO SOURCES. Lincoln–Petersen (`N = n1 n2 / n12`) assumes INDEPENDENT capture. Beat detectors
 * fail together — motion, perfusion and apnea degrade optical and electrical at once — and positive
 * dependence biases the estimate DOWNWARD, i.e. it under-reports the very undercount being sought. With
 * two lists the 2x2 table is SATURATED, so the dependence cannot be estimated from the data at all.
 * Three sources give 7 observable cells and admit all three pairwise interactions.
 *
 * THE ESTIMATOR. Log-linear with every pairwise interaction and NO three-way term — the standard
 * closure, and the only one three sources can support. For a 2^3 table that has a closed form:
 *
 *     m000 = (m100 · m010 · m001 · m111) / (m110 · m101 · m011)
 *
 * N̂ = observed + m000. The no-three-way assumption is an ASSUMPTION, not a result: it is unfalsifiable
 * from three lists and is stated here rather than buried, because it is the one thing that could make
 * the answer wrong in the same direction as the bias it is correcting.
 *
 * WHY THE SOURCES ARE COMPARABLE AT ALL. All three streams carry the capture host's own `Phone
 * timestamp`, so they are already on one axis — no offset estimation, and none of the alignment
 * difficulty documented elsewhere in this project applies. That is the point of host anchoring.
 *
 * Usage:
 *   node tools/beat-capture-recapture.mjs --self-test
 *   node tools/beat-capture-recapture.mjs --ecg <ECG.txt> --ppg-a <PPG.txt> --ppg-b <PPG.txt> [--tol-ms 250]
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
// The one-inflation-robust floor + diagnostic — see the note in estimate().
import { chao, modifiedChao } from './capture-recapture.mjs';

const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DexBuild = require(join(ROOT, 'tools/build-core.js'));

function realm() {
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
  for (const f of ['clock.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js']) {
    vm.runInContext(DexBuild.classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: join(ROOT, f) });
  }
  return ctx;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
export function hostMs(x) {
  const m = ISO.exec(String(x).trim());
  if (!m) return null;
  const [y, mo, d, h, mi, se] = [+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  return Date.UTC(y, mo - 1, d, h, mi, se, m[7] ? +m[7].padEnd(3, '0') : 0);
}

/** `col` = index of the signal column. Comment lines (`#`) and the header are skipped. */
export function parseStream(text, col) {
  const t = [],
    v = [];
  for (const line of String(text).split('\n')) {
    if (!line || line[0] === '#') continue;
    const c = line.split(';');
    if (c.length <= col) continue;
    const h = hostMs(c[0]);
    const x = +c[col];
    if (h === null || !Number.isFinite(x)) continue;
    t.push(h);
    v.push(x);
  }
  return { t, v };
}

/** Effective sample rate from the host stamps — never an assumed constant. */
export const fsOf = (t) => (t.length > 1 ? (t.length - 1) / ((t[t.length - 1] - t[0]) / 1000) : 0);

/* ── beat times, from the SHIPPED detectors ──────────────────────────────────────────────────── */
export function ecgBeats(ctx, s) {
  const fs = fsOf(s.t);
  const bp = ctx.ECGDSP.bandpass(Float64Array.from(s.v), fs);
  const peaks = ctx.ECGDSP.detectPeaks(Int16Array.from(s.v.map((x) => Math.max(-32768, Math.min(32767, Math.round(x))))), bp, fs);
  const idx = Array.isArray(peaks) ? peaks : (peaks && (peaks.peaks || peaks.idx)) || [];
  return { fs, times: idx.map((i) => timeAtFractional(s.t, i)).filter(Number.isFinite) };
}

export function ppgBeats(ctx, s) {
  const fs = fsOf(s.t);
  /* `detectChannel`, NOT the `detectBeats` primitive. It is what PpgDex actually ships, and it does
     two things the primitive cannot: it band-passes with EXPLICIT 0.5–8 Hz cutoffs (the two-argument
     `bandpass` call I first wrote passes none), and it runs `orientByRise` to fix polarity — which
     matters here because the Verity's raw channel sits near −4.7e5 and an inverted pulse gives the
     upstroke detector nothing to find. Measured cost of reaching for the primitive instead: 9 beats
     where 945 exist over the same 18 min, a 99 % miss reported as a result. */
  /* ONE call on the whole window. An earlier version segmented this, on a diagnosis that turned out
     to be wrong: the "global threshold degrades over long blocks" behaviour belonged to the
     un-oriented `detectBeats` primitive, not to `detectChannel`. Measured on the same Verity window,
     `detectChannel` scales cleanly — 46 / 94 / 190 / 285 / 477 / 718 / 963 beats at 0.9 / 1.9 / 3.8 /
     5.7 / 9.4 / 14.2 / 18.9 min, i.e. a flat 50.9 beats·min⁻¹ against the ECG's 51.5. The segmentation
     was solving a problem introduced by the earlier misuse. */
  const r = ctx.PPGDSP.detectChannel(Float64Array.from(s.v), fs);
  /* FEET, not peaks: the systolic foot is the fiducial the suite uses elsewhere, and mixing fiducials
     across sources would show up as a fixed offset that the matcher would read as a miss. */
  const idx = (r && (r.feet && r.feet.length ? r.feet : r.peaks)) || [];
  /* THE FEET ARE FRACTIONAL. `detectChannel` places the systolic foot to SUB-SAMPLE precision — the
     largest index here is 199841.7578 against 200000 samples — so `s.t[i]` is `undefined` for every
     one of them and a naive `.filter(Number.isFinite)` discards the entire detection silently. That
     is what produced "0 beats" through three wrong diagnoses (primitive-vs-pipeline, segment length,
     realm state leakage) before the indices themselves were printed. Interpolate the host time
     between the bracketing samples, which also KEEPS the sub-sample precision the detector worked to
     produce rather than rounding it away. */
  return { fs, times: idx.map((i) => timeAtFractional(s.t, i)).filter(Number.isFinite) };
}

/** Host time at a fractional sample index, linearly interpolated between neighbours. */
export function timeAtFractional(t, i) {
  if (!Number.isFinite(i) || i < 0 || i > t.length - 1) return NaN;
  const lo = Math.floor(i),
    hi = Math.min(t.length - 1, lo + 1),
    f = i - lo;
  return t[lo] + f * (t[hi] - t[lo]);
}

/* ── 2^3 capture profile ─────────────────────────────────────────────────────────────────────── */
/** Greedy nearest-match within `tol`; each beat may be used once. Sets must be time-sorted. */
function matchTo(base, other, tol) {
  const hit = new Array(base.length).fill(false);
  let j = 0;
  const used = new Array(other.length).fill(false);
  for (let i = 0; i < base.length; i++) {
    while (j < other.length && other[j] < base[i] - tol) j++;
    let k = j,
      bestK = -1,
      bestD = Infinity;
    while (k < other.length && other[k] <= base[i] + tol) {
      if (!used[k]) {
        const d = Math.abs(other[k] - base[i]);
        if (d < bestD) {
          bestD = d;
          bestK = k;
        }
      }
      k++;
    }
    if (bestK >= 0) {
      hit[i] = true;
      used[bestK] = true;
    }
  }
  return hit;
}

/* PULSE ARRIVAL TIME IS NOT A MISS. An R-peak and the systolic foot it produces are the SAME beat,
   separated by the transit time to the wrist or finger — typically 150–300 ms, i.e. past any sane
   match tolerance. Measured before this was handled: the two optical sources matched each other 895
   times while matching the ECG 10 times, and `observed` came out at 1899 against a true ~950 — every
   beat counted twice, once as "ECG only" and once as "both PPGs". Estimate the median lag and remove
   it, which also makes the lag itself a reported by-product rather than a hidden correction. */
export function medianLag(base, other, maxMs) {
  const d = [];
  let j = 0;
  for (let i = 0; i < base.length; i++) {
    while (j < other.length - 1 && other[j] < base[i] - maxMs) j++;
    let bestD = Infinity;
    for (let k = j; k < other.length && other[k] <= base[i] + maxMs; k++) {
      const x = other[k] - base[i];
      if (Math.abs(x) < Math.abs(bestD)) bestD = x;
    }
    if (Number.isFinite(bestD) && Math.abs(bestD) <= maxMs) d.push(bestD);
  }
  if (d.length < 10) return 0;
  d.sort((a, b) => a - b);
  return d[d.length >> 1];
}

export function profile(A, B, C, tol) {
  const cells = { m111: 0, m110: 0, m101: 0, m011: 0, m100: 0, m010: 0, m001: 0 };
  const aB = matchTo(A, B, tol),
    aC = matchTo(A, C, tol);
  for (let i = 0; i < A.length; i++) {
    if (aB[i] && aC[i]) cells.m111++;
    else if (aB[i]) cells.m110++;
    else if (aC[i]) cells.m101++;
    else cells.m100++;
  }
  /* B and C beats that A missed. `m011` counts those B∧C pairs; a beat seen by exactly one of B or C
     and not by A lands in m010 / m001. Anchoring on B for the remainder avoids double counting. */
  const bA = matchTo(B, A, tol),
    bC = matchTo(B, C, tol);
  for (let i = 0; i < B.length; i++) {
    if (bA[i]) continue;
    if (bC[i]) cells.m011++;
    else cells.m010++;
  }
  const cA = matchTo(C, A, tol),
    cB = matchTo(C, B, tol);
  for (let i = 0; i < C.length; i++) if (!cA[i] && !cB[i]) cells.m001++;
  return cells;
}

/**
 * One window's estimate as a single printable string.
 *
 * ⚠️ EXTRACTED SO IT CAN BE GATED. `--scan` is the survey mode — it is *where* per-window contamination
 * shows up — and it was the one path on which the diagnostic could not be seen: a window carrying the
 * 48.5 %-shaped absurdity printed `missed=9500 (48.5 %)` with no flag at all, because the REFUSED branch
 * is loud and the estimated branch said nothing but the number. Inline in a `console.log` this could only
 * have been checked by a source scan, and a source scan is satisfiable by a comment.
 */
export function estSummary(est) {
  if (!est.ok) return `REFUSED — ${String(est.reason).slice(0, 72)}`;
  const warn = est.warnings && est.warnings.length ? `  ⚠ ${est.warnings.length} — ${String(est.warnings[0]).slice(0, 58)}…` : '';
  return `missed=${est.missedEst.toFixed(1)} (${est.missedFracPct.toFixed(2)} %)${warn}`;
}

/** No-three-way-interaction closure. Returns null when a cell is 0 (the estimator is undefined). */
export function estimate(c) {
  const denom = c.m110 * c.m101 * c.m011;
  const observed = c.m111 + c.m110 + c.m101 + c.m011 + c.m100 + c.m010 + c.m001;
  if (!denom || !c.m111) return { ok: false, reason: 'a required cell is zero — estimator undefined', observed, cells: c };
  /* SPARSE-CELL REFUSAL. The closed form divides by m110·m101·m011 and multiplies by the three
     single-source cells, so when detectors agree closely those six cells hold single-digit counts and
     the point estimate is noise amplified by a small denominator. Measured on a clean 18.85-min
     window: cells 24 / 2 / 3 and 9 / 1 / 12 gave m000 = 701 against ~970 real beats — 41 % of beats
     "missed by everything", which is absurd on its face and would have been reported as a number.
     The bound is the textbook adequacy rule for log-linear capture-recapture (expected cell ≥ 5); it
     is applied to the six informative cells, and a refusal here means the DATA cannot identify the
     undercount, not that the undercount is zero. Those are different statements and the caller must
     not be able to confuse them. */
  const sparse = ['m110', 'm101', 'm011', 'm100', 'm010', 'm001'].filter((k) => c[k] < 5);
  if (sparse.length) {
    return {
      ok: false,
      reason: `cells too sparse to identify the undercount: ${sparse.map((k) => k + '=' + c[k]).join(', ')} (need >=5). The detectors agree too closely on this window — this is NOT a claim that nothing was missed`,
      observed,
      cells: c
    };
  }
  const m000 = (c.m100 * c.m010 * c.m001 * c.m111) / denom;

  /* ── THE ADEQUACY RULE IS NECESSARY, NOT SUFFICIENT ─────────────────────────────────────────────
     The sparse-cell refusal above catches six single-digit cells. It does NOT catch cells that are
     comfortably >= 5 and still wrong, which is what a full night produces: 93/159/207 · 262/152/74
     clear the rule everywhere and yield m000 = 9500 against 10093 observed — 48.5 % of beats "missed
     by everything", the same absurdity the rule exists for, arriving through a door it does not watch.

     The mechanism is CONTAMINATION, not sparsity. The closed form multiplies the three SINGLE-SOURCE
     cells, and a single-source cell is a mixture: a real beat the other two missed, or a spike this one
     detector invented. False positives therefore enter the numerator directly. Chao's bound reads the
     same singletons and inflates with them; the modified Chao (Bohning et al. 2018, Metrika) reads only
     f2 and f3 and CANNOT — so the ratio measures the contamination no cell-count rule can see.
     Measured: false singletons that push the log-linear up 89 % move the modified Chao by 0.
     WARN, do not refuse: their sparse rule already owns refusal, and a second one would silently change
     this function's contract for its existing caller.
     ⚠️ Both Chao variants UNDER-read by ~70 % under the positive dependence this corpus has. They are a
     floor and a diagnostic, never a competing point estimate. */
  const _cr = {
    100: c.m100,
    '010': c.m010,
    '001': c.m001,
    110: c.m110,
    101: c.m101,
    '011': c.m011,
    111: c.m111
  };
  const _ch = chao(_cr);
  const _mc = modifiedChao(_cr);
  const _oneInflation = _ch.ok && _mc.ok && _mc.n0 > 0 ? _ch.n0 / _mc.n0 : null;
  /* BOTH THRESHOLDS ARE ARGUED, NOT FITTED — they gate warnings, never behaviour.
     0.25: a physiological bound. A worn recording on which three detectors each see ~9600 beats cannot
     plausibly have missed a quarter of them; if the model says so, the model is wrong, not the night.
     5: a structural bound, not a calibration — and the null is EXACT, so a reader can check it rather
     than take it. Under a homogeneous Poisson capture model f_k = N·L^k·e^-L/k!, both estimators reduce
     to f0 = N·e^-L algebraically:
         Chao      f1^2/2f2   = (N·L·e^-L)^2 / (2·N·L^2·e^-L/2)        = N·e^-L
         mod Chao  2f2^3/9f3^2 = 2(N·L^2·e^-L/2)^3 / (9(N·L^3·e^-L/6)^2) = N·e^-L
     So their ratio is 1 BY CONSTRUCTION, not approximately (verified numerically over L = 0.3 .. 5.0:
     1.0000 at every point, independently by two sessions), and any departure from 1 is contamination or
     heterogeneity rather than a tuning artefact. 5 sits far above sampling noise and far below what real
     data produces — the measured night reads 699. Nothing here is tuned to that number.

     ⚠️ THE TWO BOUNDS AGE DIFFERENTLY, which is why they are argued separately. The physiological one is
     a claim about this subject and this montage and could simply be wrong for another recording. The
     structural one cannot be wrong unless the capture model is. Do not "harmonise" them. */
  const _warnings = [];
  if (m000 > observed * 0.25) {
    _warnings.push(`log-linear puts ${((m000 / (observed + m000)) * 100).toFixed(1)} % of beats in the unobserved cell — implausible on a worn recording, and NOT excluded by the adequacy rule`);
  }
  if (_oneInflation != null && _oneInflation > 5) {
    _warnings.push(
      `one-inflation ${_oneInflation.toFixed(1)}x — the single-source cells hold far more than the doubleton/tripleton structure explains, i.e. detector false positives are inflating m000`
    );
  }

  return {
    ok: true,
    observed,
    missedEst: m000,
    warnings: _warnings,
    /* ⚠️ FLOORS, NOT QUANTITIES — named so, because `chaoFloor` reads like something to plot.
       Both under-read by ~70 % under the positive dependence this corpus has, and the modified Chao
       returns ~0.31 on the measured night. When `estimate()` refuses, neither is computed at all and
       `oneInflation` is null. The RATIO is doing the work here; the floors are its inputs. */
    chaoFloor: _ch.ok ? _ch.n0 : null,
    modifiedChaoFloor: _mc.ok ? _mc.n0 : null,
    oneInflation: _oneInflation,
    total: observed + m000,
    missedFracPct: (m000 / (observed + m000)) * 100,
    perSourceMissPct: {
      A: (1 - (c.m111 + c.m110 + c.m101 + c.m100) / (observed + m000)) * 100,
      B: (1 - (c.m111 + c.m110 + c.m011 + c.m010) / (observed + m000)) * 100,
      C: (1 - (c.m111 + c.m101 + c.m011 + c.m001) / (observed + m000)) * 100
    },
    cells: c
  };
}

/* ── WINDOWED SCAN ───────────────────────────────────────────────────────────────────────────────
   The whole-recording run refuses on quiet sleep because the detectors agree too well: the cells that
   carry information about the unseen hold single-digit counts. The method has power where the sources
   DISAGREE, which is also where beats are actually lost — motion, poor perfusion, apnea.

   ⚠ WHAT KIND OF SELECTION THIS IS, because "select the windows that work" is the circularity this
   project keeps catching. Windows are ranked by DISAGREEMENT COUNT — a property of the three beat
   sets, computed before any estimate exists — and never by the estimate, the miss rate, or whether
   the estimator returned `ok`. That is selection on PRECISION, which is legitimate, and it is the same
   move as analysing subjects who have more data.
   ⚠ WHAT IT COSTS ANYWAY: the result is then an estimate FOR THE DISAGREEING SEGMENTS, not for the
   night. Those segments are where misses concentrate, so the number is the relevant one — but it must
   never be multiplied up to a whole-night undercount, and this function reports the covered fraction
   so a reader can see how much of the night it does not speak for. */
export function scanWindows(eT, aT, bT, tol, winMs) {
  const lo = Math.max(eT[0], aT[0], bT[0]),
    hi = Math.min(eT[eT.length - 1], aT[aT.length - 1], bT[bT.length - 1]);
  const out = [];
  for (let w = lo; w + winMs <= hi; w += winMs) {
    const cut = (arr) => arr.filter((t) => t >= w && t < w + winMs);
    const c = profile(cut(eT), cut(aT), cut(bT), tol);
    const disagree = c.m110 + c.m101 + c.m011 + c.m100 + c.m010 + c.m001;
    out.push({ startMs: w, cells: c, agree: c.m111, disagree, est: estimate(c) });
  }
  return { windows: out, spanMs: hi - lo, winMs };
}

function selfTest() {
  let fail = 0;
  const ok = (n, cond, d = '') => {
    if (!cond) fail++;
    console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
  };
  /* A known truth: 1000 beats at 1 Hz, three detectors with INDEPENDENT miss probabilities. With
     independence the closure is exact in expectation, so this checks the arithmetic, not the biology. */
  const truth = [];
  for (let i = 0; i < 1000; i++) truth.push(i * 1000);
  /* INDEPENDENT drops, via a seeded LCG per source. A first version used a modular pattern
     (`(i*7919 + phase) % 1000`), which makes the three miss-sets DISJOINT — so no beat was missed by
     all three, the unseen cell was genuinely 0, and the assertion below could not pass however correct
     the estimator was. The fixture has to be able to produce the thing being measured. */
  const lcg = (seed) => {
    let x = seed >>> 0;
    return () => (x = (1664525 * x + 1013904223) >>> 0) / 4294967296;
  };
  const keep = (p, seed) => {
    const r = lcg(seed);
    return truth.filter(() => r() >= p);
  };
  const A = keep(0.1, 11),
    B = keep(0.2, 22),
    C = keep(0.3, 33);
  const c = profile(A, B, C, 250);
  const e = estimate(c);
  ok('estimator returns a result on a well-populated table', e.ok, JSON.stringify(e.reason));
  /* the refusal must fire on the real-world shape that motivated it */
  const sparseCells = { m111: 935, m110: 24, m101: 2, m011: 3, m100: 9, m010: 1, m001: 12 };
  const sp = estimate(sparseCells);
  ok('a sparse but non-zero table is REFUSED, not estimated', !sp.ok && /too sparse/.test(sp.reason), sp.ok ? 'returned ' + sp.total.toFixed(1) : sp.reason.slice(0, 60));
  ok('recovered total is within 5 % of the planted 1000', Math.abs(e.total - 1000) / 1000 < 0.05, `total=${e.total.toFixed(1)}`);
  ok('the fixture actually HAS beats missed by all three', e.observed < 1000, `observed=${e.observed} of 1000`);
  ok('…and it EXCEEDS the observed count (it estimates the unseen)', e.total > e.observed, `obs=${e.observed} total=${e.total.toFixed(1)}`);
  ok(
    'per-source miss rates are near the planted 10/20/30 %',
    Math.abs(e.perSourceMissPct.A - 10) < 4 && Math.abs(e.perSourceMissPct.B - 20) < 4 && Math.abs(e.perSourceMissPct.C - 30) < 4,
    `A=${e.perSourceMissPct.A.toFixed(1)} B=${e.perSourceMissPct.B.toFixed(1)} C=${e.perSourceMissPct.C.toFixed(1)}`
  );
  /* THE FAILURE MODE THAT MATTERS: perfectly correlated detectors. All three miss the SAME beats, so
     the overlap carries no information about the unseen and the estimate must not claim otherwise. */
  const same = truth.filter((_, i) => i % 10 !== 0);
  const cc = profile(same, same.slice(), same.slice(), 250);
  const ee = estimate(cc);
  ok('fully dependent detectors do NOT yield a confident total', !ee.ok || Math.abs(ee.total - same.length) < 1e-6, ee.ok ? `total=${ee.total}` : ee.reason);
  ok('a beat is matched at most once', matchTo([0, 10], [5], 250).filter(Boolean).length === 1);
  console.log(fail ? `\n${fail} self-test FAILURE(S)` : '\nself-test: all green');
  return fail ? 1 : 0;
}

function main(argv) {
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : null;
  };
  if (argv.includes('--selftest') || argv.includes('--self-test')) return selfTest();
  const fe = arg('--ecg'),
    fa = arg('--ppg-a'),
    fb = arg('--ppg-b');
  if (!fe || !fa || !fb) {
    console.error('usage: --ecg <ECG.txt> --ppg-a <PPG.txt> --ppg-b <PPG.txt> [--tol-ms 250]');
    return 2;
  }
  const tol = Number(arg('--tol-ms') || 250);
  const ctx = realm();
  const E = ecgBeats(ctx, parseStream(readFileSync(fe, 'utf8'), 3));
  const A = ppgBeats(ctx, parseStream(readFileSync(fa, 'utf8'), 2));
  const B = ppgBeats(ctx, parseStream(readFileSync(fb, 'utf8'), 2));
  const sortT = (x) => x.times.slice().sort((p, q) => p - q);
  /* An empty source must SAY SO. A first version took Math.max over an undefined first element, which
     is NaN, which silently filtered every source to zero and reported "0 beats" for all three — an
     empty result presented as a measurement. */
  for (const [name, o] of [
    ['ecg', E],
    ['ppg-a', A],
    ['ppg-b', B]
  ]) {
    if (!o.times.length) {
      console.error(`${name}: detector returned NO beats (fs=${o.fs.toFixed(2)}) — refusing to report a table built on it`);
      return 1;
    }
  }
  const lo = Math.max(E.times[0], A.times[0], B.times[0]);
  const hi = Math.min(E.times[E.times.length - 1], A.times[A.times.length - 1], B.times[B.times.length - 1]);
  const win = (arr) => arr.filter((t) => t >= lo && t <= hi);
  const eT = win(sortT(E)),
    aT = win(sortT(A)),
    bT = win(sortT(B));
  /* Align the optical sources onto the ECG by their median lag before building the table. */
  const lagA = medianLag(eT, aT, 600),
    lagB = medianLag(eT, bT, 600);
  const aAdj = aT.map((t) => t - lagA),
    bAdj = bT.map((t) => t - lagB);
  if (argv.includes('--scan')) {
    const winMs = Number(arg('--win-min') || 2) * 60000;
    const sc = scanWindows(eT, aAdj, bAdj, tol, winMs);
    const ranked = sc.windows.slice().sort((x, y) => y.disagree - x.disagree);
    const usable = ranked.filter((w) => w.est.ok);
    console.log(`windows=${sc.windows.length} of ${(sc.spanMs / 60000).toFixed(1)} min at ${winMs / 60000} min each`);
    console.log(`median disagreement/window: ${sc.windows.map((w) => w.disagree).sort((a, b) => a - b)[sc.windows.length >> 1]}`);
    console.log(`windows where the estimator is identifiable: ${usable.length}/${sc.windows.length}` + `  (covering ${(((usable.length * winMs) / sc.spanMs) * 100).toFixed(1)} % of the overlap)`);
    for (const w of ranked.slice(0, 8)) {
      const m = Math.round((w.startMs - sc.windows[0].startMs) / 60000);
      console.log(`  min ${String(m).padStart(3)}  agree=${String(w.agree).padStart(4)} disagree=${String(w.disagree).padStart(3)}  ` + estSummary(w.est));
    }
    if (usable.length) {
      const fr = usable.map((w) => w.est.missedFracPct).sort((a, b) => a - b);
      console.log(`\nmissed-fraction across identifiable windows: median ${fr[fr.length >> 1].toFixed(2)} %  range ${fr[0].toFixed(2)}–${fr[fr.length - 1].toFixed(2)} %`);
      console.log('NOTE: this describes the DISAGREEING segments only; it must not be scaled to the night.');
    }
    return 0;
  }
  const c = profile(eT, aAdj, bAdj, tol);
  const est = estimate(c);
  console.log(
    JSON.stringify(
      {
        windowMin: +((hi - lo) / 60000).toFixed(2),
        tolMs: tol,
        fs: { ecg: +E.fs.toFixed(2), ppgA: +A.fs.toFixed(2), ppgB: +B.fs.toFixed(2) },
        beats: { ecg: eT.length, ppgA: aT.length, ppgB: bT.length },
        medianPulseArrivalMs: { ppgA: lagA, ppgB: lagB },
        ...est
      },
      null,
      1
    )
  );
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('beat-capture-recapture.mjs')) process.exit(main(process.argv.slice(2)));

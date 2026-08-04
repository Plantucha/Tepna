#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * beat-comb-analysis.mjs — why two beat trains cannot tell you a clock offset
 *
 * WHY — IBI-ALIGNMENT-LIMIT-2026-08-01-BRIEF measured wrist↔finger beat
 * correspondence with "nearest beat + linear median" and reported a per-night
 * table, one row of which (2026-07-27: median 326 ms, 5 % of beats inside
 * ±100 ms) was called "an outlier worth chasing — a per-night defect, not a
 * method limit". It also cited no tool, so the numbers were not reproducible.
 *
 * Both problems have the same root. Nearest-beat matching is bounded by ±RR/2,
 * so its output is a CIRCULAR quantity and a linear median of it is undefined
 * near the wrap. Replace it with a LAG SWEEP — for each candidate offset τ,
 * count the A-beats having a B-beat within ±tol of (t+τ) — and the wrap is gone,
 * because τ is unbounded.
 *
 * What the sweep shows is worse than a resolution limit, and is the real finding:
 *
 *   The coincidence curve between two beat trains is a COMB whose period is the
 *   MEAN RR, with teeth of equal height. The offset is therefore identifiable
 *   only MODULO one heartbeat. No statistic escapes this — it is a property of
 *   correlating two periodic trains, not of the estimator or of the data.
 *
 * So the old table was reading one arbitrary tooth, and its "% inside ±100 ms"
 * column was simply the curve's height AT ZERO LAG — which varies between 5 %
 * and 26 % across nights purely by where zero happens to fall on the comb.
 * (`--dir` reproduces that column to within 2 points on all six box nights.)
 *
 * This is also the structural reason ACC↔ACC envelope correlation DOES work:
 * an activity envelope is APERIODIC, so its cross-correlation has one peak.
 * A beat train is periodic by construction, so its coincidence curve cannot.
 *
 * ⛔ BUT THE CONCLUSION DRAWN FROM THAT WAS WRONG — corrected 2026-08-01.
 * This tool sweeps ONE offset across a whole night. The two optical devices
 * DRIFT relative to each other, by up to 123 ppm measured — over 7 h that is
 * ~3 s, nearly three RR intervals. So a constant-offset scan is right at the
 * start of the night and comparing against the wrong beat by the end, and the
 * "% corresponding" it reports is mostly a statement about how far the clocks
 * have separated. Refitting in 5-minute blocks takes the same nights from
 * 18–40 % to 43–98.8 % (chance control, same search: 22–27 %). Use --local.
 *
 * The comb is still real, and is still why you cannot simply search harder:
 * under a CONSTANT offset the teeth are one RR apart and no statistic picks
 * between them. What resolves it is a drift term, not a finer search.
 *
 * USAGE
 *   node tools/beat-comb-analysis.mjs --selftest
 *     Deterministic synthetic pair with a PLANTED offset and known mean RR.
 *     Truth is known, so this asserts the comb rather than describing it:
 *     the teeth appear at planted + k·meanRR, they are of comparable height,
 *     and the argmax is NOT reliably the planted tooth. Known-answer, no corpus.
 *
 *   node tools/beat-comb-analysis.mjs --dir <folder of per-night export dirs>
 *     Real path. Each <night>/ holds PpgDex_<night>.node-export.json (wrist) and
 *     PpgDexFinger_<night>.node-export.json (finger); both need timeseries.ppi,
 *     which node exports carry from v2.0.0 on. Prints the per-night table.
 *
 *   --local       refit the offset per 5-minute block instead of once per night.
 *                 This is the honest measurement of beat CORRESPONDENCE; without
 *                 it the number is confounded with relative clock drift.
 *   --control     shift the partner series by +1 h and re-run, with identical
 *                 degrees of freedom — because a per-block search is exactly the
 *                 kind of added freedom that manufactures a result.
 *   --pair <p>    optical | ecg-wrist | ecg-finger | all   (default optical)
 *                 `optical` is wrist↔finger, the brief's CONTROL table. The two
 *                 `ecg-*` pairs are the brief's FIRST table, which turns out to be
 *                 the same comb — its "mode unstable 10 → 1010 ms" is an argmax
 *                 hopping between teeth, not a fiducial too poor to match beats.
 *   --tol <ms>    coincidence half-window            (default 100)
 *   --span <RR>   sweep half-width in mean-RR units  (default 3)
 * ════════════════════════════════════════════════════════════════════════ */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

/* The closure identity + the four-state verdict, from the module `trio-batch` already routes its
   clock lines through. Imported rather than reimplemented: a second copy of "when is a ppm a
   measurement" is how this tool came to publish one that no closure had ever seen. */
const DriftReport = createRequire(import.meta.url)('./drift-report.js');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const TOL = parseFloat(opt('--tol', '100'));
/* Refit per block rather than once per night. See the ⛔ note in the header: without this the
   reported correspondence is confounded with relative clock drift, which is how this tool's own
   first conclusion came out wrong. `--control` shifts the partner +1 h with identical degrees of
   freedom, because a per-block search is exactly the kind of added freedom that manufactures one. */
const LOCAL = flag('--local');
const CONTROL = flag('--control');
const SPAN_RR = parseFloat(opt('--span', '3'));

/* ── the instrument ────────────────────────────────────────────────────── */

/** Count A-beats having a B-beat within ±tol of (a + tau). Both arrays sorted ms. */
function coincidence(A, B, tau, tol) {
  let n = 0;
  let j = 0;
  for (let i = 0; i < A.length; i++) {
    const x = A[i] + tau;
    while (j < B.length && B[j] < x - tol) j++;
    if (j < B.length && B[j] <= x + tol) n++;
  }
  return n;
}

/**
 * Sweep τ and return the curve plus its structure.
 * `floor` is the chance level: B-beats arriving at their own mean rate give each
 * A-beat an independent 1 − exp(−rate·2·tol) probability of a spurious partner.
 */
function sweep(A, B, meanRR, tol, spanRR, stepMs) {
  const step = stepMs || 10;
  const half = spanRR * meanRR;
  const lags = [];
  const counts = [];
  for (let tau = -half; tau <= half; tau += step) {
    lags.push(tau);
    counts.push(coincidence(A, B, tau, tol));
  }
  let bi = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] > counts[bi]) bi = i;

  const span = B[B.length - 1] - B[0];
  const rate = B.length / span;
  const floor = A.length * (1 - Math.exp(-rate * 2 * tol));

  /* Teeth: local maxima at least 60 % of a beat apart and clearly above chance.
     A tooth is not sharp — it is as wide as the matching window (±tol) convolved
     with the two trains' jitter, so the raw argmax wanders tens of ms inside a
     flat top. Report the count-weighted CENTROID of the plateau (everything
     within 90 % of the local max) instead; that is stable to a few ms. */
  const teeth = [];
  for (let i = 2; i < counts.length - 2; i++) {
    let isMax = true;
    for (let k = -2; k <= 2; k++) if (counts[i + k] > counts[i]) isMax = false;
    if (!isMax || counts[i] < 1.5 * floor) continue;
    let lo = i;
    let hi = i;
    while (lo > 0 && counts[lo - 1] >= 0.9 * counts[i]) lo--;
    while (hi < counts.length - 1 && counts[hi + 1] >= 0.9 * counts[i]) hi++;
    let wSum = 0;
    let w = 0;
    for (let k = lo; k <= hi; k++) {
      wSum += lags[k] * counts[k];
      w += counts[k];
    }
    const centre = w > 0 ? wSum / w : lags[i];
    if (teeth.length && centre - teeth[teeth.length - 1].lag < 0.6 * meanRR) {
      if (counts[i] > teeth[teeth.length - 1].n) teeth[teeth.length - 1] = { lag: centre, n: counts[i] };
      continue;
    }
    teeth.push({ lag: centre, n: counts[i] });
  }
  return { lags, counts, best: { lag: lags[bi], n: counts[bi] }, floor, teeth, zero: coincidence(A, B, 0, tol) };
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

/* ── real corpus ───────────────────────────────────────────────────────── */

/** Beat times from a node export's timeseries block, on the absolute floating timeline. */
function loadBeats(path, key) {
  if (!existsSync(path)) return null;
  const d = JSON.parse(readFileSync(path, 'utf8'));
  const p = d.timeseries && d.timeseries[key];
  if (!p || !p.tSec || !p.tSec.length) return null;
  const t0 = (d.recording && d.recording.startEpochMs) || 0;
  return { t: p.tSec.map((s) => s * 1000 + t0), ms: p.ms };
}

/* Which trains to correlate. `optical` is the pair the brief's CONTROL table used;
   the two `ecg-*` pairs are the brief's FIRST table, which turns out to be the same
   comb — its "mode unstable 10 → 1010 ms" is an argmax hopping between teeth. */
const PAIRS = {
  optical: { label: 'wrist↔finger', a: ['PpgDex', 'ppi'], b: ['PpgDexFinger', 'ppi'] },
  'ecg-wrist': { label: 'ECG→wrist', a: ['ECGDex', 'rr'], b: ['PpgDex', 'ppi'] },
  'ecg-finger': { label: 'ECG→finger', a: ['ECGDex', 'rr'], b: ['PpgDexFinger', 'ppi'] }
};

/* The three pairs above are not three unrelated measurements — they are the three edges of ONE
   triangle over {ECGDex, PpgDex, PpgDexFinger}, so their drifts are over-determined by exactly one
   constraint. `--pair all` is therefore the only mode that can check itself, which is why closure is
   gated on it rather than offered as a flag: a single pair has nothing to close against.

   A lag tau maximises coincidence(A, B, tau), i.e. B's beats sit at A + tau, so tau is B relative to
   A and the pair is the directed leg a->b. Then tau(ecg,wrist) + tau(wrist,finger) = tau(ecg,finger)
   by construction, and differentiating gives the rate identity closeTriple checks. */
const TRIANGLE = { optical: ['PpgDex', 'PpgDexFinger'], 'ecg-wrist': ['ECGDex', 'PpgDex'], 'ecg-finger': ['ECGDex', 'PpgDexFinger'] };

/**
 * Beat correspondence with the offset REFIT PER BLOCK — the measurement the whole-night
 * sweep cannot make. Returns the median per-block coincidence and the drift implied by
 * how the per-block offset marches, via a Theil–Sen slope over block pairs ≥30 min apart.
 */
function localCorrespondence(A, B, tol, blockMs, shiftMs) {
  const b = shiftMs ? B.map((x) => x + shiftMs) : B;
  const t0 = A[0];
  const t1 = A[A.length - 1];
  const fracs = [];
  const pts = [];
  for (let bs = t0; bs < t1; bs += blockMs) {
    const wb = A.filter((t) => t >= bs && t < bs + blockMs);
    if (wb.length < 60) continue;
    const fb = b.filter((t) => t >= bs - 4000 && t < bs + blockMs + 4000);
    if (fb.length < 60) continue;
    let best = 0;
    let bl = 0;
    for (let tau = -3000; tau <= 3000; tau += 20) {
      const c = coincidence(wb, fb, tau, tol);
      if (c > best) {
        best = c;
        bl = tau;
      }
    }
    fracs.push((100 * best) / wb.length);
    pts.push([(bs - t0) / 60000, bl]);
  }
  if (!fracs.length) return null;
  const med = (a) => {
    const x = a.slice().sort((p, q) => p - q);
    return x[x.length >> 1];
  };
  const sl = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j][0] - pts[i][0];
      if (dx > 30) sl.push((pts[j][1] - pts[i][1]) / dx);
    }
  const driftMsPerMin = sl.length ? med(sl) : null;
  return { blocks: fracs.length, median: med(fracs), best: Math.max(...fracs), driftMsPerMin, ppm: driftMsPerMin == null ? null : (driftMsPerMin / 60000) * 1e6 };
}

/**
 * Print one night's per-block rows, gated on the three-source closure over its own legs.
 *
 * §6 of `CROSS-DEVICE-DRIFT-AND-CLOSURE`: *"Do not quote a ppm figure that has not closed. The six
 * nights here produce drift estimates spanning -21 to +754 ppm; two of them are credible. The rest
 * are unwrap failures wearing the same units, and they are indistinguishable from real measurements
 * without the closure column beside them."* This tool printed that column for a year with no closure
 * beside it, on a corpus where its own ppm spans -133 to +185 against a crystal error of ~20.
 *
 * The number is still PRINTED in every state — a refusal is a result and suppressing the fit would
 * cost the diagnostic — but it is marked unquotable, exactly as `driftFitLine` marks its own.
 */
const closureTally = { closed: 0, inconsistent: 0, unclosed: 0, legsSeen: {} };

function flushNight(night, local) {
  const legs = local.filter((r) => r.L && r.L.ppm != null && isFinite(r.L.ppm) && TRIANGLE[r.key]).map((r) => ({ a: TRIANGLE[r.key][0], b: TRIANGLE[r.key][1], ppm: r.L.ppm }));
  /* null when the triangle is incomplete — which is the honest answer for `--pair optical`, not a
     pass. driftVerdict(null) is the 'unclosed' state, and unclosed is not quotable. */
  const tri = legs.length === 3 ? DriftReport.closeTriple(legs) : null;
  const v = DriftReport.driftVerdict(tri);
  closureTally[tri ? (tri.consistent ? 'closed' : 'inconsistent') : 'unclosed']++;
  for (const r of local) closureTally.legsSeen[r.key] = (closureTally.legsSeen[r.key] || 0) + 1;

  for (const r of local) {
    console.log(
      night.padEnd(14),
      r.label.padEnd(15),
      r.wholeNight.toFixed(1).padStart(9) + '%',
      (r.L ? r.L.median.toFixed(1) : '—').padStart(11) + '%',
      (r.L ? r.L.best.toFixed(1) : '—').padStart(8) + '%',
      (r.L && r.L.ppm != null ? r.L.ppm.toFixed(0) : '—').padStart(9),
      (v.quotable ? 'yes' : v.state.toUpperCase()).padStart(11),
      r.C ? (r.C.median.toFixed(1) + '%').padStart(11) : ''
    );
  }
  if (tri) {
    console.log(
      `${''.padEnd(14)} ⏱ 3-source closure: ${tri.closurePpm.toFixed(1)} ppm (identity 0, tol ${tri.tolPpm.toFixed(0)})` +
        `   ${tri.consistent ? 'consistent — ppm above is a measurement' : '⚠ INCONSISTENT — at least one pairwise fit is wrong; the ppm above is not a measurement'}`
    );
  } else if (local.length) {
    console.log(`${''.padEnd(14)} ⏱ 3-source closure: UNCLOSED — ${v.why}; the ppm above is a fit, not a measurement`);
  }
}

function runDir(dir, which) {
  const nights = readdirSync(dir).sort();
  const pairs = which === 'all' ? Object.keys(PAIRS) : [which];
  console.log(`beat-comb — ${dir}   tol ±${TOL} ms, sweep ±${SPAN_RR} RR\n`);
  if (LOCAL) console.log('night          pair            whole-night   per-block   best     ppm   quotable' + (CONTROL ? '     control' : ''));
  else console.log('night          pair            meanRR   @lag0%   peak%   floor%   ratio   teeth   spacing (ms)');
  let seen = 0;
  for (const night of nights) {
    const local = [];
    for (const key of pairs) {
      const P = PAIRS[key];
      const A = loadBeats(join(dir, night, `${P.a[0]}_${night}.node-export.json`), P.a[1]);
      const B = loadBeats(join(dir, night, `${P.b[0]}_${night}.node-export.json`), P.b[1]);
      if (!A || !B) continue;
      seen++;
      const meanRR = mean(A.ms);
      const s = sweep(A.t, B.t, meanRR, TOL, SPAN_RR);
      if (LOCAL) {
        const L = localCorrespondence(A.t, B.t, TOL, 5 * 60 * 1000, 0);
        const C = CONTROL ? localCorrespondence(A.t, B.t, TOL, 5 * 60 * 1000, 3600000) : null;
        /* BUFFERED, not printed. The whole point of `drift-report.js` is that the closure is computed
           BEFORE the line that quotes the number — printing here and closing afterwards is the exact
           ordering bug that module was extracted to fix. */
        local.push({ key, label: P.label, wholeNight: (100 * s.best.n) / A.t.length, L, C });
        continue;
      }
      const sp = [];
      for (let i = 1; i < s.teeth.length; i++) sp.push(Math.round(s.teeth[i].lag - s.teeth[i - 1].lag));
      console.log(
        night.padEnd(14),
        P.label.padEnd(15),
        String(Math.round(meanRR)).padStart(6),
        ((100 * s.zero) / A.t.length).toFixed(1).padStart(8),
        ((100 * s.best.n) / A.t.length).toFixed(1).padStart(7),
        ((100 * s.floor) / A.t.length).toFixed(1).padStart(8),
        (s.best.n / s.floor).toFixed(2).padStart(7),
        String(s.teeth.length).padStart(7),
        '  ' + sp.join(' ')
      );
    }
    if (LOCAL && local.length) flushNight(night, local);
  }
  if (!seen) {
    console.log('\n(no night carried both halves of the requested pair with a beat timeseries)');
    return;
  }
  if (LOCAL) {
    const tallied = closureTally.closed + closureTally.inconsistent + closureTally.unclosed;
    console.log(
      `\nCLOSURE: ${closureTally.closed} closed · ${closureTally.inconsistent} inconsistent · ${closureTally.unclosed} unclosed, of ${tallied} night(s).` +
        (closureTally.closed ? '' : '  NOT ONE ppm ABOVE IS A MEASUREMENT.')
    );
    /* A pair that produced no rows is INVISIBLE in the table — it simply has no lines — and an absent
       leg is the one thing that makes closure structurally impossible rather than merely failing. So
       the pairs that ran are named against the pairs that were asked for. */
    const askedFor = which === 'all' ? Object.keys(PAIRS) : [which];
    const silent = askedFor.filter((k) => !closureTally.legsSeen[k]);
    if (silent.length)
      console.log(
        `  ⚠ ${silent.length} of ${askedFor.length} requested pair(s) produced NO rows: ${silent.join(', ')}.` +
          `\n    A triangle needs all three legs, so closure cannot be evaluated at all — this is not a` +
          `\n    failed check, it is an absent one. Supply the missing node export(s) or do not quote a ppm.`
      );
    console.log(`\n${seen} row(s). PER-BLOCK is the honest correspondence; WHOLE-NIGHT is that number`);
    console.log('confounded with relative clock drift, which the ppm column quantifies. Compare each');
    console.log('row against its own CONTROL (partner shifted +1 h, identical per-block search) — the');
    console.log('gain has to survive that, or it is just the extra degrees of freedom.');
    return;
  }
  console.log(`\n${seen} row(s). Read the SPACING column: where it is ≈ meanRR the curve is a comb,`);
  console.log('and the offset is identifiable only modulo one beat. @lag0 is what a nearest-beat');
  console.log('matcher reports as "% corresponding" — it is the comb sampled at zero, nothing more.');
  console.log('A ratio near 1 means no beat sharing at all, and there the peak lag is pure noise.');
}

/* ── selftest: planted truth ───────────────────────────────────────────── */

function selftest() {
  let pass = 0;
  let fail = 0;
  const ok = (name, cond, detail) => {
    if (cond) {
      pass++;
      console.log(`  ✓ ${name}`);
    } else {
      fail++;
      console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`);
    }
  };

  /* Deterministic LCG — no Math.random, so the assertions below are fixed. */
  let s = 20260801;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  const MEAN_RR = 1000;
  const PLANTED = 250; // ms; B beats arrive this much after A's
  const N = 6000;

  /* A: a beat train with realistic RR variability (±8 %). B: the same beats,
     shifted by PLANTED, with per-beat jitter and 25 % of beats dropped — i.e.
     the two trains genuinely share beats, which is the favourable case. */
  const A = [];
  let t = 0;
  for (let i = 0; i < N; i++) {
    A.push(t);
    t += MEAN_RR * (0.92 + 0.16 * rnd());
  }
  const B = [];
  for (let i = 0; i < A.length; i++) {
    if (rnd() < 0.25) continue;
    B.push(A[i] + PLANTED + (rnd() - 0.5) * 60);
  }

  const rrA = [];
  for (let i = 1; i < A.length; i++) rrA.push(A[i] - A[i - 1]);
  const meanRR = mean(rrA);

  const r = sweep(A, B, meanRR, 100, 3, 10);

  ok(
    'the planted offset IS a tooth',
    r.teeth.some((x) => Math.abs(x.lag - PLANTED) <= 60),
    `teeth at ${r.teeth.map((x) => Math.round(x.lag)).join(', ')}`
  );
  ok('the curve is a comb, not a peak — ≥3 teeth', r.teeth.length >= 3, `${r.teeth.length} teeth`);

  const sp = [];
  for (let i = 1; i < r.teeth.length; i++) sp.push(r.teeth[i].lag - r.teeth[i - 1].lag);
  const spOk = sp.length > 0 && sp.every((v) => Math.abs(v - meanRR) < 0.12 * meanRR);
  ok('tooth spacing is the MEAN RR', spOk, `spacing ${sp.map(Math.round).join(', ')} vs meanRR ${Math.round(meanRR)}`);

  /* The identifiability claim: a non-planted tooth reaches most of the planted
     tooth's height, so the argmax carries almost no information about which
     tooth is the true one. This is the assertion the brief's table violated. */
  const planted = r.teeth.find((x) => Math.abs(x.lag - PLANTED) <= 60);
  const others = r.teeth.filter((x) => Math.abs(x.lag - PLANTED) > 0.6 * meanRR);
  const tallestOther = others.length ? Math.max(...others.map((x) => x.n)) : 0;
  ok(
    'a wrong tooth reaches ≥50 % of the right one — offset is ambiguous mod RR',
    planted && tallestOther >= 0.5 * planted.n,
    planted ? `${Math.round((100 * tallestOther) / planted.n)} %` : 'no planted tooth'
  );

  /* And the consequence for the retired statistic: coincidence at lag 0 tells
     you where zero fell on the comb, NOT how well the two trains correspond. */
  const zeroPct = (100 * r.zero) / A.length;
  const peakPct = (100 * r.best.n) / A.length;
  ok('coincidence at lag 0 badly understates correspondence when zero is off-tooth', zeroPct < 0.5 * peakPct, `@0 ${zeroPct.toFixed(1)} % vs peak ${peakPct.toFixed(1)} %`);

  /* ── THE ONE THIS TOOL'S FIRST CONCLUSION NEEDED (2026-08-01) ─────────
     Plant a pair that SHARES EVERY BEAT but drifts, and the whole-night sweep
     reports poor correspondence anyway — which is exactly what was measured on
     the real corpus and read as physiology. The local refit recovers it. Without
     this assertion the tool can report 20 % on a pair that shares 100 %. */
  const DRIFT_PPM = 123; // the worst measured on the real corpus (2026-07-28)
  const dA = [];
  let dt = 0;
  for (let i = 0; i < 25000; i++) {
    dA.push(dt);
    dt += MEAN_RR * (0.92 + 0.16 * rnd());
  }
  // partner sees THE SAME beats, on a clock running DRIFT_PPM fast
  const dB = dA.map((t) => t * (1 + DRIFT_PPM / 1e6) + 250);
  const span = (dA[dA.length - 1] - dA[0]) / 1000;
  const accrued = (span * DRIFT_PPM) / 1e6;
  ok('the planted night accrues more than one RR of drift', accrued * 1000 > MEAN_RR, `${accrued.toFixed(1)} s over ${(span / 60).toFixed(0)} min vs RR ${MEAN_RR} ms`);

  let gBest = 0;
  for (let tau = -3000; tau <= 3000; tau += 10) gBest = Math.max(gBest, coincidence(dA, dB, tau, 100));
  const gPct = (100 * gBest) / dA.length;
  const loc = localCorrespondence(dA, dB, 100, 5 * 60 * 1000, 0);
  const ctl = localCorrespondence(dA, dB, 100, 5 * 60 * 1000, 3600000);
  ok('ONE offset badly understates a pair that shares every beat', gPct < 60, `whole-night ${gPct.toFixed(1)} % on a 100 %-shared pair`);
  ok('…and refitting per block recovers it', loc && loc.median > 90, loc ? `per-block ${loc.median.toFixed(1)} %` : 'null');
  ok('…and that gain survives the +1 h control', loc && ctl && loc.median > 3 * ctl.median, loc && ctl ? `${loc.median.toFixed(1)} % vs control ${ctl.median.toFixed(1)} %` : 'null');
  ok(
    '…and the drift is recovered to within 15 ppm',
    loc && loc.ppm != null && Math.abs(loc.ppm - DRIFT_PPM) < 15,
    loc && loc.ppm != null ? `${loc.ppm.toFixed(0)} ppm vs planted ${DRIFT_PPM}` : 'null'
  );

  /* Control: against an INDEPENDENT train there is no comb above chance —
     so the comb above is beat sharing, not an artifact of the sweep itself. */
  const C = [];
  t = 0;
  for (let i = 0; i < N; i++) {
    C.push(t);
    t += MEAN_RR * (0.92 + 0.16 * rnd());
  }
  const rc = sweep(A, C, meanRR, 100, 3, 10);
  ok('independent trains produce no tooth above 1.5× chance', rc.teeth.length === 0, `${rc.teeth.length} teeth`);

  /* ── the closure gate, on PLANTED legs ────────────────────────────────────────────────────────
     The identity is checked here rather than only in the shared suite because this is the tool that
     PUBLISHES the ppm, and the failure being guarded against is a consistent-looking closure over an
     incomplete or wrong triangle. Truth is planted, so these assert rather than describe. */
  const L = (a, b, ppm) => ({ a, b, ppm });
  /* Three legs that genuinely come from three clocks: wrist +30 ppm and finger +50 ppm relative to
     the ECG, so the optical pair MUST read +20 or one of the three fits is wrong. */
  const good = DriftReport.closeTriple([L('ECGDex', 'PpgDex', 30), L('PpgDex', 'PpgDexFinger', 20), L('ECGDex', 'PpgDexFinger', 50)]);
  ok('a consistent triangle closes at 0', good && Math.abs(good.closurePpm) < 1e-9, good ? `${good.closurePpm}` : 'null');
  ok('…and is quotable', DriftReport.driftVerdict(good).quotable === true);

  /* THE RED. Same triangle with the optical leg off by 40 ppm — the shape every corpus row has when
     its per-block lag hopped a tooth. It must be caught BY VALUE, not by throwing. */
  const bad = DriftReport.closeTriple([L('ECGDex', 'PpgDex', 30), L('PpgDex', 'PpgDexFinger', 60), L('ECGDex', 'PpgDexFinger', 50)]);
  ok('an inconsistent triangle does NOT close', bad && !bad.consistent, bad ? `${bad.closurePpm.toFixed(1)} ppm vs tol ${bad.tolPpm.toFixed(1)}` : 'null');
  ok('…and is NOT quotable', DriftReport.driftVerdict(bad).quotable === false);

  /* An absent leg must not close trivially — two legs and a hole would sum to whatever the two are. */
  ok('two legs and a hole is unclosed, not consistent', DriftReport.closeTriple([L('ECGDex', 'PpgDex', 30), L('PpgDex', 'PpgDexFinger', 20)]) === null);
  ok('…and unclosed is not quotable', DriftReport.driftVerdict(null).quotable === false);

  /* The tolerance scales with the legs, so the SAME residual is judged differently against sharp
     legs and against weak ones — a fixed threshold would excuse the first or condemn the second. */
  const sharp = DriftReport.closeTriple([L('a', 'b', 4), L('b', 'c', 4), L('c', 'a', -2)]);
  const weak = DriftReport.closeTriple([L('a', 'b', 400), L('b', 'c', 400), L('c', 'a', -794)]);
  ok('a 6 ppm residual is tolerated against 400 ppm legs', weak && weak.consistent, weak ? `tol ${weak.tolPpm.toFixed(0)}` : 'null');
  ok('…and the same 6 ppm is NOT tolerated against 4 ppm legs', sharp && !sharp.consistent, sharp ? `tol ${sharp.tolPpm.toFixed(0)}` : 'null');

  console.log(`\n${fail === 0 ? '✓' : '✗'} selftest — ${pass} passed, ${fail} failed`);
  return fail === 0;
}

/* ── main ──────────────────────────────────────────────────────────────── */

if (flag('--selftest')) {
  process.exit(selftest() ? 0 : 1);
} else {
  const dir = opt('--dir', null);
  const pair = opt('--pair', 'optical');
  if (!dir || !existsSync(dir)) {
    console.error('beat-comb-analysis: --dir <folder of per-night export dirs>, or --selftest');
    process.exit(2);
  }
  if (pair !== 'all' && !PAIRS[pair]) {
    console.error(`beat-comb-analysis: --pair must be one of ${Object.keys(PAIRS).join(', ')}, all`);
    process.exit(2);
  }
  runDir(dir, pair);
}

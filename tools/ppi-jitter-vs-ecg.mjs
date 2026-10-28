#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * ppi-jitter-vs-ecg.mjs — O2RING-FINGER-HRV-VALIDATION §3, the PRIMARY endpoint
 * ------------------------------------------------------------------------------------------------
 * PPI-jitter sd for the O2Ring FINGER pleth against paired H10 chest ECG, reported as median + IQR
 * across nights so it is directly comparable to the Verity wrist's 5.92 ms.
 *
 * The brief says "adopt the deep-dive's validated apparatus verbatim". That apparatus was never
 * committed — like the two O2Ring sweeps §5b found dead, and like the §3 scratchpad whose numbers can
 * no longer be re-derived. So this is it, committed, with a corpus-free `--selftest`.
 *
 * WHY BEAT MATCHING NEEDS PER-EPOCH ALIGNMENT (§3.3, non-negotiable). The finger pulse arrives
 * ~150-250 ms after the R-peak and that pulse-transit time DRIFTS over a night. A single global lag
 * scores ~F1 0.26 and a nonsense −1 ms PTT. Worse, aligning on the beat trains themselves pins the
 * offset only MODULO one heartbeat — a beat train is periodic, so a whole-RR error is invisible.
 *
 * So the coarse lag is taken on the INSTANTANEOUS-HR ENVELOPE, not the beat times: HR wanders
 * aperiodically over a 5-min epoch (respiratory sinus arrhythmia, arousals), and an aperiodic signal
 * cannot alias by a beat. Only after that envelope lag is removed is ±75 ms one-to-one beat matching
 * meaningful, and only within the epoch it was measured on.
 *
 * WHAT IS REPORTED
 *   PPI-jitter sd  sd of (finger interval − its matched ECG interval), per epoch, median over epochs
 *                  per night, then median + IQR over nights.   PRIMARY.
 *   RMSSD bias %   finger whole-record RMSSD vs ECG, per night.
 *   sdnnRobust %   the jitter-robust family the brief expects to survive where RMSSD does not.
 *   match rate     fraction of finger beats matched within ±75 ms after alignment — a low rate makes
 *                  the jitter figure meaningless and is reported beside it, never folded in.
 *
 * THE PER-EPOCH ARM (added 2026-10-28) — the estimator `papers/ppg-ecg-hrv-validation.html` actually
 * quotes, which until now had no producer. Every figure below is computed on the SAME shared absolute
 * 5-min grid the jitter rides, by each node's OWN exported estimator:
 *   per-epoch rMSSD/SDNN bias %   median over nights of each night's median epoch — NOT the
 *                                 whole-record figure above, and the two are printed side by side.
 *   k, R²                         the model rMSSD²_ppg = rMSSD²_ecg + k·σ², fitted per night through
 *                                 the origin, against the theoretical band 2 ≤ k ≤ 6.
 *   catastrophic epochs           the |ΔrMSSD| > 25 % population, with each side's jitter median.
 *   MAE, PPI bias, sensitivity    Table 1's remaining columns, from the same matched differences.
 *   jitter budget                 σ for a 1/2/3 % bias, inverted from the fitted k and the MEASURED
 *                                 reference rMSSD it is a fraction of — which is printed with it.
 *
 * SHIPPED CODE ONLY — PPGDSP/ECGDSP co-loaded in a vm realm mirroring tests/run-tests.mjs. No
 * reimplemented HRV math: RMSSD/SDNN come from the node's own analyze().
 *
 * USAGE
 *   node tools/ppi-jitter-vs-ecg.mjs --dir <captures> [--min-epochs 3] [--max-nights 20]
 *   node tools/ppi-jitter-vs-ecg.mjs --selftest
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const SELFTEST = has('--selftest');
const DIR = opt('--dir', null);
const MIN_EPOCHS = +opt('--min-epochs', 3);
const MAX_NIGHTS = +opt('--max-nights', 20);
/* 🔴 AN OPTIONAL PER-EPOCH DUMP, OFF BY DEFAULT AND NEVER INSIDE THE REPOSITORY. A per-epoch row is a
   per-night capture record, so it stays off the public tree (§5 of the paper says so in as many words)
   — but every question asked of a published figure afterwards otherwise costs another full corpus pass.
   The flag takes an explicit path, writes nothing without one, and the paper cites the POOLED record. */
const EPOCH_DUMP = opt('--epoch-dump', null);
/* WHICH PPG DEVICE. The finger is this brief's subject, but the Verity must be runnable through the
   SAME instrument. The deep-dive's 5.92 ms wrist figure is `[CORPUS]`-marked and its §2.2 apparatus was
   never committed — §2.2 describes the method and names no tool — so quoting a finger number against it
   would compare two instruments, only one of which can be re-run. Measuring both here makes the
   comparison same-instrument and turns 5.92 ms into a CHECK ON THIS TOOL rather than a constant. */
/* §4 adjudicates CVHR on SLEEP nights specifically — "n=2 waking is not evidence". The capture corpus
   mixes overnight recordings with daytime segments, so a night is taken as sleep when it STARTS between
   20:00 and 04:00 local and runs ≥ 4 h. Crude, and deliberately so: it is a property of the filename
   stamp and the duration, not a stage call, and over-including a borderline night is safer here than
   silently excluding a real one. Reported alongside the unfiltered figure so the filter's effect is
   visible rather than assumed. */
const SLEEP_ONLY = has('--sleep-only');
/* SESSION MERGE (default ON; --no-merge reproduces the pre-2026-08-04 single-file behaviour).
   The O2Ring and the Polar loggers split ONE night across many session files — 1632 finger files across
   18 nights, and the early nights are 100-400 fragments with no single continuous recording. Treating
   one FILE as one night therefore made most of the corpus invisible: only the 9 nights that happened to
   contain one long unbroken file ever produced a row, and raising --max-nights from 30 to 120 changed
   nothing because the cap was never the binding constraint. `trio-batch.mjs` already merges concurrent
   sessions per night ("47 concurrent session(s), 12.2 h merged"); this is that idea, applied here.
   NIGHT KEY is trio-batch's: the date of (start - 12 h), so an evening start and the post-midnight hours
   of the same sleep land on one key. */
/* SESSION MERGE, both sides (finger and ECG). The earlier finger-only version is superseded; its
   asymmetry — a merged finger train paired against ONE ECG file — is what made merged jitter read
   worse. Kept in the history, not in the behaviour.
   REMAINING LIMITATION, deliberate: CVHR is still per-session. `cvhrFromNN` / `detectCVHR` live inside
   analyze() and are not exported, so a merged night carries its LARGEST session's cvhrIndex. A
   merged-night CVHR count therefore does NOT satisfy §3.1's ≥10-night bar and must not be read as
   doing so; exporting them is a compute-path change with a re-bundle and verify-fixtures behind it.
   Superseded note (was: ⚠ INCOMPLETE — the FINGER side merges, the ECG side does not yet). */
const MERGE = !has('--no-merge');
const nightKeyOf = (tMs) => new Date(tMs - 12 * 3600 * 1000).toISOString().slice(0, 10);
const DEVICE = String(opt('--device', 'o2ring')).toLowerCase();
/* ⚠️ THE SAME DEVICE IS NAMED TWO WAYS, and matching only one reports an EMPTY corpus as no data.
   The Verity Sense appears as `Polar_VeritySense_<serial>` when the capture host wrote it and as
   `Polar_Sense_<serial>` when Polar Sensor Logger did — identical serial (`0C301E3F` on this corpus),
   one physical armband. The repo already treats the PSL spelling as the Verity elsewhere: PpgDex's
   equivalence input is `Polar_Sense_BBBBBBBB_20260621_060523_PPG.txt`.
   Measured 2026-08-18 on the PSL tree: the old `/VeritySense/` pattern matched **0 of 1980** files
   while **54** wrist PPG and **50** paired H10 ECG files were present. A `--device verity` run there
   reported nothing to report, which reads as "the corpus cannot answer this" rather than "the tool
   cannot see it" — and that is the reading that kept a settling measurement looking impossible. */
const PPG_RE = DEVICE === 'verity' ? /(?:VeritySense|Polar_Sense).*_PPG\.txt$/i : /O2Ring.*_PPG\.txt$/i;

import {
  EPOCH_MS,
  MATCH_MS,
  HR_BIN_MS,
  MAX_LAG_MS,
  mean,
  sd,
  quantile,
  median,
  hrEnvelope,
  envelopeLagMs,
  refineLagByMatch,
  matchBeats,
  refinePeaks,
  ppiJitterMs,
  rateAgreement
} from './ppi-match.mjs';
import { gitCommitOf, notCovered, populationVerdict, ruleLine, snapshotEntries } from './corpus-scope-core.mjs';
/* Re-exported so the existing import surface of this file is unchanged for any consumer. */
export { hrEnvelope, envelopeLagMs, refineLagByMatch, matchBeats, refinePeaks, ppiJitterMs, rateAgreement };

/* ═══════════════════════════ THE PER-EPOCH ARM — PURE HALF ═══════════════════════════════════════
 * WHY IT EXISTS. `papers/ppg-ecg-hrv-validation.html` quotes its headline rMSSD bias as the median
 * over nights of each night's median PER-EPOCH bias, fits `rMSSD²_ppg = rMSSD²_ecg + k·σ²` per night,
 * and splits the corpus on |ΔrMSSD| > 25 %. This tool published a WHOLE-RECORD rMSSD bias, which is a
 * DIFFERENT ESTIMATOR over the same nights. So the paper's primary numbers had no producer (residue
 * `2026-10-27-the-ppg-ecg-hrv-paper-has-no-committed-producer`), and the gap between the published
 * +4.24 % and this tool's +6.52 % could not be attributed to population or to estimator.
 *
 * NO HRV MATH IS REIMPLEMENTED (§3.5). Each side's per-epoch rMSSD/SDNN comes from THAT NODE'S OWN
 * EXPORTED ESTIMATOR — `PPGDSP.timeDomain`, `ECGDSP.rmssd`, `ECGDSP.std` — fed the node's own published
 * interval series under the node's own masking rule, reproduced from the node's own epoch loop
 * (`ppgdex-dsp.js buildEpochs`, `ecgdex-dsp.js epochEngine`). The ONE thing that changes is the GRID.
 *
 * WHY THE GRID HAD TO MOVE. Each node anchors `epochs[]` to its own record `t0`, so the two grids
 * differ by a per-night phase and a published-epoch pairing can overlap by as little as 150 s of 300 s.
 * Pairing them reports that phase as a device difference. The jitter loop already walks a COMMON
 * ABSOLUTE grid, so the per-epoch arm rides it and both devices are scored on the same seconds.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */

/* PRE-STATED, never fitted to the data they judge (§🧾). The 25 % split and the 15 ms band are the
   paper's own; the k-fit floor is this tool's, because a three-epoch regression names a slope and
   measures nothing. */
const CAT_BIAS_PCT = 25;
const JIT_BAND_MS = 15;
const MIN_KFIT_EPOCHS = 5;

/* §4's clean-adjacency mask in the KEPT frame, rebuilt from the index map PpgDex publishes.
   `adj[j]` is true when the pair (j−1, j) was adjacent in the ORIGINAL train: a pair spanning a
   corrected or dropped interval is not a successive difference, and `timeDomain` must not count it.
   This is the node's own projection (`ppgdex-dsp.js`, `kIdx = corr.keptIdx`), not a new rule. */
export function adjFromKeptIdx(keptIdx) {
  if (!Array.isArray(keptIdx) || keptIdx.length === 0) return null;
  const adj = new Array(keptIdx.length);
  for (let j = 0; j < keptIdx.length; j++) adj[j] = j === 0 || keptIdx[j] === keptIdx[j - 1] + 1;
  return adj;
}

/* ECGDex's pair mask, one forward pass over the WHOLE record because that is how the node walks it:
   `dropped` persists across a window boundary, so the first survivor after a gap is marked 1 even when
   the gap sat in the previous window. `null` marks an interval the node removes outright — it never
   enters a segment, and a 0 in its place would silently convert an absence into a measured pair (§∅). */
export function ecgSkipSeries(spansGap, n) {
  const out = new Array(n);
  let dropped = false;
  for (let i = 0; i < n; i++) {
    if (spansGap && spansGap[i]) {
      out[i] = null;
      dropped = true;
      continue;
    }
    out[i] = dropped ? 1 : 0;
    dropped = false;
  }
  return out;
}

/* Half-open on both ends, matching both nodes' own epoch selection (`tt[i] >= e0 && tt[i] < e0 + 300`).
   A beat landing exactly on the boundary belongs to the window after it, in exactly one window. */
export function windowIdx(ttMs, t0, t1) {
  const idx = [];
  for (let i = 0; i < ttMs.length; i++) if (ttMs[i] >= t0 && ttMs[i] < t1) idx.push(i);
  return idx;
}

/* 🔴 THE ONE-SESSION RULE. A merged night is several recordings; each carries its OWN interval series,
   and the series are not concatenable — the gap between two sessions is not an RR interval. An epoch
   window that is not wholly inside ONE session has no per-epoch HRV to report, so it REFUSES with a
   named reason rather than borrowing a neighbour's series (§∅, owner ruling 2026-09-17: a
   discontinuity refuses). Two covering sessions is ambiguous, not better, and refuses too. */
export function coveringSession(sessions, t0, t1) {
  if (!Array.isArray(sessions)) return null;
  const hit = sessions.filter((s) => s && s.t0 <= t0 && s.t1 >= t1);
  return hit.length === 1 ? hit[0] : null;
}

/* THE PAPER'S MODEL, fitted per night: `rMSSD²_ppg = rMSSD²_ecg + k·σ²`, i.e. y = k·x through the
   ORIGIN with y the squared-rMSSD difference and x the measured jitter variance. The intercept is not
   free, because the model's whole claim is that zero jitter costs zero bias — fitting one would let a
   night with a rMSSD offset of construction buy a flattering k.
   TWO R² ARE REPORTED because the two conventions disagree on a through-origin fit and the paper's
   0.964 does not say which it used: `r2` is centred (against the mean of y, the conventional and
   stricter reading) and `r2Unc` is uncentred (against zero, which is the fit's own null). */
export function kFitThroughOrigin(pts) {
  const use = (pts || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (use.length < MIN_KFIT_EPOCHS) return null;
  let sxy = 0,
    sxx = 0,
    sy = 0;
  for (const p of use) {
    sxy += p.x * p.y;
    sxx += p.x * p.x;
    sy += p.y;
  }
  if (!(sxx > 0)) return null;
  const k = sxy / sxx;
  const ybar = sy / use.length;
  /* 🔴 THREE DENOMINATORS OVER ONE RESIDUAL SUM, because a published R² does not say which it divided by
     and the three differ by more than an order of magnitude here. `ssr` is the same for all three — the
     fit is the fit — and only the TOTAL changes:
       r2       variance of the INCREMENT rMSSD²f − rMSSD²e        → does jitter explain the GAP it claims to
       r2Unc    Σ of that increment squared, uncentred             → the same question with no intercept allowance
       r2Model  variance of rMSSD²f itself (needs p.ref)           → does the MODEL predict the PPG value
     The third is near-tautological whenever rMSSD²e explains most of rMSSD²f, which on paired devices it
     always does, so it can read ~0.96 while the first reads ~0.09 over identical residuals. Reporting one
     without naming it is how a reference term gets published as a model fit. */
  const refs = use.filter((p) => Number.isFinite(p.ref));
  const refbar = refs.length === use.length && refs.length ? refs.reduce((a, p) => a + p.ref, 0) / refs.length : null;
  let ssr = 0,
    sst = 0,
    sstU = 0,
    sstM = 0;
  for (const p of use) {
    const r = p.y - k * p.x;
    ssr += r * r;
    sst += (p.y - ybar) * (p.y - ybar);
    sstU += p.y * p.y;
    if (refbar != null) sstM += (p.ref - refbar) * (p.ref - refbar);
  }
  return {
    k,
    r2: sst > 0 ? 1 - ssr / sst : null,
    r2Unc: sstU > 0 ? 1 - ssr / sstU : null,
    r2Model: refbar != null && sstM > 0 ? 1 - ssr / sstM : null,
    n: use.length
  };
}

/* 🔴 THE SAME MODEL WITH THE REFERENCE COEFFICIENT FREED, because the paper writes rMSSD²f = rMSSD²e +
   k·σ² — coefficient 1 on the reference, CONSTRAINED — and a fit that frees it answers a different
   question with the same symbols:  rMSSD²f = a·rMSSD²e + k·σ².  Freeing `a` lets the reference term
   absorb scale, which lifts the model-level R² toward 1 and moves k, so the two fits can disagree about
   whether the model holds while quoting one equation. This is reported BESIDE the constrained fit, never
   instead of it: the constrained one is the paper's claim, the free one is the estimator that reproduces
   a published pair, and naming which is which is the whole point of having a producer.
   Least squares with no intercept over two predictors — a 2×2 normal system, solved in closed form. */
/* THE SQUARED PEARSON between the two devices' per-epoch rMSSD. This is NOT the jitter model's R²
   and is no substitute for it: it asks only how much of one device's epoch-to-epoch rMSSD variation
   the other tracks, with no model in it at all. It is published because a reader who meets a bare
   "R² = 0.964" cannot tell which quantity was reported, and this is the most charitable candidate —
   so the paper needs its measured value rather than an assumption about it. Null below the fit floor
   or when either side has no variance (a constant column has no correlation, §∅). */
export function r2Pair(xs, ys) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < MIN_KFIT_EPOCHS) return null;
  const ok = xs.map((x, i) => [x, ys[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (ok.length < MIN_KFIT_EPOCHS) return null;
  const mx = ok.reduce((a, [v]) => a + v, 0) / ok.length;
  const my = ok.reduce((a, [, v]) => a + v, 0) / ok.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [a, b] of ok) {
    sxy += (a - mx) * (b - my);
    sxx += (a - mx) ** 2;
    syy += (b - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : null;
}

export function kFitTwoTerm(pts) {
  const use = (pts || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.ref) && Number.isFinite(p.refE));
  if (use.length < MIN_KFIT_EPOCHS) return null;
  let s11 = 0,
    s12 = 0,
    s22 = 0,
    s1y = 0,
    s2y = 0,
    sy = 0;
  for (const p of use) {
    s11 += p.refE * p.refE;
    s12 += p.refE * p.x;
    s22 += p.x * p.x;
    s1y += p.refE * p.ref;
    s2y += p.x * p.ref;
    sy += p.ref;
  }
  const det = s11 * s22 - s12 * s12;
  if (!(Math.abs(det) > 0)) return null;
  const a = (s1y * s22 - s2y * s12) / det;
  const k = (s2y * s11 - s1y * s12) / det;
  const ybar = sy / use.length;
  let ssr = 0,
    sst = 0;
  for (const p of use) {
    const r = p.ref - (a * p.refE + k * p.x);
    ssr += r * r;
    sst += (p.ref - ybar) * (p.ref - ybar);
  }
  return { a, k, r2Model: sst > 0 ? 1 - ssr / sst : null, n: use.length };
}

/* THE BUDGET, INVERTED FROM THE SAME MODEL rather than quoted. For a fractional rMSSD bias p the model
   gives rMSSD_ppg = rMSSD_ecg·(1+p), so k·σ² = rMSSD_ecg²·((1+p)² − 1) and σ follows in closed form.
   A budget is therefore a statement about THREE things — k, the tolerated p, and the REFERENCE rMSSD it
   is a fraction of — and quoting a σ without naming the reference publishes a number that cannot be
   checked. The caller passes a MEASURED reference; this function invents none. */
export function sigmaForBias(k, refRmssd, frac) {
  if (!(k > 0) || !(refRmssd > 0) || !(frac > 0)) return null;
  return refRmssd * Math.sqrt(((1 + frac) * (1 + frac) - 1) / k);
}

/* THE CATASTROPHIC SPLIT. The paper's claim is not that bias correlates with jitter — it is that the
   epochs where rMSSD fails are the HIGH-JITTER epochs, so the split is reported as the two
   populations' jitter medians and their shares above the band, never as one correlation. Pooled over
   every scored epoch in the corpus, because the claim is about the corpus. */
export function catastrophicSplit(eps, biasPct, bandMs) {
  const use = (eps || []).filter((e) => e && Number.isFinite(e.rmBiasPct) && Number.isFinite(e.jitter));
  if (!use.length) return null;
  const inSet = use.filter((e) => Math.abs(e.rmBiasPct) > biasPct);
  const outSet = use.filter((e) => Math.abs(e.rmBiasPct) <= biasPct);
  const above = (a) => (a.length ? a.filter((e) => e.jitter > bandMs).length / a.length : null);
  return {
    n: use.length,
    nCat: inSet.length,
    catShare: inSet.length / use.length,
    jitIn: inSet.length ? median(inSet.map((e) => e.jitter)) : null,
    jitOut: outSet.length ? median(outSet.map((e) => e.jitter)) : null,
    aboveIn: above(inSet),
    aboveOut: above(outSet)
  };
}

/* ════════════════════════════════════════ SELFTEST ════════════════════════════════════════ */
/* The usage string is a CONSTANT so the selftest can check it against the flags the tool actually
   reads. `--device` shipped undocumented: it exists at the DEVICE line below and selects the Verity
   leg, but `--help` never mentioned it, so a session looking for it found `--dir` only and concluded
   the capability was absent. That is the discoverability failure one level below a missing index —
   the flag is IN the tool and unreachable by anyone who did not read the source. */
const USAGE =
  'usage: node tools/ppi-jitter-vs-ecg.mjs --dir <captures> [--device o2ring|verity] ' +
  '[--min-epochs N] [--max-nights N] [--sleep-only] [--no-merge] [--epoch-dump <path outside the repo>]  |  --selftest';

function selftest() {
  let fail = 0;
  const ok = (n, c, d) => {
    console.log((c ? '  ok   ' : '  FAIL ') + n + (d != null && !c ? '  — ' + d : ''));
    if (!c) fail++;
  };
  /* ⚠️ EVERY FLAG THE TOOL READS MUST APPEAR IN ITS USAGE STRING. Read from the source rather than a
     hand-list, so a flag added tomorrow is covered without anyone remembering to update this. Derived,
     not asserted: `--device` was undocumented for weeks and a session concluded the capability was
     missing because `--help` did not name it. */
  {
    const src = readFileSync(new URL(import.meta.url).pathname, 'utf8');
    const flags = [...src.matchAll(/(?:opt|has)\('(--[a-z-]+)'/g)].map((m) => m[1]);
    const undocumented = [...new Set(flags)].filter((f) => USAGE.indexOf(f) < 0);
    ok('every flag the tool reads is named in USAGE', undocumented.length === 0, undocumented.join(', ') || '');
    ok('…and the flag scan actually found flags (anti-vacuity)', flags.length >= 3, flags.length + ' flag(s) scanned');
  }
  // A synthetic beat train with an APERIODIC HR wander, a known PTT lag, and known jitter.
  const mk = (lagMs, jitterSd, seed) => {
    let s = seed || 1;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff - 0.5;
    };
    const ecg = [],
      finger = [];
    let t = 0;
    for (let i = 0; i < 400; i++) {
      // aperiodic wander: two incommensurate slow components, so the envelope cannot alias
      const rr = 900 + 60 * Math.sin(i / 17.3) + 40 * Math.sin(i / 7.1 + 1.3);
      t += rr;
      ecg.push(t);
      finger.push(t + lagMs + (jitterSd ? rnd() * jitterSd * 3.46 : 0)); // uniform → sd ≈ jitterSd
    }
    return { ecg, finger };
  };
  const A = mk(200, 0, 7);
  const t0 = 0,
    t1 = A.ecg[A.ecg.length - 1];
  const lag = envelopeLagMs(hrEnvelope(A.finger, t0, t1), hrEnvelope(A.ecg, t0, t1));
  ok('an envelope lag is recovered at all', lag != null, JSON.stringify(lag));
  /* THE POINT of using the HR envelope: it is aperiodic, so the recovered lag is NOT ambiguous modulo
     one RR (~900 ms here). A beat-train correlation would be. */
  ok('the recovered lag is within one HR bin of the planted 200 ms — not a whole-RR alias', lag && Math.abs(lag.lagMs - 200) <= HR_BIN_MS, 'lag=' + (lag && lag.lagMs));
  ok('…and the envelope correlation is strong on identical wander', lag && lag.r > 0.9, 'r=' + (lag && lag.r));

  /* THE LEG THAT WOULD HAVE CAUGHT THE FIRST RUN. The coarse envelope argmax is on a 1 s grid, so on a
     200 ms lag it reports 0 — and ±75 ms matching against a 200 ms error matches almost nothing. §3.3's
     local refinement is what recovers it. Asserting the COARSE stage is wrong is as important as
     asserting the refined stage is right: without this, a tool that skipped refinement still passed. */
  ok('the COARSE envelope lag is grid-quantised and cannot serve ±75 ms matching on its own', lag && Math.abs(lag.coarseMs - 200) >= 75, 'coarse=' + (lag && lag.coarseMs) + ' vs true 200');
  const seeded = refineLagByMatch(A.finger, A.ecg, lag.coarseMs);
  ok('…and the local refinement recovers the true lag to within the matching tolerance', Math.abs(seeded.lagMs - 200) <= MATCH_MS, 'refined=' + seeded.lagMs);
  ok(
    '…which is what makes the match rate usable (coarse would strand it)',
    seeded.matched >= A.finger.length - 5 && matchBeats(A.finger, A.ecg, lag.coarseMs).length < seeded.matched,
    'refined ' + seeded.matched + ' vs coarse ' + matchBeats(A.finger, A.ecg, lag.coarseMs).length
  );
  const pairs = matchBeats(A.finger, A.ecg, 200);
  ok('a zero-jitter train matches one-to-one, essentially completely', pairs.length >= A.finger.length - 2, pairs.length + '/' + A.finger.length);
  const j0 = ppiJitterMs(A.finger, A.ecg, pairs);
  ok('zero planted jitter ⇒ ~0 ms measured', j0 && j0.sd < 0.5, 'sd=' + (j0 && j0.sd));

  const B = mk(200, 6, 11);
  const pb = matchBeats(B.finger, B.ecg, 200);
  const j6 = ppiJitterMs(B.finger, B.ecg, pb);
  /* Interval jitter is the DIFFERENCE of two independent beat jitters, so sd scales by √2. A 6 ms beat
     jitter must read ~8.5 ms of interval jitter — asserting the raw 6 would silently accept a tool that
     measured beat error instead of interval error. */
  ok('6 ms beat jitter reads ~8.5 ms INTERVAL jitter (√2 — the difference of two jitters)', j6 && j6.sd > 6 && j6.sd < 11, 'sd=' + (j6 && j6.sd));

  // one-to-one: an ECG beat may not be consumed twice
  const dup = matchBeats([1000, 1010], [1005], 0);
  ok('one ECG beat cannot match two finger beats', dup.length === 1, JSON.stringify(dup));
  // a gap must not become a jitter sample
  const gj = ppiJitterMs(
    [0, 900, 5000, 5900],
    [0, 900, 5000, 5900],
    [
      { fi: 0, ei: 0 },
      { fi: 1, ei: 1 },
      { fi: 3, ei: 3 }
    ]
  );
  ok('a non-consecutive pair contributes no jitter sample (too few ⇒ null)', gj === null, JSON.stringify(gj));
  ok('sd is the SAMPLE sd (÷ n−1)', Math.abs(sd([800, 900]) - Math.sqrt(5000)) < 1e-9);
  ok('quantile interpolates — IQR is not a nearest-rank approximation', quantile([1, 2, 3, 4], 0.25) === 1.75, String(quantile([1, 2, 3, 4], 0.25)));
  /* THE HARMONIC LEG (row `2026-10-19-the-ppi-jitter-endpoint-cannot-see-a-2x-harmonic`). A detector
     firing twice per beat is the failure this endpoint gated nine punch-list items against, and it
     could not see one: the extra beats pair with nothing, no two matched pairs stay consecutive, and
     `ppiJitterMs` REFUSES — which the corpus loop reads as "drop this epoch". The epochs that remain
     are the ones where nothing went wrong. Both halves are asserted below, the blindness and the
     figure that replaces it, because asserting only the fix would leave the next reader to guess what
     it is for. The train is planted at 48 bpm: that is the rate the witness in `tests/dex-tests.js`
     reads as 106.57 bpm under a centred TERMA average, and the nine comparable nights never go there. */
  const slow = (bpm, seed) => {
    let z = seed;
    const r = () => {
      z = (z * 1103515245 + 12345) & 0x7fffffff;
      return z / 0x7fffffff - 0.5;
    };
    const base = 60000 / bpm;
    const ecg = [],
      finger = [];
    let t = 0;
    while (t < EPOCH_MS) {
      const rr = base + 0.07 * base * Math.sin(ecg.length / 17.3) + 0.045 * base * Math.sin(ecg.length / 7.1 + 1.3);
      t += rr;
      ecg.push(t);
      finger.push(t + 200 + r() * 6 * 3.46);
    }
    return { ecg, finger };
  };
  const twice = (f) => {
    const o = [];
    for (let i = 0; i < f.length; i++) {
      o.push(f[i]);
      if (i + 1 < f.length) o.push((f[i] + f[i + 1]) / 2);
    }
    return o;
  };
  {
    const S48 = slow(48, 7);
    const win = (a) => a.filter((x) => x >= 0 && x < EPOCH_MS);
    const clean = win(S48.finger),
      harm = win(twice(S48.finger));
    const jc = ppiJitterMs(clean, S48.ecg, matchBeats(clean, S48.ecg, 200));
    const jh = ppiJitterMs(harm, S48.ecg, matchBeats(harm, S48.ecg, 200));
    ok('a clean 48 bpm train yields a jitter at all', jc != null, JSON.stringify(jc));
    ok('a DOUBLED train refuses the jitter — so the corpus loop drops the epoch rather than scoring it', jh === null, JSON.stringify(jh));
    const rc = rateAgreement(clean, S48.ecg, 0, EPOCH_MS);
    const rh = rateAgreement(harm, S48.ecg, 0, EPOCH_MS);
    ok('the count ratio reads ~1.0 on the clean train', rc && Math.abs(rc.ratio - 1) < 0.05, rc && rc.ratio.toFixed(3));
    ok('…and ~2.0 on the doubled one, which is the figure the jitter and the match rate cannot carry', rh && Math.abs(rh.ratio - 2) < 0.05, rh && rh.ratio.toFixed(3));
    ok(
      'the covered rate is reported from the ECG side, so it survives a finger-side harmonic',
      rc && rh && Math.abs(rc.ecgBpm - rh.ecgBpm) < 1e-9,
      rc && rc.ecgBpm.toFixed(2) + ' vs ' + (rh && rh.ecgBpm.toFixed(2))
    );
    ok('…and the planted 48 bpm is what it reports', rc && Math.abs(rc.ecgBpm - 48) < 2, rc && rc.ecgBpm.toFixed(2));
    /* ∅ — an empty side has no ratio. A 0 here would read as "the devices disagree completely", which
       is a measurement; absence is not. */
    ok('a window with no ECG beat has NO ratio, not a ratio of 0', rateAgreement(clean, [], 0, EPOCH_MS) === null);
    ok('a zero-length window has no ratio either', rateAgreement(clean, S48.ecg, 0, 0) === null);
  }

  /* ════════════════ THE PER-EPOCH ARM ════════════════
     Only the PURE halves are reachable here: `fingerEpochHrv`/`ecgEpochHrv` call the vm realm, which is
     built after this function exits. What is pinned is therefore every rule that decides WHICH samples
     reach a node's estimator and WHAT is done with the numbers it returns — which is where this arm
     can be wrong without any node being wrong. */
  {
    /* ADJACENCY. `keptIdx` 0,1,2,4,5 means the interval originally at 3 was corrected away, so the pair
       (2 → 4) spans an absence and is not a successive difference. */
    const adj = adjFromKeptIdx([0, 1, 2, 4, 5]);
    ok('adjacency: the pair after a removed interval is NOT adjacent', JSON.stringify(adj) === JSON.stringify([true, true, true, false, true]), JSON.stringify(adj));
    /* An ABSENT index map returns null, which `timeDomain` reads as "no mask → all adjacent pairs".
       That is the NODE'S OWN behaviour when `buildEpochs` is handed no `adj`, inherited deliberately: a
       stricter rule here would make this arm disagree with the node it is supposed to reproduce. The
       leg exists to make the inheritance a decision rather than an accident. */
    ok('an absent kept-index map yields no mask — the node’s own default, not a stricter rule', adjFromKeptIdx(undefined) === null && adjFromKeptIdx([]) === null);
    /* THE ECG PAIR MASK, including the carry across a window boundary: interval 2 is removed, so 3 —
       which may well be the first interval of the NEXT window — is the first survivor and is marked. */
    const sk = ecgSkipSeries([0, 0, 1, 0, 0], 5);
    ok('the ECG pair mask marks the first survivor after a gap, and NULLS the removed interval', JSON.stringify(sk) === JSON.stringify([0, 0, null, 1, 0]), JSON.stringify(sk));
    ok('…and a removed interval never becomes a measured pair with skip 0 (∅)', sk[2] === null);
    /* HALF-OPEN AT BOTH ENDS, so every beat lands in exactly one window. */
    const tt = [1000, 1500, 2000, 2500];
    ok('window selection is half-open: t0 is in, t1 is out', JSON.stringify(windowIdx(tt, 1500, 2500)) === JSON.stringify([1, 2]), JSON.stringify(windowIdx(tt, 1500, 2500)));
    ok('a window containing nothing selects nothing, rather than the nearest beat', windowIdx(tt, 3000, 4000).length === 0);
    /* THE ONE-SESSION RULE — the §∅ half of this arm. */
    const S = [
      { t0: 0, t1: 1000, tag: 'a' },
      { t0: 1000, t1: 3000, tag: 'b' }
    ];
    ok('an epoch inside one session finds that session', (coveringSession(S, 1200, 1800) || {}).tag === 'b');
    ok('an epoch STRADDLING two sessions refuses — the gap between them is not an RR interval', coveringSession(S, 800, 1800) === null);
    ok('an epoch outside every session refuses', coveringSession(S, 5000, 6000) === null);
    ok(
      'two covering sessions are ambiguous, not better',
      coveringSession(
        [
          { t0: 0, t1: 9000 },
          { t0: 0, t1: 9000 }
        ],
        1000,
        2000
      ) === null
    );
    /* THE MODEL'S SLOPE on data planted to have one: y = 3x exactly, so k must read 3 and both R²
       must read 1. A fit that cannot recover a planted slope cannot measure one. */
    const kf = kFitThroughOrigin([1, 2, 3, 4, 5, 9].map((x) => ({ x, y: 3 * x })));
    ok('the through-origin fit recovers a planted k', kf && Math.abs(kf.k - 3) < 1e-12, kf && kf.k);
    ok('…with R² 1 on exact data, centred AND uncentred', kf && Math.abs(kf.r2 - 1) < 1e-12 && Math.abs(kf.r2Unc - 1) < 1e-12, kf && kf.r2 + ' / ' + kf.r2Unc);
    ok('…and it REFUSES below the stated epoch floor rather than naming a slope from four points', kFitThroughOrigin([1, 2, 3, 4].map((x) => ({ x, y: 3 * x }))) === null);
    ok('a night whose jitter never varies has no slope to fit (x all zero)', kFitThroughOrigin([0, 0, 0, 0, 0, 0].map((x) => ({ x, y: 1 }))) === null);
    /* 🔴 THE DENOMINATOR LEG, which is the one that decides whether a published R² can be read at all.
       Identical residuals, three totals: a set whose INCREMENT is almost pure noise about the fit but
       whose rMSSD²f spans a wide range must read a LOW r2 and a HIGH r2Model. That is the shape a
       paired-device corpus always has, so the two numbers are not variants of one claim. */
    {
      const noisy = [
        { x: 1, y: 2, ref: 100 },
        { x: 2, y: 8, ref: 400 },
        { x: 3, y: 2, ref: 900 },
        { x: 4, y: 14, ref: 1600 },
        { x: 5, y: 4, ref: 2500 },
        { x: 6, y: 16, ref: 3600 }
      ];
      const kn = kFitThroughOrigin(noisy);
      ok('the increment R² and the model-level R² are different numbers over ONE residual sum', kn && kn.r2 < 0.6 && kn.r2Model > 0.95, kn && `${kn.r2.toFixed(3)} vs ${kn.r2Model.toFixed(3)}`);
      ok('…and the model-level one is the HIGHER of the two whenever the reference term dominates', kn && kn.r2Model > kn.r2);
      ok('a point set with no reference magnitude reports no model-level R² rather than a borrowed one', kf && kf.r2Model === null, kf && String(kf.r2Model));
      ok(
        'one missing ref disqualifies the whole night, never a silent subset',
        kFitThroughOrigin([
          { x: 1, y: 1, ref: 4 },
          { x: 2, y: 2, ref: 9 },
          { x: 3, y: 3, ref: 16 },
          { x: 4, y: 4, ref: 25 },
          { x: 5, y: 5 },
          { x: 6, y: 6, ref: 49 }
        ]).r2Model === null
      );
    }
    /* 🔴 THE TWO-TERM FIT, on data planted so the CONSTRAINED and FREE answers must differ: every epoch
       carries rMSSD²f = 1.5·rMSSD²e + 3·σ², so freeing the coefficient recovers a=1.5 and k=3 exactly,
       while forcing a=1 must report some other k. A fit that cannot tell those two apart cannot say which
       estimator a published pair came from. */
    {
      const plant = [12, 25, 31, 44, 50, 66].map((rmE2, i) => {
        const x = (i + 1) * 7;
        return { x, refE: rmE2, ref: 1.5 * rmE2 + 3 * x };
      });
      const ff = kFitTwoTerm(plant);
      ok('the free fit recovers a planted reference coefficient and slope', ff && Math.abs(ff.a - 1.5) < 1e-9 && Math.abs(ff.k - 3) < 1e-9, ff && `a ${ff.a} k ${ff.k}`);
      ok('…with R² 1 on exact data', ff && Math.abs(ff.r2Model - 1) < 1e-9, ff && ff.r2Model);
      const cons = kFitThroughOrigin(plant.map((p) => ({ x: p.x, y: p.ref - p.refE, ref: p.ref })));
      ok('…and the CONSTRAINED fit of the same epochs names a different k, which is the whole finding', cons && Math.abs(cons.k - 3) > 0.5, cons && cons.k.toFixed(3));
      ok('the free fit refuses below the epoch floor', kFitTwoTerm(plant.slice(0, 4)) === null);
      ok('…and refuses a night with no reference magnitudes rather than fitting one term', kFitTwoTerm(plant.map((p) => ({ x: p.x, ref: p.ref }))) === null);
    }
    /* 🔴 THE BARE-AGREEMENT r², which exists to be told APART from the model's R². Planted so the two
       devices track each other perfectly while the model's increment does not: r2Pair must read 1 and
       say nothing about any model. It refuses a constant column, because a column with no variance has
       no correlation to report (§∅ — not a 0, which would read as perfect disagreement). */
    {
      const xs = [20, 24, 31, 38, 45, 52];
      const scaled = xs.map((v) => 0.5 * v + 3);
      ok('the bare r² reads 1 on two columns that move together exactly', Math.abs(r2Pair(xs, scaled) - 1) < 1e-12, r2Pair(xs, scaled));
      /* A V symmetric about the mid-point has covariance EXACTLY zero against a ramp, so this leg
         pins the uncorrelated case on algebra rather than on a number that happens to come out small. */
      ok('…and 0 on a pair with no linear agreement, rather than borrowing the model fit', r2Pair([1, 2, 3, 4, 5, 6], [3, 1, 0, 0, 1, 3]) < 1e-9, r2Pair([1, 2, 3, 4, 5, 6], [3, 1, 0, 0, 1, 3]));
      ok('a constant column has no correlation and reports null, never 0', r2Pair(xs, [5, 5, 5, 5, 5, 5]) === null);
      ok('…and it refuses below the same epoch floor the fits use', r2Pair(xs.slice(0, 4), xs.slice(0, 4)) === null);
    }
    /* THE BUDGET, round-tripped through the model it was inverted from: feed the σ back in and the
       bias must come out at the fraction asked for. A closed form is exactly the kind of algebra that
       is wrong by a factor of two and still looks plausible. */
    {
      const k0 = 2.4,
        r0 = 38;
      const s2 = sigmaForBias(k0, r0, 0.02);
      const back = (Math.sqrt(r0 * r0 + k0 * s2 * s2) - r0) / r0;
      ok('the σ budget round-trips through the model: 2 % in, 2 % out', Math.abs(back - 0.02) < 1e-12, back);
      ok('a tighter bias asks a smaller σ', sigmaForBias(k0, r0, 0.01) < s2);
      ok('…and an unmeasured k or reference yields NO budget, never a number (∅)', sigmaForBias(null, r0, 0.02) === null && sigmaForBias(k0, 0, 0.02) === null);
    }
    /* THE CATASTROPHIC SPLIT on a planted population: two epochs over the 25 % bias bar, both above
       the 15 ms jitter band, and two under both. */
    {
      const sp = catastrophicSplit(
        [
          { rmBiasPct: 30, jitter: 40 },
          { rmBiasPct: -28, jitter: 20 },
          { rmBiasPct: 5, jitter: 4 },
          { rmBiasPct: -5, jitter: 6 }
        ],
        CAT_BIAS_PCT,
        JIT_BAND_MS
      );
      ok('the split counts a bias by MAGNITUDE, so an understatement is catastrophic too', sp && sp.nCat === 2 && Math.abs(sp.catShare - 0.5) < 1e-12, sp && sp.nCat);
      ok('…and reports both populations’ jitter, which is the claim', sp && sp.jitIn === 30 && sp.jitOut === 5, sp && sp.jitIn + ' / ' + sp.jitOut);
      ok('…and the share above the band on each side', sp && sp.aboveIn === 1 && sp.aboveOut === 0, sp && sp.aboveIn + ' / ' + sp.aboveOut);
      /* ∅ — an empty population has no share. A 0 % here would read as "no epoch was catastrophic",
         which is a measurement over nothing. */
      ok('an empty population has NO split, not a 0 % share', catastrophicSplit([], CAT_BIAS_PCT, JIT_BAND_MS) === null);
    }
    /* TABLE 1'S MAE AND SIGNED BIAS, and the SIGN CONVENTION with them: finger minus ECG. A finger
       interval train running 4 ms long per beat must read +4, not −4. */
    {
      const f = [],
        e = [];
      for (let i = 0; i < 20; i++) {
        f.push(i * 1004);
        e.push(i * 1000);
      }
      const pr = f.map((_, i) => ({ fi: i, ei: i }));
      const jj = ppiJitterMs(f, e, pr);
      ok('the jitter object now carries MAE and a SIGNED bias', jj != null && jj.mae != null && jj.bias != null, JSON.stringify(jj));
      ok('…the sign is finger minus ECG: a long finger interval reads POSITIVE', jj && Math.abs(jj.bias - 4) < 1e-9, jj && jj.bias);
      ok('…the MAE of a constant offset is that offset, while its sd is 0 — two different facts', jj && Math.abs(jj.mae - 4) < 1e-9 && jj.sd < 1e-9, jj && jj.mae + ' / ' + jj.sd);
    }
  }

  console.log(fail ? '\nselftest: ' + fail + ' FAILED' : '\nselftest: all green');
  return fail;
}
if (SELFTEST) process.exit(selftest());

/* ════════════════════════════════════════ CORPUS RUN ════════════════════════════════════════ */
if (!DIR) {
  console.error(USAGE);
  process.exit(2);
}
const B = await import(join(ROOT, 'tools/build-core.js'));
const classicify = B.classicify || B.default?.classicify;
function realm(files) {
  const sb = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  sb.window = sb;
  sb.globalThis = sb;
  sb.self = sb;
  sb.document = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ style: {}, appendChild() {} }),
    head: { appendChild() {} },
    addEventListener() {},
    documentElement: { outerHTML: '' }
  };
  sb.navigator = { userAgent: 'v' };
  sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const ctx = vm.createContext(sb);
  for (const f of files) vm.runInContext(classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
  return sb;
}
const P = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ppgdex-registry.js', 'ppgdex-morph.js', 'ppgdex-dsp.js']).PPGDSP;
const E = realm(['clock.js', 'kernel-constants.js', 'metric-registry.js', 'ecgdex-registry.js', 'ecgdex-morph.js', 'ecgdex-dsp.js']).ECGDSP;

/* ═══════════════════════ THE PER-EPOCH ARM — THE HALF THAT CALLS THE NODES ══════════════════════
 * A SESSION, not a night: the per-epoch series are per RECORDING and must never be concatenated
 * (`coveringSession`). Only the fields the two epoch loops read are retained, and the analyse result
 * itself is NOT held — an ECG `res` carries the band-passed waveform, and keeping one per session for
 * every night is tens of megabytes for nothing (lazy-load, ≤ 8 GB).
 * Stamps are converted to ABSOLUTE floating wall-clock ms here, once, because the grid is absolute and
 * a per-epoch reconversion inside the loop is where a seconds/ms slip hides (CLAUDE.md §🔒). */
function fingerSession(rec, res) {
  const tt = res.tt || [];
  const ttMs = new Float64Array(tt.length);
  for (let i = 0; i < tt.length; i++) ttMs[i] = rec.t0Ms + tt[i] * 1000;
  return {
    t0: rec.t0Ms,
    t1: rec.t0Ms + (rec.durSec || 0) * 1000,
    ttMs,
    nn: res.nn || [],
    clean: res.ppiClean || null,
    adj: adjFromKeptIdx(res.ppiKeptIdx)
  };
}
function ecgSession(t0Ms, durMs, res) {
  const tt = res.tt || [];
  const ttMs = new Float64Array(tt.length);
  for (let i = 0; i < tt.length; i++) ttMs[i] = t0Ms + tt[i] * 1000;
  /* THE NODE ALREADY PUBLISHED ITS REFUSALS, so they are read rather than re-derived: a clock seam and
     a blanking run are reconstructible only from `rec.clockResyncs` and a sidecar this tool never
     parses, and inventing either would place a refusal on the wrong seconds. `too-few-beats` is
     dropped from the list deliberately — it is a property of the node's grid phase, not of the signal,
     and this arm scores a DIFFERENT window, so it must re-decide that one itself. */
  return {
    t0: t0Ms,
    t1: t0Ms + durMs,
    ttMs,
    nn: res.nn || [],
    skip: ecgSkipSeries(res.nnSpansGap, (res.nn || []).length),
    refused: (res.epochsRefused || [])
      .filter((r) => r && Number.isFinite(r.tMin) && r.reason !== 'too-few-beats')
      .map((r) => ({ t0: t0Ms + r.tMin * 60000, t1: t0Ms + r.tMin * 60000 + EPOCH_MS, reason: r.reason }))
  };
}

/* PpgDex's own epoch computation on a borrowed window: `buildEpochs`' floor of 5 intervals, its mask
   and adjacency slices, and `timeDomain` itself. `idx` is a contiguous run because `tt` is monotone,
   which is what makes the record-level slices line up 1:1 — the node's own note says so. */
function fingerEpochHrv(s, t0, t1) {
  const idx = windowIdx(s.ttMs, t0, t1);
  if (idx.length < 5) return { ok: false, reason: 'thin-epoch' };
  const seg = idx.map((i) => s.nn[i]);
  const segMask = s.clean ? idx.map((i) => s.clean[i]) : null;
  const segAdj = s.adj ? idx.map((i) => s.adj[i]) : null;
  const td = P.timeDomain(seg, segMask, null, segAdj);
  if (!td || td.rmssd == null) return { ok: false, reason: 'no-clean-pair' };
  return { ok: true, rmssd: td.rmssd, sdnn: td.sdnn, n: seg.length };
}

/* ECGDex's own epoch computation on the same window, in the node's order: seam and blanking first
   (named, never borrowed), then the 20-interval floor, then `rmssd(seg, segSkip)` and `std(seg)`.
   `_rmOrNull(…, 1)` is the node's rounding and is reproduced, because a figure that differs from the
   published one in the last decimal invites exactly the re-derivation this producer exists to end. */
function ecgEpochHrv(s, t0, t1) {
  const bad = s.refused.find((r) => r.t0 < t1 && t0 < r.t1);
  if (bad) return { ok: false, reason: bad.reason };
  const idx = windowIdx(s.ttMs, t0, t1);
  const seg = [],
    segSkip = [];
  for (const i of idx) {
    if (s.skip[i] == null) continue;
    seg.push(s.nn[i]);
    segSkip.push(s.skip[i]);
  }
  if (seg.length < 20) return { ok: false, reason: 'too-few-beats' };
  const rm = E.rmssd(seg, segSkip);
  if (rm == null) return { ok: false, reason: 'no-successive-pair' };
  return { ok: true, rmssd: +rm.toFixed(1), sdnn: +E.std(seg).toFixed(1), n: seg.length };
}

const walk = (d, o = []) => {
  try {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, o);
      else o.push({ p, size: st.size });
    }
  } catch (_e) {}
  return o;
};
/* THE LISTER IS THE POPULATION RULE, AND IT CARRIES A NAME ON PURPOSE. `snapshotEntries` publishes
   `rule: null` for an inline arrow (`corpus-scope.mjs:329`), which would state that nobody chose the
   rule this run applied. The unit is a FILE, not a night: `--dir` is a capture tree and not the
   `YYYY-MM-DD` root `snapshotNights` reads, so a night snapshot here would manufacture a population.
   🔴 IT MUST NOT SWALLOW AN UNREADABLE ROOT. `walk` catches every error, so a root nobody can open
   returns `[]`, and the snapshot would then publish `n: 0` — a MEASUREMENT of zero over a directory
   nothing read (§∅). The root's own readdir runs outside that catch, so the snapshot reports
   `ok: false` with the reason instead. */
function listDevicePpg(root) {
  readdirSync(root);
  return walk(root)
    .filter((f) => PPG_RE.test(f.p))
    .map((f) => relative(root, f.p));
}

const PPG_UNIT = `${DEVICE} PPG files`;
const snap = snapshotEntries(DIR, { list: listDevicePpg, unit: PPG_UNIT });
/* 🔴 STAMP THE CODE THAT RAN, NOT THE CODE AT THE END OF THE RUN. Reading a night of PPG takes long
   enough for a commit to land in this worktree, and Node loaded this module at the start. */
const commitOf = gitCommitOf(ROOT);
const all = walk(DIR);
const _ppgMatched = all.filter((f) => PPG_RE.test(f.p));
const fingerFiles = _ppgMatched.sort((a, b) => b.size - a.size).slice(0, MAX_NIGHTS);
/* PRINT THE DENOMINATOR. A pattern that matches nothing and a corpus that holds nothing produce the
   same silence, and only one of them is a fact about the data. Stating files-walked beside
   files-matched makes a naming mismatch visible in the output instead of leaving it to be inferred
   from an empty table. */
console.log(`corpus: ${all.length} file(s) walked · ${_ppgMatched.length} matched ${DEVICE} PPG · ${all.filter((f) => /H10.*_ECG\.txt$/i.test(f.p)).length} paired H10 ECG`);
if (!_ppgMatched.length) {
  console.error(`\n⊘ NO ${DEVICE.toUpperCase()} PPG FILE MATCHED under ${DIR}.`);
  console.error('  This is a statement about the PATTERN, not about the corpus. Check the vendor naming:');
  console.error('  the Verity is `Polar_VeritySense_*` from the capture host and `Polar_Sense_*` from');
  console.error('  Polar Sensor Logger — the same armband, two spellings.');
  process.exit(2);
}
const ecgs = all.filter((f) => /H10.*_ECG\.txt$/i.test(f.p));

console.log('O2RING-FINGER-HRV-VALIDATION §3 — PPI-jitter sd vs paired H10 ECG (per-epoch alignment)');
console.log('device: ' + (DEVICE === 'verity' ? 'Polar Verity Sense (WRIST — the deep-dive reference leg)' : "Wellue O2Ring (FINGER — this brief's subject)") + '\n');
console.log('night                                        eps  jitter_sd  match%  ratio  refBpm  drop   lag_ms   RMSSD_f  RMSSD_e  bias%   sdnnRob%');

/* Build the UNITS to score. Merged: one unit per NIGHT, its beat train the union of every session's
   beats on the shared absolute (floating) clock. Unmerged: one unit per file, the legacy behaviour.
   Each session is parsed and analysed INDEPENDENTLY — detection stays per-recording, which is correct,
   since a fragment boundary is real time in which no signal arrived. Only the resulting beat TIMES are
   pooled, and an interval spanning a boundary is dropped downstream by ppiJitterMs' own 300-2000 ms
   window rather than being bridged (the same discipline ppgdex-dsp applies to a gap). */
function buildUnits(files) {
  const parsed = [];
  for (const f of files) {
    try {
      const rec = P.parsePPG(readFileSync(f.p, 'utf8'));
      if (rec.t0Ms == null) continue;
      const res = P.analyze(rec);
      if (!res || !res.beatTimes) continue;
      parsed.push({ f, rec, res, beats: (res.footSec || []).map((x) => rec.t0Ms + x * 1000), sess: fingerSession(rec, res) });
    } catch (_e) {}
  }
  if (!MERGE) {
    return parsed.map((u) => ({
      name: u.f.p.split('/').pop(),
      t0: u.rec.t0Ms,
      t1: u.rec.t0Ms + (u.rec.durSec || 0) * 1000,
      beats: u.beats,
      res: u.res,
      sessions: [u.sess],
      nSess: 1
    }));
  }
  const byNight = new Map();
  for (const u of parsed) {
    const k = nightKeyOf(u.rec.t0Ms);
    if (!byNight.has(k)) byNight.set(k, []);
    byNight.get(k).push(u);
  }
  const out = [];
  for (const [k, us] of byNight) {
    const beats = [];
    for (const u of us) beats.push(...u.beats);
    beats.sort((a, b) => a - b);
    // representative analyse result = the LARGEST session, used only for the per-node HRV columns
    // (RMSSD / sdnnRobust / cvhrIndex live inside analyze() and cannot be recomputed from beat times
    // without exporting cvhrFromNN/detectCVHR — see the follow-up note in the brief).
    const rep = us.slice().sort((a, b) => b.f.size - a.f.size)[0];
    out.push({
      name: k + ' (' + us.length + ' sess)',
      t0: Math.min(...us.map((u) => u.rec.t0Ms)),
      t1: Math.max(...us.map((u) => u.rec.t0Ms + (u.rec.durSec || 0) * 1000)),
      beats,
      res: rep.res,
      /* EVERY session's per-epoch series, not the representative's. The beat TRAIN above is merged
         because beat times are comparable across sessions; an interval series is not, so the per-epoch
         arm keeps them separate and refuses any window that is not inside exactly one of them. */
      sessions: us.map((u) => u.sess),
      nSess: us.length,
      repName: rep.f.p.split('/').pop()
    });
  }
  return out.sort((a, b) => b.beats.length - a.beats.length);
}

/* MERGED ECG NIGHTS, built ONCE. Two things were wrong with searching the raw file list inside the
   finger loop. Correctness: a merged finger train was paired against a SINGLE best-overlapping ECG
   file, so finger beats outside that one file's window had nothing to match and the rate collapsed on
   fragmented nights (80.6 % on 2026-07-24's 45 sessions, 65.2 % on 07-31's 8) — the jitter median then
   read worse under merge purely as an artifact of the asymmetry. Cost: the search re-parsed EVERY ECG
   file for EVERY candidate night, so a 400-file run did ~400x419 parses and took hours.
   Both go away by grouping the reference the same way the finger side is grouped. int16 is dropped
   after refinement — only beat TIMES are retained, so holding every night at once stays cheap. */
function buildEcgNights(files) {
  const parsed = [];
  for (const e of files) {
    try {
      const er = E.parseECG(readFileSync(e.p, 'utf8'));
      if (er.t0Ms == null) continue;
      const eres = E.analyze(er);
      if (!eres || !eres.peaks) continue;
      const bp = E.bandpass(er.int16, er.fs);
      parsed.push({
        e,
        t0: er.t0Ms,
        t1: er.t0Ms + (er.durSec || 0) * 1000,
        durMs: (er.durSec || 0) * 1000,
        beats: refinePeaks(bp, eres.peaks).map((q) => er.t0Ms + (q / er.fs) * 1000),
        beatsRaw: eres.peaks.map((q) => er.t0Ms + (q / er.fs) * 1000),
        res: eres,
        sess: ecgSession(er.t0Ms, (er.durSec || 0) * 1000, eres)
      });
    } catch (_x) {}
  }
  if (!MERGE) return parsed.map((u) => ({ ...u, nSess: 1, sessions: [u.sess] }));
  const by = new Map();
  for (const u of parsed) {
    const k = nightKeyOf(u.t0);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(u);
  }
  const out = [];
  for (const [k, us] of by) {
    const beats = [];
    const beatsRaw = [];
    for (const u of us) {
      beats.push(...u.beats);
      beatsRaw.push(...u.beatsRaw);
    }
    beats.sort((a, b) => a - b);
    beatsRaw.sort((a, b) => a - b);
    const rep = us.slice().sort((a, b) => b.e.size - a.e.size)[0];
    out.push({
      key: k,
      t0: Math.min(...us.map((u) => u.t0)),
      t1: Math.max(...us.map((u) => u.t1)),
      // COVERED duration, not span: a merged night with holes must not claim the holes as reference.
      durMs: us.reduce((a, u) => a + u.durMs, 0),
      beats,
      beatsRaw,
      res: rep.res,
      sessions: us.map((u) => u.sess),
      nSess: us.length
    });
  }
  return out;
}
const ecgNights = buildEcgNights(ecgs);

const nights = [];
/* EVERY SCORED EPOCH IN THE CORPUS, pooled. The catastrophic-epoch claim and the reference rMSSD the
   budget is a fraction of are both corpus-level, so they are computed over this pool rather than over
   per-night medians — a median of medians answers a different question and the paper quotes both. */
const allEp = [];
for (const unit of buildUnits(fingerFiles)) {
  const fres = unit.res;
  const frec = { t0Ms: unit.t0, durSec: (unit.t1 - unit.t0) / 1000 };
  const f = { p: unit.name };
  /* Sleep filter on the MERGED window, not on a filename stamp: a merged night starts at its earliest
     session, which is not necessarily the largest file. Read with getUTC* because tMs is floating
     wall-clock (CLAUDE.md §5) — using local getters would make the filter depend on the reader's zone. */
  if (SLEEP_ONLY) {
    const hh = new Date(unit.t0).getUTCHours();
    const okHour = hh >= 20 || hh < 4;
    if (!(okHour && (frec.durSec || 0) >= 4 * 3600)) continue; // §4: sleep nights only
  }
  const fBeats = unit.beats;
  if (fBeats.length < 100) continue;
  const fw = [unit.t0, unit.t1];
  /* Pair against the merged ECG NIGHT with the greatest overlap. Still an overlap search rather than a
     key lookup, so a finger night straddling the 12 h boundary still finds its reference. §3.2's
     sub-sample refinement already happened in buildEcgNights — unrefined, the H10's integer grid
     injects 3.14 ms of interval quantization into the finger's measured jitter. */
  let best = null;
  for (const u of ecgNights) {
    const ov = Math.min(fw[1], u.t1) - Math.max(fw[0], u.t0);
    if (ov > EPOCH_MS && (!best || ov > best.ov)) best = { ov, u };
  }
  if (!best) continue;
  const eBeats = best.u.beats;
  const eBeatsRaw = best.u.beatsRaw;

  const jit = [],
    rawJit = [],
    lags = [],
    rates = [],
    ratios = [],
    refBpms = [],
    maes = [],
    ppiBias = [],
    sens = [],
    eph = [];
  /* WHY THE PER-EPOCH ARM KEEPS ITS OWN DROP TALLY. An epoch can produce a jitter and still produce no
     per-epoch HRV — it straddles a session boundary, or ECGDex refused its window for a clock seam. The
     two populations therefore differ, and a figure quoted over one while the drop count is read off the
     other is the §4b family: a verdict about something never examined. Keyed by REASON, because a
     count names nothing to chase. */
  const epRef = { boundary: 0 };
  const epDrop = (r) => {
    epRef[r] = (epRef[r] || 0) + 1;
  };
  /* An epoch that never reaches the figures still happened. Counting the drops by reason is what makes
     a harmonic visible at all: its epochs do not score badly, they leave the population (§∅ — an output
     over absent input reports the absence). */
  let dropThin = 0,
    dropNoLag = 0,
    dropNoJitter = 0;
  const lo = Math.max(fw[0], best.u.t0),
    hi = Math.min(fw[1], best.u.t1);
  for (let t = lo; t + EPOCH_MS <= hi; t += EPOCH_MS) {
    const fe = fBeats.filter((x) => x >= t && x < t + EPOCH_MS);
    const ee = eBeats.filter((x) => x >= t - MAX_LAG_MS && x < t + EPOCH_MS + MAX_LAG_MS);
    if (fe.length < 60 || ee.length < 60) {
      dropThin++;
      continue;
    }
    /* TAKEN BEFORE THE JITTER GATE, deliberately. The gate below is where a doubled rate escapes:
       `ppiJitterMs` refuses when no two matched pairs are consecutive, this loop then drops the epoch,
       and both figures end up describing the epochs where nothing went wrong. Measured 2026-10-20 on a
       planted 48 bpm train: doubling every beat refuses the jitter outright, so the epoch disappears
       rather than reading 50 % — which is why the match rate beside the jitter never caught it. */
    const ra = rateAgreement(fe, ee, t, t + EPOCH_MS);
    if (ra) {
      ratios.push(ra.ratio);
      refBpms.push(ra.ecgBpm);
    }
    const coarse = envelopeLagMs(hrEnvelope(fe, t, t + EPOCH_MS), hrEnvelope(ee, t, t + EPOCH_MS));
    if (!coarse) {
      dropNoLag++;
      continue;
    }
    const lag = refineLagByMatch(fe, ee, coarse.lagMs); // §3.3 stage (b)
    const pairs = matchBeats(fe, ee, lag.lagMs);
    const rate = pairs.length / fe.length;
    const j = ppiJitterMs(fe, ee, pairs);
    if (!j) {
      dropNoJitter++;
      continue;
    }
    jit.push(j.sd);
    /* The SAME epoch scored against the UNREFINED reference, so §3.2's refinement is measured rather
       than assumed. Measured on this corpus it removes ~0.08 ms at the finger's ~26 ms jitter (they add
       in quadrature, so 3.14 ms against 26 ms is invisible) — but it would be ~13 % at the Verity's
       ~6 ms. Reported, because "negligible" is a claim about a specific device's noise floor, not a
       property of the method. */
    const eeRaw = eBeatsRaw.filter((x) => x >= t - MAX_LAG_MS && x < t + EPOCH_MS + MAX_LAG_MS);
    const jr = ppiJitterMs(fe, eeRaw, matchBeats(fe, eeRaw, lag.lagMs));
    if (jr) rawJit.push(jr.sd);
    lags.push(lag.lagMs);
    rates.push(rate);
    /* ── TABLE 1'S OTHER TWO COLUMNS, from the SAME matched differences as the jitter sd. ──
       MAE and the signed PPI bias are new fields on `ppiJitterMs`, so they describe exactly the pairs
       the jitter describes and cannot drift from it. */
    maes.push(j.mae);
    ppiBias.push(j.bias);
    /* SENSITIVITY, which the match rate is NOT. `rate` is matched finger beats over finger beats —
       positive predictive value. Sensitivity is matched REFERENCE beats over reference beats, and the
       two differ exactly where a detector misses or doubles. Denominator from the epoch proper, never
       the lag-widened read window, so the figure is per epoch and not per search span; the lag then
       biases it down by at most one beat at each edge (~0.5 % of a 300 s epoch) — named, not corrected,
       because correcting it would need a beat the window does not contain. */
    const eIn = ee.filter((x) => x >= t && x < t + EPOCH_MS).length;
    if (eIn) sens.push(pairs.filter((p) => ee[p.ei] >= t && ee[p.ei] < t + EPOCH_MS).length / eIn);
    /* ── THE PER-EPOCH rMSSD ARM. Both sides on THIS window, each by its own node's estimator. ── */
    const fS = coveringSession(unit.sessions, t, t + EPOCH_MS),
      eS = coveringSession(best.u.sessions, t, t + EPOCH_MS);
    if (!fS || !eS) epRef.boundary++;
    else {
      const fh = fingerEpochHrv(fS, t, t + EPOCH_MS),
        eh = ecgEpochHrv(eS, t, t + EPOCH_MS);
      if (!fh.ok) epDrop('finger-' + fh.reason);
      else if (!eh.ok) epDrop('ecg-' + eh.reason);
      /* A ZERO REFERENCE HAS NO RATIO (§∅). A 0 ms epoch rMSSD is legal — a perfectly regular stretch —
         and a percentage against it is not a large bias, it is no bias to report. */ else if (!(eh.rmssd > 0)) epDrop('ecg-zero-reference');
      else {
        const row = {
          night: unit.name,
          t,
          jitter: j.sd,
          rmF: fh.rmssd,
          rmE: eh.rmssd,
          sdF: fh.sdnn,
          sdE: eh.sdnn,
          rmBiasPct: ((fh.rmssd - eh.rmssd) / eh.rmssd) * 100,
          sdBiasPct: eh.sdnn > 0 ? ((fh.sdnn - eh.sdnn) / eh.sdnn) * 100 : null,
          nF: fh.n,
          nE: eh.n
        };
        eph.push(row);
        allEp.push(row);
      }
    }
  }
  if (jit.length < MIN_EPOCHS) continue;
  /* CVHR AGREEMENT (§4's third criterion, never previously measured). Both nodes run the SAME detector
     — PpgDex's `cvhrFromNN` is a faithful port of `ECGDSP.detectCVHR`, deliberately, so the Integrator
     corroborates like against like. That makes this a comparison of the DEVICES, not of two methods.
     The Integrator's band is |Δ| ≤ 5.0 events/h (`CVHR_AGREE_PER_H`).

     Both indices are events per HOUR over each node's own record, and the two records do not cover the
     same window — so the OVERLAP FRACTION is reported beside the gap. A pair that overlaps 40 % is not
     evidence of disagreement; it is two different nights being compared, and folding it in silently is
     how a rate comparison fabricates a discrepancy. */
  const cvF = fres.cvhrIndex,
    cvE = best.u.res.cvhr ? best.u.res.cvhr.index : null;
  const fDur = (frec.durSec || 0) * 1000,
    eDur = best.u.durMs;
  const ovFrac = fDur > 0 && eDur > 0 ? best.ov / (Math.max(fDur, eDur) / 1000) : null;
  const rf = fres.rmssd,
    re = best.u.res.rmssd;
  /* READ `dispSd`, NOT `sdnn`. This is the field that makes §4's sdnnRobust criterion measurable, and
     getting it wrong produced a confident −29 % that was an artifact of pairing.

       ECGDex `sdnn`    whole-record SDNN — carries the between-epoch (SDANN) variance
       ECGDex `dispSd`  MEDIAN of per-5-min epoch SDNN — and it is what the EXPORT publishes as
                        `hrv.time.sdnn` for a long record
       PpgDex `sdnnRobust`  quality-gated MEDIAN of per-5-min epoch SDNN

     So `dispSd` is `sdnnRobust`'s like-for-like counterpart and always was; ECGDex simply names it
     differently. Verified rather than assumed: `dispSd` === median(epochs[].sdnn) to the reported
     decimal. On one night the wrong pair reads −35.0 % and the right pair +13.7 %; the wrong pair also
     read −29 % on BOTH devices, which was the tell — a constant offset of construction. */
  const sf = fres.sdnnRobust,
    se = best.u.res.dispSd != null ? best.u.res.dispSd : best.u.res.sdnn;
  const epJit = eph.map((e) => e.jitter);
  const epRmFs = eph.map((x) => x.rmF);
  const epRmEs = eph.map((x) => x.rmE);
  nights.push({
    rec: relative(DIR, f.p),
    name: f.p.split('/').pop(),
    eps: jit.length,
    jitter: median(jit),
    rate: median(rates),
    rateRatio: ratios.length ? median(ratios) : null,
    ratioWorst: ratios.length ? ratios.reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a)) : null,
    refBpm: refBpms.length ? median(refBpms) : null,
    refBpmLo: refBpms.length ? Math.min(...refBpms) : null,
    refBpmHi: refBpms.length ? Math.max(...refBpms) : null,
    dropThin,
    dropNoLag,
    dropNoJitter,
    lag: median(lags),
    refGain: rawJit.length ? median(rawJit) - median(jit) : null,
    cvF,
    cvE,
    cvGap: cvF != null && cvE != null ? Math.abs(cvF - cvE) : null,
    ovFrac,
    rf,
    re,
    bias: rf != null && re ? ((rf - re) / re) * 100 : null,
    sdnnBias: sf != null && se ? ((sf - se) / se) * 100 : null,
    /* ── THE PER-EPOCH ARM'S PER-NIGHT FIGURES — the paper's estimator, not the whole-record one. ──
       `bias` above is ONE rMSSD per night from each node's whole record; `epRmBias` is the median of
       this night's per-epoch biases. They are different estimators and the paper quotes the second, so
       both are published side by side and the gap between them is a measurement rather than a puzzle. */
    epN: eph.length,
    epRmBias: eph.length ? median(eph.map((e) => e.rmBiasPct)) : null,
    epSdBias: eph.some((e) => e.sdBiasPct != null) ? median(eph.filter((e) => e.sdBiasPct != null).map((e) => e.sdBiasPct)) : null,
    epRmF: eph.length ? median(eph.map((e) => e.rmF)) : null,
    epRmE: eph.length ? median(eph.map((e) => e.rmE)) : null,
    /* THE LEVERAGE THE PER-NIGHT FIT HAS. A fit through the origin on σ² can only explain variance
       that σ² HAS: if this night's jitter barely moves between epochs, a low R² is a statement about
       the night's dynamic range and not about the model. Published beside every R² for that reason. */
    epJitIqr: epJit.length >= 2 ? quantile(epJit, 0.75) - quantile(epJit, 0.25) : null,
    epRmR2: r2Pair(epRmFs, epRmEs),
    kfit: kFitThroughOrigin(eph.map((e) => ({ x: e.jitter * e.jitter, y: e.rmF * e.rmF - e.rmE * e.rmE, ref: e.rmF * e.rmF, refE: e.rmE * e.rmE }))),
    kfree: kFitTwoTerm(eph.map((e) => ({ x: e.jitter * e.jitter, ref: e.rmF * e.rmF, refE: e.rmE * e.rmE }))),
    mae: maes.length ? median(maes) : null,
    ppiBias: ppiBias.length ? median(ppiBias) : null,
    sens: sens.length ? median(sens) : null,
    epRef
  });
  const n = nights[nights.length - 1];
  console.log(
    `${n.name.slice(0, 42).padEnd(42)} ${String(n.eps).padStart(4)} ${n.jitter.toFixed(2).padStart(10)} ${(n.rate * 100).toFixed(1).padStart(7)} ${(n.rateRatio == null ? '—' : n.rateRatio.toFixed(2)).padStart(6)} ${(n.refBpm == null ? '—' : n.refBpm.toFixed(1)).padStart(7)} ${String(n.dropThin + n.dropNoLag + n.dropNoJitter).padStart(5)} ${n.lag.toFixed(0).padStart(8)} ${String(n.rf ?? '—').padStart(9)} ${String(n.re ?? '—').padStart(8)} ${(n.bias == null ? '—' : n.bias.toFixed(1)).padStart(7)} ${(n.sdnnBias == null ? '—' : n.sdnnBias.toFixed(1)).padStart(9)}`
  );
}

/* THE SET MAY HAVE MOVED WHILE THIS RAN, and the closing walk is what says so. Without it a result
   that moved because the tree gained a capture is indistinguishable from one that moved because a
   file changed. */
const population = populationVerdict(snap, snapshotEntries(DIR, { list: listDevicePpg, unit: PPG_UNIT }), {
  commit: commitOf.commit,
  commitReason: commitOf.reason,
  tool: 'tools/ppi-jitter-vs-ecg.mjs',
  evidence: ['tools/ppi-jitter-vs-ecg.mjs', 'tools/corpus-scope.mjs']
});

/* THE OTHER HALF OF THE POPULATION. The denominator line above names what the WALK matched. This
   names what the READ could not score, and by name rather than by count, because a count names
   nothing to chase. Both causes land here: the `--max-nights` cap and the per-night skips. */
function printPopulation() {
  console.log(
    `\n  population: ${population.status} — ${population.population.checked} offered ${snap.unit} the run can report over, of ${population.population.eligible} it saw${population.reason ? ` · ${population.reason}` : ''}`
  );
  const rl = ruleLine(population);
  if (rl) console.log(rl);
  console.log(`  the read scored ${nights.length} of the ${snap.n} offered under ${DIR}${snap.ok ? '' : ` · ${snap.reason}`}`);
  const missed = notCovered(snap, nights, { key: 'rec' });
  if (missed.length) console.log(`  it removed ${missed.length}, by name: ${missed.slice(0, 8).join(' · ')}${missed.length > 8 ? ` · … (+${missed.length - 8})` : ''}`);
  if (fingerFiles.length < snap.n) console.log(`  ${snap.n - fingerFiles.length} of those left under the --max-nights ${MAX_NIGHTS} cap, largest first`);
}

/* 🔴 A RUN THAT SCORED NOTHING STILL OWES ITS POPULATION. The early exit below used to be the only
   line such a run printed, so the one case where the population is the whole story was the one case
   that reported none. */
if (!nights.length) {
  console.log('\nno night produced ≥' + MIN_EPOCHS + ' comparable epochs — nothing to report.');
  printPopulation();
  process.exit(0);
}
const J = nights.map((n) => n.jitter);
const Bs = nights.filter((n) => n.bias != null).map((n) => n.bias);
const S = nights.filter((n) => n.sdnnBias != null).map((n) => n.sdnnBias);
const R = nights.map((n) => n.rate * 100);
const fmt = (a) => (a.length ? `median ${median(a).toFixed(2)}  IQR ${quantile(a, 0.25).toFixed(2)}–${quantile(a, 0.75).toFixed(2)}` : 'n/a');
console.log(`\n${nights.length} night(s) with ≥${MIN_EPOCHS} comparable epochs\n`);
/* The reference is DEVICE-KEYED and repeats the device name on the line. It used to print
   "[Verity wrist reference: 5.92 ms]" beside whatever `--device` selected — and `--device` defaults to
   o2ring, so a finger median printed next to a wrist reference as if the two were a matched pair.
   The header at the top of this output DOES name the device correctly, which is exactly why the
   failure survives: anyone reading the summary through `| tail` (CLAUDE.md §👥.4b) keeps the unkeyed
   reference and discards the label. Measured 2026-08-17 — a finger 7.74 read as a +31 % miss against
   5.92 when the Verity leg on the same nights read 4.98, i.e. BETTER than the reference. A label must
   travel with the number it labels, not sit at the top of the page. */
console.log(
  `  PPI-jitter sd (PRIMARY)   ${fmt(J)} ms      [${DEVICE === 'verity' ? 'Verity WRIST reference: 5.92 ms — like-for-like' : 'no published reference for the O2Ring FINGER; 5.92 ms is the VERITY WRIST figure and is NOT comparable'}]`
);
console.log(`  beat match rate           ${fmt(R)} %`);
/* THREE FIGURES THE MATCH RATE CANNOT CARRY, and the row `2026-10-19-the-ppi-jitter-endpoint-cannot-see-a-2x-harmonic`
   is why they are here. The jitter and the match rate are both scored over beats that PAIRED, and a
   detector firing twice per beat refuses the jitter instead of lowering the rate, so its epochs leave
   the population and the survivors read clean. The count ratio is taken before the pairing; the drop
   tally says how many epochs never reached a figure, by reason; and the covered rate range says which
   rates were examined at all, because a variant that only misbehaves at 48 bpm is invisible on a corpus
   that never goes there. Read as a verdict about data these three decide nothing on their own — the
   acceptance bar lives in the brief's §4, which now reads them. */
const RA = nights.filter((n) => n.rateRatio != null).map((n) => n.rateRatio);
const BP = nights.filter((n) => n.refBpm != null).map((n) => n.refBpm);
const LOS = nights.filter((n) => n.refBpmLo != null).map((n) => n.refBpmLo);
const HIS = nights.filter((n) => n.refBpmHi != null).map((n) => n.refBpmHi);
const WORST = nights.filter((n) => n.ratioWorst != null).map((n) => n.ratioWorst);
const dThin = nights.reduce((a, n) => a + n.dropThin, 0);
const dLag = nights.reduce((a, n) => a + n.dropNoLag, 0);
const dJit = nights.reduce((a, n) => a + n.dropNoJitter, 0);
const kept = nights.reduce((a, n) => a + n.eps, 0);
console.log(`  beat-count ratio f/ECG    ${fmt(RA)}        [1.00 is one finger beat per ECG beat; a doubled rate reads 2.00]`);
console.log(
  `                            worst night ${WORST.length ? WORST.reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a)).toFixed(2) : 'n/a'} — taken BEFORE the jitter gate, so a refused epoch still counts here`
);
console.log(`  epochs dropped            ${dThin} thin · ${dLag} no envelope lag · ${dJit} jitter refused   (${kept} kept — a dropped epoch leaves both figures above)`);
console.log(`  reference rate covered    ${BP.length ? `median ${median(BP).toFixed(1)} bpm · slowest epoch ${Math.min(...LOS).toFixed(1)} · fastest ${Math.max(...HIS).toFixed(1)}` : 'n/a'}`);
console.log(`  RMSSD bias vs ECG         ${fmt(Bs)} %`);
/* §4: CVHR promotes only if the finger agrees with ECGDex within the Integrator's band on SLEEP nights.
   Scored only where BOTH nodes produced an index and the records genuinely overlap — a thin overlap makes
   the per-hour rates describe different nights. */
const CVHR_BAND = 5.0;
const cvPairs = nights.filter((n) => n.cvGap != null && n.ovFrac != null && n.ovFrac >= 0.5);
if (cvPairs.length) {
  const gaps = cvPairs.map((n) => n.cvGap);
  const agree = gaps.filter((g) => g <= CVHR_BAND).length;
  console.log(`  CVHR |Δ| events/h         ${fmt(gaps)}   ${agree}/${cvPairs.length} within the Integrator band (±${CVHR_BAND})`);
  console.log(`                            finger median ${median(cvPairs.map((n) => n.cvF)).toFixed(2)} /h · ECG median ${median(cvPairs.map((n) => n.cvE)).toFixed(2)} /h · overlap ≥50 %`);
} else {
  console.log('  CVHR |Δ| events/h         no pair with ≥50 % record overlap AND an index from both nodes');
}
/* §4's `sdnnRobust → validated` bar is ±3.5 %, and THIS TOOL CANNOT ADJUDICATE IT — so the number is
   withheld rather than printed with a caveat nobody reads. `sdnnRobust` is a quality-gated MEDIAN of
   per-5-min SDNN; ECGDex publishes only whole-record `sdnn`, which structurally includes the
   between-epoch (SDANN) variance the per-5-min median excludes. Comparing them is comparing two
   different quantities, and the measurement says so plainly: it read −29 % on the FINGER and −29 % on
   the WRIST, i.e. a constant offset of construction, not a property of either device. PpgDex's own
   export note puts sdnnRobust at ~+3.5 % vs "ECG truth" — meaning the ECG's per-5-min equivalent.
   🔴 UPDATED 2026-10-28: that reference now EXISTS. The per-epoch arm below computes the ECG's
   per-5-min SDNN on the shared grid by calling `ECGDSP.std` over the node's own segments, so it is the
   node's estimator rather than reimplemented math — §3.5 forbids the second, not the first, and the
   distinction is the whole reason the arm was buildable without touching a DSP.
   THE BAR IS STILL NOT ADJUDICATED HERE, for a different reason: `sdnnRobust` is a QUALITY-GATED median
   and the per-epoch arm reproduces no quality gate, so what it publishes is a per-epoch SDNN bias
   between two ungated medians. At a ±3.5 % bar the gate is not a detail. The figure is reported under
   its own name below and never as `sdnnRobust`. */
console.log(`  sdnnRobust vs ECG dispSd  ${fmt(S)} %      [§4 promotion bar: within ~±3.5 %]`);
console.log(`  ^ dispSd is ECGDex's MEDIAN of per-5-min epoch SDNN — sdnnRobust's like-for-like counterpart.
    Pairing it against whole-record \`sdnn\` instead reads ~−29 % on BOTH devices: an offset of construction.`);
console.log(
  '\nThe match rate is reported BESIDE the jitter, never folded into it: a low rate means the jitter\n' +
    'figure describes whichever beats happened to pair, not the night. Read them together or not at all.\n' +
    'And both describe the RATE RANGE named above, not every rate a device can reach: a change that\n' +
    'misbehaves outside that range moves nothing here. Quote the range with the figure.'
);

/* ════════════════════════ THE PER-EPOCH ARM — WHAT IT REPORTS ═══════════════════════════════════
 * `papers/ppg-ecg-hrv-validation.html` quotes every figure below, and none of them had a producer
 * before this block. They are printed APART from the whole-record figures above, and the two are never
 * added or compared as if they were one estimator: a whole-record rMSSD is one number per night over
 * all of it, a per-epoch median is the middle of ~70 five-minute numbers, and jitter inflates the two
 * differently because the second never averages a quiet hour against a noisy one.
 * ════════════════════════════════════════════════════════════════════════════════════════════════ */
const epNights = nights.filter((n) => n.epN > 0);
const kNights = nights.filter((n) => n.kfit);
if (!epNights.length) {
  console.log(`\nper-epoch arm: no night produced a scored epoch — ${nights.reduce((a, n) => a + (n.epRef.boundary || 0), 0)} window(s) crossed a session boundary`);
} else {
  const ERM = epNights.map((n) => n.epRmBias);
  const ESD = epNights.filter((n) => n.epSdBias != null).map((n) => n.epSdBias);
  const KS = kNights.map((n) => n.kfit.k);
  const R2 = kNights.filter((n) => n.kfit.r2 != null).map((n) => n.kfit.r2);
  const R2U = kNights.filter((n) => n.kfit.r2Unc != null).map((n) => n.kfit.r2Unc);
  const R2M = kNights.filter((n) => n.kfit.r2Model != null).map((n) => n.kfit.r2Model);
  const MA = nights.filter((n) => n.mae != null).map((n) => n.mae);
  const PB = nights.filter((n) => n.ppiBias != null).map((n) => n.ppiBias);
  const SE = nights.filter((n) => n.sens != null).map((n) => n.sens * 100);
  console.log(`\n── THE PER-EPOCH ARM — ${allEp.length} epoch(s) over ${epNights.length} night(s) ──\n`);
  console.log(
    `  ${'night'.padEnd(26)} ${'eps'.padStart(4)} ${'rMSSD bias %'.padStart(12)} ${'SDNN bias %'.padStart(11)} ${'k'.padStart(6)} ${'R²'.padStart(6)} ${'MAE ms'.padStart(7)} ${'PPI bias'.padStart(9)} ${'sens %'.padStart(7)}`
  );
  for (const n of epNights)
    console.log(
      `  ${n.name.slice(0, 26).padEnd(26)} ${String(n.epN).padStart(4)} ${n.epRmBias.toFixed(1).padStart(12)} ${(n.epSdBias == null ? '—' : n.epSdBias.toFixed(1)).padStart(11)} ${(n.kfit ? n.kfit.k.toFixed(2) : '—').padStart(6)} ${(n.kfit && n.kfit.r2 != null ? n.kfit.r2.toFixed(3) : '—').padStart(6)} ${(n.mae == null ? '—' : n.mae.toFixed(2)).padStart(7)} ${(n.ppiBias == null ? '—' : n.ppiBias.toFixed(2)).padStart(9)} ${(n.sens == null ? '—' : (n.sens * 100).toFixed(1)).padStart(7)}`
    );
  console.log(`\n  per-epoch rMSSD bias      ${fmt(ERM)} %      [median over nights of each night's median epoch; the whole-record figure above is ${Bs.length ? median(Bs).toFixed(2) : 'n/a'} %]`);
  /* THE NIGHT-LEVEL DISTRIBUTION, because the median is not the claim on its own. A right-skewed set of
     nights has a mean nowhere near its median, and the limits of agreement are the figure a reader of a
     method paper actually needs. Computed over NIGHTS, never over epochs: epochs inside a night are not
     independent, and pooling them narrows an interval that has no right to narrow (§2 of the paper, and
     its companion on pooling inverting gate rankings). */
  const nMean = mean(ERM),
    nSd = ERM.length > 1 ? sd(ERM) : null;
  console.log(
    `  …over nights              mean ${nMean.toFixed(2)} % · sd ${nSd == null ? '—' : nSd.toFixed(2)} · ${ERM.filter((v) => Math.abs(v) <= 10).length}/${ERM.length} within ±10 % · ${ERM.filter((v) => Math.abs(v) <= 5).length} within ±5 % · ${ERM.filter((v) => v > 0).length} positive`
  );
  console.log(
    `  …95 % limits of agreement ${nSd == null ? 'n/a — one night' : `${(nMean - 1.96 * nSd).toFixed(1)} to ${(nMean + 1.96 * nSd).toFixed(1)} %`}      [normal approximation over NIGHTS; a skewed set makes it wide, which is the point]`
  );
  console.log(`  per-epoch SDNN bias       ${fmt(ESD)} %      [NOT the §4 sdnnRobust bar — see the note below]`);
  /* THE MODEL'S SLOPE. Theory puts k in [2, 6]: independent jitter on both ends of an interval adds 2σ²
     to each successive difference at the low end, and correlated jitter across neighbouring intervals
     drives it up. A k OUTSIDE that band is the interesting result, which is why the band is printed
     beside it rather than used to filter anything. */
  console.log(`  k  (rMSSD²f = rMSSD²e + k·σ²)  ${fmt(KS)}      over ${kNights.length}/${epNights.length} night(s) with ≥${MIN_KFIT_EPOCHS} epochs   [theory: 2 ≤ k ≤ 6]`);
  console.log(
    `  R² of that fit            ${R2.length ? `median ${median(R2).toFixed(3)}  IQR ${quantile(R2, 0.25).toFixed(3)}–${quantile(R2, 0.75).toFixed(3)}  worst ${Math.min(...R2).toFixed(3)}` : 'n/a'}   [the INCREMENT's variance — does jitter explain the gap]`
  );
  console.log(
    `  …same residuals, other denominators   uncentred increment ${R2U.length ? median(R2U).toFixed(3) : 'n/a'} · rMSSD²f itself ${R2M.length ? `${median(R2M).toFixed(3)}  IQR ${quantile(R2M, 0.25).toFixed(3)}–${quantile(R2M, 0.75).toFixed(3)}` : 'n/a'}` +
      `\n                            [the last one is near-tautological: rMSSD²e alone explains most of rMSSD²f on paired devices. A published R² that does not name its denominator can be any of these three.]`
  );
  const JQ = kNights.filter((n) => n.epJitIqr != null).map((n) => n.epJitIqr);
  console.log(
    `  within-night jitter IQR   ${JQ.length ? `median ${median(JQ).toFixed(2)} ms  range ${Math.min(...JQ).toFixed(2)}–${Math.max(...JQ).toFixed(2)}` : 'n/a'}      [the x-spread the per-night fit works with]` +
      `\n                            [σ² is the only predictor, so a night whose jitter hardly moves cannot produce a high R² whether the model holds or not.]`
  );
  const RP = kNights.filter((n) => n.epRmR2 != null).map((n) => n.epRmR2);
  console.log(
    `  r² ppg-vs-ecg rMSSD        ${RP.length ? `median ${median(RP).toFixed(3)}  IQR ${quantile(RP, 0.25).toFixed(3)}–${quantile(RP, 0.75).toFixed(3)}` : 'n/a'}      [no model in it — the devices' bare per-epoch agreement]` +
      `\n                            [the most charitable reading of an unlabelled R²; printed so a published value can be tested against it rather than assumed to be it.]`
  );
  console.log(`  PPI MAE / signed bias     ${fmt(MA)} ms  /  ${fmt(PB)} ms      [a bias near 0 says the devices agree on RATE, which the sd cannot say]`);
  console.log(`  beat sensitivity          ${fmt(SE)} %      [matched REFERENCE beats over reference beats — the match rate above is PPV]`);
  /* THE RANGES ACROSS NIGHTS, in one line, because a method paper's table quotes them and a reader
     cannot derive a range from a median and an IQR. Printed together so the table has ONE source. */
  const rng = (a) => (a.length ? `${Math.min(...a).toFixed(2)}–${Math.max(...a).toFixed(2)}` : 'n/a');
  console.log(`  ranges across nights      jitter ${rng(J)} ms · MAE ${rng(MA)} ms · PPI bias ${rng(PB)} ms · sens ${rng(SE)} % · PPV ${rng(R)} % · per-epoch rMSSD bias ${rng(ERM)} %`);
  /* THE POOLED FIT, DESCRIPTIVE ONLY and labelled as such on the line itself. It answers a different
     question from the per-night median — one slope over every epoch in the corpus, with nights of many
     epochs weighted more — and the label travels with the number because a pooled figure read as the
     night-clustered one is the exact error the paper's §2 exists to prevent. */
  const kPool = kFitThroughOrigin(allEp.map((e) => ({ x: e.jitter * e.jitter, y: e.rmF * e.rmF - e.rmE * e.rmE, ref: e.rmF * e.rmF, refE: e.rmE * e.rmE })));
  const kFree = kFitTwoTerm(allEp.map((e) => ({ x: e.jitter * e.jitter, ref: e.rmF * e.rmF, refE: e.rmE * e.rmE })));
  console.log(
    `  pooled over all epochs    ${kPool ? `k ${kPool.k.toFixed(2)} · R² ${kPool.r2 == null ? '—' : kPool.r2.toFixed(3)} increment / ${kPool.r2Unc == null ? '—' : kPool.r2Unc.toFixed(3)} uncentred / ${kPool.r2Model == null ? '—' : kPool.r2Model.toFixed(3)} rMSSD²f over ${kPool.n} epoch(s)` : 'n/a'}   [DESCRIPTIVE — epochs within a night are not independent]`
  );
  /* 🔴 THE CONSTRAINED CLAIM AND THE FREE ESTIMATOR, SIDE BY SIDE AND LABELLED. `a` is the coefficient the
     paper's equation fixes at 1. If the free fit puts `a` near 1 the constraint costs nothing and the two
     k's agree; if it does not, the published k and R² belong to the free estimator and the equation as
     written is a different model. A reader cannot tell those apart from one number, so both are printed. */
  const KF = kNights.filter((n) => n.kfree).map((n) => n.kfree);
  if (KF.length) {
    const AA = KF.map((f) => f.a),
      KK = KF.map((f) => f.k),
      RR = KF.filter((f) => f.r2Model != null).map((f) => f.r2Model);
    console.log(
      `  …with the reference coefficient FREED (rMSSD²f = a·rMSSD²e + k·σ²)\n` +
        `                            a ${fmt(AA)}  ·  k ${fmt(KK)}  ·  R² ${RR.length ? `median ${median(RR).toFixed(3)}  IQR ${quantile(RR, 0.25).toFixed(3)}–${quantile(RR, 0.75).toFixed(3)}` : 'n/a'}   over ${KF.length} night(s)\n` +
        `                            [a = 1 is the paper's constraint. Pooled: ${kFree ? `a ${kFree.a.toFixed(3)} · k ${kFree.k.toFixed(2)} · R² ${kFree.r2Model == null ? '—' : kFree.r2Model.toFixed(3)} over ${kFree.n} epoch(s)` : 'n/a'}]`
    );
  }
  console.log(`  covered by scored epochs  ${((allEp.length * EPOCH_MS) / 3600000).toFixed(1)} h      [${allEp.length} × 5 min; the record spans more, this is what the per-epoch arm examined]`);
  const split = catastrophicSplit(allEp, CAT_BIAS_PCT, JIT_BAND_MS);
  if (split)
    console.log(
      `  catastrophic epochs       ${split.nCat} of ${split.n} (${(split.catShare * 100).toFixed(1)} %) with |ΔrMSSD| > ${CAT_BIAS_PCT} %\n` +
        `                            jitter median ${split.jitIn == null ? '—' : split.jitIn.toFixed(1)} ms inside vs ${split.jitOut == null ? '—' : split.jitOut.toFixed(1)} ms outside · above ${JIT_BAND_MS} ms: ${split.aboveIn == null ? '—' : (split.aboveIn * 100).toFixed(0)} % vs ${split.aboveOut == null ? '—' : (split.aboveOut * 100).toFixed(0)} %`
    );
  /* THE BUDGET IS A FRACTION OF SOMETHING, so the something is MEASURED and printed with it. The
     reference is the corpus median per-epoch ECG rMSSD — the quantity the bias is a percentage of.
     Quoting a σ budget without it publishes a number nobody can check, and a budget read against an
     assumed 38 ms says nothing about a corpus whose reference is 25. */
  const refRm = median(allEp.map((e) => e.rmE));
  const kMed = KS.length ? median(KS) : null;
  const BUDGET_TARGETS = [0.01, 0.02, 0.03, 0.05];
  const bud = BUDGET_TARGETS.map((p) => sigmaForBias(kMed, refRm, p));
  console.log(`  reference per-epoch rMSSD ${refRm.toFixed(1)} ms      [corpus median of the ECG side over ${allEp.length} epoch(s) — what every % above is a fraction of]`);
  console.log(
    `  jitter budget             σ ≤ ${bud.map((v) => (v == null ? '—' : v.toFixed(2))).join(' / ')} ms for a ${BUDGET_TARGETS.map((p) => (p * 100).toFixed(0)).join(' / ')} % per-epoch rMSSD bias` +
      `\n                            [closed form from k=${kMed == null ? '—' : kMed.toFixed(2)} and that reference; a different corpus moves both]`
  );
  /* 🔴 EACH TARGET'S STATUS, COUNTED RATHER THAN ASSERTED. A budget table's third column — "reached on
     15 of 20 nights" — is a COUNT over the per-night jitter column, and a count left to a reader is a
     count nobody can re-run: the paper's own version of this table had no producer, which is the row
     this arm closes. The required cut is quoted against the MEDIAN night, and says so, because a cut
     that reaches the median reaches nothing on the worst night. */
  const jMed = median(J);
  for (let i = 0; i < bud.length; i++) {
    const v = bud[i];
    const tgt = (BUDGET_TARGETS[i] * 100).toFixed(0) + ' %';
    if (v == null) {
      console.log(`    ≤ ${tgt.padStart(4)}   no budget — k or the reference was not measured`);
      continue;
    }
    const cut = ((jMed - v) / jMed) * 100;
    console.log(
      `    ≤ ${tgt.padStart(4)}   σ ≤ ${v.toFixed(2).padStart(6)} ms   ${(cut > 0 ? `needs a ${cut.toFixed(0)} % cut from the median night's ${jMed.toFixed(2)} ms` : `already met by the median night (${jMed.toFixed(2)} ms)`).padEnd(52)} reached on ${J.filter((x) => x <= v).length}/${J.length} night(s)`
    );
  }
  const drops = Object.entries(nights.reduce((a, n) => (Object.entries(n.epRef).forEach(([k2, v]) => (a[k2] = (a[k2] || 0) + v)), a), {})).filter(([, v]) => v > 0);
  if (EPOCH_DUMP) {
    writeFileSync(
      EPOCH_DUMP,
      'night,epochStartMs,jitterMs,rmssdFinger,rmssdEcg,sdnnFinger,sdnnEcg,rmssdBiasPct,sdnnBiasPct,nFinger,nEcg\n' +
        allEp.map((e) => [e.night, e.t, e.jitter, e.rmF, e.rmE, e.sdF, e.sdE, e.rmBiasPct, e.sdBiasPct, e.nF, e.nE].join(',')).join('\n') +
        '\n'
    );
    console.log(`  per-epoch rows written    ${allEp.length} to ${EPOCH_DUMP}   [NOT a repository artifact — per-night records]`);
  }
  console.log(`  epochs with no HRV pair   ${drops.length ? drops.map(([k2, v]) => `${v} ${k2}`).join(' · ') : 'none'}   (of the ${kept} epochs the jitter arm scored)`);
  console.log(
    '\n  The per-epoch population is NOT the jitter population: an epoch can carry a jitter and no\n' +
      '  per-epoch HRV (it crosses a session boundary, or ECGDex refused its window for a clock seam).\n' +
      '  Both counts are printed, and a figure from one must not be read against a drop tally from the other.'
  );
}

printPopulation();

#!/usr/bin/env node
/*
 * tools/nsrr-coupling-bout-fpr.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * DEEP-AUDIT-V F8 — DOES THE EVENT-COUPLING NULL SURVIVE REAL OSA BOUT STRUCTURE?
 *
 * Measures, on SHHS1, the false-positive rate of `event-coupling.js`'s circular-shift null when two
 * INDEPENDENT streams share a real OSA night's bout-scale rate profile — as a curve in the profile
 * scale — and whether a per-record density statistic can flag the vulnerable nights. XML only.
 *
 * `event-coupling.js` nulls a coupling with CIRCULAR TIME-SHIFT surrogates at ±5–17 min. That null is
 * exact for two streams that are independent — a shift preserves each stream's own clustering — and
 * it was measured correct (4.8 % FPR / 500 trials, DEEP-AUDIT-V §3). It is NOT exact when both
 * streams' RATES are modulated by one shared process at the scale of the shift itself: a shift of
 * 5–17 min carries A's events OUT of the shared 5–20 min bouts B's events sit in, the null hit rate
 * falls below the observed one, and the primitive reports a coupling that is inherited from the
 * bout structure, not from any event-level mechanism. At the HOUR scale the same shift leaves A
 * inside the shared hump, so the null holds (6.0 / 5.3 % vs 6.0 % control). At the BOUT scale a
 * synthetic profile gave 36–53 % (DEEP-AUDIT-V punch-list 2.2), and F8 asked the one question that
 * figure could not answer: is that profile REAL? The trio corpus is a healthy sleeper and the
 * committed CPAP night carries 20 events, so no local night could say. SHHS1 carries thousands of
 * untreated OSA nights, scored — the DUA is signed (owner, 2026-09-20), so it can.
 *
 * ── THREE LEGS, all from the annotation XML alone (no EDF is read) ──────────────────────────────
 *   L1 REAL-PAIRED    A = resp events (record i), B = expert desaturations (record i). TRUE coupling
 *                     (apnea → desat). A positive control, not an FPR: the fraction the primitive
 *                     calls significant among usable measurements is its REACH on real OSA.
 *   L2 REAL-CROSSED   A = resp(i), B = desat(j), j = the next record in hash order. Independent by
 *                     construction, REAL within-stream clustering on both sides, NO shared
 *                     modulation. The null is exactly true. Tests the term the shift already handles.
 *   L3 SHARED-λ       λ(t) = record i's OWN resp-event rate profile (kernel-smoothed, σ = 90 s —
 *                     wide enough that no sub-minute alignment is manufactured, narrow enough to
 *                     keep a 5-min bout). A′ and B′ are two INDEPENDENT inhomogeneous-Poisson draws
 *                     from that same λ, sized to the record's resp and desat counts. Independent
 *                     given λ; shared bout structure by construction; the null is true at the event
 *                     level. This is the F8 term, on REAL profiles.  K trials per record.
 *   L3c CONTROL       A′ from λ, B′ HOMOGENEOUS Poisson at the same count — one modulated stream
 *                     only. Must sit at ~α; if it does not, the leg's own machinery is wrong.
 *
 * Integrator config throughout (`integrator-dsp.js` apneaCoupling): window [−15 s, +60 s],
 * `shiftsForAlpha(0.05)` = 80 prime-second shifts, coverage = the scored span. A measurement counts
 * only when USABLE (neither underpowered nor saturated) — exactly what the Integrator reads.
 *
 * ── THE DENSITY DIAGNOSTIC THIS EXISTS TO SIZE ──────────────────────────────────────────────────
 * The punch list prescribes a LOCAL-DENSITY DIAGNOSTIC and forbids a second null: "do not touch the
 * p-value". A diagnostic is worth shipping only if it separates the nights where L3's FPR is high
 * from those where it is not. Two candidates, computed per record from the OBSERVED streams:
 *   fano10     variance/mean of resp counts in 10-min bins  (Poisson ⇒ 1; bouts ⇒ ≫ 1)
 *   rateLift   Σ λ̂A λ̂B  ÷  mean over the shift set of Σ λ̂A(t) λ̂B(t+s), with λ̂ the 2-min binned
 *              rates — the lift the shared modulation alone would produce, model-free. It cannot
 *              tell shared modulation from a real coupling at bin scale, and does not try to: it
 *              says "the two rates co-vary at the bout scale; a lift at this window may be
 *              inherited from that", which is the whole of what a diagnostic may say.
 * Each is scored by AUC against "L3 FPR > 15 %" over records.
 *
 * ── BANDS, registered BEFORE the first run — do not move them after seeing a number ─────────────
 *   L2 crossed FPR    ≤ 8 %  → the shift null holds under real within-stream clustering (expected)
 *                     > 8 %  → a NEW finding: real clustering alone breaks the null; F8 was mis-scoped
 *   L3c control       ≤ 8 %  → the leg's machinery is sound;  > 8 % → the leg is broken, stop
 *   L3 shared-λ FPR   ≤ 10 % → the bout-scale worry does NOT reach on real OSA profiles; F8 closes
 *                              as refuted-on-data, and the diagnostic is not owed
 *                     10–30 % → reaches, moderately; ship the diagnostic if AUC ≥ 0.8
 *                     > 30 % → the synthetic 36–53 % is REAL; the diagnostic is owed regardless
 *   AUC (either)      ≥ 0.8 → discriminates;  < 0.8 → a per-record flag would mislead; say so
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ L3 shares the PROFILE with the real night, not the night. A real desat stream is CAUSED by the
 *    resp stream, so a real-paired FPR does not exist; L3 is the closest a true null can get to real
 *    bout structure and it is stated as such. ⚠️ The kernel width is a choice (σ = 90 s, stated;
 *    `--sigma` re-runs it). ⚠️ P5: measurement is permitted, external quoting is gated (owner
 *    2026-09-12). ⚠️ Never fetches; absent records ⇒ SKIP printing the paths searched.
 *
 *   node tools/nsrr-coupling-bout-fpr.mjs --selftest
 *   node tools/nsrr-coupling-bout-fpr.mjs --anns <dir> [--n 400] [--trials 10] [--sigma 90] [--json]
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ANNS = '/srv/data/shhs/polysomnography/annotations-events-nsrr/shhs1';
const ALPHA = 0.05;
const WINDOW = [-15000, 60000]; // integrator-dsp.js leadMaxSec / trailMaxSec defaults
const BIN_MS = 120000; // rateLift bins
const FANO_BIN_MS = 600000; // 10 min

export const BANDS = {
  crossedFprMax: 0.08,
  controlFprMax: 0.08,
  sharedNotReached: 0.1,
  sharedSynthetic: 0.3,
  fprHigh: 0.15,
  aucDiscriminates: 0.8
};

/* Order by hash(id) — the `nsrr-score-pool.mjs` idiom, inlined because importing that module runs
   ITS `--selftest` guard on this process's argv. NSRR ids track recruitment, so a directory-order
   prefix is a biased sample; a hash-order prefix is uniform. */
export function shuffledOrder(ids, salt) {
  return ids
    .map((id) => ({
      id,
      k: createHash('sha256')
        .update(String(salt || '') + '\0' + id)
        .digest('hex')
        .slice(0, 13)
    }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.id < b.id ? -1 : 1))
    .map((o) => o.id);
}

/* ── the primitive, in its own realm ─────────────────────────────────────────────────────────── */
export function loadCoupling() {
  const sandbox = { console, Math };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(ROOT, 'event-coupling.js'), 'utf8'), ctx, { filename: 'event-coupling.js' });
  if (!ctx.EventCoupling || typeof ctx.EventCoupling.coupling !== 'function') throw new Error('EventCoupling did not load');
  return ctx.EventCoupling;
}

/* ── XML → event streams ─────────────────────────────────────────────────────────────────────
   Deliberately the SAME reading as `nsrr-adapter.js parseNsrrXml` (RESP_RE / HYPOP_RE / APNEA_RE)
   for resp events; desats are the `SpO2 desaturation` concept the ODI tool's expert index reads.
   Times are ms from recording start (floating, per §🔒 — the XML has no zone and no date). */
const BLOCK_RE = /<ScoredEvent>[\s\S]*?<\/ScoredEvent>/g;
const RESP_RE = /apnea|hypopnea|hypopnoea|apnoea/i;
const DESAT_RE = /SpO2 desaturation/i;
const STAGE_RE = /^(Wake|Stage \d sleep|REM sleep)\|/i;
function tag(b, t) {
  const m = new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>').exec(b);
  return m ? m[1] : null;
}
export function streamsFromXml(xml) {
  const resp = [];
  const desat = [];
  let endSec = 0;
  let sleepSec = 0;
  for (const b of String(xml).match(BLOCK_RE) || []) {
    const concept = tag(b, 'EventConcept') || '';
    const start = parseFloat(tag(b, 'Start'));
    const dur = parseFloat(tag(b, 'Duration'));
    if (!Number.isFinite(start)) continue;
    if (Number.isFinite(dur) && start + dur > endSec) endSec = start + dur;
    if (RESP_RE.test(concept)) resp.push({ tMs: start * 1000, durSec: dur });
    else if (DESAT_RE.test(concept)) desat.push({ tMs: start * 1000 });
    else if (STAGE_RE.test(concept) && !/^Wake/i.test(concept) && Number.isFinite(dur)) sleepSec += dur;
  }
  resp.sort((a, b) => a.tMs - b.tMs);
  desat.sort((a, b) => a.tMs - b.tMs);
  return { resp, desat, spanMs: endSec * 1000, tstHours: sleepSec / 3600 };
}

/* ── the rate profile and the two synthetic draws ──────────────────────────────────────────── */
export function rateProfile(events, spanMs, sigmaMs, stepMs) {
  const n = Math.max(1, Math.ceil(spanMs / stepMs));
  const lam = new Float64Array(n);
  const inv2s2 = 1 / (2 * sigmaMs * sigmaMs);
  const reach = Math.ceil((4 * sigmaMs) / stepMs);
  for (const e of events) {
    const c = Math.floor(e.tMs / stepMs);
    for (let i = Math.max(0, c - reach); i <= Math.min(n - 1, c + reach); i++) {
      const d = (i + 0.5) * stepMs - e.tMs;
      lam[i] += Math.exp(-d * d * inv2s2);
    }
  }
  return lam; // unnormalised; only the SHAPE is used
}

/* mulberry32 — a seeded PRNG so a run is reproducible record-for-record. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Draw exactly `count` events from a profile by inverse-CDF sampling of the discretised λ, then
   jitter uniformly inside the step. A fixed count (not Poisson-distributed) keeps every trial at
   the record's own power, which is the thing being compared. */
export function drawFromProfile(lam, count, stepMs, rand) {
  const cdf = new Float64Array(lam.length);
  let s = 0;
  for (let i = 0; i < lam.length; i++) {
    s += lam[i];
    cdf[i] = s;
  }
  const out = [];
  if (!(s > 0)) return out;
  for (let k = 0; k < count; k++) {
    const u = rand() * s;
    let lo = 0;
    let hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    out.push({ tMs: (lo + rand()) * stepMs });
  }
  out.sort((a, b) => a.tMs - b.tMs);
  return out;
}

export function drawUniform(count, spanMs, rand) {
  const out = [];
  for (let k = 0; k < count; k++) out.push({ tMs: rand() * spanMs });
  out.sort((a, b) => a.tMs - b.tMs);
  return out;
}

/* ── the two density statistics ─────────────────────────────────────────────────────────────── */
export function fano(events, spanMs, binMs) {
  const n = Math.max(1, Math.ceil(spanMs / binMs));
  const c = new Float64Array(n);
  for (const e of events) c[Math.min(n - 1, Math.floor(e.tMs / binMs))]++;
  let m = 0;
  for (let i = 0; i < n; i++) m += c[i];
  m /= n;
  if (!(m > 0)) return null;
  let v = 0;
  for (let i = 0; i < n; i++) v += (c[i] - m) * (c[i] - m);
  v /= n;
  return v / m;
}

/* Σ λA λB at lag 0 over its mean across the shift set, both circular over the span — the lift
   the binned rates alone predict. NaN when either stream is empty. */
export function rateLift(A, B, spanMs, shiftsMs, binMs) {
  const n = Math.max(1, Math.ceil(spanMs / binMs));
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  for (const e of A) a[Math.min(n - 1, Math.floor(e.tMs / binMs))]++;
  for (const e of B) b[Math.min(n - 1, Math.floor(e.tMs / binMs))]++;
  const dot = (lagBins) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += a[i] * b[(((i + lagBins) % n) + n) % n];
    return s;
  };
  const d0 = dot(0);
  let acc = 0;
  for (const s of shiftsMs) acc += dot(Math.round(s / binMs));
  const dNull = acc / shiftsMs.length;
  return dNull > 0 ? d0 / dNull : NaN;
}

/* ── AUC (Mann–Whitney), ties at ½ ─────────────────────────────────────────────────────────── */
export function auc(scores, labels) {
  let pos = 0;
  let neg = 0;
  let u = 0;
  for (let i = 0; i < scores.length; i++) {
    if (!Number.isFinite(scores[i])) continue;
    if (labels[i]) pos++;
    else neg++;
  }
  if (!pos || !neg) return null;
  for (let i = 0; i < scores.length; i++) {
    if (!labels[i] || !Number.isFinite(scores[i])) continue;
    for (let j = 0; j < scores.length; j++) {
      if (labels[j] || !Number.isFinite(scores[j])) continue;
      u += scores[i] > scores[j] ? 1 : scores[i] === scores[j] ? 0.5 : 0;
    }
  }
  return u / (pos * neg);
}

/* ── one record ─────────────────────────────────────────────────────────────────────────────── */
export function measureRecord(EC, rec, next, opts) {
  const shifts = EC.shiftsForAlpha(ALPHA);
  const cov = [[0, rec.spanMs]];
  const run = (A, B, spanMs) => {
    const r = EC.coupling(A, B, { window: WINDOW, coverage: [[0, spanMs]], nullShifts: shifts });
    return { usable: !r.underpowered && !r.saturated, sig: r.pPerm < ALPHA, lift: r.lift, p: r.pPerm };
  };
  const out = { id: rec.id, nResp: rec.resp.length, nDesat: rec.desat.length, spanMs: rec.spanMs };
  out.paired = run(rec.resp, rec.desat, rec.spanMs);
  if (next) {
    const span = Math.min(rec.spanMs, next.spanMs);
    out.crossed = run(
      rec.resp.filter((e) => e.tMs < span),
      next.desat.filter((e) => e.tMs < span),
      span
    );
  }
  out.fano10 = fano(rec.resp, rec.spanMs, FANO_BIN_MS);
  out.rateLiftReal = rateLift(rec.resp, rec.desat, rec.spanMs, shifts, BIN_MS);
  const stepMs = 30000;
  const lam = rateProfile(rec.resp, rec.spanMs, opts.sigmaMs, stepMs);
  const rand = rng(opts.seed ^ hash32(rec.id));
  let usable = 0;
  let sig = 0;
  let cUsable = 0;
  let cSig = 0;
  let rlSum = 0;
  let rlN = 0;
  for (let k = 0; k < opts.trials; k++) {
    const A = drawFromProfile(lam, rec.resp.length, stepMs, rand);
    const B = drawFromProfile(lam, rec.desat.length, stepMs, rand);
    const r = run(A, B, rec.spanMs);
    if (r.usable) {
      usable++;
      if (r.sig) sig++;
    }
    const rl = rateLift(A, B, rec.spanMs, shifts, BIN_MS);
    if (Number.isFinite(rl)) {
      rlSum += rl;
      rlN++;
    }
    const Bu = drawUniform(rec.desat.length, rec.spanMs, rand);
    const rc = run(A, Bu, rec.spanMs);
    if (rc.usable) {
      cUsable++;
      if (rc.sig) cSig++;
    }
  }
  out.shared = { usable, sig, fpr: usable ? sig / usable : null };
  out.control = { usable: cUsable, sig: cSig, fpr: cUsable ? cSig / cUsable : null };
  out.rateLiftShared = rlN ? rlSum / rlN : null;
  void cov;
  return out;
}

function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/* ── the pool ───────────────────────────────────────────────────────────────────────────────── */
export function summarise(rows) {
  const pooled = (key) => {
    let u = 0;
    let s = 0;
    for (const r of rows) {
      if (r[key]?.usable) {
        u += r[key].usable;
        s += r[key].sig;
      }
    }
    return { usable: u, sig: s, rate: u ? s / u : null };
  };
  const one = (key) => {
    let u = 0;
    let s = 0;
    for (const r of rows) {
      if (r[key]?.usable) {
        u++;
        if (r[key].sig) s++;
      }
    }
    return { usable: u, sig: s, rate: u ? s / u : null };
  };
  const shared = pooled('shared');
  const control = pooled('control');
  const paired = one('paired');
  const crossed = one('crossed');
  const withFpr = rows.filter((r) => r.shared.fpr != null && r.shared.usable >= 5);
  const labels = withFpr.map((r) => r.shared.fpr > BANDS.fprHigh);
  const nHigh = labels.filter(Boolean).length;
  const aucFano = auc(
    withFpr.map((r) => r.fano10),
    labels
  );
  const aucRateLift = auc(
    withFpr.map((r) => r.rateLiftShared),
    labels
  );
  const med = (xs) => {
    const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
    return v.length ? v[(v.length - 1) >> 1] : null;
  };
  const verdictShared =
    shared.rate == null
      ? 'no usable measurement'
      : shared.rate <= BANDS.sharedNotReached
        ? 'NOT REACHED on real profiles'
        : shared.rate <= BANDS.sharedSynthetic
          ? 'REACHES, moderately'
          : 'REACHES — the synthetic figure is real';
  return {
    n: rows.length,
    paired,
    crossed,
    shared,
    control,
    perRecord: { withFpr: withFpr.length, high: nHigh, medianFpr: med(withFpr.map((r) => r.shared.fpr)), medianFano10: med(rows.map((r) => r.fano10)) },
    auc: { fano10: aucFano, rateLift: aucRateLift },
    verdict: {
      crossed: crossed.rate == null ? 'n/a' : crossed.rate <= BANDS.crossedFprMax ? 'null holds under real clustering' : 'NEW FINDING — real clustering alone breaks the null',
      control: control.rate == null ? 'n/a' : control.rate <= BANDS.controlFprMax ? 'sound' : 'BROKEN — stop',
      shared: verdictShared,
      diagnostic:
        aucRateLift == null && aucFano == null
          ? 'n/a'
          : Math.max(aucFano ?? 0, aucRateLift ?? 0) >= BANDS.aucDiscriminates
            ? 'discriminates'
            : 'does NOT discriminate — a per-record flag would mislead'
    }
  };
}

function discover(dir) {
  const searched = [dir];
  if (!existsSync(dir)) return { ids: [], searched };
  const ids = readdirSync(dir)
    .filter((f) => /-nsrr\.xml$/.test(f))
    .map((f) => basename(f, '-nsrr.xml'));
  return { ids, searched };
}

function fmtPct(x) {
  return x == null ? 'n/a' : (100 * x).toFixed(1) + ' %';
}

function report(sum, opts) {
  const L = [];
  L.push('nsrr-coupling-bout-fpr — F8 on SHHS1 · n=' + sum.n + ' records · ' + opts.trials + ' trials/record · σ=' + opts.sigmaMs / 1000 + ' s · α=' + ALPHA);
  L.push('');
  L.push('  L1 real-paired   sig/usable ' + sum.paired.sig + '/' + sum.paired.usable + ' = ' + fmtPct(sum.paired.rate) + '   (true coupling — REACH, not an FPR)');
  L.push('  L2 real-crossed  sig/usable ' + sum.crossed.sig + '/' + sum.crossed.usable + ' = ' + fmtPct(sum.crossed.rate) + '   → ' + sum.verdict.crossed);
  L.push('  L3c control      sig/usable ' + sum.control.sig + '/' + sum.control.usable + ' = ' + fmtPct(sum.control.rate) + '   → ' + sum.verdict.control);
  L.push('  L3 shared-λ      sig/usable ' + sum.shared.sig + '/' + sum.shared.usable + ' = ' + fmtPct(sum.shared.rate) + '   → ' + sum.verdict.shared);
  L.push('');
  L.push(
    '  per-record (≥5 usable trials): ' +
      sum.perRecord.withFpr +
      ' records · median FPR ' +
      fmtPct(sum.perRecord.medianFpr) +
      ' · ' +
      sum.perRecord.high +
      ' with FPR > ' +
      fmtPct(BANDS.fprHigh) +
      ' · median fano10 ' +
      (sum.perRecord.medianFano10 == null ? 'n/a' : sum.perRecord.medianFano10.toFixed(2))
  );
  L.push(
    '  density diagnostic AUC vs FPR>15 %:  fano10 ' +
      (sum.auc.fano10 == null ? 'n/a' : sum.auc.fano10.toFixed(3)) +
      ' · rateLift ' +
      (sum.auc.rateLift == null ? 'n/a' : sum.auc.rateLift.toFixed(3)) +
      '   → ' +
      sum.verdict.diagnostic
  );
  L.push('');
  L.push('  bands (registered before the run): crossed ≤ 8 % · control ≤ 8 % · shared ≤ 10 % not reached / 10–30 % moderate / > 30 % synthetic real · AUC ≥ 0.8');
  return L.join('\n');
}

/* ── selftest — PLANTS, not the corpus ──────────────────────────────────────────────────────── */
function selftest() {
  const EC = loadCoupling();
  const fails = [];
  const ok = (c, m) => (c ? null : fails.push(m));
  // XML reader: resp + desat + span + tst, and a stage that is Wake does not count as sleep
  const xml =
    '<ScoredEvents>' +
    '<ScoredEvent><EventConcept>Obstructive apnea|Obstructive Apnea</EventConcept><Start>100</Start><Duration>20</Duration></ScoredEvent>' +
    '<ScoredEvent><EventConcept>Hypopnea|Hypopnea</EventConcept><Start>400</Start><Duration>15</Duration></ScoredEvent>' +
    '<ScoredEvent><EventConcept>SpO2 desaturation|SpO2 desaturation</EventConcept><Start>130</Start><Duration>10</Duration><SpO2Nadir>88</SpO2Nadir><SpO2Baseline>95</SpO2Baseline></ScoredEvent>' +
    '<ScoredEvent><EventConcept>Wake|0</EventConcept><Start>0</Start><Duration>60</Duration></ScoredEvent>' +
    '<ScoredEvent><EventConcept>Stage 2 sleep|2</EventConcept><Start>60</Start><Duration>3600</Duration></ScoredEvent>' +
    '</ScoredEvents>';
  const s = streamsFromXml(xml);
  ok(s.resp.length === 2 && s.desat.length === 1, 'xml: 2 resp + 1 desat');
  ok(s.spanMs === 3660000 && Math.abs(s.tstHours - 1) < 1e-9, 'xml: span 3660 s, TST 1 h (Wake excluded)');
  // fano: a Poisson-like uniform draw ≈ 1; a bouted stream ≫ 1
  const rand = rng(7);
  const span = 8 * 3600000;
  const uni = drawUniform(400, span, rand);
  const fU = fano(uni, span, FANO_BIN_MS);
  ok(fU > 0.5 && fU < 2, 'fano uniform ≈ 1, got ' + fU);
  // a bouted profile: 6 bouts of 10 min, 8 h night
  const lam = new Float64Array(span / 30000);
  for (let b = 0; b < 6; b++) for (let i = 0; i < 20; i++) lam[b * 160 + 40 + i] = 1;
  const bouted = drawFromProfile(lam, 400, 30000, rand);
  const fB = fano(bouted, span, FANO_BIN_MS);
  ok(fB > 5, 'fano bouted ≫ 1, got ' + fB);
  ok(
    bouted.every((e) => e.tMs >= 0 && e.tMs <= span),
    'draw stays inside the span'
  );
  // THE PLANT: two independent draws from one bouted profile — the shift null must be fooled
  // often (this is F8's mechanism, reproduced synthetically), while a draw against a uniform
  // stream must not be. If the plant does not fire, the leg cannot see what it was built to see.
  const shifts = EC.shiftsForAlpha(ALPHA);
  let sig = 0;
  let sigC = 0;
  let usable = 0;
  let usableC = 0;
  for (let k = 0; k < 40; k++) {
    const A = drawFromProfile(lam, 300, 30000, rand);
    const B = drawFromProfile(lam, 200, 30000, rand);
    const r = EC.coupling(A, B, { window: WINDOW, coverage: [[0, span]], nullShifts: shifts });
    if (!r.underpowered && !r.saturated) {
      usable++;
      if (r.pPerm < ALPHA) sig++;
    }
    const rc = EC.coupling(A, drawUniform(200, span, rand), { window: WINDOW, coverage: [[0, span]], nullShifts: shifts });
    if (!rc.underpowered && !rc.saturated) {
      usableC++;
      if (rc.pPerm < ALPHA) sigC++;
    }
  }
  ok(usable >= 30 && sig / usable > 0.5, 'PLANT: shared 10-min bouts fool the null (' + sig + '/' + usable + ')');
  ok(usableC >= 30 && sigC / usableC < 0.25, 'PLANT control: one modulated stream does not (' + sigC + '/' + usableC + ')');
  // rateLift sees the same thing the plant sees
  const rlB = rateLift(drawFromProfile(lam, 300, 30000, rand), drawFromProfile(lam, 200, 30000, rand), span, shifts, BIN_MS);
  const rlU = rateLift(drawUniform(300, span, rand), drawUniform(200, span, rand), span, shifts, BIN_MS);
  ok(rlB > 1.5, 'rateLift on shared bouts > 1.5, got ' + rlB);
  ok(rlU > 0.7 && rlU < 1.3, 'rateLift on two uniform streams ≈ 1, got ' + rlU);
  // auc: perfect separation → 1, reversed → 0, ties → 0.5
  ok(auc([1, 2, 3, 4], [0, 0, 1, 1]) === 1 && auc([4, 3, 2, 1], [0, 0, 1, 1]) === 0 && auc([1, 1, 1, 1], [0, 1, 0, 1]) === 0.5, 'auc edges');
  ok(auc([1, 2], [1, 1]) === null, 'auc with one class is null, not a number');
  // measureRecord end to end on the plant
  const rec = { id: 'plant', resp: bouted, desat: drawFromProfile(lam, 200, 30000, rand), spanMs: span };
  const m = measureRecord(EC, rec, null, { trials: 5, sigmaMs: 90000, seed: 1 });
  ok(m.shared.usable === 5 && m.control.usable === 5 && Number.isFinite(m.fano10), 'measureRecord: 5 usable trials each leg');
  const sum = summarise([m, m, m]);
  ok(sum.n === 3 && sum.shared.usable === 15 && sum.control.usable === 15, 'summarise pools trials');
  for (const f of fails) console.error('  ✗ ' + f);
  console.log(fails.length ? 'selftest FAILED (' + fails.length + ' of 13)' : 'all 13 selftests passed');
  return fails.length ? 1 : 0;
}

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const arg = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
  };
  const opts = { trials: +arg('--trials', 10), sigmaMs: +arg('--sigma', 90) * 1000, seed: +arg('--seed', 20260920) };
  const n = +arg('--n', 400);
  const annDir = arg('--anns', DEFAULT_ANNS);
  const { ids, searched } = discover(annDir);
  if (!ids.length) {
    console.log('SKIP — no NSRR annotations found. Searched:\n  ' + searched.join('\n  ') + '\nNo metrics reported; this tool never fetches.');
    return 0;
  }
  const order = shuffledOrder(ids, 'f8').slice(0, n);
  const EC = loadCoupling();
  const load = (id) => {
    const s = streamsFromXml(readFileSync(join(annDir, id + '-nsrr.xml'), 'utf8'));
    s.id = id;
    return s;
  };
  const rows = [];
  let prev = null;
  const t0 = Date.now();
  for (let i = 0; i < order.length; i++) {
    const rec = load(order[i]);
    if (!rec.spanMs || rec.resp.length < 5) {
      prev = rec;
      continue;
    }
    const next = load(order[(i + 1) % order.length]);
    rows.push(measureRecord(EC, rec, next, opts));
    prev = rec;
    if ((i + 1) % 50 === 0) process.stderr.write('  ' + (i + 1) + '/' + order.length + ' · ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s\n');
  }
  void prev;
  const sum = summarise(rows);
  if (argv.includes('--json')) console.log(JSON.stringify({ opts, bands: BANDS, summary: sum, records: rows }, null, 1));
  else console.log(report(sum, opts));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));

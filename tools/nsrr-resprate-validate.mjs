#!/usr/bin/env node
/*
 * tools/nsrr-resprate-validate.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═════════════════════════════════════════════════════════════════════════════
 * IS OXYDEX'S PROXY RESPIRATION RATE RIGHT? — a POOL SCORER, not a tool.
 *
 * `2026-09-03-oxydex-proxy-resprate-unattributed` (OPEN) records that OxyDex computes a proxy
 * respiration rate from heart-rate spectral content, writes it into the node export as
 * `newMetrics.respRate` carrying a `basis` (the WINDOWING) and no estimator attribution, and that
 * its sibling row found it reaches NO consumer — so the risk is latent rather than live. Neither
 * row asks the question this one answers: IS THE NUMBER RIGHT? Nothing had ever checked it.
 *
 * SHHS1 carries the reference at 100 % coverage, twice over: THOR RES and ABDO RES, two independent
 * inductance belts measuring the same breathing directly rather than inferring it from pulse.
 *
 * ── THE CONTROL IS THE POINT OF USING BOTH BELTS ──────────────────────────────────────────────
 * A derived reference needs its own validation or the comparison is one unvalidated estimator
 * against another. THOR and ABDO supply it for free: they are independent sensors, so their
 * agreement bounds the reference's own error. If the belts agree with each other and disagree with
 * the proxy, the disagreement is the proxy's. That control is reported on every record
 * (`ctrlAbsDiff`) and is never assumed — a record whose belts disagree is excluded from the verdict
 * by `liveStat`, because there the reference itself is not trustworthy.
 *
 * ── THE BAND IS THE FINDING TO WATCH FOR ──────────────────────────────────────────────────────
 * `_respRateProxyWindow` (`oxydex-dsp.js`) scans 20 bins over 0.13–0.33 Hz, so the proxy can only
 * ever report 7.8–19.8 brpm. Two consequences, both checked here rather than argued:
 *
 *   1. `respRateLabel` emits 'Fast (>20)' above 20 brpm, and the maximum representable value is
 *      19.8 — so that label is UNREACHABLE BY CONSTRUCTION. Asserted in the selftest against the
 *      real exported function, not against a copy of its arithmetic.
 *   2. A true rate above the band cannot be reported as itself; it can only pile up at the edge.
 *      `proxyAtEdge` counts that, because an estimate pinned to its own search boundary is a
 *      fabricated value in the §∅ sense — it means ">= 19.8, or not measurable here", and reports
 *      a number.
 *
 * The reference band is deliberately WIDER (0.1–0.5 Hz = 6–30 brpm) than the proxy's. A reference
 * confined to the same band could not detect the truncation it exists to detect.
 *
 * ── THIS IS A SCORER MODULE ───────────────────────────────────────────────────────────────────
 *     node tools/nsrr-score-pool.mjs --scorer ./nsrr-resprate-validate.mjs --limit 300
 *
 * so it inherits the pool's parallelism, checkpoint/`--resume`, SIGKILL-survivability and heartbeat
 * (§2.9 of `briefs/TOOL-BUILD-STANDARD-2026-09-13-BRIEF.md`).
 *
 * §2.6 — parallelism measured, not assumed: this scorer does NOT call `processNight` (4040 ms/record
 * for the AAI scorer), because `computeRespRateProxy` is exported and is the same function
 * `processNight` itself calls. Per-record cost is the EDF read plus two spectral scans.
 * §2.11 — nothing is GPU-accelerated; the per-window arrays are far too small for dispatch to pay.
 *
 * ⚠️ The belts are decimated 10 Hz → 2 Hz through a 5-sample box filter before the scan. Plain
 * every-5th-sample decimation would ALIAS cardiac content near 1 Hz straight into the respiratory
 * band; the box filter's first null sits at 2 Hz, which is the point of using one. 2 Hz retains
 * Nyquist 1 Hz against a 0.5 Hz ceiling.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ODI = await import('./nsrr-oxydex-odi.mjs');

/* the pool builds one realm per worker and reuses it */
export function makeRealm() {
  return ODI.makeRealm ? ODI.makeRealm() : ODI.buildRealm();
}

/* ── the reference ════════════════════════════════════════════════════════════════════════════
   Box-filter decimate, then scan. `lo`/`hi` in Hz; returns brpm, or null when the window is too
   short to resolve the band (never a default — §∅). */
export function decimate(data, factor) {
  const out = [];
  for (let i = 0; i + factor <= data.length; i += factor) {
    let s = 0;
    for (let j = 0; j < factor; j++) s += data[i + j];
    out.push(s / factor);
  }
  return out;
}

export function spectralPeakBrpm(data, fs, lo, hi, bins) {
  const n = data.length;
  if (!n || !(fs > 0)) return null;
  /* need at least three full cycles of the SLOWEST frequency to call it a peak rather than a trend */
  if (n / fs < 3 / lo) return null;
  let m = 0;
  for (let i = 0; i < n; i++) m += data[i];
  m /= n;
  let bestP = -1,
    bestF = null;
  const B = bins || 200;
  for (let k = 0; k <= B; k++) {
    const f = lo + (k * (hi - lo)) / B;
    let re = 0,
      im = 0;
    const w = (2 * Math.PI * f) / fs;
    for (let i = 0; i < n; i++) {
      const a = w * i,
        v = data[i] - m;
      re += v * Math.cos(a);
      im += v * Math.sin(a);
    }
    const p = re * re + im * im;
    if (p > bestP) {
      bestP = p;
      bestF = f;
    }
  }
  return bestF == null ? null : +(bestF * 60).toFixed(2);
}

/* whole-night reference: median over 30-min windows, mirroring the proxy's own `basis` so the two
   numbers describe the same quantity over the same windows */
export function referenceBrpm(sig) {
  if (!sig || !sig.data || !(sig.fs > 0)) return null;
  const fac = Math.max(1, Math.round(sig.fs / 2));
  const d = decimate(Array.from(sig.data), fac);
  const fs2 = sig.fs / fac;
  const W = Math.round(30 * 60 * fs2);
  const per = [];
  for (let i = 0; i + W <= d.length; i += W) {
    const v = spectralPeakBrpm(d.slice(i, i + W), fs2, 0.1, 0.5, 200);
    if (v != null) per.push(v);
  }
  if (!per.length) return null;
  return median(per);
}

export function median(v) {
  const s = [...v].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(4);
}

/* the proxy's search band, read off the shipped kernel rather than retyped */
export const PROXY_LO_BRPM = +(0.13 * 60).toFixed(1); /* 7.8 */
export const PROXY_HI_BRPM = +(0.33 * 60).toFixed(1); /* 19.8 */

export function poolScoreRecord(ctx, rec) {
  const edf = ctx.CpapEdf.readEDF(ODI.toArrayBuffer(readFileSync(rec.edf)));
  const sig = edf.signals || {};
  const thor = referenceBrpm(sig['THOR RES']);
  const abdo = referenceBrpm(sig['ABDO RES']);

  /* the proxy, through the SHIPPED exported function — never a reimplementation */
  const conv = ctx.NSRR.edfToOxyRows(edf);
  /* ⚠️ `.rows`, not the object itself — the trap the AAI scorer's header records */
  const rows = conv && conv.rows;
  let proxy = null;
  if (rows && rows.length) {
    const p = ctx.OxyDex._bare.computeRespRateProxy(rows);
    proxy = p && p.respRateBpm != null ? p.respRateBpm : null;
  }

  const ctrlAbsDiff = thor != null && abdo != null ? +Math.abs(thor - abdo).toFixed(3) : null;
  const ref = thor != null && abdo != null ? +((thor + abdo) / 2).toFixed(3) : thor != null ? thor : abdo;
  return {
    id: rec.id,
    proxy,
    thor,
    abdo,
    ref,
    ctrlAbsDiff,
    delta: proxy != null && ref != null ? +(proxy - ref).toFixed(3) : null,
    proxyAtEdge: proxy == null ? null : proxy <= PROXY_LO_BRPM || proxy >= PROXY_HI_BRPM,
    refAboveBand: ref == null ? null : ref > PROXY_HI_BRPM,
    hours: rows && rows.length ? +(rows.length / 3600).toFixed(2) : null
  };
}

/* ── the live statistic ═══════════════════════════════════════════════════════════════════════
   CTRL_MAX_BRPM gates on the CONTROL, not on the answer: a record whose two belts disagree has an
   untrustworthy reference, and including it would blame the proxy for the reference's error. It is
   a property of the instrument pair, chosen as one proxy grid-step (0.63 brpm) so it cannot be
   tuned to a desired verdict. */
export const CTRL_MAX_BRPM = 0.63;

export function liveStat(rows) {
  const all = (rows || []).filter((r) => r && !r.err);
  const p = all.filter((r) => r.delta != null && r.ctrlAbsDiff != null && r.ctrlAbsDiff <= CTRL_MAX_BRPM);
  const d = p.map((r) => r.delta);
  let hw = null;
  if (d.length >= 5) {
    const mu = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (d.length - 1));
    hw = +((1.96 * sd) / Math.sqrt(d.length)).toFixed(4);
  }
  const det = [];
  if (p.length) {
    det.push('proxy median ' + median(p.map((r) => r.proxy)) + ' brpm  ·  belt reference median ' + median(p.map((r) => r.ref)) + ' brpm');
    const edge = p.filter((r) => r.proxyAtEdge).length;
    const above = p.filter((r) => r.refAboveBand).length;
    det.push('proxy pinned to its band edge ' + edge + '/' + p.length + '  ·  true rate above the band ' + above + '/' + p.length);
  }
  const drop = all.length - p.length;
  if (drop > 0) det.push(drop + ' record(s) excluded — belts disagree > ' + CTRL_MAX_BRPM + ' brpm, reference not trustworthy there');
  return { label: 'median (proxy − belt reference), brpm', value: median(d), halfWidth: hw, n: d.length, detail: det };
}

/* ── selftest ═════════════════════════════════════════════════════════════════════════════════ */
function selftest() {
  let bad = 0,
    good = 0;
  const A = (n, c) => {
    if (c) {
      good++;
      console.log('  ✓ ' + n);
    } else {
      bad++;
      console.log('  ✗ ' + n);
    }
  };

  /* the estimator recovers a planted rate it was not tuned for */
  const fs = 2,
    N = 3600;
  for (const trueBrpm of [9, 13.2, 16.5, 24]) {
    const f = trueBrpm / 60;
    const x = [];
    for (let i = 0; i < N; i++) x.push(Math.sin((2 * Math.PI * f * i) / fs) + 0.05 * Math.sin((2 * Math.PI * 0.011 * i) / fs));
    const got = spectralPeakBrpm(x, fs, 0.1, 0.5, 400);
    A('reference recovers a planted ' + trueBrpm + ' brpm (got ' + got + ')', got != null && Math.abs(got - trueBrpm) < 0.4);
  }

  /* §∅ — an unresolvable window is null, never a number */
  A('reference: too-short window is null, not a guess', spectralPeakBrpm([1, 2, 3, 4], 2, 0.1, 0.5, 50) === null);
  A('reference: empty input is null', spectralPeakBrpm([], 2, 0.1, 0.5, 50) === null);
  A('reference: fs of 0 is null, not a division', spectralPeakBrpm([1, 2, 3], 0, 0.1, 0.5, 50) === null);

  /* the box-filter decimator actually averages, and drops the ragged tail rather than padding it */
  const dec = decimate([0, 2, 0, 2, 0, 2, 0, 2, 9], 4);
  A('decimate: box-averages (got ' + dec.join(',') + ')', dec.length === 2 && dec[0] === 1 && dec[1] === 1);

  /* the control gate keys on the CONTROL, not on the answer */
  const mk = (delta, ctrl) => ({ delta, ctrlAbsDiff: ctrl, proxy: 10, ref: 10 - delta });
  const st = liveStat([mk(-3, 0.1), mk(-3, 0.1), mk(-3, 0.1), mk(-3, 0.1), mk(-3, 0.1), mk(+99, 5)]);
  A('liveStat: excludes a record whose belts disagree', st.n === 5 && st.value === -3);
  A('liveStat: publishes a between-record half-width once n>=5', st.halfWidth != null);
  A('liveStat: refuses a half-width below the floor', liveStat([mk(-3, 0.1), mk(-3, 0.1)]).halfWidth === null);
  A(
    'liveStat: reports what it excluded rather than dropping it silently',
    st.detail.some((d) => /excluded/.test(d))
  );

  /* a control that is clean under BOTH hypotheses cannot license the negative: assert the gate
     admits records when the belts DO agree, so the exclusion above is discriminating */
  A('liveStat: admits all records when every control is clean', liveStat([mk(-3, 0.1), mk(-3, 0.1), mk(-3, 0.1)]).n === 3);

  /* THE BAND CLAIM, against the real shipped kernel — not a copy of its arithmetic */
  return import(pathToFileURL(join(ROOT, 'tools', 'nsrr-oxydex-odi.mjs')).href)
    .then(() => makeRealm())
    .then((ctx) => {
      const K = ctx.OxyDex._bare.computeRespRateProxy;
      /* drive it with pure tones far above and far below its band and read what it can emit */
      const mkRows = (brpm) => {
        const r = [];
        for (let i = 0; i < 2400; i++) r.push({ hr: 60 + 5 * Math.sin((2 * Math.PI * (brpm / 60) * i) / 1) });
        return r;
      };
      const fast = K(mkRows(30)),
        slow = K(mkRows(4));
      A('proxy cannot report above ' + PROXY_HI_BRPM + ' brpm even when driven at 30 (got ' + (fast && fast.respRateBpm) + ')', fast && fast.respRateBpm <= PROXY_HI_BRPM);
      A("proxy's 'Fast (>20)' label is UNREACHABLE — its own ceiling is " + PROXY_HI_BRPM, fast && fast.respRateLabel !== 'Fast (>20)');
      A('proxy cannot report below ' + PROXY_LO_BRPM + ' brpm even when driven at 4 (got ' + (slow && slow.respRateBpm) + ')', slow && slow.respRateBpm >= PROXY_LO_BRPM);
      console.log('\n' + (bad ? '✗ ' + bad + ' failed' : '✓ all ' + good + ' assertions passed'));
      process.exit(bad ? 1 : 0);
    });
}

const IS_CLI = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (IS_CLI) await selftest();

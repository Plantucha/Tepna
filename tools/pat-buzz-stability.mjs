#!/usr/bin/env node
/*
 * tools/pat-buzz-stability.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * DRIFT OR NOISE? — decompose a buzz sequence's per-event timing offsets into the two components the
 * ΔPAT dip index cares about, on the captures that already exist.
 *
 * REPURPOSED 2026-08-20. The first version of this tool was an acquisition instrument waiting for a
 * cross-device capture; the capture had already been made and analysed (O2RING-BUZZ-FIDUCIAL §5:
 * ring→H10 5/5, matched-filter SE 19.1 ms) by `buzz-onset-extract.mjs`, whose primitives this tool now
 * imports instead of duplicating. What nobody had computed is the DECOMPOSITION: §5b's per-event SD
 * (42.8 ms) is one number for two different worlds —
 *   · WHITE estimator noise (rise-shape, 20 ms ACC quantum): averages away under the dip index's
 *     rolling-median detrend; the ~15 ms arousal dip survives.
 *   · WITHIN-CONNECTION DRIFT (the offset moving between events): does NOT average away; at the
 *     20 s–3 min scale it is exactly the defect pat-align.js:335 assumes absent, and would swamp a dip.
 * The discriminators, per event series (t = command instant, off = per-event offset):
 *   · OLS slope with SE → drift rate (ms/min) and its significance;
 *   · von Neumann ratio VN = mean(Δoff²)/var(off) → ≈2 for white noise, ≪2 for a trend;
 *   · residual SD about the fit → the noise floor after removing any linear drift.
 * PRE-STATED bands (set before running on real data, per the house rule): over a 60 s dip window,
 * |drift| ≤ 5 ms → CLEAN · ≤ 15 ms → MARGINAL · > 15 ms → SWAMPED (15 ms = the Pitson arousal dip the
 * index must resolve). n < 3 events → null (two points cannot separate a trend from scatter).
 *
 * Event sources (either):
 *   --cmds HH:MM:SS.mmm,...  --a <ACC|PPG2W>            → cmd→device latency series (single-device leg)
 *   --cmds ...  --a <ACC> --b <ACC|PPG2W>               → device↔device offset series (cross-device leg)
 * Per-event offsets come from buzz-onset-extract's xcorr on a ±window around each command (matched
 * filter — the estimator §5b showed beats the threshold detector 2–3×).
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';
import { loadStream, hfEnergy, resample, xcorrLag, secOfDay } from './buzz-onset-extract.mjs';

const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};

/** Per-event offsets, TIME KEPT (unlike xcorrAnalyze's bare list — a drift fit needs (t, off) pairs).
 *  For each command: xcorr the two signals' HF-energy in [c−0.5, c+2.5] (or the template for a single
 *  leg). Low-confidence events (r < rMin, or no lag) are dropped WITH a reason count — never silently.
 *  PURE over its inputs. */
export function perEventSeries(sigA, sigB, cmds, { fs: fsr = 100, rMin = 0.3 } = {}) {
  const events = [];
  const dropped = { lowR: 0, noLag: 0 };
  for (const c of cmds) {
    const e0 = c - 0.5,
      e1 = c + 2.5;
    let lag, r;
    if (sigB) {
      const ga = resample(sigA, e0, e1, fsr);
      const gb = resample(sigB, e0, e1, fsr);
      const x = xcorrLag(ga, gb, fsr, 1.5);
      lag = x.lagS;
      r = x.r;
    } else {
      // single leg: xcorr the device energy against a boxcar burst template at the command
      const ga = resample(sigA, e0, e1, fsr);
      const template = [];
      for (let t = e0; t <= e1; t += 1 / fsr) template.push(t >= c && t < c + 1.1 ? 1 : 0);
      const x = xcorrLag(template, ga, fsr, 1.5);
      lag = x.lagS;
      r = x.r;
    }
    if (lag == null) {
      dropped.noLag++;
      continue;
    }
    if (r != null && r < rMin) {
      dropped.lowR++;
      continue;
    }
    events.push({ t: c, offS: lag, r });
  }
  return { events, dropped };
}

/** OLS drift + noise decomposition of (t, offS) events. PURE. null when n < 3 — two points cannot
 *  separate a trend from scatter, and reporting one anyway would be a level dressed as a stability. */
export function driftDecompose(events) {
  const n = events.length;
  if (n < 3) return null;
  const t0 = events[0].t;
  const xs = events.map((e) => e.t - t0);
  const ys = events.map((e) => e.offS);
  const mx = xs.reduce((p, c) => p + c, 0) / n;
  const my = ys.reduce((p, c) => p + c, 0) / n;
  let sxx = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  const slope = sxx > 0 ? sxy / sxx : 0; // s of offset per s of time
  const resid = ys.map((y, i) => y - (my + slope * (xs[i] - mx)));
  const residVar = resid.reduce((p, c) => p + c * c, 0) / (n - 2);
  const slopeSE = sxx > 0 ? Math.sqrt(residVar / sxx) : null;
  const rawVar = ys.reduce((p, c) => p + (c - my) ** 2, 0) / (n - 1);
  // von Neumann ratio: successive squared diffs over variance — ≈2 white, ≪2 trending
  let ssd = 0;
  for (let i = 1; i < n; i++) ssd += (ys[i] - ys[i - 1]) ** 2;
  const vn = rawVar > 0 ? ssd / (n - 1) / rawVar : null;
  return {
    n,
    spanS: xs[n - 1],
    slopeMsPerMin: slope * 1000 * 60,
    slopeSEMsPerMin: slopeSE != null ? slopeSE * 1000 * 60 : null,
    rawSdMs: Math.sqrt(rawVar) * 1000,
    residSdMs: Math.sqrt(residVar) * 1000,
    vonNeumann: vn
  };
}

/** The verdict against the dip index's budget. PRE-STATED bands over a 60 s dip window:
 *  |drift| ≤ 5 ms CLEAN · ≤ 15 ms MARGINAL · > 15 ms SWAMPED. Drift is only CHARGED when the slope is
 *  resolved (|slope| > 2·SE); an unresolved slope reports the upper bound |slope|+2SE honestly instead
 *  of pretending zero. PURE. */
export function dipHeadroom(dec, { dipMs = 15, windowS = 60 } = {}) {
  if (!dec) return null;
  const resolved = dec.slopeSEMsPerMin != null && Math.abs(dec.slopeMsPerMin) > 2 * dec.slopeSEMsPerMin;
  const chargeMsPerMin = resolved ? Math.abs(dec.slopeMsPerMin) : Math.abs(dec.slopeMsPerMin) + 2 * (dec.slopeSEMsPerMin ?? 0);
  const drift60 = chargeMsPerMin * (windowS / 60);
  const verdict = drift60 <= 5 ? 'CLEAN' : drift60 <= dipMs ? 'MARGINAL' : 'SWAMPED';
  return { drift60Ms: drift60, driftResolved: resolved, verdict, dipMs, windowS };
}

/** The capture-protocol prescription: the span a buzz sequence needs before its slope SE can bound
 *  drift at the dip budget. From SE_slope = sigma/sqrt(Sxx) and Sxx ~ (n/12)*T^2 for n fires spread
 *  evenly over T: solving SE_slope*window <= budget/2 (2-sigma bound) gives T. PURE. Says what the
 *  16-29 s bursts could not: how long the NEXT sequence must be for the same hardware to answer. */
export function requiredSpanS(sigmaMs, n, { dipMs = 15, windowS = 60 } = {}) {
  if (!(sigmaMs > 0) || !(n >= 3)) return null;
  const seBudgetMsPerS = dipMs / 2 / windowS; // 2*SE*window = dipMs at the bound
  const sqrtSxx = sigmaMs / seBudgetMsPerS; // seconds
  return sqrtSxx / Math.sqrt(n / 12);
}

function selftest() {
  let pass = 0,
    fail = 0;
  const ok = (nm, c, d = '') => {
    c ? (pass++, console.log(`  ok   ${nm}`)) : (fail++, console.log(`  FAIL ${nm}${d ? ' — ' + d : ''}`));
  };

  // WHITE noise: offsets scatter with no trend → VN ≈ 2, slope unresolved, drift charge = 2SE bound
  const tset = [0, 6, 8, 13, 16, 23, 27, 29, 36, 40];
  const white = tset.map((t, i) => ({ t, offS: 0.1 + [3, -2, 1, -4, 2, 0, -1, 4, -3, 1][i] * 0.01 }));
  const dw = driftDecompose(white);
  ok('white: slope unresolved', Math.abs(dw.slopeMsPerMin) < 2 * dw.slopeSEMsPerMin, JSON.stringify(dw));
  ok('white: von Neumann near 2', dw.vonNeumann > 1.2, `VN=${dw.vonNeumann?.toFixed(2)}`);
  ok('white: residual ≈ raw SD', Math.abs(dw.residSdMs - dw.rawSdMs) < 0.35 * dw.rawSdMs, `${dw.residSdMs?.toFixed(1)} vs ${dw.rawSdMs?.toFixed(1)}`);

  // DRIFT: a 60 ms/min ramp with small noise → slope recovered, VN small, verdict SWAMPED
  const ramp = tset.map((t, i) => ({ t, offS: 0.1 + t * 0.001 + [1, -1, 0, 1, -1, 0, 1, -1, 0, 1][i] * 0.002 }));
  const dr = driftDecompose(ramp);
  ok('ramp: slope recovered ~60 ms/min', Math.abs(dr.slopeMsPerMin - 60) < 10, `${dr.slopeMsPerMin?.toFixed(1)}`);
  ok('ramp: von Neumann far below 2', dr.vonNeumann < 0.8, `VN=${dr.vonNeumann?.toFixed(2)}`);
  ok('ramp: verdict SWAMPED', dipHeadroom(dr).verdict === 'SWAMPED', JSON.stringify(dipHeadroom(dr)));
  ok('white: verdict not SWAMPED by an unresolved slope alone', dipHeadroom(dw).verdict !== 'SWAMPED' || dipHeadroom(dw).drift60Ms > 15, JSON.stringify(dipHeadroom(dw)));

  // n guard
  ok(
    'n=2 → null',
    driftDecompose([
      { t: 0, offS: 0.1 },
      { t: 5, offS: 0.12 }
    ]) === null
  );
  ok('headroom(null) → null', dipHeadroom(null) === null);

  // per-event series on synthetic streams: B lags A by a KNOWN per-event schedule; times kept
  const cmds = [10, 16, 18, 23, 26];
  const offs = [0.1, 0.1, 0.1, 0.1, 0.1];
  const mk = (delay) => {
    const sig = [];
    for (let t = 5; t < 32; t += 0.02) {
      let v = 0;
      cmds.forEach((c, i) => {
        const s = c + (delay ? offs[i] : 0) + 0.12;
        if (t >= s && t < s + 1.1) v = 20 + (((t * 50) | 0) % 2); // vibration texture so hfEnergy sees it
      });
      sig.push({ t, v });
    }
    return sig;
  };
  const A = hfEnergy(mk(false));
  const B = hfEnergy(mk(true));
  const { events, dropped } = perEventSeries(A, B, cmds);
  ok('per-event: all commands paired, times kept', events.length === 5 && events.every((e, i) => e.t === cmds[i]), JSON.stringify({ n: events.length, dropped }));
  ok(
    'per-event: the planted 100 ms offset is recovered',
    events.every((e) => Math.abs(e.offS - 0.1) < 0.04),
    events.map((e) => e.offS.toFixed(3)).join(',')
  );

  // one device silent → all events dropped with a REASON, never a fake series
  const flat = A.map((r) => ({ t: r.t, v: 0 }));
  const sil = perEventSeries(A, flat, cmds);
  ok('silent device → 0 events, reasons counted', sil.events.length === 0 && sil.dropped.noLag + sil.dropped.lowR === 5, JSON.stringify(sil.dropped));

  // required-span prescription: with 50 ms noise and 10 fires, ~7-8 min is needed; more fires shrink it
  const rs = requiredSpanS(50, 10);
  ok('required span ~7-8 min for sigma=50, n=10', rs > 380 && rs < 480, `${rs?.toFixed(0)}s`);
  ok('more fires shrink the required span', requiredSpanS(50, 40) < rs);
  ok('required span guards its inputs', requiredSpanS(0, 10) === null && requiredSpanS(50, 2) === null);

  console.log(fail ? `\n${fail} FAILURE(S)` : `\n${pass} assertions — all green`);
  return fail ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  const cmdsRaw = arg('--cmds');
  const aP = arg('--a');
  if (!cmdsRaw || !aP) {
    console.log('usage: --cmds HH:MM:SS.mmm,... --a <ACC|PPG2W> [--b <ACC|PPG2W>] [--rmin 0.3]');
    process.exit(2);
  }
  const cmds = cmdsRaw.split(',').map((s) => secOfDay(s.trim()));
  if (cmds.some((c) => c == null)) {
    console.log('unparseable command stamp');
    process.exit(2);
  }
  const cols = (p) => (/PPG2W/i.test(p) ? [4] : [2, 3, 4]);
  const sigA = hfEnergy(loadStream(aP, cols(aP)));
  const bP = arg('--b');
  const sigB = bP ? hfEnergy(loadStream(bP, cols(bP))) : null;
  const rMin = Number(arg('--rmin') || 0.3);
  const { events, dropped } = perEventSeries(sigA, sigB, cmds, { rMin });
  console.log(`  ${cmds.length} commands → ${events.length} usable event(s) (dropped: lowR ${dropped.lowR}, noLag ${dropped.noLag})`);
  if (events.length) console.log(`  offsets (ms): ${events.map((e) => (e.offS * 1000).toFixed(0)).join(', ')}`);
  const dec = driftDecompose(events);
  if (!dec) {
    console.log('  ✗ fewer than 3 usable events — drift and noise cannot be separated. Not a pass.');
    process.exit(1);
  }
  console.log(`  span ${dec.spanS.toFixed(1)} s · raw SD ${dec.rawSdMs.toFixed(1)} ms`);
  console.log(`  DRIFT  : ${dec.slopeMsPerMin.toFixed(1)} ± ${dec.slopeSEMsPerMin?.toFixed(1)} ms/min (von Neumann ${dec.vonNeumann?.toFixed(2)} — ≈2 white, ≪2 trend)`);
  console.log(`  NOISE  : ${dec.residSdMs.toFixed(1)} ms residual SD about the fit`);
  const h = dipHeadroom(dec);
  console.log(`  DIP HEADROOM (60 s window, 15 ms budget): drift charge ${h.drift60Ms.toFixed(1)} ms${h.driftResolved ? '' : ' (UNRESOLVED slope — charged at |slope|+2SE)'} → ${h.verdict}`);
  if (!h.driftResolved) {
    const need = requiredSpanS(dec.residSdMs, dec.n);
    if (need != null)
      console.log(
        `  → to BOUND drift at the 15 ms budget with this noise (${dec.residSdMs.toFixed(0)} ms, n=${dec.n}): spread the fires over ~${(need / 60).toFixed(1)} min (this sequence spanned ${(dec.spanS / 60).toFixed(1)} min)`
      );
  }
}

#!/usr/bin/env node
/*
 * tools/ppg2w-rate.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * MEASURE THE O2RING ppg2w SAMPLE RATE against the calibrated 125 Hz pleth.
 *
 * WHY. `_PPG.txt` (single-channel, MEASURED 125 Hz — O2RING-FRAME-SAMPLE-LOCK) and `_PPG2W.txt` (raw
 * dual-wavelength, cmd 0x05) are the SAME finger, SAME session. The pleth's rate is known; ppg2w's is an
 * explicit UNKNOWN (capture.py stamps its rows at buffer-span/record-count because "no rate is known",
 * sensor_ns is 0). Both cover the same wall-clock span, so the rate falls out of a COVERAGE-CALIBRATED
 * count — gap-immune, no waveform assumption:
 *
 *   coverage = (pleth samples) / (125 Hz * pleth host-span)     ← how much of the night actually landed
 *   fs_ppg2w = (ppg2w samples) / (ppg2w host-span * coverage)   ← same coverage, applied to ppg2w
 *
 * Coverage cancels the shared gap structure that a bare samples/span would mistake for a lower rate; the
 * pleth's own count vs its KNOWN rate is what measures that coverage. A RULER, not a clock: it transfers
 * the pleth's timebase onto ppg2w and adds no new timing to the system — but it retires the rate unknown
 * (and hence the SpO2-trend prerequisite) with zero hardware.
 *
 * ⚠ An earlier draft cross-correlated the pulse waveforms and returned 7 Hz against a ~100 Hz direct
 * count — the autocorrelation locked on a harmonic, and it needed a bandpass the fs-unknown made
 * un-settable. The ratio has no such failure mode: it does not care what the samples MEAN.
 *
 * Usage: node tools/ppg2w-rate.mjs --pleth <_PPG.txt> --ppg2w <_PPG2W.txt>
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';

const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};

// count data rows and host-stamp span (seconds) — one pass, no waveform kept.
export function countAndSpan(path) {
  const t = fs.readFileSync(path, 'utf8');
  let n = 0,
    t0 = null,
    t1 = null,
    i = 0;
  while (i < t.length) {
    let j = t.indexOf('\n', i);
    if (j < 0) j = t.length;
    const ln = t.slice(i, j);
    i = j + 1;
    if (!ln || ln[0] === '#' || ln[0] === 'P') continue;
    const semi = ln.indexOf(';');
    if (semi < 0) continue;
    n++;
    const ms = Date.parse(ln.slice(0, semi) + 'Z');
    if (Number.isFinite(ms)) {
      if (t0 === null) t0 = ms;
      t1 = ms;
    }
  }
  return { n, spanS: t0 !== null ? (t1 - t0) / 1000 : null };
}

// PURE, exported for the gate.
export function rateFromRatio(plethN, plethSpanS, p2wN, p2wSpanS, fsPleth) {
  if (!(plethN > 0 && plethSpanS > 0 && p2wN > 0 && p2wSpanS > 0 && fsPleth > 0)) return null;
  const coverage = plethN / (fsPleth * plethSpanS);
  const fsW = p2wN / (p2wSpanS * coverage);
  return { coverage, fsW, fsRaw: p2wN / p2wSpanS };
}

function selftest() {
  let pass = 0,
    fail = 0;
  const ok = (n, c, d = '') => {
    if (c) {
      pass++;
      console.log(`  ok   ${n}`);
    } else {
      fail++;
      console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`);
    }
  };
  // coverage exactly cancels a shared gap: pleth 99% of 125*span, ppg2w 99% of X*span → X recovered.
  const span = 26000,
    cov = 0.994,
    fsTrue = 100;
  const r = rateFromRatio(Math.round(125 * span * cov), span, Math.round(fsTrue * span * cov), span, 125);
  ok('coverage cancels the shared gap → true rate recovered', Math.abs(r.fsW - fsTrue) < 0.5, `got ${r.fsW}`);
  ok('coverage is measured, not assumed', Math.abs(r.coverage - cov) < 0.001, `got ${r.coverage}`);
  // a DIFFERENT true rate is recovered, so it is not hard-coded to 100
  const r2 = rateFromRatio(Math.round(125 * span * cov), span, Math.round(130 * span * cov), span, 125);
  ok('a 130 Hz stream reads 130, not 100', Math.abs(r2.fsW - 130) < 0.5, `got ${r2.fsW}`);
  // full coverage: raw == calibrated
  const r3 = rateFromRatio(125 * span, span, 100 * span, span, 125);
  ok('at 100% coverage raw == calibrated', Math.abs(r3.fsW - r3.fsRaw) < 1e-6);
  // refuse on bad input rather than return NaN
  ok('zero span refuses', rateFromRatio(1, 0, 1, 1, 125) === null);
  ok('zero fsPleth refuses', rateFromRatio(1, 1, 1, 1, 0) === null);
  console.log(fail ? `\n${fail} FAILURE(S)` : '\nall green');
  return fail ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  const FS_PLETH = 125.0;
  const pl = arg('--pleth'),
    pw = arg('--ppg2w');
  if (!pl || !pw) {
    console.log('usage: --pleth <_PPG.txt> --ppg2w <_PPG2W.txt>');
    process.exit(2);
  }
  const P = countAndSpan(pl),
    W = countAndSpan(pw);
  console.log(`  pleth : ${P.n} samples over ${P.spanS?.toFixed(0)} s  (raw ${(P.n / P.spanS).toFixed(1)} Hz vs KNOWN ${FS_PLETH})`);
  console.log(`  ppg2w : ${W.n} samples over ${W.spanS?.toFixed(0)} s  (raw ${(W.n / W.spanS).toFixed(1)} Hz — uncalibrated)`);
  const r = rateFromRatio(P.n, P.spanS, W.n, W.spanS, FS_PLETH);
  if (!r) {
    console.log('  insufficient data');
    process.exit(1);
  }
  console.log(`\n  coverage (from pleth vs its known rate): ${(r.coverage * 100).toFixed(1)}%`);
  console.log(`  ppg2w SAMPLE RATE = ${r.fsW.toFixed(2)} Hz  (nearest round: ${Math.round(r.fsW)} Hz, residual ${((100 * Math.abs(r.fsW - Math.round(r.fsW))) / Math.round(r.fsW)).toFixed(1)}%)`);
}

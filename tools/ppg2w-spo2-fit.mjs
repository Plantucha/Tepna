#!/usr/bin/env node
/*
 * tools/ppg2w-spo2-fit.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * DOES THE 0x05 TWO-CHANNEL RATIO TRACK THE DEVICE'S OWN SpO₂? — the FUNCTIONAL red+IR test.
 *
 * The channel-identity question (O2RING-RAW-DUAL-WAVELENGTH §1.2④) was withdrawn on evidence this
 * corpus later invalidated: the "no cardiac periodicity" refutation ran on gap-spliced SATURATED
 * buffers (99.3 % pinned at the 102-record reply cap — a phase jump every ~1 s destroys long-range
 * autocorrelation by construction), and its within-buffer leg used a 0.82 s window that cannot hold a
 * 0.91 s beat. This tool runs the test the withdrawal could not: per-buffer ratio-of-ratios
 * R = (AC/DC)_ch0 / (AC/DC)_ch1, 15 s median-binned, per-session normalised (each session's optical
 * geometry sets its own R baseline), fitted against the device's host-stamped 1 Hz SpO₂ — pooled
 * across EVERY session in the corpus, with per-session r and leave-one-session-out so no single
 * night can drive the verdict.
 *
 * Measured 2026-08-20 (15 sessions, 10,314 bins): pooled r = 0.520, per-session r positive 14/15,
 * MONOTONIC dose–response (SpO₂ <92 % → Rn 0.834 · 92–94 % → 0.922 · ≥96 % → 1.005), LOO r
 * 0.487–0.542. Sign ⇒ functionally ch0 = IR, ch1 = RED (classical R_red/ir rises as SpO₂ falls; this
 * ratio falls). Functional evidence, NOT spectral proof — the sunlight experiment remains the
 * assignment's confirmation, and the per-device fit is not a calibration curve.
 *
 * Usage: node tools/ppg2w-spo2-fit.mjs <captures-root> [--bin 15] [--min-bins 20]
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 ? +argv[i + 1] : d;
};

export function parseHostS(s) {
  const m = /(\d{2}):(\d{2}):(\d{2})\.(\d{3})/.exec(s || '');
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : null;
}

export function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : null;
}

export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 8) return null;
  const mx = xs.reduce((p, c) => p + c, 0) / n;
  const my = ys.reduce((p, c) => p + c, 0) / n;
  let sxx = 0,
    syy = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null; // zero-variance → null, never NaN
}

/** Per-buffer {AC, DC} of one channel: linear-detrended peak-to-peak over the buffer, |mean| DC.
 *  Crude by design — it is the SAME estimator the 2026-08-20 measurement used; sharpening it is
 *  #1596-data work (unsaturated contiguous buffers), not a re-tune of this record. PURE. */
export function acdc(vals) {
  const n = vals.length;
  const m = vals.reduce((p, c) => p + c, 0) / n;
  const mx = (n - 1) / 2;
  let sxx = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (i - mx) ** 2;
    sxy += (i - mx) * (vals[i] - m);
  }
  const sl = sxx > 0 ? sxy / sxx : 0;
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 2; i < n - 2; i++) {
    const v = vals[i] - m - sl * (i - mx);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { ac: hi - lo, dc: Math.abs(m) };
}

/** One session → 15 s bins of {R (ratio-of-ratios), s (device SpO₂)}, or null when the pair is
 *  unusable. Buffers are split at re-anchor jumps (|Δ − modal| ≥ 3 ms); bins need ≥8 buffer-points. */
export function sessionBins(ppg2wPath, spo2Path, { binS = 15, minSamples = 5000 } = {}) {
  let L;
  try {
    L = fs.readFileSync(ppg2wPath, 'utf8').trim().split('\n').slice(1);
  } catch {
    return null;
  }
  const rows = [];
  for (const l of L) {
    const p = l.split(';');
    const t = parseHostS(p[0]);
    const a = +p[2],
      b = +p[3];
    if (t != null && Number.isFinite(a) && Number.isFinite(b)) rows.push({ t, a, b });
  }
  if (rows.length < minSamples) return null;
  const sp = {};
  try {
    for (const l of fs.readFileSync(spo2Path, 'utf8').trim().split('\n').slice(1)) {
      const p = l.split(',');
      const m = /^(\d{2}):(\d{2}):(\d{2})/.exec(p[0]);
      if (!m) continue;
      const v = +p[1];
      if (v >= 60 && v <= 100) sp[+m[1] * 3600 + +m[2] * 60 + +m[3]] = v;
    }
  } catch {
    return null;
  }
  const d = [];
  for (let i = 1; i < rows.length; i++) d.push((rows[i].t - rows[i - 1].t) * 1000);
  const hist = {};
  d.forEach((x) => {
    const k = Math.round(x);
    hist[k] = (hist[k] || 0) + 1;
  });
  const ent = Object.entries(hist).sort((a, b) => b[1] - a[1]);
  if (!ent.length) return null;
  const modal = +ent[0][0];
  const pts = [];
  let s0 = 0;
  const flush = (b) => {
    if (b.length < 90) return;
    const A = acdc(b.map((r) => r.a));
    const B = acdc(b.map((r) => r.b));
    if (A.dc < 1 || B.dc < 1 || A.ac <= 0 || B.ac <= 0) return;
    const R = A.ac / A.dc / (B.ac / B.dc);
    const tm = b[(b.length / 2) | 0].t | 0;
    const s = sp[tm] ?? sp[tm - 1] ?? sp[tm + 1];
    if (s != null && Number.isFinite(R) && R > 0) pts.push({ t: tm, R, s });
  };
  for (let i = 0; i < d.length; i++) {
    if (Math.abs(d[i] - modal) >= 3) {
      flush(rows.slice(s0, i + 1));
      s0 = i + 1;
    }
  }
  flush(rows.slice(s0));
  const bins = {};
  for (const p of pts) {
    const k = (p.t / binS) | 0;
    if (!bins[k]) bins[k] = { R: [], s: [] };
    bins[k].R.push(p.R);
    bins[k].s.push(p.s);
  }
  return Object.values(bins)
    .filter((b) => b.R.length >= 8)
    .map((b) => ({ R: median(b.R), s: median(b.s) }));
}

/** The pooled verdict over per-session bin sets: normalise R by each session's median, pool, and
 *  report pooled r + the dose–response medians + leave-one-session-out extremes. PURE. */
export function pooledFit(sessions) {
  const all = [];
  const per = [];
  for (const { name, bins } of sessions) {
    if (!bins || bins.length < 20) continue;
    const Rm = median(bins.map((b) => b.R));
    const r = pearson(
      bins.map((b) => b.R),
      bins.map((b) => b.s)
    );
    per.push({ name, n: bins.length, r });
    for (const b of bins) all.push({ name, Rn: b.R / Rm, s: b.s });
  }
  if (all.length < 100) return null;
  const rPool = pearson(
    all.map((a) => a.Rn),
    all.map((a) => a.s)
  );
  const band = (lo, hi) => median(all.filter((a) => a.s >= lo && a.s < hi).map((a) => a.Rn));
  const loo = per
    .map((p) => {
      const rest = all.filter((a) => a.name !== p.name);
      return pearson(
        rest.map((a) => a.Rn),
        rest.map((a) => a.s)
      );
    })
    .filter((x) => x != null);
  return {
    sessions: per,
    bins: all.length,
    rPooled: rPool,
    dose: { low: band(0, 92), mid: band(92, 95), high: band(96, 101) },
    looMin: Math.min(...loo),
    looMax: Math.max(...loo)
  };
}

function selftest() {
  let pass = 0,
    fail = 0;
  const ok = (nm, c, d = '') => {
    c ? (pass++, console.log(`  ok   ${nm}`)) : (fail++, console.log(`  FAIL ${nm}${d ? ' — ' + d : ''}`));
  };
  ok('pearson collinear → 1', Math.abs(pearson([1, 2, 3, 4, 5, 6, 7, 8], [2, 4, 6, 8, 10, 12, 14, 16]) - 1) < 1e-12);
  ok('pearson zero-variance → null', pearson([1, 1, 1, 1, 1, 1, 1, 1], [1, 2, 3, 4, 5, 6, 7, 8]) === null);
  ok('median evens', median([4, 1, 3, 2]) === 3);
  // acdc: a detrended sine of amplitude 10 on a big DC has AC≈p2p, DC≈mean
  const sine = Array.from({ length: 100 }, (_, i) => 5000 + 10 * Math.sin((i / 100) * 2 * Math.PI) + i * 0.5);
  const A = acdc(sine);
  // NB: a sine CORRELATES with a line over one period, so the linear detrend legitimately tilts and
  // trims the p2p (measured 15.0 for amplitude 10). Pin the crude estimator's real behaviour — a band
  // well above noise and below the untrimmed 20 — rather than an idealisation the estimator never had.
  ok('acdc: detrended p2p lands in the crude-estimator band on a drifting sine', A.ac > 12 && A.ac < 21, `${A.ac.toFixed(1)}`);
  ok('acdc: DC ≈ mean level', Math.abs(A.dc - 5025) < 30, `${A.dc.toFixed(0)}`);
  // pooled fit: synthetic sessions where Rn is BUILT to track SpO2 → strong r; a flat control → null-ish
  const mkBins = (track) =>
    Array.from({ length: 60 }, (_, i) => {
      const s = 90 + (i % 10);
      return { R: track ? 1 + 0.02 * (s - 95) + (i % 3) * 0.001 : 1 + (i % 7) * 0.003, s };
    });
  const pf = pooledFit([
    { name: 'a', bins: mkBins(true) },
    { name: 'b', bins: mkBins(true) }
  ]);
  ok('a built-in tracking relation pools to strong r', pf != null && pf.rPooled > 0.8, `${pf?.rPooled?.toFixed(3)}`);
  ok('dose-response is monotonic on tracking data', pf.dose.low < pf.dose.mid && pf.dose.mid < pf.dose.high, JSON.stringify(pf.dose));
  const pn = pooledFit([
    { name: 'a', bins: mkBins(false) },
    { name: 'b', bins: mkBins(false) }
  ]);
  ok('a non-tracking control does NOT pool to strong r', pn == null || Math.abs(pn.rPooled) < 0.3, `${pn?.rPooled?.toFixed(3)}`);
  ok('too little data → null', pooledFit([{ name: 'x', bins: mkBins(true).slice(0, 5) }]) === null);
  console.log(fail ? `\n${fail} FAILURE(S)` : `\n${pass} assertions — all green`);
  return fail ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) process.exit(selftest());
  const root = argv.find((a) => !a.startsWith('--') && fs.existsSync(a));
  if (!root) {
    console.log('usage: node tools/ppg2w-spo2-fit.mjs <captures-root> [--bin 15]');
    process.exit(2);
  }
  const binS = opt('--bin', 15);
  const sessions = [];
  for (const day of fs
    .readdirSync(root)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()) {
    const dir = path.join(root, day);
    for (const f of fs.readdirSync(dir).filter((x) => /_PPG2W\.txt$/i.test(x))) {
      const stem = f.replace(/_PPG2W\.txt$/i, '');
      const sp = path.join(dir, stem + '_SPO2.csv');
      if (!fs.existsSync(sp)) continue;
      const bins = sessionBins(path.join(dir, f), sp, { binS });
      if (bins) sessions.push({ name: stem.slice(-14), bins });
    }
  }
  console.log(`  sessions with usable pairs: ${sessions.length}`);
  const pf = pooledFit(sessions);
  if (!pf) {
    console.log('  ✗ under 100 pooled bins — no verdict.');
    process.exit(1);
  }
  console.log('  session          bins    r');
  for (const p of pf.sessions) console.log(`   ${p.name}  ${String(p.n).padStart(5)}  ${p.r == null ? '  —' : p.r.toFixed(3).padStart(6)}`);
  console.log(`  POOLED: ${pf.bins} bins · r = ${pf.rPooled.toFixed(3)} · LOO range [${pf.looMin.toFixed(3)}, ${pf.looMax.toFixed(3)}]`);
  console.log(`  dose–response (median Rn): <92% ${pf.dose.low?.toFixed(3)} · 92–94% ${pf.dose.mid?.toFixed(3)} · ≥96% ${pf.dose.high?.toFixed(3)}`);
  const mono = pf.dose.low != null && pf.dose.mid != null && pf.dose.high != null && pf.dose.low < pf.dose.mid && pf.dose.mid < pf.dose.high;
  console.log(
    mono && pf.rPooled > 0.3
      ? '  ✓ the ratio TRACKS SpO₂ (monotonic, positive) — functional red+IR behaviour (ch0=IR, ch1=RED by sign)'
      : '  ✗ no robust tracking — the functional case is NOT supported by this corpus state'
  );
}

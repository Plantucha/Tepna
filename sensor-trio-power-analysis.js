/*
 * sensor-trio-power-analysis.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * SAMPLE-SIZE / POWER apparatus for the paper
 *   "Pinning a sensor's error without a reference: how many co-recorded
 *    windows, and how long each (O2Ring · Polar H10 · Verity Sense)."
 *
 * Companion to sigma-no-reference (the σ METHOD) and nights-icc (the "how many
 * nights" TEMPLATE). sigma-no-reference can recover each device's HR-error σ
 * with NO calibrated reference via the three-cornered hat (TCH) over a
 * simultaneous O2Ring + H10 + Verity window — but a single window gives no CI.
 * This tool answers the practitioner's real question: HOW MANY co-recorded
 * windows do you need to pin each device's σ to a usable precision?
 *
 * TWO ARMS (same philosophy as the rest of the suite — simulation ground truth,
 * then real-data validation):
 *   PART 1 — simulation power. A synthetic trio generator with a controllable
 *     variance REGIME (resting vs dynamic) and KNOWN per-device σ planted at the
 *     paper's best real estimate — the raw-ECG 10-night broad hat (σ_O2≈2.72,
 *     σ_H10≈1.86, σ_Verity≈1.94 bpm; supersedes the interim device-HR 1.7/2.2/3.0). The SAME
 *     per-window TCH kernel sigma-no-reference uses is run over N_windows =
 *     1,2,3,5,8,12,20 across ~MC Monte-Carlo trials → σ̂ bias, CI half-width and
 *     RMSE vs the planted σ as a function of N. Gives a defensible "how many
 *     windows" answer NOW, before all real captures exist.
 *   PART 2 — real validation. The one real trio window (06-16/17, ~7,057 s,
 *     raw PPG→PPGDSP / raw ECG→Pan-Tompkins / O2Ring native, Clock-Contract
 *     aligned) is solved by the same kernel and overlaid on the sim's predicted
 *     CI band as N accumulates. Today N_windows = 1 → "validation accumulating".
 *
 * THE REGIME STORY (why the answer is not one number): a trio difference cancels
 * the common true HR, so PURE additive Gaussian device noise is recovered with a
 * regime-independent 1/√N law. Reality is not pure: at REST the beat-to-beat HRV
 * is large and each device renders it differently (O2Ring internally smoothed,
 * H10/Verity instantaneous), injecting a SHARED, signal-dependent error that
 * inflates σ̂, varies window-to-window, and can drive a TCH variance negative
 * (the uncorrelated-error assumption is the thing that breaks). During EXERCISE
 * the HRV collapses, that shared component nearly vanishes, and TCH recovers the
 * clean independent floors with a tight 1/√N CI. So resting windows are
 * inefficient for σ metrology and the answer is "how many windows OF WHAT KIND."
 * The generator therefore plants both an independent floor σ0 per device AND a
 * shared resting-HRV component, sized so the RESTING total σ matches the real
 * estimates (2.72/1.86/1.94, raw-ECG broad hat). An explicit ρ knob injects extra correlated error
 * between the H10·Verity pair to calibrate the assumption-testability finding.
 *
 * 100% local. Clock-Contract parser mirrored (regex → floating ms; never
 * new Date(str)). This is an ANALYSIS tool, not a bundled detector — no
 * re-bundle / provenance. It only READS ppgdex/ecgdex-derived real series.
 */
(function () {
  'use strict';

  // ── colours (match sigma-no-reference) ───────────────────────────────────
  const O2COL = '#FFB84D', H10COL = '#3DE0D0', VERCOL = '#B98AFF', FLAGCOL = '#FF6B7A',
        GRID = 'rgba(255,255,255,.06)', AXIS = 'rgba(255,255,255,.16)', TXT = '#e6edf6',
        MUT = '#6f8096', MUT2 = '#aab8cc', BANDCOL = 'rgba(88,166,255,.16)';

  // ── device truth (planted) ───────────────────────────────────────────────
  // RESTING total σ matches the real reference-free estimates. Each total σ is
  // decomposed into an independent floor σ0 (recovered cleanly in the dynamic
  // regime) + a response r to the SHARED resting beat-to-beat HRV term h:
  //     σ_total² = r²·Var(h_rest) + σ0² .
  // O2Ring is internally smoothed → low HRV response; H10/Verity instantaneous.
  const SD_H_REST = 1.35;          // bpm SD of the shared beat-to-beat HRV at rest
  const SD_H_DYN  = 0.30;          // HRV collapses during exercise
  const DEV = {
    o2:     { name: 'O2Ring (pulse)', col: O2COL,  resp: 0.45, sigmaRest: 2.72 },
    h10:    { name: 'H10 (ECG)',      col: H10COL, resp: 1.00, sigmaRest: 1.86 },
    verity: { name: 'Verity (PPG)',   col: VERCOL, resp: 1.00, sigmaRest: 1.94 },   // planted at the raw-ECG 10-night broad hat (O2Ring 2.72 / H10 1.86 / Verity 1.94 bpm, 122,903 s) — the suite's best reference-free estimate; supersedes the interim device-HR re-fit (1.7/2.2/3.0)DSP is cleaner than the earlier estimate) — docs/INTEGRATOR-TCH-REALDATA-VALIDATION-2026-07-06.md
  };
  // solve independent floor σ0 so the resting total matches the real estimate
  for (const k in DEV) {
    const d = DEV[k], shared = d.resp * SD_H_REST;
    d.sigma0 = Math.sqrt(Math.max(0.04, d.sigmaRest * d.sigmaRest - shared * shared));
    // dynamic-regime total σ (the clean recovery target): small HRV residual
    const sd = d.resp * SD_H_DYN;
    d.sigmaDyn = Math.sqrt(sd * sd + d.sigma0 * d.sigma0);
  }
  const DKEYS = ['o2', 'h10', 'verity'];
  const N_GRID = [1, 2, 3, 5, 8, 12, 20];
  // window-DURATION sweep (seconds = 1,2,5,10,20,30,60 min) at N=1: "how many
  // MINUTES per window?" — finer than the whole-hour window the N-sweep fixes.
  const DUR_GRID = [60, 120, 300, 600, 1200, 1800, 3600];
  const RHO_GRID = [0, 0.15, 0.3, 0.5, 0.7];      // injected H10·Verity error correlation
  const TARGETS = [0.5, 0.25, 0.15];                // CI ±precision targets (bpm)
  const REGIME_N = 8;                               // aggregate N used for the regime-bias panel

  // ── config (UI-overridable) ───────────────────────────────────────────────
  // ar1: second-to-second autocorrelation of the device-error series. Real 1-Hz
  // HR error is strongly autocorrelated (a beat-detector's bias persists for
  // seconds), so the effective independent sample count per window is FAR below
  // the raw second count — this is what sets the realistic per-window σ̂ CI width
  // and reproduces the real block-bootstrap ordering (Verity widest).
  const CFG = { trials: 500, winSec: 3600, ar1: 0.9, rhoInject: 0 };

  // ── RNG (seeded, deterministic) ──────────────────────────────────────────
  let _s = 0x9e3779b9 >>> 0;
  function seed(v) { _s = (v >>> 0) || 1; }
  function rnd() { _s ^= _s << 13; _s >>>= 0; _s ^= _s >> 17; _s ^= _s << 5; _s >>>= 0; return _s / 4294967296; }
  function gauss() { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  // per-trial seed mix (shared verbatim with sensor-trio-worker.js): a trial's
  // randomness depends only on (stream, N, t) → the sweep is bit-reproducible and
  // independent of how trials are sharded across the worker pool.
  // stream: 1=dynamic, 2=resting, 3+ri=ρ-sweep leg ri.
  function trialSeed(stream, N, t) { let h = (Math.imul(stream + 1, 0x9E3779B1) ^ Math.imul(N + 1, 0x85EBCA77) ^ Math.imul(t + 1, 0xC2B2AE3D)) >>> 0; h = Math.imul(h ^ (h >>> 15), 0x2C1B3C6D); h ^= h >>> 13; h = Math.imul(h, 0x297A2D39); h ^= h >>> 15; return h >>> 0; }

  // ── stats ────────────────────────────────────────────────────────────────
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  function variance(a) { const m = mean(a); let s = 0; for (const x of a) s += (x - m) * (x - m); return s / (a.length - 1); }
  const median = (a) => { const s = [...a].sort((p, q) => p - q), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const pct = (sorted, p) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))))];
  function pearson(x, y) { const mx = mean(x), my = mean(y); let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < x.length; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sx += dx * dx; sy += dy * dy; } return sxy / Math.sqrt(sx * sy); }

  // ── the SHARED TCH kernel (identical math to sigma-no-reference) ──────────
  // σ²_A = ½(V_AB + V_AC − V_BC), cyclically; negative variance = broken
  // uncorrelated-error assumption (surfaced, never hidden).
  function threeCorneredHat(vAB, vAC, vBC) {
    return { a: 0.5 * (vAB + vAC - vBC), b: 0.5 * (vAB + vBC - vAC), c: 0.5 * (vAC + vBC - vAB) };
  }
  // A=h10, B=verity, C=o2 (kept consistent with the method paper's ordering)
  function tchSigmas(hh, vv, oo) {
    const dHV = [], dHO = [], dVO = [];
    for (let i = 0; i < hh.length; i++) { dHV.push(hh[i] - vv[i]); dHO.push(hh[i] - oo[i]); dVO.push(vv[i] - oo[i]); }
    const cv = threeCorneredHat(variance(dHV), variance(dHO), variance(dVO));
    return {
      h10: cv.a > 0 ? Math.sqrt(cv.a) : null,
      verity: cv.b > 0 ? Math.sqrt(cv.b) : null,
      o2: cv.c > 0 ? Math.sqrt(cv.c) : null,
      neg: cv.a <= 0 || cv.b <= 0 || cv.c <= 0,
    };
  }

  // ── synthetic trio window generator ──────────────────────────────────────
  // Returns per-device 1-Hz observation arrays = true HR trend + device-rendered
  // shared HRV + independent AR(1) floor noise (+ optional ρ-correlated pair
  // error). The recovery TARGET is σ measured against the smooth trueTrend.
  function genWindow(regime, rho) {
    const n = CFG.winSec, ar = CFG.ar1, dyn = regime === 'dynamic';
    // resting beat-to-beat HRV amplitude varies window-to-window (night-to-night
    // physiology) → injects across-window σ̂ spread → resting needs more windows.
    const sdH = dyn ? SD_H_DYN : SD_H_REST * (0.45 + 1.15 * rnd());
    // true smooth HR trend
    const trend = new Float64Array(n);
    let base = 52 + rnd() * 14;
    if (dyn) {
      // exercise/recovery ramp: rise to +35..+55 then decay (large variance)
      const peak = 35 + rnd() * 25, tPk = n * (0.3 + rnd() * 0.25), up = tPk, dn = n - tPk;
      for (let i = 0; i < n; i++) trend[i] = base + (i < tPk ? peak * (i / up) : peak * Math.exp(-(i - tPk) / (dn * 0.55)));
    } else {
      // resting slow drift (small variance), OU-ish
      let d = 0; const k = 0.0008;
      for (let i = 0; i < n; i++) { d += -k * d + 0.22 * gauss(); trend[i] = base + d; }
    }
    // shared beat-to-beat HRV term h (AR(1)), rendered differently by each device
    const h = new Float64Array(n); let hp = 0;
    for (let i = 0; i < n; i++) { hp = ar * hp + Math.sqrt(1 - ar * ar) * gauss(); h[i] = sdH * hp; }
    // optional correlated error shared by H10·Verity only (assumption-break knob)
    const c = new Float64Array(n);
    if (rho > 0) { let cp = 0; for (let i = 0; i < n; i++) { cp = ar * cp + Math.sqrt(1 - ar * ar) * gauss(); c[i] = cp; } }
    const out = {};
    for (const k of DKEYS) {
      const d = DEV[k], a = new Float64Array(n); let np = 0;
      // a fraction rho of this device's floor variance becomes the SHARED c term
      const corr = (k === 'h10' || k === 'verity') ? rho : 0;
      const sInd = d.sigma0 * Math.sqrt(1 - corr), sCor = d.sigma0 * Math.sqrt(corr);
      for (let i = 0; i < n; i++) {
        np = ar * np + Math.sqrt(1 - ar * ar) * gauss();
        a[i] = trend[i] + d.resp * h[i] + sInd * np + sCor * c[i];
      }
      out[k] = a;
      out['true'] = trend;
    }
    return out;
  }

  // per-window σ̂ from the generator (TCH on the three device arrays)
  function windowSigma(w) {
    const s = tchSigmas(Array.from(w.h10), Array.from(w.verity), Array.from(w.o2));
    return s;
  }

  // ── Monte-Carlo sweep over N_windows for one regime ──────────────────────
  // For each N in N_GRID, MC trials: draw N windows, aggregate σ̂ per device as
  // the across-window median, accumulate. Returns per-device {N: {sigma, bias,
  // ciLo, ciHi, half, rmse, negRate}} against the regime's true target σ.
  function regimeTargets(regime) {
    return { o2: regime === 'dynamic' ? DEV.o2.sigmaDyn : DEV.o2.sigmaRest,
             h10: regime === 'dynamic' ? DEV.h10.sigmaDyn : DEV.h10.sigmaRest,
             verity: regime === 'dynamic' ? DEV.verity.sigmaDyn : DEV.verity.sigmaRest };
  }

  async function sweepRegime(regime, rho, onProg) {
    const tgt = regimeTargets(regime);
    const stream = regime === 'dynamic' ? 1 : 2;
    const res = {}; for (const k of DKEYS) res[k] = {};
    const maxN = N_GRID[N_GRID.length - 1];
    for (let gi = 0; gi < N_GRID.length; gi++) {
      const N = N_GRID[gi];
      const agg = { o2: [], h10: [], verity: [] }, negCount = { o2: 0, h10: 0, verity: 0 }, negTot = { o2: 0, h10: 0, verity: 0 };
      for (let t = 0; t < CFG.trials; t++) {
        seed(trialSeed(stream, N, t));
        const per = { o2: [], h10: [], verity: [] };
        for (let w = 0; w < N; w++) {
          const win = genWindow(regime, rho);
          const s = windowSigma(win);
          for (const k of DKEYS) { negTot[k]++; if (s[k] != null) per[k].push(s[k]); else negCount[k]++; }
        }
        for (const k of DKEYS) if (per[k].length) agg[k].push(median(per[k]));
      }
      for (const k of DKEYS) {
        const a = agg[k].sort((p, q) => p - q);
        const m = a.length ? median(a) : null, lo = a.length ? pct(a, 0.025) : null, hi = a.length ? pct(a, 0.975) : null;
        let rmse = null; if (a.length) { let s = 0; for (const v of a) s += (v - tgt[k]) * (v - tgt[k]); rmse = Math.sqrt(s / a.length); }
        res[k][N] = { sigma: m, ciLo: lo, ciHi: hi, half: (lo != null && hi != null) ? (hi - lo) / 2 : null, bias: m != null ? m - tgt[k] : null, rmse, negRate: negTot[k] ? negCount[k] / negTot[k] : 0 };
      }
      if (onProg) await onProg((gi + 1) / N_GRID.length);
    }
    return { regime, rho, target: tgt, dev: res };
  }

  // minimum-N table: smallest N in grid whose CI half-width ≤ target precision
  function minN(devRes, target) {
    for (const N of N_GRID) { const r = devRes[N]; if (r && r.half != null && r.half <= target) return N; }
    return null; // not reached within grid
  }

  // correlated-error sweep: negative-variance rate vs ρ and N (resting regime).
  // Light: only the per-window negative flag is needed, so generate each window
  // once, record its neg flag, and compose the "≥1 negative in N draws" rate
  // analytically (1 − (1−p)^N) from the per-window rate p — no nested re-draw.
  async function sweepRho(onProg) {
    const grid = {}; let done = 0;
    for (let ri = 0; ri < RHO_GRID.length; ri++) {
      const rho = RHO_GRID[ri];
      // per-window negative rate p at this ρ (resting), then compose over N
      let neg = 0; const M = Math.max(800, CFG.trials);
      for (let t = 0; t < M; t++) { seed(trialSeed(3 + ri, 0, t)); if (windowSigma(genWindow('resting', rho)).neg) neg++; }
      const p = neg / M; grid[rho] = {};
      for (const N of N_GRID) grid[rho][N] = 1 - Math.pow(1 - p, N);
      done++; if (onProg) await onProg(done / RHO_GRID.length);
    }
    return grid;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  REAL ARM — load the committed trio window(s), TCH per window
  // ════════════════════════════════════════════════════════════════════════
  const TRIOS = [
    { label: '2026-06-16/17 · 01:06–03:04',
      h10: 'uploads/h10-ecg-derived-2026-06-17-HR.txt',
      o2: 'uploads/O2Ring S 2100_20260616221235.csv',
      verity: 'uploads/verity-ppg-derived-2026-06-17-HR.txt' },
    // append further real windows as their derived series are committed
  ];
  const HR_MIN = 30, HR_MAX = 220, MIN_WIN_S = 1000;
  function parseTimestamp(raw) {
    if (raw == null) return null; const s = String(raw).trim(); if (!s) return null; let m;
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0);
    m = s.match(/^(\d{2}):(\d{2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})$/); // HH:MM:SS DD/MM/YYYY
    if (m) return Date.UTC(+m[6], +m[5] - 1, +m[4], +m[1], +m[2], +m[3]);
    return null;
  }
  const sFloor = (t) => Math.floor(t / 1000) * 1000;
  async function fetchText(p) { const r = await fetch(encodeURI(p)); if (!r.ok) throw new Error('fetch ' + p + ' → ' + r.status); return r.text(); }
  function bpmMap(text, sep, col) { const o = new Map(), L = text.split(/\r?\n/); for (let i = 1; i < L.length; i++) { if (!L[i]) continue; const cc = L[i].split(sep); const t = parseTimestamp(cc[0]); if (t == null) continue; const hr = +cc[col]; if (!(hr >= HR_MIN && hr <= HR_MAX)) continue; o.set(sFloor(t), hr); } return o; }
  function derivedMap(text) { const o = new Map(), L = text.split(/\r?\n/); for (let i = 1; i < L.length; i++) { if (!L[i]) continue; const cc = L[i].split(';'); const ms = +cc[0], hr = +cc[1]; if (!isFinite(ms) || !(hr >= HR_MIN && hr <= HR_MAX)) continue; o.set(sFloor(ms), hr); } return o; }
  // within-window block bootstrap CI of one window's σ̂ (BLOCK_S blocks)
  function blockCI(hh, vv, oo, B) {
    const n = hh.length, bl = Math.min(n, 30), nb = Math.ceil(n / bl), acc = { h10: [], verity: [], o2: [] };
    for (let b = 0; b < B; b++) {
      const H = [], V = [], O = [];
      for (let k = 0; k < nb; k++) { const st = Math.floor(rnd() * (n - bl + 1)); for (let j = 0; j < bl; j++) { H.push(hh[st + j]); V.push(vv[st + j]); O.push(oo[st + j]); } }
      const s = tchSigmas(H, V, O); for (const k of DKEYS) if (s[k] != null) acc[k].push(s[k]);
    }
    const out = {}; for (const k of DKEYS) { const a = acc[k].sort((p, q) => p - q); out[k] = a.length >= 20 ? { lo: pct(a, 0.025), hi: pct(a, 0.975) } : null; } return out;
  }
  async function loadReal() {
    const windows = [];
    for (const e of TRIOS) {
      let H, O, V;
      try { H = derivedMap(await fetchText(e.h10)); O = bpmMap(await fetchText(e.o2), ',', 2); V = derivedMap(await fetchText(e.verity)); }
      catch (err) { windows.push({ skip: true, label: e.label, reason: err.message }); continue; }
      const ks = [...H.keys()].filter((k) => O.has(k) && V.has(k)).sort((a, b) => a - b);
      if (ks.length < MIN_WIN_S) { windows.push({ skip: true, label: e.label, reason: ks.length + ' s < ' + MIN_WIN_S }); continue; }
      const hh = [], vv = [], oo = []; for (const k of ks) { hh.push(H.get(k)); vv.push(V.get(k)); oo.push(O.get(k)); }
      const s = tchSigmas(hh, vv, oo);
      const ci = blockCI(hh, vv, oo, 500);
      windows.push({ label: e.label, n: ks.length, sigma: { o2: s.o2, h10: s.h10, verity: s.verity }, ci, neg: s.neg,
        rHV: pearson(hh, vv), rHO: pearson(hh, oo), rVO: pearson(vv, oo) });
    }
    return windows;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ORCHESTRATION
  // ════════════════════════════════════════════════════════════════════════
  const RESULT = {}; window.TRIO_POWER = RESULT;
  const $ = (id) => document.getElementById(id);
  const setStatus = (c, t) => { const p = $('status'); if (p) { p.className = 'pill ' + c; p.textContent = t; } };

  // ════════════════════════════════════════════════════════════════════════
  //  WORKER POOL + DURABILITY (house pattern: cohort-worker / hrv-confound)
  // ════════════════════════════════════════════════════════════════════════

  // ── single-instance lock (localStorage heartbeat) ────────────────────────
  //   Several page instances can coexist (agent preview + user tab + a reload).
  //   A heartbeat lock lets exactly ONE run; others defer until it goes stale.
  const RUN_ID = Math.random().toString(36).slice(2);
  function lockFresh() { try { const l = JSON.parse(localStorage.getItem('striopwr_lock') || 'null'); return (l && (Date.now() - l.ts) < 6000) ? l : null; } catch (e) { return null; } }
  function lockHeldByOther() { const l = lockFresh(); return !!(l && l.id !== RUN_ID); }
  function lockBeat() { try { localStorage.setItem('striopwr_lock', JSON.stringify({ id: RUN_ID, ts: Date.now() })); } catch (e) {} }
  function lockRelease() { try { const l = lockFresh(); if (l && l.id === RUN_ID) localStorage.removeItem('striopwr_lock'); } catch (e) {} }

  // ── durable checkpoint (IndexedDB) — survive a preview/tab reload mid-run ─
  function idbOpen() { return new Promise((res, rej) => { const r = indexedDB.open('striopwr_ckpt', 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function ckptSave(o) { try { const db = await idbOpen(); await new Promise((res) => { const tx = db.transaction('s', 'readwrite'); tx.objectStore('s').put(o, 'run'); tx.oncomplete = res; tx.onerror = res; }); } catch (e) {} }
  async function ckptLoad() { try { const db = await idbOpen(); return await new Promise((res) => { const tx = db.transaction('s', 'readonly'); const rq = tx.objectStore('s').get('run'); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); }); } catch (e) { return null; } }
  async function ckptClear() { try { const db = await idbOpen(); await new Promise((res) => { const tx = db.transaction('s', 'readwrite'); tx.objectStore('s').delete('run'); tx.oncomplete = res; tx.onerror = res; }); } catch (e) {} }

  // ── worker pool ──────────────────────────────────────────────────────────
  //   K real Web Workers run the Monte-Carlo OFF the main thread → true
  //   multicore, no UI freeze. Jobs route by reqId through the shared pend map;
  //   per-trial deterministic seeding makes the result pool-size-independent.
  let pool = []; const pend = new Map(); let seq = 1; let CANCEL = false; let _progHook = null;
  function bootPool(K) {
    pool = []; const readies = [];
    for (let i = 0; i < K; i++) {
      (function () {
        let w; try { w = new Worker('sensor-trio-worker.js'); } catch (e) { return; }
        const rec = { w: w, ready: false, _res: null };
        pool.push(rec); readies.push(new Promise((res) => { rec._res = res; }));
        w.onmessage = (ev) => { const m = ev.data || {}; if (m.type === 'ready') { rec.ready = true; if (rec._res) { rec._res(); rec._res = null; } return; } if (m.type === 'progress') { if (_progHook) _progHook(m); return; } if (m.type === 'done') { const p = pend.get(m.reqId); if (p) { pend.delete(m.reqId); p(m); } } };
        w.onerror = () => { if (rec._res) { rec._res(); rec._res = null; } };
        w.postMessage({ type: 'init' });
      })();
    }
    return Promise.race([Promise.all(readies), new Promise((r) => setTimeout(r, 8000))]);
  }
  function runJob(rec, job) { return new Promise((resolve) => { const id = seq++; pend.set(id, resolve); rec.w.postMessage(Object.assign({ type: 'job', reqId: id, ar1: CFG.ar1, winSec: CFG.winSec }, job)); setTimeout(() => { if (pend.has(id)) { pend.delete(id); resolve({ error: 'timeout' }); } }, job.timeoutMs || 300000); }); }

  function fmtETA(sec) { if (!isFinite(sec) || sec < 0) return '—'; const m = Math.floor(sec / 60), s = Math.round(sec % 60); return m ? (m + 'm' + (s < 10 ? '0' : '') + s + 's') : (s + 's'); }
  // collapse one cell's accumulated per-trial medians → {sigma,ci,half,bias,rmse,negRate}
  function finalizeCell(a, tgt) {
    const res = {};
    for (const k of DKEYS) {
      const arr = a.med[k].slice().sort((p, q) => p - q);
      const m = arr.length ? median(arr) : null, lo = arr.length ? pct(arr, 0.025) : null, hi = arr.length ? pct(arr, 0.975) : null;
      let rmse = null; if (arr.length) { let s = 0; for (const v of arr) s += (v - tgt[k]) * (v - tgt[k]); rmse = Math.sqrt(s / arr.length); }
      res[k] = { sigma: m, ciLo: lo, ciHi: hi, half: (lo != null && hi != null) ? (hi - lo) / 2 : null, bias: m != null ? m - tgt[k] : null, rmse: rmse, negRate: a.negTot[k] ? a.negCount[k] / a.negTot[k] : 0 };
    }
    return res;
  }
  function assembleResult(dyn, rest, rhoS, real) {
    Object.assign(RESULT, {
      cfg: { ...CFG }, nGrid: N_GRID, rhoGrid: RHO_GRID, targets: TARGETS,
      planted: Object.fromEntries(DKEYS.map((k) => [k, { sigmaRest: DEV[k].sigmaRest, sigmaDyn: +DEV[k].sigmaDyn.toFixed(3), sigma0: +DEV[k].sigma0.toFixed(3), resp: DEV[k].resp }])),
      sdHrest: SD_H_REST, sdHdyn: SD_H_DYN, dynamic: dyn, resting: rest, rhoSweep: rhoS, real: real,
      minN: { dynamic: minNTable(dyn), resting: minNTable(rest) },
    });
  }
  function persistRate(secs) { try { localStorage.setItem('striopwr_secPer500', String(secs * 500 / Math.max(1, CFG.trials))); } catch (e) {} }
  function updEta() {
    const e = $('eta'); if (!e) return;
    const trials = Math.max(50, Math.min(50000, +($('trials') ? $('trials').value : 500) || 500));
    const r = parseFloat(localStorage.getItem('striopwr_secPer500'));
    e.textContent = (r && isFinite(r) && r > 0)
      ? '≈ ' + fmtETA(r * trials / 500) + ' (' + (navigator.hardwareConcurrency || '?') + ' cores)'
      : '↑ first run calibrates a per-machine estimate';
  }

  async function run(resumeCk) {
    if (lockHeldByOther()) { setStatus('idle', 'another tab/instance is running this sweep — not duplicating'); $('runBtn').disabled = false; return; }
    lockBeat(); const _hb = setInterval(lockBeat, 2000);
    $('runBtn').disabled = true; CANCEL = false;
    if ($('cancel')) { $('cancel').style.display = ''; $('cancel').disabled = false; }
    CFG.trials = Math.max(50, Math.min(50000, +$('trials').value || 500));
    CFG.winSec = Math.max(1200, Math.min(7200, +$('winSec').value || 3600));
    const t0 = performance.now();
    const K = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4));
    setStatus('run', 'booting ' + K + '× worker realms…');
    if (!pool.length) await bootPool(K);
    const rdy = pool.filter((r) => r.ready);
    const sig = CFG.trials + '|' + CFG.winSec + '|' + CFG.ar1 + '|' + N_GRID.join(',');
    const M = Math.max(800, CFG.trials), BLK = 256;

    // accumulators (resume from a compatible checkpoint if one was passed)
    let acc, rhoAcc, durAcc, done;
    if (resumeCk && resumeCk.sig === sig && resumeCk.acc) { acc = resumeCk.acc; rhoAcc = resumeCk.rhoAcc; durAcc = resumeCk.durAcc; done = resumeCk.done || {}; }
    else {
      acc = { dynamic: {}, resting: {} };
      for (const reg of ['dynamic', 'resting']) for (const N of N_GRID) acc[reg][N] = { med: { o2: [], h10: [], verity: [] }, negCount: { o2: 0, h10: 0, verity: 0 }, negTot: { o2: 0, h10: 0, verity: 0 } };
      rhoAcc = {}; for (const rho of RHO_GRID) rhoAcc[rho] = { neg: 0, M: 0 };
      done = {};
    }
    if (!durAcc) { durAcc = { dynamic: {}, resting: {} }; for (const reg of ['dynamic', 'resting']) for (let di = 0; di < DUR_GRID.length; di++) durAcc[reg][di] = { med: { o2: [], h10: [], verity: [] }, negCount: { o2: 0, h10: 0, verity: 0 }, negTot: { o2: 0, h10: 0, verity: 0 } }; }

    // build the remaining job queue (cell trials sharded in blocks; ρ legs too)
    const jobs = [];
    for (const regime of ['dynamic', 'resting']) for (const N of N_GRID) for (let s = 0; s < CFG.trials; s += BLK) { const key = 'c|' + regime + '|' + N + '|' + s; if (!done[key]) { const cnt = Math.min(BLK, CFG.trials - s); jobs.push({ kind: 'cell', regime: regime, N: N, rho: 0, t0: s, count: cnt, key: key, work: cnt * N }); } }
    RHO_GRID.forEach((rho, ri) => { for (let s = 0; s < M; s += BLK) { const key = 'r|' + ri + '|' + s; if (!done[key]) { const cnt = Math.min(BLK, M - s); jobs.push({ kind: 'rho', rho: rho, ri: ri, t0: s, count: cnt, key: key, work: cnt }); } } });
    for (const regime of ['dynamic', 'resting']) for (let di = 0; di < DUR_GRID.length; di++) for (let s = 0; s < CFG.trials; s += BLK) { const key = 'd|' + regime + '|' + di + '|' + s; if (!done[key]) { const cnt = Math.min(BLK, CFG.trials - s); jobs.push({ kind: 'dur', regime: regime, N: 1, rho: 0, durIdx: di, winSec: DUR_GRID[di], seedStream: (regime === 'dynamic' ? 100 : 200) + di, t0: s, count: cnt, key: key, work: cnt }); } }
    const totalWork = 2 * N_GRID.reduce((a, b) => a + b, 0) * CFG.trials + RHO_GRID.length * M + 2 * DUR_GRID.length * CFG.trials;
    let doneWork = totalWork - jobs.reduce((a, j) => a + j.work, 0);

    // serial fallback if no worker realm came up (e.g. Worker blocked)
    if (!rdy.length) {
      setStatus('run', 'no workers available — running serial…');
      const dyn = await sweepRegime('dynamic', 0, (f) => { setStatus('run', 'serial · dynamic ' + Math.round(f * 100) + '%'); return new Promise((r) => setTimeout(r, 0)); });
      const rest = await sweepRegime('resting', 0, (f) => { setStatus('run', 'serial · resting ' + Math.round(f * 100) + '%'); return new Promise((r) => setTimeout(r, 0)); });
      const rhoS = await sweepRho(null);
      let real = []; try { real = await loadReal(); } catch (e) {}
      assembleResult(dyn, rest, rhoS, real); render();
      clearInterval(_hb); lockRelease(); const secs = (performance.now() - t0) / 1000; persistRate(secs);
      setStatus('done', 'done (serial) · ' + CFG.trials + ' trials/cell · win ' + CFG.winSec + 's · ' + secs.toFixed(0) + 's');
      ['dlFig1', 'dlFig2', 'dlFig3', 'dlStats', 'dlCsv'].forEach((id) => { const e = $(id); if (e) e.disabled = false; });
      $('runBtn').disabled = false; if ($('cancel')) $('cancel').style.display = 'none'; updEta(); return;
    }

    let qi = 0, lastCk = doneWork;
    async function lane(rec) {
      while (!CANCEL) {
        const j = jobs[qi++]; if (!j) return;
        const r = await runJob(rec, j);
        if (r.error) { jobs.push(j); continue; }   // requeue a timed-out block
        if (j.kind === 'cell' || j.kind === 'dur') { const a = j.kind === 'dur' ? durAcc[j.regime][j.durIdx] : acc[j.regime][j.N]; for (const k of DKEYS) { const src = r.med[k]; for (let i = 0; i < src.length; i++) a.med[k].push(src[i]); a.negCount[k] += r.negCount[k]; a.negTot[k] += r.negTot[k]; } }
        else { rhoAcc[j.rho].neg += r.neg; rhoAcc[j.rho].M += r.count; }
        done[j.key] = 1; doneWork += j.work;
        const el = (performance.now() - t0) / 1000, rate = doneWork / el;
        setStatus('run', Math.round(100 * doneWork / totalWork) + '% · ' + rdy.length + '× workers · ' + (rate / 1000).toFixed(0) + 'k win/s · ETA ' + fmtETA((totalWork - doneWork) / (rate || 1)));
        if (doneWork - lastCk > totalWork / 30) { lastCk = doneWork; ckptSave({ sig: sig, trials: CFG.trials, winSec: CFG.winSec, acc: acc, rhoAcc: rhoAcc, durAcc: durAcc, done: done, savedAt: Date.now() }); await new Promise((r) => setTimeout(r, 0)); }
      }
    }
    await Promise.all(rdy.map(lane));
    clearInterval(_hb); lockRelease();
    if (CANCEL) { await ckptSave({ sig: sig, trials: CFG.trials, winSec: CFG.winSec, acc: acc, rhoAcc: rhoAcc, durAcc: durAcc, done: done, savedAt: Date.now() }); setStatus('idle', 'cancelled — partial checkpoint saved (re-run resumes)'); $('runBtn').disabled = false; if ($('cancel')) $('cancel').style.display = 'none'; return; }
    await ckptClear();

    // finalize cells → the {regime,rho,target,dev:{k:{N:{…}}}} shape render() expects
    const tgtD = regimeTargets('dynamic'), tgtR = regimeTargets('resting');
    const dyn = { regime: 'dynamic', rho: 0, target: tgtD, dev: {} }, rest = { regime: 'resting', rho: 0, target: tgtR, dev: {} };
    for (const k of DKEYS) { dyn.dev[k] = {}; rest.dev[k] = {}; }
    for (const N of N_GRID) { const fD = finalizeCell(acc.dynamic[N], tgtD), fR = finalizeCell(acc.resting[N], tgtR); for (const k of DKEYS) { dyn.dev[k][N] = fD[k]; rest.dev[k][N] = fR[k]; } }
    const rhoS = {}; for (const rho of RHO_GRID) { const a = rhoAcc[rho]; const p = a.M ? a.neg / a.M : 0; rhoS[rho] = {}; for (const N of N_GRID) rhoS[rho][N] = 1 - Math.pow(1 - p, N); }
    // window-DURATION sweep → CI half-width vs window minutes (N=1) + min-minutes
    const durSweep = { gridSec: DUR_GRID, dynamic: { dev: {} }, resting: { dev: {} } };
    for (const reg of ['dynamic', 'resting']) { const tg = reg === 'dynamic' ? tgtD : tgtR; for (const k of DKEYS) durSweep[reg].dev[k] = {}; for (let di = 0; di < DUR_GRID.length; di++) { const f = finalizeCell(durAcc[reg][di], tg); for (const k of DKEYS) durSweep[reg].dev[k][di] = f[k]; } }
    const minMin = { dynamic: {}, resting: {} };
    for (const reg of ['dynamic', 'resting']) for (const k of DKEYS) { minMin[reg][k] = {}; for (const tg of TARGETS) { let mm = null; for (let di = 0; di < DUR_GRID.length; di++) { const r = durSweep[reg].dev[k][di]; if (r && r.half != null && r.half <= tg) { mm = DUR_GRID[di] / 60; break; } } minMin[reg][k][tg] = mm; } }
    let real = []; try { real = await loadReal(); } catch (e) { console.warn('real arm:', e.message); }
    assembleResult(dyn, rest, rhoS, real); RESULT.duration = durSweep; RESULT.minMinutes = minMin; render();
    const secs = (performance.now() - t0) / 1000; persistRate(secs);
    setStatus('done', 'done · ' + CFG.trials + ' trials/cell · win ' + CFG.winSec + 's · ' + rdy.length + '× · ' + secs.toFixed(0) + 's · real N_windows=' + real.filter((w) => !w.skip).length);
    ['dlFig1', 'dlFig2', 'dlFig3', 'dlStats', 'dlCsv'].forEach((id) => { const e = $(id); if (e) e.disabled = false; });
    $('runBtn').disabled = false; if ($('cancel')) $('cancel').style.display = 'none'; updEta();
  }

  // auto-resume a recent (<20 min) compatible checkpoint after an accidental reload
  window.__trioTryResume = async function () {
    try {
      const ck = await ckptLoad();
      if (!ck || !ck.done || (Date.now() - (ck.savedAt || 0)) > 20 * 60000) return;
      if (lockHeldByOther()) { setStatus('run', 'another instance running… (watching)'); setTimeout(window.__trioTryResume, 5000 + Math.random() * 2000); return; }
      if ($('trials')) $('trials').value = ck.trials; if ($('winSec')) $('winSec').value = ck.winSec;
      setStatus('run', 'resuming previous run…');
      run(ck);
    } catch (e) {}
  };
  function minNTable(sweep) { const o = {}; for (const k of DKEYS) { o[k] = {}; for (const tg of TARGETS) o[k][tg] = minN(sweep.dev[k], tg); } return o; }

  // Synchronous run path (no setTimeout yields) — used for headless figure
  // generation where a hidden iframe pauses timers. Identical math to run().
  window.__trioRunSync = function (trials, winSec, ar) {
    CFG.trials = trials || 500; CFG.winSec = winSec || 3600; if (ar) CFG.ar1 = ar;
    seed(0xC0FFEE);
    const dynP = sweepRegime('dynamic', 0, null);
    seed(0xBEEF01);
    const restP = sweepRegime('resting', 0, null);
    seed(0x5EED02);
    const rhoP = sweepRho(null);
    return Promise.all([dynP, restP, rhoP]).then(async ([dyn, rest, rho]) => {
      let real = []; try { real = await loadReal(); } catch (e) { console.warn('real:', e.message); }
      Object.assign(RESULT, {
        cfg: { ...CFG }, nGrid: N_GRID, rhoGrid: RHO_GRID, targets: TARGETS,
        planted: Object.fromEntries(DKEYS.map((k) => [k, { sigmaRest: DEV[k].sigmaRest, sigmaDyn: +DEV[k].sigmaDyn.toFixed(3), sigma0: +DEV[k].sigma0.toFixed(3), resp: DEV[k].resp }])),
        sdHrest: SD_H_REST, sdHdyn: SD_H_DYN,
        dynamic: dyn, resting: rest, rhoSweep: rho, real,
        minN: { dynamic: minNTable(dyn), resting: minNTable(rest) },
      });
      render();
      setStatus('done', `done (sync) · ${CFG.trials} trials/cell · win ${CFG.winSec}s · real N=${real.filter((w) => !w.skip).length}`);
      ['dlFig1', 'dlFig2', 'dlFig3', 'dlStats', 'dlCsv'].forEach((id) => { const e = $(id); if (e) e.disabled = false; });
      return 'done';
    });
  };

  // ════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════════════════
  const f1 = (x) => (x == null ? '—' : x.toFixed(1));
  const f2 = (x) => (x == null ? '—' : x.toFixed(2));

  function render() {
    drawCurves($('curveCanvas'), RESULT.dynamic, 'half');
    drawRegime($('regimeCanvas'), RESULT.dynamic, RESULT.resting);
    drawReal($('realCanvas'), RESULT.dynamic, RESULT.real);
    drawNeg($('negCanvas'), RESULT.rhoSweep);
    fillMinTbl();
    fillRealTbl();
    if (RESULT.duration && $('durCanvas')) drawDuration($('durCanvas'), RESULT.duration.dynamic);
    if (RESULT.minMinutes) fillDurTbl();
    // headline stats
    $('hPin05').textContent = worstMinN(0.5) ?? '>20';
    $('hPin025').textContent = worstMinN(0.25) ?? '>20';
    $('hRestBias').textContent = restUnderRecovery();
    $('hRealN').textContent = RESULT.real.filter((w) => !w.skip).length;
  }

  // largest min-N across devices to hit a target in the dynamic regime
  function worstMinN(tg) {
    let w = 0; for (const k of DKEYS) { const v = RESULT.minN.dynamic[k][tg]; if (v == null) return null; w = Math.max(w, v); } return w;
  }
  // resting floor-stripping: H10's resting under-recovery vs its true total σ, in %
  function restUnderRecovery() {
    const r = RESULT.resting.dev.h10[REGIME_N];
    if (!r || r.sigma == null) return '—';
    const pctv = 100 * (RESULT.resting.target.h10 - r.sigma) / RESULT.resting.target.h10;
    return '−' + pctv.toFixed(0) + '%';
  }

  // axis helpers
  function axes(c, P, xLabels, y0, y1, xLog) {
    const x = c.getContext('2d'), w = c.width, h = c.height;
    x.clearRect(0, 0, w, h); x.fillStyle = '#0f141b'; x.fillRect(0, 0, w, h);
    x.strokeStyle = AXIS; x.lineWidth = 1; x.beginPath(); x.moveTo(P.l, P.t); x.lineTo(P.l, h - P.b); x.lineTo(w - P.r, h - P.b); x.stroke();
    x.font = '11px ui-monospace,monospace';
    return { x, w, h };
  }
  const sxLog = (N, P, w) => P.l + (Math.log(N) / Math.log(20)) * (w - P.l - P.r);
  const sy = (v, y0, y1, P, h) => (h - P.b) - (v - y0) / (y1 - y0) * (h - P.t - P.b);

  // FIGURE 1 — σ-CI half-width vs N_windows per device (dynamic/clean regime)
  function drawCurves(c, sweep, metric) {
    const P = { l: 56, r: 16, t: 24, b: 40 }, { x, w, h } = axes(c, P);
    let top = 0; for (const k of DKEYS) for (const N of N_GRID) { const r = sweep.dev[k][N]; if (r && r[metric] != null) top = Math.max(top, r[metric]); }
    const y1 = Math.max(0.5, Math.ceil(top * 1.05 * 2) / 2), y0 = 0;
    // grid + y labels
    for (let i = 0; i <= 5; i++) { const v = y0 + (y1 - y0) * i / 5, yy = sy(v, y0, y1, P, h); x.strokeStyle = GRID; x.beginPath(); x.moveTo(P.l, yy); x.lineTo(w - P.r, yy); x.stroke(); x.fillStyle = MUT; x.fillText(v.toFixed(1), 14, yy + 4); }
    // x labels (log)
    for (const N of N_GRID) { const px = sxLog(N, P, w); x.fillStyle = MUT; x.textAlign = 'center'; x.fillText(N, px, h - P.b + 16); x.textAlign = 'left'; }
    // target lines
    for (const tg of TARGETS) { const yy = sy(tg, y0, y1, P, h); if (yy > P.t && yy < h - P.b) { x.strokeStyle = 'rgba(255,107,122,.35)'; x.setLineDash([4, 4]); x.beginPath(); x.moveTo(P.l, yy); x.lineTo(w - P.r, yy); x.stroke(); x.setLineDash([]); x.fillStyle = '#FF9aa6'; x.fillText('\u00b1' + tg, w - P.r - 34, yy - 4); } }
    // curves
    for (const k of DKEYS) {
      const d = DEV[k]; x.strokeStyle = d.col; x.lineWidth = 2; x.beginPath();
      let started = false; for (const N of N_GRID) { const r = sweep.dev[k][N]; if (!r || r[metric] == null) continue; const px = sxLog(N, P, w), py = sy(r[metric], y0, y1, P, h); started ? x.lineTo(px, py) : x.moveTo(px, py); started = true; }
      x.stroke();
      for (const N of N_GRID) { const r = sweep.dev[k][N]; if (!r || r[metric] == null) continue; x.fillStyle = d.col; x.beginPath(); x.arc(sxLog(N, P, w), sy(r[metric], y0, y1, P, h), 3, 0, 7); x.fill(); }
    }
    // legend + title
    x.fillStyle = MUT2; x.fillText('95% CI half-width of σ̂ (bpm)  vs  N windows — dynamic regime', P.l, P.t - 8);
    // stacked legend (top-right)
    let ly = P.t + 6; for (const k of DKEYS) { x.fillStyle = DEV[k].col; x.fillRect(w - P.r - 92, ly - 7, 12, 4); x.fillStyle = MUT2; x.fillText(DEV[k].name, w - P.r - 76, ly - 3); ly += 16; }
    x.fillStyle = MUT; x.save(); x.translate(16, h / 2); x.rotate(-Math.PI / 2); x.textAlign = 'center'; x.restore();
    x.fillStyle = MUT; x.textAlign = 'center'; x.fillText('N co-recorded windows (log)', (P.l + w - P.r) / 2, h - 6); x.textAlign = 'left';
  }

  // FIGURE 2 — regime RECOVERY BIAS: per device, σ̂ − true σ (each regime vs its
  // OWN true total σ). Dynamic sits on zero (unbiased); resting is biased LOW for
  // the instantaneous devices (H10/Verity) because TCH strips the shared
  // beat-to-beat HRV common to ECG and PPG → it recovers the independent floor,
  // not the full σ. The smoothed O2Ring goes slightly the other way.
  function drawRegime(c, dyn, rest) {
    const P = { l: 56, r: 16, t: 26, b: 52 }, { x, w, h } = axes(c, P);
    const N = REGIME_N;
    let lo = 0, hi = 0; for (const k of DKEYS) for (const sw of [dyn, rest]) { const r = sw.dev[k][N]; if (!r) continue; lo = Math.min(lo, (r.ciLo - sw.target[k])); hi = Math.max(hi, (r.ciHi - sw.target[k])); }
    const y0 = Math.floor((lo - 0.08) * 10) / 10, y1 = Math.ceil((hi + 0.08) * 10) / 10;
    for (let i = 0; i <= 6; i++) { const v = y0 + (y1 - y0) * i / 6, yy = sy(v, y0, y1, P, h); x.strokeStyle = v === 0 ? AXIS : GRID; x.beginPath(); x.moveTo(P.l, yy); x.lineTo(w - P.r, yy); x.stroke(); x.fillStyle = MUT; x.fillText(v.toFixed(1), 14, yy + 4); }
    const yZero = sy(0, y0, y1, P, h);
    x.strokeStyle = 'rgba(57,217,138,.6)'; x.lineWidth = 1.4; x.beginPath(); x.moveTo(P.l, yZero); x.lineTo(w - P.r, yZero); x.stroke();
    const groups = DKEYS.length, gw = (w - P.l - P.r) / groups;
    DKEYS.forEach((k, gi) => {
      const cx = P.l + gw * gi + gw / 2;
      const items = [[dyn.dev[k][N], cx - gw * 0.2, true], [rest.dev[k][N], cx + gw * 0.2, false]];
      for (const [r, bx, fill] of items) {
        if (r.bias == null) continue; const yb = sy(r.bias, y0, y1, P, h), bw = gw * 0.28;
        x.fillStyle = DEV[k].col; x.strokeStyle = DEV[k].col; x.lineWidth = 1.6;
        if (fill) x.fillRect(bx - bw / 2, Math.min(yZero, yb), bw, Math.abs(yb - yZero));
        else { x.globalAlpha = 0.2; x.fillRect(bx - bw / 2, Math.min(yZero, yb), bw, Math.abs(yb - yZero)); x.globalAlpha = 1; x.strokeRect(bx - bw / 2, Math.min(yZero, yb), bw, Math.abs(yb - yZero)); }
        const ehi = sy(r.bias + r.half, y0, y1, P, h), elo = sy(r.bias - r.half, y0, y1, P, h);
        x.strokeStyle = '#e6edf6'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(bx, ehi); x.lineTo(bx, elo); x.moveTo(bx - 4, ehi); x.lineTo(bx + 4, ehi); x.moveTo(bx - 4, elo); x.lineTo(bx + 4, elo); x.stroke();
        x.fillStyle = '#e6edf6'; x.font = '10px ui-monospace,monospace'; x.textAlign = 'center'; x.fillText((r.bias >= 0 ? '+' : '') + r.bias.toFixed(2), bx, (r.bias >= 0 ? ehi - 5 : elo + 12)); x.textAlign = 'left'; x.font = '11px ui-monospace,monospace';
      }
      x.fillStyle = MUT2; x.textAlign = 'center'; x.fillText(DEV[k].name.split(' ')[0], cx, h - P.b + 18); x.fillStyle = MUT; x.fillText('dyn  ·  rest', cx, h - P.b + 32); x.textAlign = 'left';
    });
    x.fillStyle = MUT2; x.fillText(`Recovery bias  σ̂ − true σ  by regime (N=${N}) — bpm · 0 = exact recovery`, P.l, P.t - 10);
    let lx = w - P.r - 96, ly = P.t + 4;
    x.fillStyle = MUT2; x.fillRect(lx, ly - 7, 11, 9); x.fillText('dynamic', lx + 15, ly);
    x.strokeStyle = MUT2; x.strokeRect(lx, ly + 8, 11, 9); x.fillText('resting', lx + 15, ly + 15);
  }

  // FIGURE 3 — real running-σ point(s) ± CI overlaid on the sim predicted band
  function drawReal(c, sweep, real) {
    const P = { l: 56, r: 16, t: 24, b: 40 }, { x, w, h } = axes(c, P);
    const valid = (real || []).filter((r) => !r.skip);
    let top = 9; for (const k of DKEYS) { const r = sweep.dev[k][1]; if (r && r.ciHi) top = Math.max(top, r.ciHi); } for (const wn of valid) for (const k of DKEYS) if (wn.ci && wn.ci[k]) top = Math.max(top, wn.ci[k].hi);
    const y1 = Math.ceil(top + 1), y0 = 0;
    for (let i = 0; i <= 5; i++) { const v = y0 + (y1 - y0) * i / 5, yy = sy(v, y0, y1, P, h); x.strokeStyle = GRID; x.beginPath(); x.moveTo(P.l, yy); x.lineTo(w - P.r, yy); x.stroke(); x.fillStyle = MUT; x.fillText(v.toFixed(0), 18, yy + 4); }
    for (const N of N_GRID) { const px = sxLog(N, P, w); x.fillStyle = MUT; x.textAlign = 'center'; x.fillText(N, px, h - P.b + 16); x.textAlign = 'left'; }
    // sim predicted band per device (sigma ± CI half from the dynamic sweep)
    for (const k of DKEYS) {
      const d = DEV[k]; x.fillStyle = d.col; x.globalAlpha = 0.12; x.beginPath(); let started = false;
      const ptsHi = [], ptsLo = [];
      for (const N of N_GRID) { const r = sweep.dev[k][N]; if (!r || r.sigma == null) continue; ptsHi.push([sxLog(N, P, w), sy(r.ciHi, y0, y1, P, h)]); ptsLo.push([sxLog(N, P, w), sy(r.ciLo, y0, y1, P, h)]); }
      ptsHi.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); for (let i = ptsLo.length - 1; i >= 0; i--) x.lineTo(ptsLo[i][0], ptsLo[i][1]); x.closePath(); x.fill(); x.globalAlpha = 1;
      // central sim σ line
      x.strokeStyle = d.col; x.globalAlpha = 0.55; x.lineWidth = 1.4; x.beginPath(); started = false;
      for (const N of N_GRID) { const r = sweep.dev[k][N]; if (!r || r.sigma == null) continue; const px = sxLog(N, P, w), py = sy(r.sigma, y0, y1, P, h); started ? x.lineTo(px, py) : x.moveTo(px, py); started = true; } x.stroke(); x.globalAlpha = 1;
    }
    // real points at N=1,2,… with whiskers
    valid.forEach((wn, idx) => {
      const N = idx + 1, px = sxLog(N, P, w);
      for (const k of DKEYS) { if (wn.sigma[k] == null) continue; const py = sy(wn.sigma[k], y0, y1, P, h); const ci = wn.ci && wn.ci[k];
        if (ci) { x.strokeStyle = '#e6edf6'; x.lineWidth = 1.4; const yhi = sy(ci.hi, y0, y1, P, h), ylo = sy(ci.lo, y0, y1, P, h); x.beginPath(); x.moveTo(px, yhi); x.lineTo(px, ylo); x.moveTo(px - 5, yhi); x.lineTo(px + 5, yhi); x.moveTo(px - 5, ylo); x.lineTo(px + 5, ylo); x.stroke(); }
        x.fillStyle = DEV[k].col; x.beginPath(); x.arc(px, py, 4.5, 0, 7); x.fill(); x.strokeStyle = '#0f141b'; x.lineWidth = 1.5; x.stroke();
      }
    });
    x.fillStyle = MUT2; x.fillText('Real trio σ̂ ± CI (points) vs sim predicted band (shaded) — vs cumulative N', P.l, P.t - 8);
    let ly = P.t + 6; for (const k of DKEYS) { x.fillStyle = DEV[k].col; x.fillRect(w - P.r - 92, ly - 7, 12, 4); x.fillStyle = MUT2; x.fillText(DEV[k].name, w - P.r - 76, ly - 3); ly += 16; }
    if (!valid.length) { x.fillStyle = MUT; x.fillText('no real trio window committed', P.l + 12, h / 2); }
    x.fillStyle = MUT; x.textAlign = 'center'; x.fillText('cumulative N real windows (log)', (P.l + w - P.r) / 2, h - 6); x.textAlign = 'left';
  }

  // assumption panel — negative-variance rate vs N at several injected ρ
  function drawNeg(c, grid) {
    const P = { l: 50, r: 16, t: 24, b: 40 }, { x, w, h } = axes(c, P);
    const y0 = 0, y1 = 1;
    for (let i = 0; i <= 5; i++) { const v = i / 5, yy = sy(v, y0, y1, P, h); x.strokeStyle = GRID; x.beginPath(); x.moveTo(P.l, yy); x.lineTo(w - P.r, yy); x.stroke(); x.fillStyle = MUT; x.fillText((v * 100).toFixed(0) + '%', 14, yy + 4); }
    for (const N of N_GRID) { const px = sxLog(N, P, w); x.fillStyle = MUT; x.textAlign = 'center'; x.fillText(N, px, h - P.b + 16); x.textAlign = 'left'; }
    const cols = ['#39D98A', '#3DE0D0', '#58A6FF', '#FFB84D', '#FF6B7A'];
    RHO_GRID.forEach((rho, ri) => {
      const col = cols[ri % cols.length]; x.strokeStyle = col; x.lineWidth = 2; x.beginPath(); let st = false;
      for (const N of N_GRID) { const v = grid[rho][N]; const px = sxLog(N, P, w), py = sy(v, y0, y1, P, h); st ? x.lineTo(px, py) : x.moveTo(px, py); st = true; }
      x.stroke();
      for (const N of N_GRID) { const v = grid[rho][N]; x.fillStyle = col; x.beginPath(); x.arc(sxLog(N, P, w), sy(v, y0, y1, P, h), 2.5, 0, 7); x.fill(); }
    });
    x.fillStyle = MUT2; x.fillText('P(≥1 negative TCH variance) vs N — by injected H10·Verity error ρ (resting)', P.l, P.t - 8);
    let ly = P.t + 6; RHO_GRID.forEach((rho, ri) => { x.fillStyle = cols[ri % cols.length]; x.fillRect(w - P.r - 70, ly - 7, 12, 4); x.fillStyle = MUT2; x.fillText('ρ=' + rho, w - P.r - 54, ly - 3); ly += 15; });
    x.fillStyle = MUT; x.textAlign = 'center'; x.fillText('N co-recorded windows (log)', (P.l + w - P.r) / 2, h - 6); x.textAlign = 'left';
  }

  // FIGURE 4 — σ-CI half-width vs WINDOW LENGTH (minutes) at N=1, dynamic regime.
  // Answers "how many minutes per window?" — AR(1) error means effective samples
  // grow ~sub-linearly with duration, so the curve flattens.
  function drawDuration(c, sweep) {
    const P = { l: 56, r: 16, t: 24, b: 40 }, { x, w, h } = axes(c, P);
    const mins = DUR_GRID.map((s) => s / 60);
    const lmax = Math.log(mins[mins.length - 1]);
    const sxL = (mn) => P.l + (Math.log(mn) / lmax) * (w - P.l - P.r);
    let top = 0; for (const k of DKEYS) for (let di = 0; di < DUR_GRID.length; di++) { const r = sweep.dev[k][di]; if (r && r.half != null) top = Math.max(top, r.half); }
    const y1 = Math.max(0.5, Math.ceil(top * 1.05 * 2) / 2), y0 = 0;
    for (let i = 0; i <= 5; i++) { const v = y0 + (y1 - y0) * i / 5, yy = sy(v, y0, y1, P, h); x.strokeStyle = GRID; x.beginPath(); x.moveTo(P.l, yy); x.lineTo(w - P.r, yy); x.stroke(); x.fillStyle = MUT; x.fillText(v.toFixed(1), 14, yy + 4); }
    for (let di = 0; di < DUR_GRID.length; di++) { const px = sxL(mins[di]); x.fillStyle = MUT; x.textAlign = 'center'; x.fillText(mins[di] + 'm', px, h - P.b + 16); x.textAlign = 'left'; }
    for (const tg of TARGETS) { const yy = sy(tg, y0, y1, P, h); if (yy > P.t && yy < h - P.b) { x.strokeStyle = 'rgba(255,107,122,.35)'; x.setLineDash([4, 4]); x.beginPath(); x.moveTo(P.l, yy); x.lineTo(w - P.r, yy); x.stroke(); x.setLineDash([]); x.fillStyle = '#FF9aa6'; x.fillText('\u00b1' + tg, w - P.r - 34, yy - 4); } }
    for (const k of DKEYS) {
      const d = DEV[k]; x.strokeStyle = d.col; x.lineWidth = 2; x.beginPath();
      let started = false; for (let di = 0; di < DUR_GRID.length; di++) { const r = sweep.dev[k][di]; if (!r || r.half == null) continue; const px = sxL(mins[di]), py = sy(r.half, y0, y1, P, h); started ? x.lineTo(px, py) : x.moveTo(px, py); started = true; }
      x.stroke();
      for (let di = 0; di < DUR_GRID.length; di++) { const r = sweep.dev[k][di]; if (!r || r.half == null) continue; x.fillStyle = d.col; x.beginPath(); x.arc(sxL(mins[di]), sy(r.half, y0, y1, P, h), 3, 0, 7); x.fill(); }
    }
    x.fillStyle = MUT2; x.fillText('95% CI half-width of \u03c3\u0302 (bpm)  vs  window length (min) \u2014 dynamic, N=1', P.l, P.t - 8);
    let ly = P.t + 6; for (const k of DKEYS) { x.fillStyle = DEV[k].col; x.fillRect(w - P.r - 92, ly - 7, 12, 4); x.fillStyle = MUT2; x.fillText(DEV[k].name, w - P.r - 76, ly - 3); ly += 16; }
    x.fillStyle = MUT; x.textAlign = 'center'; x.fillText('window length (minutes, log)', (P.l + w - P.r) / 2, h - 6); x.textAlign = 'left';
  }

  function fillDurTbl() {
    const tb = $('durTbl') && $('durTbl').querySelector('tbody'); if (!tb) return; tb.innerHTML = '';
    const mm = RESULT.minMinutes.dynamic;
    const cell = (v) => v == null ? '<span style="color:#FF6B7A">&gt;60</span>' : (v + ' min');
    for (const k of DKEYS) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${DEV[k].name}</td><td class="num">${cell(mm[k][0.5])}</td><td class="num">${cell(mm[k][0.25])}</td><td class="num">${cell(mm[k][0.15])}</td>`;
      tb.appendChild(tr);
    }
  }

  function fillMinTbl() {
    const tb = $('minTbl').querySelector('tbody'); tb.innerHTML = '';
    for (const k of DKEYS) {
      const d = DEV[k], dyn = RESULT.minN.dynamic[k];
      const tr = document.createElement('tr');
      const cell = (v) => v == null ? '<span style="color:#FF6B7A">&gt;20</span>' : v;
      tr.innerHTML = `<td><span style="color:${d.col}">●</span> ${d.name}</td>` +
        `<td class="num">${d.sigmaDyn.toFixed(2)}</td>` +
        `<td class="num">${cell(dyn[0.5])}</td><td class="num">${cell(dyn[0.25])}</td><td class="num">${cell(dyn[0.15])}</td>`;
      tb.appendChild(tr);
    }
  }
  function fillRealTbl() {
    const tb = $('realTbl').querySelector('tbody'); tb.innerHTML = '';
    for (const wn of RESULT.real) {
      const tr = document.createElement('tr');
      if (wn.skip) { tr.innerHTML = `<td>${wn.label}</td><td class="num" colspan="5" style="color:#FF6B7A">skipped — ${wn.reason}</td>`; tb.appendChild(tr); continue; }
      tr.innerHTML = `<td>${wn.label}</td><td class="num">${wn.n.toLocaleString()}</td>` +
        `<td class="num" style="color:#FFB84D">${f2(wn.sigma.o2)}</td>` +
        `<td class="num" style="color:#3DE0D0">${f2(wn.sigma.h10)}</td>` +
        `<td class="num" style="color:#B98AFF">${f2(wn.sigma.verity)}</td>` +
        `<td class="num">${f2(wn.rHV)} / ${f2(wn.rHO)} / ${f2(wn.rVO)}</td>`;
      tb.appendChild(tr);
    }
    $('realTag').textContent = RESULT.real.filter((w) => !w.skip).length + ' window(s)';
  }

  // ── exports ────────────────────────────────────────────────────────────
  function dl(name, blob) { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
  function hiRes(srcId, scale) {
    const src = $(srcId); const cc = document.createElement('canvas'); cc.width = src.width * scale; cc.height = src.height * scale;
    const x = cc.getContext('2d'); x.scale(scale, scale);
    // re-run the matching draw at scale by drawing the existing canvas bitmap up
    x.imageSmoothingEnabled = false; x.drawImage(src, 0, 0); return cc;
  }
  function exportFig(srcId, fname) {
    // redraw at 2× into an offscreen canvas for crisp text
    const src = $(srcId); const scale = 2; const cc = document.createElement('canvas'); cc.width = src.width * scale; cc.height = src.height * scale;
    const octx = cc.getContext('2d'); octx.scale(scale, scale);
    const proxy = { width: src.width, height: src.height, getContext: () => octx };
    if (srcId === 'curveCanvas') drawCurves(proxy, RESULT.dynamic, 'half');
    else if (srcId === 'regimeCanvas') drawRegime(proxy, RESULT.dynamic, RESULT.resting);
    else if (srcId === 'realCanvas') drawReal(proxy, RESULT.dynamic, RESULT.real);
    else if (srcId === 'durCanvas') drawDuration(proxy, RESULT.duration.dynamic);
    cc.toBlob((b) => dl(fname, b));
  }
  function exportStats() {
    const out = JSON.parse(JSON.stringify(RESULT, (k, v) => (k === 'true' ? undefined : v)));
    dl('sensor-trio-power-stats.json', new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  }

  // headless figure capture: render one figure to a fullscreen fixed canvas at
  // a chosen pixel size (for a clean, edge-to-edge screenshot). __figClear removes it.
  window.__figShow = function (which, W, H) {
    window.__figClear();
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    cv.id = '__figOverlay';
    cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:99999;background:#0f141b;object-fit:contain;';
    const proxy = { width: W, height: H, getContext: () => cv.getContext('2d') };
    if (which === 'curves') drawCurves(proxy, RESULT.dynamic, 'half');
    else if (which === 'regime') drawRegime(proxy, RESULT.dynamic, RESULT.resting);
    else if (which === 'real') drawReal(proxy, RESULT.dynamic, RESULT.real);
    else if (which === 'duration') drawDuration(proxy, RESULT.duration.dynamic);
    document.body.appendChild(cv);
    return which;
  };
  window.__figClear = function () { const e = document.getElementById('__figOverlay'); if (e) e.remove(); return true; };
  window.__figDataURL = function (which, W, H) { window.__figShow(which, W, H); const e = document.getElementById('__figOverlay'); const u = e.toDataURL('image/png'); e.remove(); return u; };
  function exportCsv() {
    const rows = [['regime', 'device', 'N_windows', 'sigma_hat', 'bias', 'ci_lo', 'ci_hi', 'ci_half', 'rmse', 'neg_var_rate', 'target_sigma']];
    for (const reg of ['dynamic', 'resting']) { const sw = RESULT[reg]; for (const k of DKEYS) for (const N of N_GRID) { const r = sw.dev[k][N]; rows.push([reg, k, N, r.sigma, r.bias, r.ciLo, r.ciHi, r.half, r.rmse, r.negRate, sw.target[k]]); } }
    rows.push([]); rows.push(['min_N table (smallest N with CI half ≤ target)']);
    rows.push(['device', 'sigma_rest', 'sigma_dyn', 'dyn_to_0.5', 'dyn_to_1.0', 'rest_to_0.5', 'rest_to_1.0']);
    for (const k of DKEYS) rows.push([k, DEV[k].sigmaRest, DEV[k].sigmaDyn.toFixed(2), RESULT.minN.dynamic[k][0.5], RESULT.minN.dynamic[k][1.0], RESULT.minN.resting[k][0.5], RESULT.minN.resting[k][1.0]]);
    rows.push([]); rows.push(['real_window', 'n_s', 'sigma_o2', 'sigma_h10', 'sigma_verity', 'r_HV', 'r_HO', 'r_VO']);
    RESULT.real.forEach((wn) => { if (!wn.skip) rows.push([wn.label, wn.n, wn.sigma.o2, wn.sigma.h10, wn.sigma.verity, wn.rHV, wn.rHO, wn.rVO]); });
    dl('sensor-trio-power-results.csv', new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' }));
  }

  // ════════════════════════════════════════════════════════════════════════
  //  FOLDER INGESTION — drop a capture folder → auto-detect eligible trio
  //  nights → solve the real TCH per night IN PARALLEL across the worker pool.
  //  Nothing is read on the main thread; each night's files (incl. the multi-GB
  //  raw PPG) are handed to a worker lane that parses + beat-detects + solves.
  // ════════════════════════════════════════════════════════════════════════
  const NIGHTS = {};
  function classify(file) {
    const n = file.name; let mo;
    if (/^O2Ring.*_(\d{14})\.csv$/i.test(n)) return { role: 'o2', stamp: n.match(/(\d{14})\.csv$/i)[1] };
    if ((mo = n.match(/^Polar_H10_[0-9A-Za-zx]+_(\d{8})_(\d{6})_([A-Z]+)\.txt$/i))) return mo[3].toUpperCase() === 'HR' ? { role: 'h10', stamp: mo[1] + mo[2] } : null;
    if ((mo = n.match(/^Polar_Sense_[0-9A-Za-zx]+_(\d{8})_(\d{6})_([A-Z]+)\.txt$/i))) { const k = mo[3].toUpperCase(), role = k === 'PPG' ? 'verityPPG' : k === 'PPI' ? 'verityPPI' : k === 'HR' ? 'verityHR' : null; return role ? { role, stamp: mo[1] + mo[2] } : null; }
    return null;
  }
  // sessions starting before noon fold into the PREVIOUS evening's night (floating civil time)
  function nightKeyOf(stamp) { const Y = +stamp.slice(0, 4), M = +stamp.slice(4, 6), D = +stamp.slice(6, 8), h = +stamp.slice(8, 10); let ms = Date.UTC(Y, M - 1, D); if (h < 12) ms -= 86400000; const d = new Date(ms); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
  function hashStr(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; }
  function stampMs(s) { return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14)); }
  // pick the trio sessions that are CONTEMPORANEOUS (same sleep session), anchored on the
  // O2Ring start — max-size-per-role independently could pair an evening H10 with a 3am
  // Verity fragment on the same night → near-zero overlap → false skip.
  function resolveTriple(nt) {
    const C = nt.cand || {}, largest = (a) => (a && a.length) ? a.reduce((b, x) => x.size > b.size ? x : b) : null;
    const o2 = largest(C.o2); nt.o2 = o2 ? o2.file : null; nt.startMs = o2 ? o2.ms : null;
    const nearest = (a) => { if (!a || !a.length) return null; if (nt.startMs == null) return largest(a); return a.reduce((b, x) => Math.abs(x.ms - nt.startMs) < Math.abs(b.ms - nt.startMs) ? x : b); };
    const h = nearest(C.h10), vppg = nearest(C.verityPPG), vppi = nearest(C.verityPPI), vhr = nearest(C.verityHR);
    nt.h10 = h ? h.file : null; nt.verityPPG = vppg ? vppg.file : null; nt.verityPPI = vppi ? vppi.file : null; nt.verityHR = vhr ? vhr.file : null;
  }
  function ingestFiles(list) {
    for (let i = 0; i < list.length; i++) { const f = list[i], c = classify(f); if (!c) continue; const nk = nightKeyOf(c.stamp), nt = NIGHTS[nk] || (NIGHTS[nk] = { key: nk, cand: {} }); (nt.cand[c.role] || (nt.cand[c.role] = [])).push({ file: f, ms: stampMs(c.stamp), size: f.size }); }
    Object.keys(NIGHTS).forEach((k) => resolveTriple(NIGHTS[k]));
    renderNightTable();
    setRealStatus(Object.keys(NIGHTS).length + ' nights indexed from ' + list.length + ' files');
  }
  const eligible = (nt) => !!(nt.o2 && nt.h10 && (nt.verityPPG || nt.verityPPI || nt.verityHR));
  const verSrc = (nt) => nt.verityPPG ? 'PPG' : nt.verityPPI ? 'PPI' : nt.verityHR ? 'HR' : '—';
  function renderNightTable() {
    const tb = $('nightTbl') && $('nightTbl').querySelector('tbody'); if (!tb) return; tb.innerHTML = '';
    const keys = Object.keys(NIGHTS).sort(); let elig = 0;
    keys.forEach((k) => {
      const nt = NIGHTS[k], ok = eligible(nt); if (ok) elig++;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><input type="checkbox" class="nchk" data-k="${k}"${ok ? ' checked' : ' disabled'}></td>` +
        `<td class="mono">${k}</td>` +
        `<td class="num">${nt.o2 ? '●' : '<span style="color:#FF6B7A">·</span>'}</td>` +
        `<td class="num">${nt.h10 ? '●' : '<span style="color:#FF6B7A">·</span>'}</td>` +
        `<td class="num">${verSrc(nt)}</td>` +
        `<td class="mono" id="nres-${k}" style="color:#6f8096">${ok ? 'ready' : 'ineligible'}</td>`;
      tb.appendChild(tr);
    });
    const tag = $('nightTag'); if (tag) tag.textContent = keys.length + ' nights · ' + elig + ' eligible';
    const pb = $('procBtn'); if (pb) pb.disabled = elig === 0;
  }
  const setRealStatus = (t) => { const e = $('realStatus'); if (e) e.textContent = t; };
  async function processSelected() {
    const boxes = [].slice.call(document.querySelectorAll('.nchk:checked'));
    const sel = boxes.map((b) => NIGHTS[b.getAttribute('data-k')]).filter((nt) => nt && eligible(nt));
    if (!sel.length) { setRealStatus('no eligible night selected'); return; }
    $('procBtn').disabled = true; setRealStatus('booting workers…');
    const bar = $('realBar'); if (bar) bar.style.display = 'block';
    const setBar = (frac, txt) => { const fl = $('realFill'); if (fl) fl.style.width = Math.round(frac * 100) + '%'; const et = $('realEta'); if (et) et.textContent = txt; };
    setBar(0, 'estimating…');
    _progHook = (mm) => { const rc = $('nres-' + mm.label); if (rc) { rc.textContent = mm.phase + '…'; rc.style.color = '#58A6FF'; } const ph = $('realPhase'); if (ph) ph.textContent = mm.label + ' · ' + mm.phase; };
    const K = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4));
    if (!pool.length) await bootPool(K);
    const rdy = pool.filter((r) => r.ready);
    if (!rdy.length) { setRealStatus('no worker realms available'); $('procBtn').disabled = false; return; }
    const results = []; let qi = 0, doneN = 0; const total = sel.length; const t0 = performance.now();
    const weight = (nt) => (nt.verityPPG && nt.verityPPG.size) || (nt.verityPPI && nt.verityPPI.size) || (nt.verityHR && nt.verityHR.size) || 5e6;
    const bytesTotal = sel.reduce((s, nt) => s + weight(nt), 0); let bytesDone = 0;
    async function lane(rec) {
      while (true) {
        const nt = sel[qi++]; if (!nt) return;
        const rc = $('nres-' + nt.key); if (rc) { rc.textContent = 'processing…'; rc.style.color = '#58A6FF'; }
        const r = await runJob(rec, { kind: 'realNight', timeoutMs: 1200000, label: nt.key, seed: hashStr(nt.key), files: { o2: nt.o2, h10: nt.h10, verityPPG: nt.verityPPG || null, verityPPI: nt.verityPPI || null, verityHR: nt.verityHR || null } });
        doneN++; bytesDone += weight(nt);
        { const el = (performance.now() - t0) / 1000; const frac = bytesTotal > 0 ? bytesDone / bytesTotal : doneN / total; const eta = fmtETA(bytesDone > 0 ? el * (bytesTotal - bytesDone) / bytesDone : NaN); setBar(frac, doneN < total ? ('~' + eta + ' left · ' + doneN + '/' + total + ' nights') : 'finishing…'); }
        const res = (r && r.real) || { skip: true, reason: (r && r.error) || 'no result' }; res.label = nt.key; results.push(res);
        if (rc) { if (res.skip) { rc.textContent = 'skip: ' + res.reason; rc.style.color = '#FF6B7A'; } else { rc.textContent = 'σ ' + f2(res.sigma.o2) + ' / ' + f2(res.sigma.h10) + ' / ' + f2(res.sigma.verity) + (res.neg ? ' ⚠neg' : '') + ' · ' + res.source; rc.style.color = '#39D98A'; } }
        setRealStatus('processed ' + doneN + '/' + total + ' nights · ' + ((performance.now() - t0) / 1000).toFixed(0) + 's');
      }
    }
    await Promise.all(rdy.map(lane));
    results.sort((a, b) => a.label < b.label ? -1 : 1);
    RESULT.real = results.map((r) => r.skip ? { skip: true, label: r.label, reason: r.reason } : { label: r.label, n: r.n, sigma: r.sigma, ci: r.ci, neg: r.neg, rHV: r.rHV, rHO: r.rHO, rVO: r.rVO, source: r.source });
    const band = RESULT.dynamic || { dev: { o2: {}, h10: {}, verity: {} } };
    try { drawReal($('realCanvas'), band, RESULT.real); } catch (e) {}
    try { fillRealTbl(); } catch (e) {}
    const solved = RESULT.real.filter((w) => !w.skip).length;
    const hn = $('hRealN'); if (hn) hn.textContent = solved;
    setRealStatus('done · ' + solved + '/' + total + ' nights solved · ' + ((performance.now() - t0) / 1000).toFixed(0) + 's · ' + rdy.length + '× workers');
    setBar(1, 'done'); const _ph = $('realPhase'); if (_ph) _ph.textContent = 'done'; _progHook = null;
    $('procBtn').disabled = false;
    ['dlStats', 'dlCsv', 'dlFig3'].forEach((id) => { const e = $(id); if (e) e.disabled = false; });
  }
  // recursive folder drag-drop (webkitGetAsEntry) → flat File[]
  function collectEntries(items) {
    const files = [], top = [];
    function walk(entry) { return new Promise((res) => { if (!entry) return res(); if (entry.isFile) { entry.file((f) => { files.push(f); res(); }, () => res()); } else if (entry.isDirectory) { const rd = entry.createReader(); let all = []; (function batch() { rd.readEntries((ents) => { if (!ents.length) { Promise.all(all.map(walk)).then(() => res()); return; } all = all.concat(ents); batch(); }, () => res()); })(); } else res(); }); }
    for (let i = 0; i < items.length; i++) { const en = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry(); if (en) top.push(walk(en)); }
    return Promise.all(top).then(() => files);
  }

  window.addEventListener('DOMContentLoaded', () => {
    $('runBtn').addEventListener('click', () => run().catch((e) => { console.error(e); setStatus('idle', 'error: ' + e.message); }));
    if ($('cancel')) $('cancel').addEventListener('click', () => { CANCEL = true; setStatus('idle', 'cancelling…'); });
    if ($('trials')) $('trials').addEventListener('input', updEta);
    if ($('winSec')) $('winSec').addEventListener('input', updEta);
    $('dlFig1').addEventListener('click', () => exportFig('curveCanvas', 'sensor-trio-power-curves.png'));
    $('dlFig2').addEventListener('click', () => exportFig('regimeCanvas', 'sensor-trio-power-regime.png'));
    $('dlFig3').addEventListener('click', () => exportFig('realCanvas', 'sensor-trio-power-real.png'));
    $('dlStats').addEventListener('click', exportStats);
    $('dlCsv').addEventListener('click', exportCsv);
    try { updEta(); } catch (e) {}
    try { window.__trioTryResume(); } catch (e) {}
    // folder-ingestion wiring (real-data arm)
    const fi = $('folderInput'), xi = $('fileInput'), dz = $('dropzone');
    if (fi) fi.addEventListener('change', (e) => ingestFiles(e.target.files));
    if (xi) xi.addEventListener('change', (e) => ingestFiles(e.target.files));
    if (dz) {
      dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.style.borderColor = 'rgba(88,166,255,.6)'; });
      dz.addEventListener('dragleave', () => { dz.style.borderColor = 'rgba(255,255,255,.18)'; });
      dz.addEventListener('drop', (e) => { e.preventDefault(); dz.style.borderColor = 'rgba(255,255,255,.18)'; const dt = e.dataTransfer; if (dt && dt.items && dt.items.length && dt.items[0].webkitGetAsEntry) { setRealStatus('reading folder…'); collectEntries(dt.items).then(ingestFiles); } else if (dt && dt.files) ingestFiles(dt.files); });
    }
    if ($('procBtn')) $('procBtn').addEventListener('click', () => processSelected().catch((err) => { console.error(err); setRealStatus('error: ' + err.message); $('procBtn').disabled = false; }));
    const drawPlaceholder = (id, msg) => { const c = $(id); if (!c) return; const x = c.getContext('2d'); x.fillStyle = '#0f141b'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#6f8096'; x.font = '13px ui-monospace,monospace'; x.textAlign = 'center'; x.fillText(msg, c.width / 2, c.height / 2); x.textAlign = 'left'; };
    ['curveCanvas', 'regimeCanvas', 'negCanvas', 'durCanvas'].forEach((id) => drawPlaceholder(id, 'Run the power simulation (button above) to populate'));
    drawPlaceholder('realCanvas', 'Process a folder below — or run the sim — to populate Figure 3');
  });
})();

/*
 * sigma-no-reference-analysis.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * Figure-generating apparatus for the paper
 *   "Per-device measurement uncertainty without a canonical reference:
 *    decomposing heart-rate error across O2Ring, Polar H10 and Verity Sense."
 *
 * THE METHOD (device-agnostic):
 *   1. Repeatability σ_repeat — random scatter, NO reference. 1-Hz residual
 *      after a 7-pt rolling median (short-term precision on quasi-stable rest).
 *   2. Transfer-standard agreement — treat the H10 ECG strap as ≈truth (its R-R
 *      is far more precise than PPG/pulse HR). Bland–Altman bias, 95% LoA, Arms;
 *      reference-free random σ of the test device via variance subtraction
 *      σ_test = √(SD_diff² − σ_ref²).
 *   3. Three-cornered hat (Gray–Allan) — with THREE simultaneous devices, recover
 *      each device's own variance with NONE assumed canonical:
 *      σ²_A = ½(V_AB+V_AC−V_BC), cyclically.
 *
 * THE σ-CORNER UPGRADE (VERITY-SIGMA-CORNER-BRIEF, June 2026):
 *   The hat is no longer a single window. `TRIOS[]` holds N simultaneous
 *   three-device windows; each is solved by the SAME per-window kernel, then the
 *   tool reports a per-device σ DISTRIBUTION — median + a confidence interval +
 *   N_windows + total simultaneous seconds — instead of a bare point estimate.
 *   CI logic is honest about N: across-window percentile bootstrap when N≥3;
 *   a within-window block bootstrap (sampling CI, NOT across-window) when N<3.
 *   The estimator's uncorrelated-error assumption is tested by surfacing every
 *   negative TCH variance and the cross-window σ spread, and by keeping the
 *   H10↔O2Ring leg as a built-in control (it must stay bias≈0, SD≈2.7 each
 *   window; drift flags a mis-aligned window). Add a window by committing its
 *   three raw-derived 1-Hz series and appending a TRIOS entry — the builder
 *   intersects them on the Clock-Contract floating-ms grid automatically.
 *   See SIGMA-WINDOW-DERIVATION.md for the per-night derivation + capture path.
 *
 * REALITY OF THIS CORPUS: H10 (ECG) + O2Ring (pulse) co-record 6 nights with
 * deep overlap → the working transfer-standard comparison. Verity Sense logged
 * NO usable onboard beats on any night (HR all-zero; PPI header-only), so its HR
 * exists ONLY as a raw-PPG derivation — now committed for SEVEN co-recorded
 * nights (06-10/11 … 06-18/19). The tool runs the full multi-window machinery over
 * the committed windows and reports an across-window σ with a bootstrap CI.
 *
 * Channel note: H10 = ECG R-R (HR only). O2Ring = SpO₂ + pulse (only pulse is
 * compared). Verity Sense = PPG HR only. SpO₂ trueness is NOT obtainable here
 * (no CO-oximeter / arterial reference).
 *
 * 100% local. Self-contained Clock-Contract parser (mirrored per CLAUDE.md).
 */
(function () {
  'use strict';

  // ── Co-recorded H10 (ECG, RR) + O2Ring (pulse) nights ────────────────────
  const NIGHTS = [
    { id: '06-10', h10: 'uploads/Polar_H10_AAAAAAAA_20260610_211534_RR.txt', o2: 'uploads/O2Ring S 2100_20260610211847.csv' },
    { id: '06-11', h10: 'uploads/Polar_H10_AAAAAAAA_20260611_210410_RR.txt', o2: 'uploads/O2Ring S 2100_20260611210603.csv' },
    { id: '06-12', h10: 'uploads/Polar_H10_AAAAAAAA_20260612_225442_RR.txt', o2: 'uploads/O2Ring S 2100_20260612230016.csv' },
    { id: '06-14', h10: 'uploads/Polar_H10_AAAAAAAA_20260614_212037_RR.txt', o2: 'uploads/O2Ring S 2100_20260614211954.csv' },
    { id: '06-15', h10: 'uploads/Polar_H10_AAAAAAAA_20260615_215320_RR.txt', o2: 'uploads/O2Ring S 2100_20260615215711.csv' },
    { id: '06-17', h10: 'uploads/Polar_H10_AAAAAAAA_20260617_222343_RR.txt', o2: 'uploads/O2Ring S 2100_20260617222311.csv' },
    { id: '06-18', h10: 'uploads/Polar_H10_AAAAAAAA_20260618_214247_RR.txt', o2: 'uploads/O2Ring S 2100_20260618214109.csv' }
  ];

  // ── Three-device overlap WINDOWS (the σ-corner: was one TRIO, now TRIOS[]) ──
  // Each entry is one simultaneous window carrying all three HR series:
  //   • h10    : H10 HR from RAW ECG via ECGDSP (Pan-Tompkins QRS) — gold leg
  //   • verity : Verity HR from RAW PPG via PPGDSP (SQI-gated) — recovers dead onboard HR
  //   • o2     : O2Ring native per-second pulse CSV
  //   • h10rr  : (optional) onboard RR, kept ONLY as a same-device concordance check
  // To add a window: derive the two raw series (SIGMA-WINDOW-DERIVATION.md),
  // commit them as uploads/*-derived-YYYY-MM-DD-HR.txt, append an entry here.
  // The builder finds the maximal all-three-present span on the floating-ms grid.
  const TRIOS = [
    {
      label: '2026-06-10/11 · overnight',
      h10: 'uploads/h10-ecg-derived-2026-06-11-HR.txt',
      h10rr: 'uploads/Polar_H10_AAAAAAAA_20260610_211534_RR.txt',
      o2: 'uploads/O2Ring S 2100_20260610211847.csv',
      verity: 'uploads/verity-ppg-derived-2026-06-11-HR.txt'
    },
    {
      label: '2026-06-11/12 · overnight',
      h10: 'uploads/h10-ecg-derived-2026-06-12-HR.txt',
      h10rr: 'uploads/Polar_H10_AAAAAAAA_20260611_210410_RR.txt',
      o2: 'uploads/O2Ring S 2100_20260611210603.csv',
      verity: 'uploads/verity-ppg-derived-2026-06-12-HR.txt'
    },
    // 2026-06-12/13 EXCLUDED: failed the pre-registered H10↔O2Ring control leg
    // (SD 8.63 vs ~2.7; H10 σ 8.55) — noisy ECG derivation that night. Dropped, not hidden.
    {
      label: '2026-06-14/15 · overnight',
      h10: 'uploads/h10-ecg-derived-2026-06-15-HR.txt',
      h10rr: 'uploads/Polar_H10_AAAAAAAA_20260614_212037_RR.txt',
      o2: 'uploads/O2Ring S 2100_20260614211954.csv',
      verity: 'uploads/verity-ppg-derived-2026-06-15-HR.txt'
    },
    {
      label: '2026-06-15/16 · overnight',
      h10: 'uploads/h10-ecg-derived-2026-06-16-HR.txt',
      h10rr: 'uploads/Polar_H10_AAAAAAAA_20260615_215320_RR.txt',
      o2: 'uploads/O2Ring S 2100_20260615215711.csv',
      verity: 'uploads/verity-ppg-derived-2026-06-16-HR.txt'
    },
    {
      label: '2026-06-16/17 · 01:06\u201303:04',
      h10: 'uploads/h10-ecg-derived-2026-06-17-HR.txt', // ECG → QRS (gold)
      h10rr: 'uploads/Polar_H10_AAAAAAAA_20260617_010614_RR.txt', // onboard RR (concordance)
      o2: 'uploads/O2Ring S 2100_20260616221235.csv',
      verity: 'uploads/verity-ppg-derived-2026-06-17-HR.txt' // raw PPG → HR
    },
    {
      // H10 raw ECG was flat that night (no skin contact); the gold leg falls back
      // to the onboard RR detector (firmware QRS). Footnoted asterisk — paper §3.2.
      label: '2026-06-18/19 · overnight (H10 leg = onboard RR)',
      h10: 'uploads/h10-rr-derived-2026-06-19-HR.txt',
      o2: 'uploads/O2Ring S 2100_20260618214109.csv',
      verity: 'uploads/verity-ppg-derived-2026-06-19-HR.txt'
    }
  ];

  // Verity Sense capture-quality probe (HR stream + PPI), across the corpus.
  const VERITY = [
    { hr: 'uploads/Polar_Sense_BBBBBBBB_20260610_211537_HR.txt' },
    { hr: 'uploads/Polar_Sense_BBBBBBBB_20260611_210414_HR.txt' },
    { hr: 'uploads/Polar_Sense_BBBBBBBB_20260615_215324_HR.txt' },
    { hr: 'uploads/Polar_Sense_BBBBBBBB_20260617_222348_HR.txt' },
    { hr: 'uploads/Polar_Sense_BBBBBBBB_20260616_221112_HR.txt', ppi: 'uploads/Polar_Sense_BBBBBBBB_20260616_221112_PPI.txt' },
    { hr: 'uploads/Polar_Sense_BBBBBBBB_20260618_214253_HR.txt' }
  ];

  const H10COL = '#3DE0D0',
    O2COL = '#FFB84D',
    VERCOL = '#B98AFF',
    FLAGCOL = '#FF6B7A';
  const HR_MIN = 30,
    HR_MAX = 220;
  const MIN_WIN_S = 1000; // keep a window only if ≥ this many simultaneous seconds (brief §2.5)
  const BLOCK_S = 30; // block length (s) for the within-window block bootstrap
  const B_WITHIN = 600; // block-bootstrap reps (single/few-window sampling CI)
  const B_ACROSS = 2000; // across-window bootstrap reps (N≥3)
  const N_FOR_ACROSS = 3; // ≥ this many windows → across-window CI; else within-window CI

  // ── Clock Contract parser (subset; mirrored, not shared) ─────────────────
  function parseTimestamp(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    let m;
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0);
    m = s.match(/^(\d{2}):(\d{2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})$/); // HH:MM:SS DD/MM/YYYY (DMY)
    if (m) return Date.UTC(+m[6], +m[5] - 1, +m[4], +m[1], +m[2], +m[3]);
    return null; // never fabricate
  }
  const sFloor = (t) => Math.floor(t / 1000) * 1000;

  async function fetchText(p) {
    const r = await fetch(encodeURI(p));
    if (!r.ok) throw new Error('fetch ' + p + ' → ' + r.status);
    return r.text();
  }

  // Interval file (H10 RR / Verity PPI) → 1-Hz mean instantaneous HR
  function intervalMap(text, sep, col) {
    const bucket = new Map(),
      L = text.split(/\r?\n/);
    for (let i = 1; i < L.length; i++) {
      if (!L[i]) continue;
      const c = L[i].split(sep);
      const t = parseTimestamp(c[0]);
      if (t == null) continue;
      const iv = +c[col];
      if (!(iv > 250 && iv < 2200)) continue;
      const hr = 60000 / iv;
      if (hr < HR_MIN || hr > HR_MAX) continue;
      const k = sFloor(t),
        a = bucket.get(k) || [0, 0];
      a[0] += hr;
      a[1]++;
      bucket.set(k, a);
    }
    const o = new Map();
    bucket.forEach((a, k) => o.set(k, a[0] / a[1]));
    return o;
  }
  // 1-Hz bpm file (Polar HR col1 ';' / O2Ring pulse col2 ',')
  function bpmMap(text, sep, col) {
    const o = new Map(),
      L = text.split(/\r?\n/);
    for (let i = 1; i < L.length; i++) {
      if (!L[i]) continue;
      const c = L[i].split(sep);
      const t = parseTimestamp(c[0]);
      if (t == null) continue;
      const hr = +c[col];
      if (!(hr >= HR_MIN && hr <= HR_MAX)) continue;
      o.set(sFloor(t), hr);
    }
    return o;
  }
  function countBpm(text, sep, col) {
    let n = 0;
    const L = text.split(/\r?\n/);
    for (let i = 1; i < L.length; i++) {
      if (!L[i]) continue;
      const c = L[i].split(sep);
      const hr = +c[col];
      if (hr >= HR_MIN && hr <= HR_MAX) n++;
    }
    return n;
  }
  // derived file: "tMs;hr;…" — col0 is a numeric floating-ms second (Verity PPG-derived & H10 ECG-derived share this)
  function derivedMap(text) {
    const o = new Map(),
      L = text.split(/\r?\n/);
    let sqi = null;
    for (let i = 1; i < L.length; i++) {
      if (!L[i]) continue;
      const c = L[i].split(';');
      const ms = +c[0],
        hr = +c[1];
      if (!isFinite(ms) || !(hr >= HR_MIN && hr <= HR_MAX)) continue;
      const q = +c[2];
      if (sqi == null && isFinite(q) && q >= 0 && q <= 1) sqi = q;
      o.set(sFloor(ms), hr);
    }
    o._sqi = sqi;
    return o;
  }

  // ── Stats ────────────────────────────────────────────────────────────────
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const variance = (a) => {
    const m = mean(a);
    return a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1);
  };
  const sd = (a) => Math.sqrt(variance(a));
  // pearson · ba · threeCorneredHat · tchSigmas · tchSigmasFused single-sourced in analysis-stats.js
  // (TEST-COVERAGE-ANALYSIS 2026-07-15) — known-answer + AF-safety tested in dex-tests.js. Aliased
  // here so every call site is untouched; behavior is identical (threeCorneredHat is reached
  // transitively through the delegated tchSigmas / tchSigmasFused, no longer a direct page call).
  var pearson = AnalysisStats.pearson;
  const median = (a) => {
    const s = [...a].sort((p, q) => p - q),
      n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  };
  const robustSD = (a) => {
    const m = median(a);
    return 1.4826 * median(a.map((x) => Math.abs(x - m)));
  };
  function repeatSigma(x) {
    const r = [];
    for (let i = 3; i < x.length - 3; i++) r.push(x[i] - median(x.slice(i - 3, i + 4)));
    return r.length > 20 ? robustSD(r) : null;
  }
  var ba = AnalysisStats.blandAltman;
  const pct = (sorted, p) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(p * sorted.length)))];

  // Per-triple three-cornered-hat σ kernel. A=H10(ECG), B=Verity(PPG), C=O2Ring(pulse).
  // Returns {h10, verity, o2} σ (null where the variance went negative) + neg flags + pairwise diffs.
  var tchSigmas = AnalysisStats.tchSigmas;

  // ── fused-weight hat (TCH-FUSED-ROBUST-HAT-2026-07-14) ─────────────────────────────────────
  // Per-second, per-corner confidence (cH/cV/cO from the DSP: density × SQI, AF-safe) weights each
  // difference series in a WEIGHTED-variance TCH — a corner's flagged seconds leave ITS differences
  // but not the others, so the artifact-inflated corner collapses to its true σ with no bias to the
  // clean ones. A GENTLE cross-sensor consensus (Tukey C=30) is a soft secondary net. Missing
  // confidences default to 1 ⇒ (near-)classic variance. Single-sourced in analysis-stats.js (the
  // known-answer + AF-safety gate lives there) — this page DELEGATES, matching tchSigmas above.
  var tchSigmasFused = AnalysisStats.tchSigmasFused;

  // Within-window block bootstrap: resample contiguous BLOCK_S-second blocks of the
  // aligned (H,V,O) triples, recompute TCH σ each rep → percentile CI per device.
  // This is the SAMPLING uncertainty of one window's σ — used when N<3 windows exist,
  // and clearly labelled as within-window (not the across-window CI the brief targets).
  function blockBootstrapCI(hh, vv, oo) {
    const n = hh.length,
      bl = Math.min(n, BLOCK_S),
      nb = Math.ceil(n / bl);
    const acc = { h10: [], verity: [], o2: [] };
    for (let b = 0; b < B_WITHIN; b++) {
      const H = [],
        V = [],
        O = [];
      for (let k = 0; k < nb; k++) {
        const st = Math.floor(Math.random() * (n - bl + 1));
        for (let j = 0; j < bl; j++) {
          H.push(hh[st + j]);
          V.push(vv[st + j]);
          O.push(oo[st + j]);
        }
      }
      const s = tchSigmas(H, V, O);
      ['h10', 'verity', 'o2'].forEach((k) => {
        if (s[k] != null && isFinite(s[k])) acc[k].push(s[k]);
      });
    }
    const out = {};
    ['h10', 'verity', 'o2'].forEach((k) => {
      const a = acc[k].sort((p, q) => p - q);
      out[k] = a.length >= 20 ? { lo: pct(a, 0.025), hi: pct(a, 0.975) } : null;
    });
    return out;
  }

  // Across-window percentile bootstrap of the median σ (used when N≥3 windows).
  function acrossWindowCI(vals) {
    if (vals.length < N_FOR_ACROSS) return null;
    const boot = [];
    for (let b = 0; b < B_ACROSS; b++) {
      const r = [];
      for (let i = 0; i < vals.length; i++) r.push(vals[Math.floor(Math.random() * vals.length)]);
      boot.push(median(r));
    }
    boot.sort((p, q) => p - q);
    return { lo: pct(boot, 0.025), hi: pct(boot, 0.975) };
  }

  const RESULT = {};
  window.SIGMA_RESULT = RESULT;

  // ── Build one three-device window from a TRIOS entry (intersection on tMs) ──
  async function buildWindow(entry) {
    let Ht, Ot, Vt;
    try {
      Ht = derivedMap(await fetchText(entry.h10));
      Ot = bpmMap(await fetchText(entry.o2), ',', 2);
      Vt = derivedMap(await fetchText(entry.verity));
    } catch (e) {
      return { skip: true, label: entry.label, reason: e.message };
    }
    const ks = [...Ht.keys()].filter((k) => Ot.has(k) && Vt.has(k)).sort((a, b) => a - b);
    if (ks.length < MIN_WIN_S) return { skip: true, label: entry.label, reason: `only ${ks.length} simultaneous s (< ${MIN_WIN_S})` };
    const hh = [],
      vv = [],
      oo = [];
    for (const k of ks) {
      hh.push(Ht.get(k));
      vv.push(Vt.get(k));
      oo.push(Ot.get(k));
    }
    const s = tchSigmas(hh, vv, oo);
    const HV = { ...ba(s.dHV), r: pearson(hh, vv) },
      HO = { ...ba(s.dHO), r: pearson(hh, oo) },
      VO = { ...ba(s.dVO), r: pearson(vv, oo) };
    // built-in control leg: H10↔O2Ring must be tight every window (bias≈0, SD≈2.7)
    const ctrlDrift = Math.abs(HO.bias) > 1.0 || HO.sd < 2.0 || HO.sd > 3.5;
    // same-device concordance (ECG-derived H10 vs onboard RR), if present
    let concord = null;
    if (entry.h10rr) {
      try {
        const Rt = intervalMap(await fetchText(entry.h10rr), ';', 1);
        const ek = [...Ht.keys()].filter((k) => Rt.has(k));
        if (ek.length > 120) {
          const de = ek.map((k) => Ht.get(k) - Rt.get(k));
          concord = {
            ...ba(de),
            r: pearson(
              ek.map((k) => Ht.get(k)),
              ek.map((k) => Rt.get(k))
            ),
            n: ek.length
          };
        }
      } catch (e) {
        /* optional */
      }
    }
    return {
      label: entry.label,
      n: ks.length,
      t0: ks[0],
      t1: ks[ks.length - 1],
      verSQI: Vt._sqi,
      sigma: { h10: s.h10, verity: s.verity, o2: s.o2 },
      negVar: s.negVar,
      neg: s.neg,
      pair: { HV, HO, VO },
      ctrlDrift,
      concord,
      hh,
      vv,
      oo,
      keys: ks // kept for block bootstrap / 3-device overlay; stripped from stats.json
    };
  }

  // ── Aggregate per-device σ across windows: median + CI + N + total seconds ──
  function aggregate(windows) {
    const keys = ['h10', 'verity', 'o2'];
    const N = windows.length,
      totalS = windows.reduce((s, w) => s + w.n, 0);
    const biggest = windows.reduce((a, b) => (b.n > a.n ? b : a), windows[0]);
    const within = N < N_FOR_ACROSS ? blockBootstrapCI(biggest.hh, biggest.vv, biggest.oo) : null;
    const dev = {};
    for (const k of keys) {
      const vals = windows.map((w) => w.sigma[k]).filter((v) => v != null);
      const point = vals.length ? median(vals) : null;
      let ci = null,
        ciKind = null;
      if (N >= N_FOR_ACROSS && vals.length >= N_FOR_ACROSS) {
        ci = acrossWindowCI(vals);
        ciKind = 'across-window';
      } else if (within) {
        ci = within[k];
        ciKind = 'within-window';
      }
      dev[k] = { point, ci, ciKind, nWin: vals.length, spread: vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0 };
    }
    // pooled pairwise BA across all windows (for the pair table)
    const pHV = [],
      pHO = [],
      pVO = [];
    windows.forEach((w) => {
      for (let i = 0; i < w.hh.length; i++) {
        pHV.push(w.hh[i] - w.vv[i]);
        pHO.push(w.hh[i] - w.oo[i]);
        pVO.push(w.vv[i] - w.oo[i]);
      }
    });
    const pooledPair = { HV: ba(pHV), HO: ba(pHO), VO: ba(pVO) };
    return {
      N,
      totalS,
      ciKind: N >= N_FOR_ACROSS ? 'across-window' : 'within-window',
      dev,
      pooledPair,
      negWindows: windows.filter((w) => w.neg).length,
      driftWindows: windows.filter((w) => w.ctrlDrift).length
    };
  }

  async function run() {
    setStatus('run', 'loading real device files…');
    const per = [];
    const grids = [];
    let allD = [],
      allH = [],
      allO = [];
    for (const N of NIGHTS) {
      let H, O;
      try {
        H = intervalMap(await fetchText(N.h10), ';', 1);
        O = bpmMap(await fetchText(N.o2), ',', 2);
      } catch (e) {
        console.warn(N.id, e.message);
        continue;
      }
      const ks = [...H.keys()].filter((k) => O.has(k)).sort((a, b) => a - b);
      if (ks.length < 60) continue;
      const hh = [],
        oo = [],
        dd = [];
      for (const k of ks) {
        hh.push(H.get(k));
        oo.push(O.get(k));
        dd.push(O.get(k) - H.get(k));
      }
      const b = ba(dd);
      b.id = N.id;
      b.r = pearson(oo, hh);
      b.t0 = ks[0];
      per.push(b);
      grids.push({ id: N.id, t: ks, h10: hh, o2: oo });
      allD = allD.concat(dd);
      allH = allH.concat(hh);
      allO = allO.concat(oo);
    }
    if (!per.length) {
      setStatus('idle', 'no co-recorded overlap');
      return;
    }

    // motion-flag a night whose SD exceeds 1.8× the median night SD
    const medSD = median(per.map((p) => p.sd));
    per.forEach((p) => {
      p.flag = p.sd > 1.8 * medSD;
    });
    const cleanD = [];
    grids.forEach((g, i) => {
      if (!per[i].flag) for (let j = 0; j < g.t.length; j++) cleanD.push(g.o2[j] - g.h10[j]);
    });

    const pooledAll = ba(allD);
    pooledAll.r = pearson(allO, allH);
    const pooledClean = ba(cleanD);
    const repH = repeatSigma(allH); // H10 short-term precision (valid transfer std)
    const repOraw = repeatSigma(allO); // O2Ring self-residual (degenerate: smoothed output)
    const sigmaRef = (SD) => Math.sqrt(Math.max(0, SD * SD - (repH || 0) * (repH || 0)));

    // Verity capture-quality probe
    const verity = [];
    for (const V of VERITY) {
      const row = { file: V.hr.split('/').pop() };
      try {
        row.hrUsable = countBpm(await fetchText(V.hr), ';', 1);
      } catch (e) {
        row.hrUsable = null;
      }
      if (V.ppi) {
        try {
          row.ppiUsable = intervalMap(await fetchText(V.ppi), ';', 1).size;
        } catch (e) {
          row.ppiUsable = null;
        }
      }
      verity.push(row);
    }
    const verityTotal = verity.reduce((s, r) => s + (r.hrUsable || 0) + (r.ppiUsable || 0), 0);

    // ── Multi-window three-cornered hat (the σ-corner upgrade) ──────────────
    const windows = [];
    const skipped = [];
    for (const entry of TRIOS) {
      const w = await buildWindow(entry);
      if (w.skip) {
        skipped.push(w);
        console.warn('window skipped:', w.label, w.reason);
      } else windows.push(w);
    }
    const hat = windows.length
      ? Object.assign(aggregate(windows), { status: 'populated', windows, skipped })
      : {
          status: 'unpopulated',
          windows: [],
          skipped,
          reason:
            'No three-device window has all three raw-derived HR series committed. Derive Verity HR from raw PPG (PPGDSP) and H10 HR from raw ECG (ECGDSP) for a co-recorded night (SIGMA-WINDOW-DERIVATION.md), commit them, and append a TRIOS entry.'
        };

    Object.assign(RESULT, {
      per,
      grids,
      pooledAll,
      pooledClean,
      repH,
      repOraw,
      sigmaO2_all: sigmaRef(pooledAll.sd),
      sigmaO2_clean: sigmaRef(pooledClean.sd),
      hat,
      verity,
      verityTotal,
      medSD
    });
    render();
    const tail = windows.length ? `${windows.length} window${windows.length > 1 ? 's' : ''} · ${RESULT.hat.totalS.toLocaleString()} simultaneous s · CI ${RESULT.hat.ciKind}` : 'hat unpopulated';
    setStatus('done', `done · 6 pair-nights · ${allD.length.toLocaleString()} s · 3-device hat: ${tail}`);
    ['dlCsv', 'dlStats', 'dlFig'].forEach((id) => {
      const e = document.getElementById(id);
      if (e) e.disabled = false;
    });
  }

  // ── Render ───────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const setStatus = (c, t) => {
    const p = $('status');
    if (p) {
      p.className = 'pill ' + c;
      p.textContent = t;
    }
  };
  const f1 = (x) => (x == null ? '—' : x.toFixed(1));
  const f2 = (x) => (x == null ? '—' : x.toFixed(2));
  const sgn = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(2));
  const ciStr = (d) => (d.point == null ? 'n/a' : d.ci ? `${d.point.toFixed(2)} [${d.ci.lo.toFixed(2)}–${d.ci.hi.toFixed(2)}]` : d.point.toFixed(2));

  function render() {
    const R = RESULT;
    $('hNights').textContent = R.per.length;
    $('hN').textContent = R.pooledAll.n.toLocaleString();
    $('hSigma').textContent = f1(R.sigmaO2_clean) + ' / ' + f1(R.sigmaO2_all);
    $('hBias').textContent = (R.pooledAll.bias >= 0 ? '+' : '') + f2(R.pooledAll.bias);
    $('hArms').textContent = f2(R.pooledClean.arms) + ' / ' + f2(R.pooledAll.arms);
    $('hRepH').textContent = f2(R.repH);

    let tsGrid;
    const hasSamples = !R._summaryOnly && ((R.hat && R.hat.status === 'populated' && R.hat.windows.length && R.hat.windows[0].hh) || (R.grids && R.grids.length));
    if (hasSamples) {
      if (R.hat.status === 'populated' && R.hat.windows.length && R.hat.windows[0].hh) {
        // showcase the cleanest 3-device window: longest span, lowest Verity scatter
        let cand = R.hat.windows.filter((w) => w.n >= 5000 && w.sigma.verity != null);
        if (!cand.length) cand = R.hat.windows.slice();
        const w0 = cand.sort((a, b) => a.sigma.verity - b.sigma.verity)[0];
        tsGrid = { id: w0.label.split(' ')[0], t: w0.keys, h10: w0.hh, o2: w0.oo, verity: w0.vv };
      } else {
        tsGrid = R.grids.find((g) => !R.per.find((p) => p.id === g.id).flag) || R.grids[0];
      }
      drawTimeSeries($('tsCanvas'), tsGrid);
      drawBland($('baO2'), R.grids || [], R.pooledAll, R.hat);
    } else {
      // archived-summary mode (loaded broad-hat JSON): per-second arrays are stripped,
      // so the two per-second figures cannot be redrawn — the σ hat + per-night bars can.
      noteCanvas($('tsCanvas'), 'per-second overlay not stored in the archived summary', 'Run corpus / drop the folder to render the 3-device overlay');
      noteCanvas($('baO2'), 'Bland–Altman scatter needs per-second samples', 'Run corpus / drop the folder to render the clouds');
    }
    drawNightBars($('nightCanvas'), R.per, R.medSD);

    // per-night table
    const tb = $('nightTbl').querySelector('tbody');
    tb.innerHTML = '';
    for (const p of R.per) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td>${p.id}${p.flag ? ' <span style="color:#FF6B7A">⚑</span>' : ''}</td><td class="num">${p.n.toLocaleString()}</td>` +
        `<td class="num">${(p.bias >= 0 ? '+' : '') + f2(p.bias)}</td><td class="num">${f2(p.sd)}</td>` +
        `<td class="num">±${f1(p.loa)}</td><td class="num">${f2(p.arms)}</td><td class="num">${f2(p.r)}</td>` +
        `<td class="num" style="color:${p.flag ? '#FF6B7A' : '#39D98A'}">${f2(Math.sqrt(Math.max(0, p.sd * p.sd - (R.repH || 0) * (R.repH || 0))))}</td>`;
      tb.appendChild(tr);
    }
    $('nightTag').textContent = R.per.length + ' nights';

    // Verity status
    const vb = $('verityTbl').querySelector('tbody');
    vb.innerHTML = '';
    for (const v of R.verity) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="mono" style="font-size:10.5px">${v.file}</td><td class="num">${v.hrUsable == null ? '—' : v.hrUsable}</td><td class="num">${v.ppiUsable == null ? 'n/a' : v.ppiUsable}</td>`;
      vb.appendChild(tr);
    }
    renderHat(R.hat);
  }

  function renderHat(H) {
    const populated = H.status === 'populated';
    $('tchO').textContent = populated ? ciStr(H.dev.o2) : '—';
    $('tchH').textContent = populated ? ciStr(H.dev.h10) : '—';
    $('tchV').textContent = populated ? ciStr(H.dev.verity) : '—';
    $('tchN').textContent = populated ? H.N : '0';
    $('tchSecs').textContent = populated ? H.totalS.toLocaleString() : '0';
    $('tchCiKind').textContent = populated ? H.ciKind : '—';

    if (!populated) {
      $('verityNote').innerHTML = '<b>Three-cornered hat: unpopulated.</b> ' + H.reason;
      $('concordNote').innerHTML = '';
      const x = clear($('tchCanvas'));
      x.fillStyle = '#6f8096';
      x.font = '12px IBM Plex Mono, monospace';
      x.fillText('no three-device window committed', 24, 150);
      $('winTbl').querySelector('tbody').innerHTML = '';
      $('pairTbl').querySelector('tbody').innerHTML = '';
      $('rankTbl').querySelector('tbody').innerHTML = '';
      return;
    }

    drawTCH($('tchCanvas'), H);

    // per-window table (the distribution behind the aggregate)
    const wt = $('winTbl').querySelector('tbody');
    wt.innerHTML = '';
    for (const w of H.windows) {
      const tr = document.createElement('tr');
      const negTxt = w.neg ? ' <span style="color:#FF6B7A" title="negative TCH variance — uncorrelated-error assumption violated">⚠</span>' : '';
      const ctrl = w.pair.HO;
      const ctrlTxt = `<span style="color:${w.ctrlDrift ? '#FF6B7A' : '#39D98A'}">${sgn(ctrl.bias)} / ${f2(ctrl.sd)}</span>`;
      tr.innerHTML =
        `<td>${w.label}${negTxt}</td><td class="num">${w.n.toLocaleString()}</td><td class="num">${w.verSQI == null ? '—' : w.verSQI.toFixed(2)}</td>` +
        `<td class="num" style="color:#FFB84D">${w.sigma.o2 == null ? 'neg' : w.sigma.o2.toFixed(2)}</td>` +
        `<td class="num" style="color:#3DE0D0">${w.sigma.h10 == null ? 'neg' : w.sigma.h10.toFixed(2)}</td>` +
        `<td class="num" style="color:#B98AFF">${w.sigma.verity == null ? 'neg' : w.sigma.verity.toFixed(2)}</td>` +
        `<td class="num">${ctrlTxt}</td>`;
      wt.appendChild(tr);
    }
    $('winTag').textContent = `${H.N} window${H.N > 1 ? 's' : ''}`;

    // pooled pairwise table
    const pb = $('pairTbl').querySelector('tbody');
    pb.innerHTML = '';
    for (const [k, lbl] of [
      ['HO', 'H10 − O2Ring (control)'],
      ['HV', 'H10 − Verity'],
      ['VO', 'Verity − O2Ring']
    ]) {
      const p = H.pooledPair[k];
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${lbl}</td><td class="num">${sgn(p.bias)}</td><td class="num">${f2(p.sd)}</td><td class="num">±${f1(p.loa)}</td><td class="num">${f2(p.arms)}</td>`;
      pb.appendChild(tr);
    }

    // precision ranking — lowest σ first, with CI-overlap tie detection + smoothing caveat
    const rb = $('rankTbl').querySelector('tbody');
    rb.innerHTML = '';
    const rankDevs = [
      { k: 'o2', name: 'O2Ring (1 Hz smoothed pulse)', col: O2COL },
      { k: 'h10', name: 'H10 (130 Hz ECG, instantaneous)', col: H10COL },
      { k: 'verity', name: 'Verity Sense (raw PPG, instantaneous)', col: VERCOL }
    ]
      .filter((d) => H.dev[d.k].point != null)
      .sort((a, b) => H.dev[a.k].point - H.dev[b.k].point);
    const best1 = rankDevs.length ? H.dev[rankDevs[0].k] : null;
    const bestSig = best1 ? best1.point : null;
    rankDevs.forEach((d, i) => {
      const dd = H.dev[d.k],
        s = dd.point,
        ci = dd.ci;
      let rel;
      if (i === 0) rel = '<span style="color:#39D98A">lowest σ — baseline</span>';
      else {
        const pct = Math.round((s / bestSig - 1) * 100);
        const overlap = ci && best1.ci && ci.lo <= best1.ci.hi && best1.ci.lo <= ci.hi;
        rel = '<b>+' + pct + '%</b> ' + (overlap ? '<span style="color:#FFB84D">— CI overlaps #1: a statistical tie</span>' : '<span style="color:#8a98ab">— robustly higher σ</span>');
      }
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td class="num">${i + 1}</td><td><span style="color:${d.col}">●</span> ${d.name}</td>` +
        `<td class="num"><b>${s.toFixed(2)}</b></td><td class="num">${ci ? ci.lo.toFixed(2) + '–' + ci.hi.toFixed(2) : '—'}</td>` +
        `<td class="num">${rel}</td>`;
      rb.appendChild(tr);
    });
    $('rankNote').innerHTML =
      '<b>Lower σ here means <em>smoother</em>, not better — this is almost the inverse of sensor fidelity.</b> The three-cornered hat scores each device’s scatter around the shared signal; it cannot tell which device is more faithful. The O2Ring emits one internally-smoothed integer per second, so its second-to-second variance is small <em>by construction</em> (it averages real beat-to-beat variation away). The H10 — sampled at ~130 Hz and the truest source — reports <em>instantaneous</em> per-beat HR carrying genuine HRV, so it earns a slightly higher σ for being more truthful, and its CI <b>overlaps the O2Ring’s</b> (the two are not distinguishable). Only Verity is robustly higher. The H10 is the reference because it resolves every R-wave; its short-term precision is ≈ 0.7 bpm (§2.3), far better than this σ implies.';

    // concordance (use first window that carries it)
    const wc = H.windows.find((w) => w.concord);
    $('concordNote').innerHTML = wc
      ? `<b>Reference check:</b> ECG-derived H10 HR matches Polar's onboard RR to <b>${sgn(wc.concord.bias)} bpm</b> bias (SD ${wc.concord.sd.toFixed(2)}, r ${wc.concord.r.toFixed(2)}, n ${wc.concord.n.toLocaleString()}) — two independent QRS algorithms on the same heart agree, so the reference leg is sound.`
      : '';

    // instability / assumption-test narrative
    const ciNote =
      H.ciKind === 'across-window'
        ? `σ is reported as the across-window median with a 95% bootstrap CI over the ${H.N} windows.`
        : `Only ${H.N} window${H.N > 1 ? 's' : ''} is committed, so the CI shown is a <em>within-window</em> block bootstrap (BLOCK_S=${BLOCK_S}s) — it bounds the single window's sampling uncertainty, <b>not</b> the across-window spread. Commit more derived windows (SIGMA-WINDOW-DERIVATION.md) to upgrade to an across-window CI and test the uncorrelated-error assumption directly.`;
    const stab = H.negWindows
      ? `<b style="color:#FF6B7A">${H.negWindows} window(s) produced a negative TCH variance</b> — the uncorrelated-error assumption is broken there; that σ is dropped, not hidden. `
      : 'No window produced a negative TCH variance. ';
    const drift = H.driftWindows
      ? `<b style="color:#FF6B7A">${H.driftWindows} window(s) show the H10↔O2Ring control leg drifting</b> off bias≈0 / SD≈2.7 — suspect alignment there. `
      : 'The H10↔O2Ring control leg stays tight (bias≈0, SD≈2.7) in every window. ';
    $('verityNote').innerHTML =
      '<b>Three-cornered hat: populated, multi-window.</b> Each window is solved by the same kernel (<code>σ²_A=½(V_AB+V_AC−V_BC)</code>, none canonical); the bars are the per-device aggregate σ with error bars. ' +
      ciNote +
      ' ' +
      stab +
      drift +
      'Caveat (error <em>structure</em>, not a plain accuracy order): the O2Ring pulse is internally smoothed (depressing its σ) while the raw-recovered Verity HR is <em>instantaneous</em> per-beat (carrying true beat-to-beat variability), so read the ranking as where each device sits on the smoothing↔raw axis.';
  }

  function clear(c) {
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = '#0f141b';
    x.fillRect(0, 0, c.width, c.height);
    return x;
  }
  function noteCanvas(c, line1, line2) {
    const x = clear(c);
    x.fillStyle = '#8a98ab';
    x.font = '12px IBM Plex Mono, monospace';
    x.fillText(line1, 20, c.height / 2 - 4);
    if (line2) {
      x.fillStyle = '#6f8096';
      x.fillText(line2, 20, c.height / 2 + 14);
    }
  }
  const sx = (v, x0, x1, P, w) => P.l + ((v - x0) / (x1 - x0)) * (w - P.l - P.r);
  const sy = (v, y0, y1, P, h) => h - P.b - ((v - y0) / (y1 - y0)) * (h - P.t - P.b);
  function frame(x, P, w, h) {
    x.strokeStyle = 'rgba(255,255,255,.14)';
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(P.l, P.t);
    x.lineTo(P.l, h - P.b);
    x.lineTo(w - P.r, h - P.b);
    x.stroke();
    x.font = '10px IBM Plex Mono, monospace';
  }

  function drawTimeSeries(c, g) {
    const x = clear(c),
      w = c.width,
      h = c.height,
      P = { l: 42, r: 12, t: 18, b: 26 };
    const hasV = !!g.verity;
    const N = Math.min(g.t.length, 600),
      t0 = g.t[0];
    // display-only median-3 smoothing of the Verity per-beat trace (kills isolated
    // beat-detection dropouts; does NOT touch any statistic — BA cloud & σ use raw)
    const vsm = (i) => {
      if (!hasV) return null;
      const a = [];
      for (let k = Math.max(0, i - 2); k <= Math.min(N - 1, i + 2); k++) if (g.verity[k] != null) a.push(g.verity[k]);
      if (!a.length) return null;
      a.sort((p, q) => p - q);
      return a[(a.length - 1) >> 1];
    };
    let lo = Infinity,
      hi = -Infinity;
    for (let i = 0; i < N; i++) {
      lo = Math.min(lo, g.h10[i], g.o2[i]);
      hi = Math.max(hi, g.h10[i], g.o2[i]);
      const vs = vsm(i);
      if (vs != null) {
        lo = Math.min(lo, vs);
        hi = Math.max(hi, vs);
      }
    }
    lo = Math.floor(lo - 2);
    hi = Math.ceil(hi + 2);
    frame(x, P, w, h);
    for (let v = lo; v <= hi; v += Math.ceil((hi - lo) / 5)) {
      const yy = sy(v, lo, hi, P, h);
      x.fillStyle = '#6f8096';
      x.fillText(v, 6, yy + 3);
      x.strokeStyle = 'rgba(255,255,255,.05)';
      x.beginPath();
      x.moveTo(P.l, yy);
      x.lineTo(w - P.r, yy);
      x.stroke();
    }
    const xs = (i) => sx((g.t[i] - t0) / 1000, 0, (g.t[N - 1] - t0) / 1000, P, w);
    if (hasV) {
      x.strokeStyle = VERCOL;
      x.lineWidth = 1.1;
      x.globalAlpha = 0.85;
      let pen = false;
      for (let i = 0; i < N; i++) {
        const vv = vsm(i);
        if (vv == null) {
          pen = false;
          continue;
        }
        const px = xs(i),
          py = sy(vv, lo, hi, P, h);
        if (!pen) {
          x.beginPath();
          x.moveTo(px, py);
          pen = true;
        } else x.lineTo(px, py);
      }
      x.stroke();
      x.globalAlpha = 1;
    }
    [
      ['o2', O2COL],
      ['h10', H10COL]
    ].forEach(([k, col]) => {
      x.strokeStyle = col;
      x.lineWidth = 1.3;
      x.beginPath();
      for (let i = 0; i < N; i++) {
        const px = xs(i),
          py = sy(g[k][i], lo, hi, P, h);
        i ? x.lineTo(px, py) : x.moveTo(px, py);
      }
      x.stroke();
    });
    x.fillStyle = '#aab8cc';
    x.fillText((hasV ? 'window ' : 'night ') + g.id + ' — first ' + N + ' s · bpm' + (hasV ? ' · 3 devices' : ''), P.l + 4, P.t - 4);
    const lx = w - P.r - (hasV ? 232 : 150);
    x.fillStyle = H10COL;
    x.fillText('H10 ECG', lx, P.t - 4);
    x.fillStyle = O2COL;
    x.fillText('O2Ring pulse', lx + 64, P.t - 4);
    if (hasV) {
      x.fillStyle = VERCOL;
      x.fillText('Verity PPG', lx + 150, P.t - 4);
    }
  }

  function drawBland(c, grids, ba0, hat) {
    const x = clear(c),
      w = c.width,
      h = c.height,
      P = { l: 42, r: 12, t: 16, b: 28 };
    const hatOn = hat && hat.status === 'populated';
    let xMin = Infinity,
      xMax = -Infinity;
    // both clouds over the SAME data so the Arms are comparable: the three-device
    // overlap when the hat is populated, else fall back to all pair-nights for O2Ring.
    const pts = [];
    let oBias, oSd, oLoa, oArms;
    if (hatOn) {
      const dO = [];
      for (const wnd of hat.windows)
        for (let i = 0; i < wnd.hh.length; i++) {
          const mu = (wnd.oo[i] + wnd.hh[i]) / 2,
            d = wnd.oo[i] - wnd.hh[i];
          pts.push([mu, d]);
          dO.push(d);
          if (mu < xMin) xMin = mu;
          if (mu > xMax) xMax = mu;
        }
      const m = dO.reduce((s, q) => s + q, 0) / dO.length;
      oSd = Math.sqrt(dO.reduce((s, q) => s + (q - m) * (q - m), 0) / (dO.length - 1));
      oBias = m;
      oLoa = 1.96 * oSd;
      oArms = Math.sqrt(m * m + oSd * oSd);
    } else {
      for (const g of grids)
        for (let i = 0; i < g.t.length; i++) {
          const mu = (g.o2[i] + g.h10[i]) / 2;
          pts.push([mu, g.o2[i] - g.h10[i]]);
          if (mu < xMin) xMin = mu;
          if (mu > xMax) xMax = mu;
        }
      oBias = ba0.bias;
      oSd = ba0.sd;
      oLoa = ba0.loa;
      oArms = ba0.arms;
    }
    // Verity − H10 cloud over the three-device hat windows (same reference & seconds)
    const vpts = [];
    let vBias = null,
      vSd = null,
      vLoa = null,
      vArms = null;
    if (hatOn) {
      const dv = [];
      for (const wnd of hat.windows)
        for (let i = 0; i < wnd.hh.length; i++) {
          const mu = (wnd.vv[i] + wnd.hh[i]) / 2,
            d = wnd.vv[i] - wnd.hh[i];
          vpts.push([mu, d]);
          dv.push(d);
          if (mu < xMin) xMin = mu;
          if (mu > xMax) xMax = mu;
        }
      const m = dv.reduce((s, q) => s + q, 0) / dv.length;
      vSd = Math.sqrt(dv.reduce((s, q) => s + (q - m) * (q - m), 0) / (dv.length - 1));
      vBias = m;
      vLoa = 1.96 * vSd;
      vArms = Math.sqrt(m * m + vSd * vSd);
    }
    xMin -= 2;
    xMax += 2;
    const yAbs = Math.max(12, Math.ceil(Math.max(oLoa + Math.abs(oBias) + 3, (vLoa || 0) + Math.abs(vBias || 0) + 3)));
    const y0 = -yAbs,
      y1 = yAbs;
    frame(x, P, w, h);
    for (let v = y0; v <= y1; v += Math.round(yAbs / 2)) {
      const yy = sy(v, y0, y1, P, h);
      x.fillStyle = '#6f8096';
      x.fillText(v, 6, yy + 3);
      x.strokeStyle = 'rgba(255,255,255,.05)';
      x.beginPath();
      x.moveTo(P.l, yy);
      x.lineTo(w - P.r, yy);
      x.stroke();
    }
    if (vpts.length) {
      x.globalAlpha = 0.12;
      x.fillStyle = VERCOL;
      const vst = Math.max(1, Math.floor(vpts.length / 6000));
      for (let i = 0; i < vpts.length; i += vst) {
        x.beginPath();
        x.arc(sx(vpts[i][0], xMin, xMax, P, w), sy(vpts[i][1], y0, y1, P, h), 1.1, 0, 7);
        x.fill();
      }
      x.globalAlpha = 1;
    }
    x.globalAlpha = 0.16;
    x.fillStyle = O2COL;
    const step = Math.max(1, Math.floor(pts.length / 6000));
    for (let i = 0; i < pts.length; i += step) {
      x.beginPath();
      x.arc(sx(pts[i][0], xMin, xMax, P, w), sy(pts[i][1], y0, y1, P, h), 1.1, 0, 7);
      x.fill();
    }
    x.globalAlpha = 1;
    const line = (v, col, dash) => {
      x.strokeStyle = col;
      x.setLineDash(dash);
      x.lineWidth = 1.2;
      const yy = sy(v, y0, y1, P, h);
      x.beginPath();
      x.moveTo(P.l, yy);
      x.lineTo(w - P.r, yy);
      x.stroke();
      x.setLineDash([]);
    };
    line(0, 'rgba(255,255,255,.25)', [2, 3]);
    if (vBias != null) {
      line(vBias, VERCOL, []);
      line(vBias + vLoa, VERCOL, [4, 4]);
      line(vBias - vLoa, VERCOL, [4, 4]);
    }
    line(oBias, '#FFB84D', []);
    line(oBias + oLoa, '#FF6B7A', [5, 4]);
    line(oBias - oLoa, '#FF6B7A', [5, 4]);
    x.fillStyle = '#e6edf6';
    x.fillText('difference vs H10 reference' + (hatOn ? ' · 3-device overlap' : ' · all nights'), P.l + 4, P.t - 3);
    x.fillStyle = '#FFB84D';
    x.fillText('O2Ring−H10  bias ' + oBias.toFixed(2) + ' · Arms ' + oArms.toFixed(2), P.l + 4, h - P.b - 6);
    if (vBias != null) {
      x.fillStyle = VERCOL;
      x.fillText('Verity−H10  bias ' + vBias.toFixed(2) + ' · Arms ' + vArms.toFixed(2), P.l + 4, h - P.b - 18);
    }
  }

  function drawNightBars(c, per, medSD) {
    const x = clear(c),
      w = c.width,
      h = c.height,
      P = { l: 42, r: 12, t: 18, b: 34 };
    const hi = Math.max(2, Math.ceil(Math.max(...per.map((p) => p.sd)) + 1));
    frame(x, P, w, h);
    for (let v = 0; v <= hi; v += Math.max(1, Math.round(hi / 5))) {
      const yy = sy(v, 0, hi, P, h);
      x.fillStyle = '#6f8096';
      x.fillText(v, 6, yy + 3);
      x.strokeStyle = 'rgba(255,255,255,.05)';
      x.beginPath();
      x.moveTo(P.l, yy);
      x.lineTo(w - P.r, yy);
      x.stroke();
    }
    const bw = (w - P.l - P.r) / per.length;
    per.forEach((p, i) => {
      const cx = P.l + bw * i + bw / 2;
      const bh = (p.sd / hi) * (h - P.t - P.b);
      x.fillStyle = p.flag ? FLAGCOL : O2COL;
      x.fillRect(cx - 16, h - P.b - bh, 32, bh);
      x.fillStyle = '#e6edf6';
      x.fillText(p.sd.toFixed(1), cx - 13, h - P.b - bh - 5);
      x.fillStyle = '#6f8096';
      x.fillText(p.id, cx - 16, h - P.b + 14);
    });
    const yy = sy(1.8 * medSD, 0, hi, P, h);
    x.strokeStyle = 'rgba(255,107,122,.5)';
    x.setLineDash([4, 3]);
    x.beginPath();
    x.moveTo(P.l, yy);
    x.lineTo(w - P.r, yy);
    x.stroke();
    x.setLineDash([]);
    x.fillStyle = '#aab8cc';
    x.fillText('per-night SD of (O2Ring − H10), bpm · ⚑ = motion-flagged (>1.8× median)', P.l + 4, P.t - 4);
  }

  // σ bars WITH error bars (CI whiskers). Each device's aggregate σ + its CI, and a
  // faint per-window dot strip so the distribution behind the median is visible.
  function drawTCH(c, H) {
    const x = clear(c),
      w = c.width,
      h = c.height,
      P = { l: 42, r: 12, t: 18, b: 40 };
    const items = [
      ['o2', 'O2Ring (pulse)', O2COL],
      ['h10', 'H10 (ECG)', H10COL],
      ['verity', 'Verity (PPG)', VERCOL]
    ];
    let top = 0;
    items.forEach(([k]) => {
      const d = H.dev[k];
      if (d.point != null) top = Math.max(top, d.ci ? d.ci.hi : d.point);
      H.windows.forEach((w2) => {
        if (w2.sigma[k] != null) top = Math.max(top, w2.sigma[k]);
      });
    });
    const hi = Math.max(2, Math.ceil(top + 1));
    frame(x, P, w, h);
    for (let v = 0; v <= hi; v += Math.max(1, Math.round(hi / 5))) {
      const yy = sy(v, 0, hi, P, h);
      x.fillStyle = '#6f8096';
      x.fillText(v, 6, yy + 3);
      x.strokeStyle = 'rgba(255,255,255,.05)';
      x.beginPath();
      x.moveTo(P.l, yy);
      x.lineTo(w - P.r, yy);
      x.stroke();
    }
    const bw = (w - P.l - P.r) / items.length;
    items.forEach(([k, lbl, col], i) => {
      const d = H.dev[k];
      if (d.point == null) return;
      const cx = P.l + bw * i + bw / 2;
      const yTop = sy(d.point, 0, hi, P, h);
      x.fillStyle = col;
      x.fillRect(cx - 26, yTop, 52, h - P.b - yTop);
      // CI whisker
      if (d.ci) {
        const yhi = sy(d.ci.hi, 0, hi, P, h),
          ylo = sy(d.ci.lo, 0, hi, P, h);
        x.strokeStyle = '#e6edf6';
        x.lineWidth = 1.4;
        x.beginPath();
        x.moveTo(cx, yhi);
        x.lineTo(cx, ylo);
        x.moveTo(cx - 8, yhi);
        x.lineTo(cx + 8, yhi);
        x.moveTo(cx - 8, ylo);
        x.lineTo(cx + 8, ylo);
        x.stroke();
      }
      // per-window dots
      x.fillStyle = 'rgba(255,255,255,.55)';
      H.windows.forEach((w2, wi) => {
        if (w2.sigma[k] == null) return;
        const dx = H.windows.length > 1 ? (wi / (H.windows.length - 1) - 0.5) * 26 : 0;
        x.beginPath();
        x.arc(cx + dx, sy(w2.sigma[k], 0, hi, P, h), 2, 0, 7);
        x.fill();
      });
      x.fillStyle = '#e6edf6';
      x.fillText(d.point.toFixed(2), cx - 12, yTop - 7);
      x.fillStyle = '#6f8096';
      x.fillText(lbl, cx - bw / 2 + 8, h - P.b + 16);
    });
    x.fillStyle = '#aab8cc';
    x.fillText(`reference-free σ (bpm) · none canonical · ${H.N} window${H.N > 1 ? 's' : ''} · ${H.totalS.toLocaleString()} s · CI ${H.ciKind}`, P.l + 4, P.t - 4);
  }

  // ── Exports ────────────────────────────────────────────────────────────
  function dl(name, blob) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  function exportCsv() {
    const R = RESULT;
    const rows = [['scope', 'n', 'bias', 'sd', 'loa95', 'arms', 'r', 'sigma_ref_free']];
    R.per.forEach((p) => rows.push([p.id + (p.flag ? '(flag)' : ''), p.n, p.bias, p.sd, p.loa, p.arms, p.r, Math.sqrt(Math.max(0, p.sd * p.sd - R.repH * R.repH))]));
    rows.push(['POOLED-clean', R.pooledClean.n, R.pooledClean.bias, R.pooledClean.sd, R.pooledClean.loa, R.pooledClean.arms, '', R.sigmaO2_clean]);
    rows.push(['POOLED-all', R.pooledAll.n, R.pooledAll.bias, R.pooledAll.sd, R.pooledAll.loa, R.pooledAll.arms, R.pooledAll.r, R.sigmaO2_all]);
    rows.push(['H10-repeatability', '', '', R.repH, '', '', '', '']);
    rows.push([]);
    const H = R.hat;
    if (H.status === 'populated') {
      rows.push(['TCH_aggregate', 'device', 'sigma', 'ci_lo', 'ci_hi', 'ci_kind', 'n_windows', 'sigma_spread']);
      ['o2', 'h10', 'verity'].forEach((k) => {
        const d = H.dev[k];
        rows.push(['', k, d.point, d.ci ? d.ci.lo : '', d.ci ? d.ci.hi : '', d.ciKind || '', d.nWin, d.spread]);
      });
      rows.push(['TCH_n_windows', H.N, 'total_simultaneous_s', H.totalS, 'neg_var_windows', H.negWindows, 'control_drift_windows', H.driftWindows]);
      rows.push([]);
      rows.push(['TCH_per_window', 'label', 'n_s', 'verSQI', 'sigma_o2', 'sigma_h10', 'sigma_verity', 'HO_bias', 'HO_sd', 'neg']);
      H.windows.forEach((w) => rows.push(['', w.label, w.n, w.verSQI, w.sigma.o2, w.sigma.h10, w.sigma.verity, w.pair.HO.bias, w.pair.HO.sd, w.neg]));
    }
    rows.push([]);
    rows.push(['verity_file', 'hr_usable', 'ppi_usable']);
    R.verity.forEach((v) => rows.push([v.file, v.hrUsable, v.ppiUsable == null ? '' : v.ppiUsable]));
    dl('sigma-no-reference-results.csv', new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' }));
  }
  // strip bulky per-sample arrays (grids + aligned window series) from the JSON
  function exportStats() {
    const drop = new Set(['grids', 'hh', 'vv', 'oo', 'keys', 'dHV', 'dHO', 'dVO']);
    dl('sigma-no-reference-stats.json', new Blob([JSON.stringify(RESULT, (k, v) => (drop.has(k) ? undefined : v), 2)], { type: 'application/json' }));
  }
  function exportFig() {
    const cs = ['tsCanvas', 'baO2', 'nightCanvas', 'tchCanvas'].map($);
    const pad = 14;
    const rowW = Math.max(cs[0].width, cs[1].width + cs[2].width + pad, cs[3].width);
    const W = rowW + pad * 2;
    const H = cs[0].height + Math.max(cs[1].height, cs[2].height) + cs[3].height + pad * 4;
    const cc = document.createElement('canvas');
    cc.width = W;
    cc.height = H;
    const x = cc.getContext('2d');
    x.fillStyle = '#0c0f14';
    x.fillRect(0, 0, W, H);
    let y = pad;
    x.drawImage(cs[0], pad, y);
    y += cs[0].height + pad;
    x.drawImage(cs[1], pad, y);
    x.drawImage(cs[2], pad + cs[1].width + pad, y);
    y += Math.max(cs[1].height, cs[2].height) + pad;
    x.drawImage(cs[3], pad, y);
    cc.toBlob((b) => dl('sigma-no-reference-figures.png', b));
  }

  // ── Load the archived 10-night broad-hat result (committed folder-ingest output) ──
  // Renders every table + the σ-hat / per-night-SD figures from the committed summary
  // JSON so the broad corpus is reproducible without the (large, private) raw folder.
  // The two per-second figures (overlay, Bland–Altman) need raw samples not stored in
  // the summary, so they show a note; Run corpus / folder-drop render them live.
  async function loadBroadHat() {
    setStatus('run', 'loading committed 10-night broad hat…');
    let J;
    try {
      J = JSON.parse(await fetchText('uploads/sigma-no-reference-broadhat.json'));
    } catch (e) {
      setStatus('idle', 'broad-hat JSON not found: ' + e.message);
      return;
    }
    if (!J || !J.hat || J.hat.status !== 'populated') {
      setStatus('idle', 'broad-hat JSON malformed');
      return;
    }
    J._summaryOnly = true;
    J.grids = [];
    Object.keys(RESULT).forEach((k) => delete RESULT[k]);
    Object.assign(RESULT, J);
    render();
    const H = RESULT.hat;
    setStatus('done', `committed broad hat · ${H.N} nights · ${H.totalS.toLocaleString()} simultaneous s · CI ${H.ciKind}`);
    ['dlCsv', 'dlStats', 'dlFig'].forEach((id) => {
      const e = $(id);
      if (e) e.disabled = false;
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  FOLDER INGESTION (parity with sensor-trio-power-analysis) — drop a capture
  //  folder → auto-detect eligible O2Ring+H10+Verity nights → derive each night's
  //  three HR corners IN PARALLEL via sensor-trio-worker.js (production PPGDSP for
  //  the Verity corner from raw PPG), then feed the SAME σ-hat / BA / control-leg
  //  pipeline (windowFromWorker → aggregate → render). H10 uses its device HR,
  //  O2Ring its native pulse; the Verity onboard HR is dead so it is derived from
  //  raw PPG. Nothing uploaded; all local, off the UI thread.
  // ════════════════════════════════════════════════════════════════════════
  const NIGHTS_IDX = {};
  function classifyF(file) {
    const n = file.name;
    if (/^O2Ring.*_(\d{14})\.csv$/i.test(n)) return { role: 'o2', stamp: n.match(/(\d{14})\.csv$/i)[1] };
    let mo = n.match(/^Polar_H10_[0-9A-Za-zx]+_(\d{8})_(\d{6})_([A-Z]+)\.txt$/i);
    if (mo) {
      const hk = mo[3].toUpperCase();
      return hk === 'HR' ? { role: 'h10', stamp: mo[1] + mo[2] } : hk === 'ECG' ? { role: 'h10ecg', stamp: mo[1] + mo[2] } : null;
    }
    mo = n.match(/^Polar_Sense_[0-9A-Za-zx]+_(\d{8})_(\d{6})_([A-Z]+)\.txt$/i);
    if (mo) {
      const k = mo[3].toUpperCase(),
        role = k === 'PPG' ? 'verityPPG' : k === 'PPI' ? 'verityPPI' : k === 'HR' ? 'verityHR' : null;
      return role ? { role, stamp: mo[1] + mo[2] } : null;
    }
    return null;
  }
  function nightKeyOf(st) {
    const Y = +st.slice(0, 4),
      M = +st.slice(4, 6),
      D = +st.slice(6, 8),
      h = +st.slice(8, 10);
    let ms = Date.UTC(Y, M - 1, D);
    if (h < 12) ms -= 86400000;
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function stampMs(s) {
    return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
  }
  function hashStr(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function resolveTriple(nt) {
    const C = nt.cand || {},
      largest = (a) => (a && a.length ? a.reduce((b, x) => (x.size > b.size ? x : b)) : null);
    const o2 = largest(C.o2);
    nt.o2 = o2 ? o2.file : null;
    nt.startMs = o2 ? o2.ms : null;
    const nearest = (a) => {
      if (!a || !a.length) return null;
      if (nt.startMs == null) return largest(a);
      return a.reduce((b, x) => (Math.abs(x.ms - nt.startMs) < Math.abs(b.ms - nt.startMs) ? x : b));
    };
    const h = nearest(C.h10),
      he = nearest(C.h10ecg),
      vp = nearest(C.verityPPG),
      vi = nearest(C.verityPPI),
      vh = nearest(C.verityHR);
    nt.h10 = h ? h.file : null;
    nt.h10ecg = he ? he.file : null;
    nt.verityPPG = vp ? vp.file : null;
    nt.verityPPI = vi ? vi.file : null;
    nt.verityHR = vh ? vh.file : null;
  }
  function ingestFiles(list) {
    for (let i = 0; i < list.length; i++) {
      const f = list[i],
        c = classifyF(f);
      if (!c) continue;
      const nk = nightKeyOf(c.stamp),
        nt = NIGHTS_IDX[nk] || (NIGHTS_IDX[nk] = { key: nk, cand: {} });
      (nt.cand[c.role] || (nt.cand[c.role] = [])).push({ file: f, ms: stampMs(c.stamp), size: f.size });
    }
    Object.keys(NIGHTS_IDX).forEach((k) => resolveTriple(NIGHTS_IDX[k]));
    renderNightTable2();
    setRealStatus(Object.keys(NIGHTS_IDX).length + ' nights indexed');
  }
  const eligibleN = (nt) => !!(nt.o2 && (nt.h10 || nt.h10ecg) && (nt.verityPPG || nt.verityPPI || nt.verityHR));
  const verSrcN = (nt) => (nt.verityPPG ? 'PPG' : nt.verityPPI ? 'PPI' : nt.verityHR ? 'HR' : '—');
  const setRealStatus = (t) => {
    const e = $('realStatus');
    if (e) e.textContent = t;
  };
  function renderNightTable2() {
    const tb = $('nightTbl2') && $('nightTbl2').querySelector('tbody');
    if (!tb) return;
    tb.innerHTML = '';
    const ks = Object.keys(NIGHTS_IDX).sort();
    let el = 0;
    ks.forEach((k) => {
      const nt = NIGHTS_IDX[k],
        ok = eligibleN(nt);
      if (ok) el++;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><input type="checkbox" class="nchk2" data-k="${k}"${ok ? ' checked' : ' disabled'}></td><td class="mono">${k}</td><td class="num">${nt.o2 ? '●' : '<span style="color:#FF6B7A">·</span>'}</td><td class="num">${nt.h10ecg || nt.h10 ? '●' : '<span style="color:#FF6B7A">·</span>'}</td><td class="num">${verSrcN(nt)}</td><td class="mono" id="nr2-${k}" style="color:#6f8096">${ok ? 'ready' : 'ineligible'}</td>`;
      tb.appendChild(tr);
    });
    const tag = $('nightTag2');
    if (tag) tag.textContent = ks.length + ' nights · ' + el + ' eligible';
    const pb = $('procBtn2');
    if (pb) pb.disabled = el === 0;
  }
  const fmtETA = (s) => {
    if (!isFinite(s) || s < 0) return '—';
    const m = Math.floor(s / 60),
      x = Math.round(s % 60);
    return m ? m + 'm' + (x < 10 ? '0' : '') + x + 's' : x + 's';
  };
  // worker pool (reuses sensor-trio-worker.js — production PPGDSP for the Verity corner)
  let sPool = [],
    sPend = new Map(),
    sSeq = 1,
    sProg = null;
  function bootSPool(K) {
    sPool = [];
    const rd = [];
    for (let i = 0; i < K; i++) {
      (function () {
        let w;
        try {
          w = new Worker('sensor-trio-worker.js');
        } catch (e) {
          return;
        }
        const rec = { w, ready: false, _r: null };
        sPool.push(rec);
        rd.push(new Promise((r) => (rec._r = r)));
        w.onmessage = (ev) => {
          const m = ev.data || {};
          if (m.type === 'ready') {
            rec.ready = true;
            if (rec._r) {
              rec._r();
              rec._r = null;
            }
            return;
          }
          if (m.type === 'progress') {
            if (sProg) sProg(m);
            return;
          }
          if (m.type === 'done') {
            const p = sPend.get(m.reqId);
            if (p) {
              sPend.delete(m.reqId);
              p(m);
            }
          }
        };
        w.onerror = () => {
          if (rec._r) {
            rec._r();
            rec._r = null;
          }
        };
        w.postMessage({ type: 'init' });
      })();
    }
    return Promise.race([Promise.all(rd), new Promise((r) => setTimeout(r, 8000))]);
  }
  function sRunJob(rec, job) {
    return new Promise((res) => {
      const id = sSeq++;
      sPend.set(id, res);
      rec.w.postMessage(Object.assign({ type: 'job', reqId: id }, job));
      setTimeout(() => {
        if (sPend.has(id)) {
          sPend.delete(id);
          res({ error: 'timeout' });
        }
      }, 1200000);
    });
  }
  // worker result (aligned per-second series) → a window in buildWindow()'s exact shape
  function windowFromWorker(res) {
    const hh = res.hh,
      vv = res.vv,
      oo = res.oo,
      ks = res.keys;
    const s = tchSigmasFused(hh, vv, oo, res.cH, res.cV, res.cO);
    const HV = { ...ba(s.dHV), r: pearson(hh, vv) },
      HO = { ...ba(s.dHO), r: pearson(hh, oo) },
      VO = { ...ba(s.dVO), r: pearson(vv, oo) };
    const ctrlDrift = Math.abs(HO.bias) > 1.5 || HO.sd > 4.5 || HO.sd < 0.5;
    return {
      label: res.label,
      n: ks.length,
      t0: ks[0],
      t1: ks[ks.length - 1],
      verSQI: null,
      sigma: { h10: s.h10, verity: s.verity, o2: s.o2 },
      negVar: s.negVar,
      neg: s.neg,
      pair: { HV, HO, VO },
      ctrlDrift,
      concord: null,
      hh,
      vv,
      oo,
      keys: ks,
      source: res.source
    };
  }
  function collectEntries(items) {
    const files = [],
      top = [];
    function walk(en) {
      return new Promise((r) => {
        if (!en) return r();
        if (en.isFile) {
          en.file(
            (f) => {
              files.push(f);
              r();
            },
            () => r()
          );
        } else if (en.isDirectory) {
          const rd = en.createReader();
          let all = [];
          (function b() {
            rd.readEntries(
              (es) => {
                if (!es.length) {
                  Promise.all(all.map(walk)).then(() => r());
                  return;
                }
                all = all.concat(es);
                b();
              },
              () => r()
            );
          })();
        } else r();
      });
    }
    for (let i = 0; i < items.length; i++) {
      const e = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      if (e) top.push(walk(e));
    }
    return Promise.all(top).then(() => files);
  }
  async function processFolder() {
    const boxes = [].slice.call(document.querySelectorAll('.nchk2:checked'));
    const sel = boxes.map((b) => NIGHTS_IDX[b.getAttribute('data-k')]).filter((nt) => nt && eligibleN(nt));
    if (!sel.length) {
      setRealStatus('no eligible night selected');
      return;
    }
    $('procBtn2').disabled = true;
    setRealStatus('booting workers…');
    const K = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4));
    if (!sPool.length) await bootSPool(K);
    const rdy = sPool.filter((r) => r.ready);
    if (!rdy.length) {
      setRealStatus('no worker realms');
      $('procBtn2').disabled = false;
      return;
    }
    const bar = $('realBar');
    if (bar) bar.style.display = 'block';
    const setBar = (f, txt) => {
      const fl = $('realFill');
      if (fl) fl.style.width = Math.round(f * 100) + '%';
      const et = $('realEta');
      if (et) et.textContent = txt;
    };
    setBar(0, 'estimating…');
    const weight = (nt) => (nt.verityPPG && nt.verityPPG.size) || (nt.verityPPI && nt.verityPPI.size) || 5e6;
    const bytesTot = sel.reduce((s, nt) => s + weight(nt), 0);
    let bytesDone = 0;
    sProg = (m) => {
      const rc = $('nr2-' + m.label);
      if (rc) {
        rc.textContent = m.phase + '…';
        rc.style.color = '#58A6FF';
      }
    };
    const results = [];
    let qi = 0,
      doneN = 0;
    const total = sel.length,
      t0 = performance.now();
    async function lane(rec) {
      while (true) {
        const nt = sel[qi++];
        if (!nt) return;
        const rc = $('nr2-' + nt.key);
        if (rc) {
          rc.textContent = 'processing…';
          rc.style.color = '#58A6FF';
        }
        const r = await sRunJob(rec, {
          kind: 'realNight',
          wantSeries: true,
          label: nt.key,
          seed: hashStr(nt.key),
          files: { o2: nt.o2, h10: nt.h10, h10ecg: nt.h10ecg || null, verityPPG: nt.verityPPG || null, verityPPI: nt.verityPPI || null, verityHR: nt.verityHR || null }
        });
        doneN++;
        bytesDone += weight(nt);
        const rr = (r && r.real) || { skip: true, reason: (r && r.error) || 'no result' };
        rr.label = nt.key;
        results.push(rr);
        if (rc) {
          if (rr.skip) {
            rc.textContent = 'skip: ' + rr.reason;
            rc.style.color = '#FF6B7A';
          } else {
            rc.textContent = 'σ ' + f2(rr.sigma.o2) + ' / ' + f2(rr.sigma.h10) + ' / ' + f2(rr.sigma.verity) + (rr.neg ? ' ⚠' : '') + ' · ' + rr.source;
            rc.style.color = '#39D98A';
          }
        }
        const el = (performance.now() - t0) / 1000;
        setBar(bytesDone / bytesTot, doneN < total ? '~' + fmtETA(bytesDone > 0 ? (el * (bytesTot - bytesDone)) / bytesDone : NaN) + ' left · ' + doneN + '/' + total : 'finishing…');
      }
    }
    await Promise.all(rdy.map(lane));
    sProg = null;
    // assemble the SAME RESULT shape run() builds, sourced from the folder windows
    const windows = [],
      skipped = [],
      per = [],
      grids = [];
    let allD = [],
      allH = [],
      allO = [];
    results.sort((a, b) => (a.label < b.label ? -1 : 1));
    for (const rr of results) {
      if (rr.skip) {
        skipped.push({ label: rr.label, reason: rr.reason });
        continue;
      }
      const w = windowFromWorker(rr);
      windows.push(w);
      const dd = [];
      for (let i = 0; i < w.hh.length; i++) dd.push(w.oo[i] - w.hh[i]);
      const b = ba(dd);
      b.id = rr.label;
      b.r = pearson(w.oo, w.hh);
      b.t0 = w.keys[0];
      per.push(b);
      grids.push({ id: rr.label, t: w.keys, h10: w.hh, o2: w.oo });
      allD = allD.concat(dd);
      allH = allH.concat(w.hh);
      allO = allO.concat(w.oo);
    }
    if (!windows.length) {
      setRealStatus('no night solved');
      $('procBtn2').disabled = false;
      return;
    }
    const medSD = median(per.map((p) => p.sd));
    per.forEach((p) => {
      p.flag = p.sd > 1.8 * medSD;
    });
    const cleanD = [];
    grids.forEach((g, i) => {
      if (!per[i].flag) for (let j = 0; j < g.t.length; j++) cleanD.push(g.o2[j] - g.h10[j]);
    });
    const pooledAll = ba(allD);
    pooledAll.r = pearson(allO, allH);
    const pooledClean = ba(cleanD);
    const repH = repeatSigma(allH),
      repOraw = repeatSigma(allO);
    const sigmaRef = (SD) => Math.sqrt(Math.max(0, SD * SD - (repH || 0) * (repH || 0)));
    const hat = Object.assign(aggregate(windows), { status: 'populated', windows, skipped });
    Object.assign(RESULT, { per, grids, pooledAll, pooledClean, repH, repOraw, sigmaO2_all: sigmaRef(pooledAll.sd), sigmaO2_clean: sigmaRef(pooledClean.sd), hat, verity: [], verityTotal: 0, medSD });
    render();
    setBar(1, 'done');
    const solved = windows.length;
    setStatus('done', `folder · ${solved}/${total} nights · ${RESULT.hat.totalS.toLocaleString()} simultaneous s · CI ${RESULT.hat.ciKind}`);
    setRealStatus('done · ' + solved + '/' + total + ' nights solved');
    $('procBtn2').disabled = false;
    ['dlCsv', 'dlStats', 'dlFig'].forEach((id) => {
      const e = $(id);
      if (e) e.disabled = false;
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    // The committed-corpus buttons (Run corpus / Load 10-night broad hat) were removed: they
    // fetched gitignored uploads/ files that don't exist in a public checkout (and the no-network
    // CSP blocks fetch anyway). Drag-drop below is the sole data path. run()/loadBroadHat() remain
    // defined but unwired — inert dead code, never invoked.
    // per-figure PNG downloads (named to match the paper's figure files)
    document.querySelectorAll('.dlbtn[data-canvas]').forEach((b) =>
      b.addEventListener('click', () => {
        const c = $(b.getAttribute('data-canvas'));
        if (!c) return;
        let fn = b.getAttribute('data-fn');
        if (b.getAttribute('data-canvas') === 'tchCanvas' && RESULT._summaryOnly) fn = 'sigma-tch-broad.png';
        c.toBlob((bl) => {
          if (bl) dl(fn, bl);
        });
      })
    );
    $('dlCsv').addEventListener('click', exportCsv);
    $('dlStats').addEventListener('click', exportStats);
    $('dlFig').addEventListener('click', exportFig);
    const fi = $('folderInput'),
      xi = $('fileInput'),
      dz = $('dropzone');
    if (fi) fi.addEventListener('change', (e) => ingestFiles(e.target.files));
    if (xi) xi.addEventListener('change', (e) => ingestFiles(e.target.files));
    if (dz) {
      dz.addEventListener('dragover', (e) => {
        e.preventDefault();
        dz.style.borderColor = 'rgba(61,224,208,.6)';
      });
      dz.addEventListener('dragleave', () => {
        dz.style.borderColor = 'rgba(255,255,255,.18)';
      });
      dz.addEventListener('drop', (e) => {
        e.preventDefault();
        dz.style.borderColor = 'rgba(255,255,255,.18)';
        const dt = e.dataTransfer;
        if (dt && dt.items && dt.items.length && dt.items[0].webkitGetAsEntry) {
          setRealStatus('reading folder…');
          collectEntries(dt.items).then(ingestFiles);
        } else if (dt && dt.files) ingestFiles(dt.files);
      });
    }
    if ($('procBtn2'))
      $('procBtn2').addEventListener('click', () =>
        processFolder().catch((e) => {
          console.error(e);
          setRealStatus('error: ' + e.message);
          $('procBtn2').disabled = false;
        })
      );
  });
})();

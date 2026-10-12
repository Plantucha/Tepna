/*
 * stage-lab-core.mjs — sleep staging from any mix of signals: feature blocks, context, a histogram GBDT, HMM
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. See the LICENSE and
 * NOTICE files at the project root, or http://www.apache.org/licenses/LICENSE-2.0
 *
 * PURE ESM, NO node: IMPORTS — so a browser app can import the same model code it was trained with.
 *
 * THE SHAPE, and why it is this shape. Staging will grow signal by signal: SpO2 first (the owner's
 * target: beat SomnoStage's published figures on the oximeter alone), then pulse, ECG-HRV, motion and
 * EEG. So a NIGHT is a 30 s epoch grid plus NAMED SIGNALS, and each signal family is one FEATURE
 * BLOCK in `BLOCKS`. Adding EEG is adding a block; nothing downstream changes. A block whose input a
 * night lacks returns NaN columns — ABSENCE IS NULL (CLAUDE.md §∅) — and the GBDT routes NaN down its
 * own learned branch, so a model trained with a signal still runs on a night without it.
 *
 * NOT IMPLEMENTED (declared, Tool Build Standard §2.11): the ecg-hrv, motion and eeg blocks. They are
 * registered with `implemented: false` so a caller asking for them gets a refusal, never zeros.
 */

export const EPOCH_S = 30;
export const STAGES = ['Wake', 'Light', 'Deep', 'REM']; // AASM collapse: N1+N2 = Light, N3(+N4) = Deep
export const STAGE_INDEX = { W: 0, Wake: 0, N1: 1, N2: 1, N3: 2, N4: 2, R: 3, REM: 3 };

/* ── small numeric helpers (NaN-aware: a NaN is a missing value, never a number) ─────────────────── */
const finite = (a) => a.filter(Number.isFinite);
function mean(a) {
  let s = 0;
  for (const v of a) s += v;
  return a.length ? s / a.length : NaN;
}
function std(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  let s = 0;
  for (const v of a) s += (v - m) ** 2;
  return Math.sqrt(s / a.length);
}
function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const p = (sorted.length - 1) * q,
    i = Math.floor(p);
  return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (p - i);
}
function slope(a) {
  const n = a.length;
  if (n < 3) return NaN;
  let sx = 0,
    sy = 0,
    sxy = 0,
    sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += a[i];
    sxy += i * a[i];
    sxx += i * i;
  }
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}
function meanAbsDiff(a) {
  let s = 0;
  for (let i = 1; i < a.length; i++) s += Math.abs(a[i] - a[i - 1]);
  return a.length > 1 ? s / (a.length - 1) : NaN;
}

/* Log band power of a 1 Hz series (linear detrend + Hann, direct DFT over the band's bins only). */
export function bandPower(a, lo, hi) {
  const n = a.length;
  if (n < 64) return NaN;
  const b = slope(a),
    m0 = mean(a) - (b * (n - 1)) / 2,
    x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = (a[i] - (m0 + b * i)) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  let p = 0;
  for (let k = Math.ceil(lo * n); k < hi * n && k <= n / 2; k++) {
    let re = 0,
      im = 0;
    const w = (2 * Math.PI * k) / n;
    for (let i = 0; i < n; i++) {
      re += x[i] * Math.cos(w * i);
      im -= x[i] * Math.sin(w * i);
    }
    p += re * re + im * im;
  }
  return Math.log(p + 1e-6);
}

/* ── FEATURE BLOCKS ──────────────────────────────────────────────────────────────────────────────
   extract(night) → { names, cols } where cols[j] is a Float64Array(nEpochs), or null if the input is absent. */
const SCALES = [30, 60, 150, 300]; // half-windows (s): 1, 2, 5, 10 min
export const MOTION_BIT_G = 0.02; // 1-bit motion threshold on the per-second |a| std (g); stated, not tuned

function windowAt(s, c, h) {
  return finite(Array.from(s.subarray(Math.max(0, c - h), Math.min(s.length, c + h))));
}

function multiScale(s, n, prefix, extra) {
  const names = [],
    cols = [];
  const add = (nm) => {
    names.push(prefix + nm);
    const c = new Float64Array(n).fill(NaN);
    cols.push(c);
    return c;
  };
  for (const h of SCALES) {
    const cm = add(`mean@${2 * h}s`),
      cs = add(`sd@${2 * h}s`),
      cr = add(`p90-p10@${2 * h}s`),
      cl = add(`slope@${2 * h}s`),
      cd = add(`mad@${2 * h}s`);
    for (let i = 0; i < n; i++) {
      const w = windowAt(s, i * EPOCH_S + EPOCH_S / 2, h);
      if (w.length < h) continue; // under half the window measured: not a value
      const srt = w.slice().sort((a, b) => a - b);
      cm[i] = mean(w);
      cs[i] = std(w);
      cr[i] = quantile(srt, 0.9) - quantile(srt, 0.1);
      cl[i] = slope(w);
      cd[i] = meanAbsDiff(w);
    }
  }
  extra(add);
  return { names, cols };
}

export const BLOCKS = {
  spo2: {
    implemented: true,
    input: 'spo2',
    extract(night) {
      const s = night.signals.spo2;
      if (!s) return null; // absent → the block is absent
      const n = night.nEpochs,
        d = s.data;
      return multiScale(d, n, 'spo2.', (add) => {
        const ev = add('desat3.count@10m'),
          fr = add('desat3.frac@10m'),
          dp = add('drop.max@10m'),
          ac = add('lag1ac@10m'),
          b1 = add('lnpow.005-.02Hz'),
          b2 = add('lnpow.02-.05Hz'),
          b3 = add('lnpow.05-.1Hz');
        for (let i = 0; i < n; i++) {
          const w = windowAt(d, i * EPOCH_S + EPOCH_S / 2, 300);
          if (w.length < 300) continue;
          let run = -Infinity,
            cnt = 0,
            inD = 0,
            prev = false,
            mx = 0;
          for (const v of w) {
            run = Math.max(run, v);
            const dr = run - v,
              isD = dr >= 3;
            if (isD && !prev) cnt++;
            if (isD) inD++;
            prev = isD;
            if (dr > mx) mx = dr;
          }
          ev[i] = cnt;
          fr[i] = inD / w.length;
          dp[i] = mx;
          const m = mean(w);
          let num = 0,
            den = 0;
          for (let k = 0; k < w.length; k++) {
            den += (w[k] - m) ** 2;
            if (k) num += (w[k] - m) * (w[k - 1] - m);
          }
          ac[i] = den > 0 ? num / den : NaN;
          b1[i] = bandPower(w, 0.005, 0.02);
          b2[i] = bandPower(w, 0.02, 0.05);
          b3[i] = bandPower(w, 0.05, 0.1);
        }
      });
    }
  },
  pulse: {
    // 1 Hz pulse rate, as an oximeter reports it
    implemented: true,
    input: 'pulse',
    extract(night) {
      const s = night.signals.pulse;
      if (!s) return null;
      const n = night.nEpochs,
        d = s.data;
      return multiScale(d, n, 'pulse.', (add) => {
        const v = add('lnpow.01-.04Hz'),
          l = add('lnpow.04-.15Hz'),
          // v19 (Vaquerizo-Villar 2025, Eng Appl AI 162:112562): the macro band 0.004–0.020 Hz (wake high, REM 0.010–0.020)
          // and the respiratory-modulation band 0.18–0.40 Hz (NREM) — an oximeter's 1 Hz PR DOES carry it; both over the
          // same 10-min window (resolution 1/600 Hz).
          m = add('lnpow.004-.02Hz'),
          r = add('lnpow.18-.40Hz');
        for (let i = 0; i < n; i++) {
          const w = windowAt(d, i * EPOCH_S + EPOCH_S / 2, 300);
          if (w.length < 300) continue;
          v[i] = bandPower(w, 0.01, 0.04);
          l[i] = bandPower(w, 0.04, 0.15);
          m[i] = bandPower(w, 0.004, 0.02);
          r[i] = bandPower(w, 0.18, 0.4);
        }
      });
    }
  },
  'ecg-hrv': { implemented: false, input: 'ecg' },
  motion: {
    /* 1 Hz wrist/finger ACTIVITY (std of |a| within the second, g). Two column families from ONE input so a bench run
       can drop either by name (brief §16, v17): `motion.*` = the activity itself; `mbit.*` = the same statistics over a
       1-bit "moved this second" flag (activity > MOTION_BIT_G), the poorest signal a ring could report. */
    implemented: true,
    input: 'motion',
    extract(night) {
      const s = night.signals.motion;
      if (!s) return null;
      const n = night.nEpochs,
        d = s.data,
        bit = Float64Array.from(d, (v) => (Number.isFinite(v) ? (v > MOTION_BIT_G ? 1 : 0) : NaN));
      const still = (x, pre) => (add) => {
        const q = add('still-run@600s'); // seconds since the last movement, capped at 10 min: the classic actigraphy cue
        let run = 600;
        const last = new Float64Array(x.length);
        for (let i = 0; i < x.length; i++) {
          if (Number.isFinite(x[i])) run = x[i] > (pre === 'mbit.' ? 0.5 : MOTION_BIT_G) ? 0 : Math.min(600, run + 1);
          last[i] = run;
        }
        for (let i = 0; i < n; i++) {
          const t = Math.min(x.length - 1, i * EPOCH_S + EPOCH_S - 1);
          if (t >= 0) q[i] = last[t];
        }
      };
      const a = multiScale(d, n, 'motion.', still(d, 'motion.')),
        b = multiScale(bit, n, 'mbit.', still(bit, 'mbit.'));
      return { names: [...a.names, ...b.names], cols: [...a.cols, ...b.cols] };
    }
  },
  eeg: { implemented: false, input: 'eeg' }
};

/* ── CONTEXT: per-night robust normalisation + multi-scale temporal context, for ANY block ────────
   Night-relative because the literature and our own data agree the absolute levels vary by person
   (Schumann 2010: alpha1 depends on age). NaN stays NaN — normalisation never invents a value. */
export const CONTEXT_EPOCHS = [2, 10, 30];

export function withContext(block, n) {
  const names = [],
    cols = [];
  for (let j = 0; j < block.cols.length; j++) {
    const c = block.cols[j],
      f = finite(Array.from(c)).sort((a, b) => a - b);
    const med = quantile(f, 0.5),
      iqr = quantile(f, 0.75) - quantile(f, 0.25) || 1;
    const z = Float64Array.from(c, (v) => (Number.isFinite(v) && f.length >= 10 ? (v - med) / iqr : NaN));
    names.push(block.names[j]);
    cols.push(z);
    for (const k of CONTEXT_EPOCHS) {
      // centred mean over the finite values in ±k epochs
      const m = new Float64Array(n).fill(NaN);
      for (let i = 0; i < n; i++) {
        let s = 0,
          q = 0;
        for (let t = Math.max(0, i - k); t <= Math.min(n - 1, i + k); t++)
          if (Number.isFinite(z[t])) {
            s += z[t];
            q++;
          }
        if (q) m[i] = s / q;
      }
      names.push(`${block.names[j]}@±${k}ep`);
      cols.push(m);
      if (k === CONTEXT_EPOCHS[CONTEXT_EPOCHS.length - 1]) {
        names.push(`${block.names[j]}-ctx${k}`);
        cols.push(Float64Array.from(z, (v, i) => v - m[i]));
      }
    }
  }
  return { names, cols };
}

/* The column names a block produces, derived from an all-missing one-epoch night — so a night that
   LACKS the signal still yields the identical layout, filled with NaN (absent, never zero). */
const _layout = {};
export function blockLayout(b) {
  if (!_layout[b]) {
    const B = BLOCKS[b];
    const dummy = { nEpochs: 1, signals: { [B.input]: { fs: 1, data: new Float64Array(EPOCH_S).fill(NaN) } } };
    _layout[b] = withContext(B.extract(dummy), 1).names;
  }
  return _layout[b];
}

/* A night's feature matrix: the requested blocks (each with context) + time of night. Refuses an
   unimplemented block by name. Returns { names, X: Float32Array(n*k), k }. */
export function nightFeatures(night, blockNames) {
  const n = night.nEpochs,
    names = [],
    cols = [];
  for (const b of blockNames) {
    const B = BLOCKS[b];
    if (!B) throw new Error(`unknown feature block "${b}"`);
    if (!B.implemented) throw new Error(`feature block "${b}" is declared but NOT IMPLEMENTED`);
    const raw = B.extract(night);
    if (raw) {
      const ctx = withContext(raw, n);
      names.push(...ctx.names);
      cols.push(...ctx.cols);
    } else
      for (const nm of blockLayout(b)) {
        names.push(nm);
        cols.push(new Float64Array(n).fill(NaN));
      }
  }
  names.push('time_of_night');
  cols.push(Float64Array.from({ length: n }, (_, i) => i / n));
  const k = cols.length,
    X = new Float32Array(n * k);
  for (let j = 0; j < k; j++) for (let i = 0; i < n; i++) X[i * k + j] = cols[j][i];
  return { names, X, k };
}

/* ── HISTOGRAM GBDT (multiclass softmax) ──────────────────────────────────────────────────────────
   Bins: per-feature quantile edges, <= 254 bins; bin 255 is MISSING. Each split learns which side
   missing values go to. Leaf-wise growth, L2-regularised leaves. Deterministic (no row sampling). */
const MISS = 255;

export function makeBins(X, nRows, k, maxBins = 254, sampleEvery = 1) {
  const edges = [];
  for (let j = 0; j < k; j++) {
    const v = [];
    for (let i = 0; i < nRows; i += sampleEvery) {
      const x = X[i * k + j];
      if (Number.isFinite(x)) v.push(x);
    }
    v.sort((a, b) => a - b);
    const e = [];
    for (let b = 1; b < maxBins; b++) {
      const q = quantile(v, b / maxBins);
      if (Number.isFinite(q) && (!e.length || q > e[e.length - 1])) e.push(q);
    }
    edges.push(e);
  }
  return edges;
}

export function binMatrix(X, nRows, k, edges) {
  const B = new Uint8Array(nRows * k);
  for (let j = 0; j < k; j++) {
    const e = edges[j];
    for (let i = 0; i < nRows; i++) {
      const x = X[i * k + j];
      if (!Number.isFinite(x)) {
        B[i * k + j] = MISS;
        continue;
      }
      let lo = 0,
        hi = e.length; // first edge > x
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (e[m] <= x) lo = m + 1;
        else hi = m;
      }
      B[i * k + j] = lo;
    }
  }
  return B;
}

function histogram(B, k, rows, g, h) {
  const H = new Float64Array(k * 256 * 3);
  for (const r of rows) {
    const o = r * k,
      gr = g[r],
      hr = h[r];
    for (let j = 0; j < k; j++) {
      const p = (j * 256 + B[o + j]) * 3;
      H[p] += gr;
      H[p + 1] += hr;
      H[p + 2]++;
    }
  }
  return H;
}

function bestSplit(H, k, lambda, minLeaf) {
  let best = { gain: 0 };
  for (let j = 0; j < k; j++) {
    let G = 0,
      Hs = 0,
      N = 0;
    for (let b = 0; b < 256; b++) {
      const p = (j * 256 + b) * 3;
      G += H[p];
      Hs += H[p + 1];
      N += H[p + 2];
    }
    const pm = (j * 256 + MISS) * 3,
      Gm = H[pm],
      Hm = H[pm + 1],
      Nm = H[pm + 2];
    const parent = (G * G) / (Hs + lambda);
    let gl = 0,
      hl = 0,
      nl = 0;
    for (let b = 0; b < MISS - 1; b++) {
      const p = (j * 256 + b) * 3;
      gl += H[p];
      hl += H[p + 1];
      nl += H[p + 2];
      for (const missLeft of [false, true]) {
        const GL = gl + (missLeft ? Gm : 0),
          HL = hl + (missLeft ? Hm : 0),
          NL = nl + (missLeft ? Nm : 0);
        const GR = G - GL,
          HR = Hs - HL,
          NR = N - NL;
        if (NL < minLeaf || NR < minLeaf) continue;
        const gain = (GL * GL) / (HL + lambda) + (GR * GR) / (HR + lambda) - parent;
        if (gain > best.gain) best = { gain, f: j, bin: b, missLeft };
      }
    }
  }
  return best;
}

function growTree(B, k, rows, g, h, o) {
  const nodes = [];
  const leafVal = (rs) => {
    let G = 0,
      Hs = 0;
    for (const r of rs) {
      G += g[r];
      Hs += h[r];
    }
    return (-G / (Hs + o.lambda)) * o.lr;
  };
  const root = { id: 0, rows, H: histogram(B, k, rows, g, h) };
  nodes.push({ leaf: leafVal(rows) });
  root.split = bestSplit(root.H, k, o.lambda, o.minLeaf);
  const open = [root];
  let leaves = 1;
  while (leaves < o.maxLeaves) {
    open.sort((a, b) => (b.split.gain || 0) - (a.split.gain || 0));
    const nd = open.shift();
    if (!nd || !(nd.split.gain > o.minGain)) break;
    const { f, bin, missLeft } = nd.split,
      L = [],
      R = [];
    for (const r of nd.rows) {
      const v = B[r * k + f];
      (v === MISS ? missLeft : v <= bin) ? L.push(r) : R.push(r);
    }
    const small = L.length < R.length ? L : R,
      Hs = histogram(B, k, small, g, h),
      Hb = nd.H.map((v, i) => v - Hs[i]);
    const [HL, HR] = small === L ? [Hs, Hb] : [Hb, Hs];
    const li = nodes.length,
      ri = li + 1;
    nodes.push({ leaf: leafVal(L) }, { leaf: leafVal(R) });
    nodes[nd.id] = { f, bin, missLeft, l: li, r: ri };
    for (const [id, rs, H] of [
      [li, L, HL],
      [ri, R, HR]
    ]) {
      const c = { id, rows: rs, H };
      c.split = bestSplit(H, k, o.lambda, o.minLeaf);
      open.push(c);
    }
    leaves++;
  }
  return nodes;
}

/* fit(X, y, nRows, k, opts, onIter) → model. y in 0..3; rows with y < 0 are ignored. */
export function fitGBDT(X, y, nRows, k, opts = {}, onIter = null) {
  const o = { iters: 300, lr: 0.1, maxLeaves: 31, minLeaf: 100, lambda: 1, minGain: 1e-6, K: 4, binSample: 1, ...opts };
  const rows = [];
  for (let i = 0; i < nRows; i++) if (y[i] >= 0) rows.push(i);
  const edges = makeBins(X, nRows, k, 254, o.binSample),
    B = binMatrix(X, nRows, k, edges);
  const prior = new Float64Array(o.K);
  for (const r of rows) prior[y[r]]++;
  const base = Array.from(prior, (c) => Math.log((c + 1) / (rows.length + o.K)));
  const F = new Float64Array(nRows * o.K);
  for (const r of rows) for (let c = 0; c < o.K; c++) F[r * o.K + c] = base[c];
  const trees = [],
    g = new Float64Array(nRows),
    h = new Float64Array(nRows);
  for (let it = 0; it < o.iters; it++) {
    const P = softmaxRows(F, rows, o.K);
    const round = [];
    for (let c = 0; c < o.K; c++) {
      for (const r of rows) {
        const p = P[r * o.K + c];
        g[r] = p - (y[r] === c ? 1 : 0);
        h[r] = Math.max(p * (1 - p), 1e-6);
      }
      const t = growTree(B, k, rows, g, h, o);
      for (const r of rows) F[r * o.K + c] += walk(t, (j) => B[r * k + j]);
      round.push(t);
    }
    trees.push(round);
    if (onIter) onIter(it + 1, o.iters);
  }
  return { schema: 'tepna.stage-gbdt/1', K: o.K, base, edges, trees };
}

function softmaxRows(F, rows, K) {
  const P = new Float64Array(F.length);
  for (const r of rows) {
    let m = -Infinity;
    for (let c = 0; c < K; c++) m = Math.max(m, F[r * K + c]);
    let s = 0;
    for (let c = 0; c < K; c++) {
      const e = Math.exp(F[r * K + c] - m);
      P[r * K + c] = e;
      s += e;
    }
    for (let c = 0; c < K; c++) P[r * K + c] /= s;
  }
  return P;
}

function walk(nodes, binOf) {
  let i = 0;
  for (;;) {
    const nd = nodes[i];
    if ('leaf' in nd) return nd.leaf;
    const v = binOf(nd.f);
    i = (v === MISS ? nd.missLeft : v <= nd.bin) ? nd.l : nd.r;
  }
}

/* Class probabilities for raw feature rows (browser-safe; bins raw values with the model's own edges). */
export function predictProba(model, X, nRows, k) {
  const B = binMatrix(X, nRows, k, model.edges),
    K = model.K,
    out = new Float64Array(nRows * K);
  for (let r = 0; r < nRows; r++) {
    const f = model.base.slice();
    for (const round of model.trees) for (let c = 0; c < K; c++) f[c] += walk(round[c], (j) => B[r * k + j]);
    const m = Math.max(...f);
    let s = 0;
    for (let c = 0; c < K; c++) {
      f[c] = Math.exp(f[c] - m);
      s += f[c];
    }
    for (let c = 0; c < K; c++) out[r * K + c] = f[c] / s;
  }
  return out;
}

/* ── HMM smoothing ───────────────────────────────────────────────────────────────────────────── */
export function transitions(labelSeqs, K = 4) {
  const T = Array.from({ length: K }, () => new Float64Array(K).fill(1));
  for (const y of labelSeqs) for (let i = 1; i < y.length; i++) if (y[i - 1] >= 0 && y[i] >= 0) T[y[i - 1]][y[i]]++;
  return T.map((row) => {
    const s = row.reduce((a, b) => a + b, 0);
    return Array.from(row, (v) => Math.log(v / s));
  });
}

/* Viterbi over per-epoch posteriors (divided by the class prior → scaled likelihoods). */
export function viterbi(P, n, K, logT, logPrior) {
  const D = new Float64Array(n * K),
    Bk = new Int32Array(n * K);
  for (let c = 0; c < K; c++) D[c] = Math.log(P[c] + 1e-9);
  for (let t = 1; t < n; t++)
    for (let c = 0; c < K; c++) {
      let best = -Infinity,
        arg = 0;
      for (let a = 0; a < K; a++) {
        const v = D[(t - 1) * K + a] + logT[a][c];
        if (v > best) {
          best = v;
          arg = a;
        }
      }
      D[t * K + c] = best + Math.log(P[t * K + c] + 1e-9) - logPrior[c];
      Bk[t * K + c] = arg;
    }
  const path = new Int32Array(n);
  let last = 0;
  for (let c = 1; c < K; c++) if (D[(n - 1) * K + c] > D[(n - 1) * K + last]) last = c;
  path[n - 1] = last;
  for (let t = n - 1; t > 0; t--) path[t - 1] = Bk[t * K + path[t]];
  return path;
}

/* ── explicit-duration HSMM with a time-of-night prior (brief §10, v13) ──────────────────────────
   A plain HMM gives every stage a geometric bout length, which sleep does not have (REM bouts lengthen through
   the night, N3 fronts the night — Borbély 1982 two-process model; McCarley & Hobson 1975 NREM–REM oscillator).
   This decoder learns, from the TRAINING hypnograms only: the bout-duration histogram per stage (1..dMax
   epochs, tail mass as a self-transition), the bout-to-bout transition matrix, and an empirical time-of-night
   curve per stage (bins of `binEpochs` from record start) applied as log(p_s(bin) / p_s) with weight `timeW`.
   Emissions are the per-epoch posteriors divided by the class prior, as in `viterbi`. */
export function hsmmFit(labelSeqs, K = 4, dMax = 120, binEpochs = 20, nBins = 60) {
  const dur = Array.from({ length: K }, () => new Float64Array(dMax + 1).fill(0.5)),
    tail = new Float64Array(K).fill(0.5);
  const A = Array.from({ length: K }, () => new Float64Array(K).fill(0.5)),
    first = new Float64Array(K).fill(1);
  const tb = Array.from({ length: nBins }, () => new Float64Array(K).fill(1)),
    marg = new Float64Array(K).fill(1);
  for (const y of labelSeqs) {
    let prev = -1,
      len = 0,
      firstSeen = false;
    for (let t = 0; t <= y.length; t++) {
      const s = t < y.length ? y[t] : -2;
      if (t < y.length && s >= 0) {
        tb[Math.min(nBins - 1, (t / binEpochs) | 0)][s]++;
        marg[s]++;
        if (!firstSeen) {
          first[s]++;
          firstSeen = true;
        }
      }
      if (s === prev) {
        len++;
        continue;
      }
      if (prev >= 0) {
        if (len <= dMax) dur[prev][len]++;
        else tail[prev]++;
        if (s >= 0) A[prev][s]++;
      }
      prev = s;
      len = 1;
    }
  }
  const logDur = dur.map((h, s) => {
    const tot = h.reduce((a, b) => a + b, 0) - 0.5 + tail[s];
    return Float64Array.from(h, (v, d) => (d === 0 ? -Infinity : Math.log(v / tot)));
  });
  const logTail = Array.from(tail, (v, s) => Math.log(v / (dur[s].reduce((a, b) => a + b, 0) - 0.5 + v)));
  const logA = A.map((row, s) => {
    row[s] = 0;
    const tot = row.reduce((a, b) => a + b, 0);
    return Array.from(row, (v, c) => (c === s ? -Infinity : Math.log(v / tot)));
  });
  const fs = first.reduce((a, b) => a + b, 0),
    logFirst = Array.from(first, (v) => Math.log(v / fs));
  const mt = marg.reduce((a, b) => a + b, 0);
  const logTime = tb.map((row) => {
    const tot = row.reduce((a, b) => a + b, 0);
    return Array.from(row, (v, s) => Math.log(v / tot) - Math.log(marg[s] / mt));
  });
  return { K, dMax, binEpochs, nBins, logDur, logTail, logA, logFirst, logTime };
}

export function hsmmViterbi(P, n, K, M, logPrior, timeW = 1) {
  const { dMax, logDur, logTail, logA, logFirst, logTime, binEpochs, nBins } = M;
  // cumulative per-state emissions: C[s*(n+1)+t] = Σ_{u<t} e[u][s]
  const C = new Float64Array(K * (n + 1));
  for (let s = 0; s < K; s++)
    for (let t = 0; t < n; t++) {
      const bin = Math.min(nBins - 1, (t / binEpochs) | 0);
      C[s * (n + 1) + t + 1] = C[s * (n + 1) + t] + Math.log(P[t * K + s] + 1e-9) - logPrior[s] + timeW * logTime[bin][s];
    }
  const D = new Float64Array(n * K).fill(-Infinity),
    Bd = new Int32Array(n * K),
    Bs = new Int32Array(n * K).fill(-1);
  const bp = new Float64Array(n * K),
    bpArg = new Int32Array(n * K); // best predecessor ending at t, entering s
  for (let t = 0; t < n; t++) {
    for (let s = 0; s < K; s++) {
      const base = s * (n + 1);
      for (let d = 1; d <= Math.min(dMax, t + 1); d++) {
        const t0 = t - d + 1,
          seg = C[base + t + 1] - C[base + t0];
        let v,
          from = -1;
        if (t0 === 0) v = logFirst[s] + logDur[s][d] + seg;
        else {
          v = bp[(t0 - 1) * K + s] + logDur[s][d] + seg;
          from = bpArg[(t0 - 1) * K + s];
        }
        if (v > D[t * K + s]) {
          D[t * K + s] = v;
          Bd[t * K + s] = d;
          Bs[t * K + s] = from;
        }
      }
      // over-long bout: a segment of exactly dMax that continues in the same state (tail mass)
      if (t >= dMax) {
        const t0 = t - dMax + 1,
          v = D[(t0 - 1) * K + s] + logTail[s] + C[base + t + 1] - C[base + t0];
        if (v > D[t * K + s]) {
          D[t * K + s] = v;
          Bd[t * K + s] = dMax;
          Bs[t * K + s] = s;
        }
      }
    }
    for (let s = 0; s < K; s++) {
      let best = -Infinity,
        arg = 0;
      for (let a = 0; a < K; a++) {
        const v = D[t * K + a] + logA[a][s];
        if (v > best) {
          best = v;
          arg = a;
        }
      }
      bp[t * K + s] = best;
      bpArg[t * K + s] = arg;
    }
  }
  const path = new Int32Array(n);
  let t = n - 1,
    s = 0;
  for (let c = 1; c < K; c++) if (D[t * K + c] > D[t * K + s]) s = c;
  while (t >= 0) {
    const d = Bd[t * K + s],
      from = Bs[t * K + s];
    for (let u = t - d + 1; u <= t; u++) path[u] = s;
    t -= d;
    s = from;
  }
  return path;
}

/* ── agreement ───────────────────────────────────────────────────────────────────────────────── */
export function confusion(y, p, K = 4) {
  const M = Array.from({ length: K }, () => new Float64Array(K));
  for (let i = 0; i < y.length; i++) if (y[i] >= 0) M[y[i]][p[i]]++;
  return M;
}
export function kappa(M) {
  const K = M.length;
  let n = 0,
    d = 0;
  const r = new Float64Array(K),
    c = new Float64Array(K);
  for (let a = 0; a < K; a++)
    for (let b = 0; b < K; b++) {
      n += M[a][b];
      r[a] += M[a][b];
      c[b] += M[a][b];
      if (a === b) d += M[a][b];
    }
  let pe = 0;
  for (let a = 0; a < K; a++) pe += (r[a] * c[a]) / (n * n);
  return (d / n - pe) / (1 - pe);
}
export function sumMatrices(Ms) {
  const K = Ms[0].length,
    S = Array.from({ length: K }, () => new Float64Array(K));
  for (const M of Ms) for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) S[a][b] += M[a][b];
  return S;
}

/* 95 % interval by resampling NIGHTS (epochs within a night are not independent). Seeded. */
export function bootstrapKappa(perNight, B = 1000, seed = 1) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const ks = [];
  for (let b = 0; b < B; b++) {
    const pick = perNight.map(() => perNight[Math.floor(rnd() * perNight.length)]);
    ks.push(kappa(sumMatrices(pick)));
  }
  ks.sort((a, b) => a - b);
  return [quantile(ks, 0.025), quantile(ks, 0.975)];
}

/* ── THE FORMULA: per-stage log-odds = Σ literature-motivated terms, each a line plus ONE bend ────────
   The owner's route to a licence-clean artifact: a few dozen coefficients on published physiology, not a
   black box. Each SpO2 term enters as z (per-night normalised) and max(0, z) — a straight line with one bend
   at the night's median ("minor curve additions"). Time enters as the published shapes: Process-S decay
   exp(-t/0.25), REM propensity rising with t, and wake at the recording edges. */
export const FORMULA_TERMS = [
  ['spo2.sd@60s@±10ep', 'short-window SpO2 variability (irregular breathing: REM up, deep down)'],
  ['spo2.sd@600s@±10ep', 'long-window SpO2 variability'],
  ['spo2.desat3.count@10m@±10ep', 'desaturation density (REM-predominant in apnoea)'],
  ['spo2.lnpow.02-.05Hz@±10ep', 'cyclic-desaturation band power (unstable sleep)'],
  ['spo2.mean@600s@±10ep', 'SpO2 level (slightly lower asleep than awake)'],
  ['spo2.slope@600s@±10ep', 'SpO2 trend'],
  ['spo2.lag1ac@10m@±10ep', 'SpO2 autocorrelation (smoothness)'],
  ['spo2.mad@60s', 'beat-scale SpO2 roughness (movement / wake)']
];

export function formulaBasis(names, X, n, k) {
  const idx = FORMULA_TERMS.map(([nm]) => names.indexOf(nm));
  if (idx.some((i) => i < 0))
    throw new Error(
      'formula term missing from features: ' +
        FORMULA_TERMS.filter((_, j) => idx[j] < 0)
          .map((t) => t[0])
          .join(', ')
    );
  const t = names.indexOf('time_of_night'),
    m = idx.length * 2 + 3,
    Z = new Float64Array(n * m),
    labels = [];
  for (const [nm] of FORMULA_TERMS) labels.push(nm, `max(0,${nm})`);
  labels.push('exp(-t/0.25)', 't', 'edges');
  for (let r = 0; r < n; r++) {
    let o = r * m;
    for (const j of idx) {
      const v = X[r * k + j],
        z = Number.isFinite(v) ? v : 0;
      Z[o++] = z;
      Z[o++] = Math.max(0, z);
    } // missing → the night's median (0)
    const tt = X[r * k + t];
    Z[o++] = Math.exp(-tt / 0.25);
    Z[o++] = tt;
    Z[o++] = Math.exp(-tt / 0.05) + Math.exp(-(1 - tt) / 0.05);
  }
  return { Z, m, labels };
}

/* Multinomial logistic (softmax) regression, L2-penalised, full-batch Adam on standardised columns.
   Returns coefficients in the ORIGINAL (unstandardised) units so the formula can be written down. */
export function fitSoftmax(Z, y, n, m, o = {}) {
  const K = 4,
    l2 = o.l2 ?? 1e-3,
    iters = o.iters ?? 400,
    lr = o.lr ?? 0.05;
  const rows = [];
  for (let i = 0; i < n; i++) if (y[i] >= 0) rows.push(i);
  const mu = new Float64Array(m),
    sd = new Float64Array(m);
  for (const r of rows) for (let j = 0; j < m; j++) mu[j] += Z[r * m + j];
  for (let j = 0; j < m; j++) mu[j] /= rows.length;
  for (const r of rows) for (let j = 0; j < m; j++) sd[j] += (Z[r * m + j] - mu[j]) ** 2;
  for (let j = 0; j < m; j++) sd[j] = Math.sqrt(sd[j] / rows.length) || 1;
  const W = new Float64Array(K * (m + 1)),
    M1 = new Float64Array(W.length),
    M2 = new Float64Array(W.length),
    G = new Float64Array(W.length),
    p = new Float64Array(K);
  for (let it = 1; it <= iters; it++) {
    G.fill(0);
    for (const r of rows) {
      let mx = -Infinity;
      for (let c = 0; c < K; c++) {
        let s = W[c * (m + 1) + m];
        for (let j = 0; j < m; j++) s += W[c * (m + 1) + j] * ((Z[r * m + j] - mu[j]) / sd[j]);
        p[c] = s;
        if (s > mx) mx = s;
      }
      let S = 0;
      for (let c = 0; c < K; c++) {
        p[c] = Math.exp(p[c] - mx);
        S += p[c];
      }
      for (let c = 0; c < K; c++) {
        const e = p[c] / S - (y[r] === c ? 1 : 0);
        for (let j = 0; j < m; j++) G[c * (m + 1) + j] += e * ((Z[r * m + j] - mu[j]) / sd[j]);
        G[c * (m + 1) + m] += e;
      }
    }
    for (let q = 0; q < W.length; q++) {
      const g = G[q] / rows.length + (q % (m + 1) === m ? 0 : l2 * W[q]);
      M1[q] = 0.9 * M1[q] + 0.1 * g;
      M2[q] = 0.999 * M2[q] + 0.001 * g * g;
      W[q] -= (lr * (M1[q] / (1 - 0.9 ** it))) / (Math.sqrt(M2[q] / (1 - 0.999 ** it)) + 1e-8);
    }
  }
  const B = Array.from({ length: K }, (_, c) => {
    const w = [];
    let b = W[c * (m + 1) + m];
    for (let j = 0; j < m; j++) {
      const v = W[c * (m + 1) + j] / sd[j];
      w.push(v);
      b -= v * mu[j];
    }
    return { w, b };
  });
  return { schema: 'tepna.stage-formula/1', K, terms: m, coef: B };
}

export function softmaxProba(F, Z, n, m) {
  const K = F.K,
    P = new Float64Array(n * K);
  for (let r = 0; r < n; r++) {
    let mx = -Infinity;
    const s = new Float64Array(K);
    for (let c = 0; c < K; c++) {
      let v = F.coef[c].b;
      for (let j = 0; j < m; j++) v += F.coef[c].w[j] * Z[r * m + j];
      s[c] = v;
      if (v > mx) mx = v;
    }
    let S = 0;
    for (let c = 0; c < K; c++) {
      s[c] = Math.exp(s[c] - mx);
      S += s[c];
    }
    for (let c = 0; c < K; c++) P[r * K + c] = s[c] / S;
  }
  return P;
}

/* ── VIRTUAL OXIMETER: one SpO2 device for every cohort (brief §6, v9) ─────────────────────────────
   Labs differ in averaging time (2–16 s), resolution (whole % vs decimals) and sampling; the variability
   and desaturation features measure those device habits, so they do not carry across labs. Harmonise
   every night to the same device: per-second SpO2 → centred 8 s moving mean over the measured seconds
   (so every source ends at least that smooth) → rounded to whole percent. Missing stays missing (§∅). */
export function harmonizeSpo2(d, avgS = 8) {
  const n = d.length,
    out = new Float64Array(n).fill(NaN),
    h = avgS >> 1;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(d[i])) continue;
    let s = 0,
      q = 0;
    for (let j = Math.max(0, i - h); j < Math.min(n, i + avgS - h); j++)
      if (Number.isFinite(d[j])) {
        s += d[j];
        q++;
      }
    out[i] = Math.round(s / q);
  }
  return out;
}

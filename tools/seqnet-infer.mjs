/* Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ════════════════════════════════════════════════════════════════════════
 * seqnet-infer.mjs — run the stage-lab control net (seqnet.py's TCN + biGRU + Viterbi) in plain JS with no runtime library, so a trained stager can ship inside a bundled offline Tepna instrument.
 *
 * The architecture: 1×1 stem → six residual dilated-conv blocks → bidirectional GRU → linear → softmax →
 * HMM Viterbi (ARCHITECTURE-PRINCIPLES §0: browser-native, no install, no network).
 *
 * Weights come from `seqnet_export.py` as `tepna-seqnet/1` JSON: PyTorch state_dict names, shapes
 * and flat float32 data. Layouts here are [T][C] row-major Float32Arrays; PyTorch's are [B][C][T]
 * for convs and [B][T][C] for the GRU — the transposes are folded into the index arithmetic.
 *
 * PyTorch semantics reproduced exactly (the parity test holds the port to 1e-4 on golden vectors):
 *   Conv1d k=5 dilation d padding 2d ('same' length), GroupNorm(8, 64) over (channels-in-group × T)
 *   with eps 1e-5, exact (erf) GELU, GRU gate order (r, z, n) with n = tanh(W_in x + b_in + r ⊙ (W_hn h + b_hn)),
 *   h' = (1 − z) ⊙ n + z ⊙ h; the backward direction runs the sequence reversed and is concatenated after
 *   the forward half. Dropout is identity (eval mode).
 */

/** Exact erf (W. J. Cody's rational approximation, |err| < 1e-15), so GELU matches torch's erf GELU. */
function erf(x) {
  const ax = Math.abs(x);
  let r;
  if (ax < 0.5) {
    const t = x * x;
    const p = [3.1611237438705656, 1.13864154151050156e2, 3.77485237685302021e2, 3.20937758913846947e3, 1.85777706184603153e-1];
    const q = [2.36012909523441209e1, 2.44024637934444173e2, 1.28261652607737228e3, 2.84423683343917062e3];
    let xn = p[4] * t,
      xd = t;
    for (let i = 0; i < 3; i++) {
      xn = (xn + p[i]) * t;
      xd = (xd + q[i]) * t;
    }
    return (x * (xn + p[3])) / (xd + q[3]);
  }
  if (ax <= 4) {
    const p = [
      5.64188496988670089e-1, 8.88314979438837594, 6.61191906371416295e1, 2.98635138197400131e2, 8.8195222124176909e2, 1.71204761263407058e3, 2.05107837782607147e3, 1.23033935479799725e3,
      2.15311535474403846e-8
    ];
    const q = [1.57449261107098347e1, 1.17693950891312499e2, 5.37181101862009858e2, 1.62138957456669019e3, 3.29079923573345963e3, 4.36261909014324716e3, 3.43936767414372164e3, 1.23033935480374942e3];
    let xn = p[8] * ax,
      xd = ax;
    for (let i = 0; i < 7; i++) {
      xn = (xn + p[i]) * ax;
      xd = (xd + q[i]) * ax;
    }
    r = (xn + p[7]) / (xd + q[7]);
    const xsq = Math.trunc(ax * 16) / 16,
      del = (ax - xsq) * (ax + xsq);
    r = 1 - Math.exp(-xsq * xsq) * Math.exp(-del) * r;
  } else {
    const p = [3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1, 1.60837851487422766e-2, 6.58749161529837803e-4, 1.63153871373020978e-2];
    const q = [2.56852019228982242, 1.87295284992346725, 5.27905102951428412e-1, 6.05183413124413191e-2, 2.33520497626869185e-3];
    const t = 1 / (ax * ax);
    let xn = p[5] * t,
      xd = t;
    for (let i = 0; i < 4; i++) {
      xn = (xn + p[i]) * t;
      xd = (xd + q[i]) * t;
    }
    r = (t * (xn + p[4])) / (xd + q[4]);
    r = (0.5641895835477563 - r) / ax;
    const xsq = Math.trunc(ax * 16) / 16,
      del = (ax - xsq) * (ax + xsq);
    r = 1 - Math.exp(-xsq * xsq) * Math.exp(-del) * r;
  }
  return x < 0 ? -r : r;
}
const gelu = (x) => 0.5 * x * (1 + erf(x / Math.SQRT2));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/** Parse the exported JSON into typed arrays keyed by state_dict name. */
function loadWeights(json) {
  const w = {};
  for (const [name, { shape, data }] of Object.entries(json.layers)) w[name] = { shape, data: Float32Array.from(data) };
  return { arch: json.arch, meta: json.meta, w };
}

/** 1×1 conv: X[T][cin] → Y[T][cout]. weight [cout][cin][1], bias [cout]. */
function conv1x1(X, T, cin, weight, bias, cout) {
  const Y = new Float32Array(T * cout);
  for (let t = 0; t < T; t++) {
    const xo = t * cin,
      yo = t * cout;
    for (let o = 0; o < cout; o++) {
      let s = bias[o];
      const wo = o * cin;
      for (let i = 0; i < cin; i++) s += weight[wo + i] * X[xo + i];
      Y[yo + o] = s;
    }
  }
  return Y;
}

/** Dilated 'same' conv, kernel k, dilation d, padding d·(k−1)/2: X[T][C] → Y[T][C]. weight [C][C][k]. */
function convDilated(X, T, C, k, d, weight, bias) {
  const Y = new Float32Array(T * C),
    pad = (d * (k - 1)) / 2;
  for (let t = 0; t < T; t++) {
    const yo = t * C;
    for (let o = 0; o < C; o++) {
      let s = bias[o];
      const wo = o * C * k;
      for (let j = 0; j < k; j++) {
        const tt = t - pad + j * d;
        if (tt < 0 || tt >= T) continue;
        const xo = tt * C,
          wj = wo + j;
        for (let i = 0; i < C; i++) s += weight[wj + i * k] * X[xo + i];
      }
      Y[yo + o] = s;
    }
  }
  return Y;
}

/** GroupNorm over (channels-in-group × T), per sample, then affine. In place on a [T][C] array. */
function groupNorm(X, T, C, groups, eps, gamma, beta) {
  const per = C / groups;
  for (let g = 0; g < groups; g++) {
    const c0 = g * per,
      c1 = c0 + per;
    let mean = 0;
    for (let t = 0; t < T; t++) for (let c = c0; c < c1; c++) mean += X[t * C + c];
    mean /= T * per;
    let v = 0;
    for (let t = 0; t < T; t++)
      for (let c = c0; c < c1; c++) {
        const dlt = X[t * C + c] - mean;
        v += dlt * dlt;
      }
    const inv = 1 / Math.sqrt(v / (T * per) + eps);
    for (let t = 0; t < T; t++)
      for (let c = c0; c < c1; c++) {
        const i = t * C + c;
        X[i] = (X[i] - mean) * inv * gamma[c] + beta[c];
      }
  }
  return X;
}

/** One residual block: x + c2(gelu(gn(c1(x)))). */
function block(X, T, C, k, d, w, i, groups, eps) {
  const p = `blocks.${i}.`;
  const h = convDilated(X, T, C, k, d, w[p + 'c1.weight'].data, w[p + 'c1.bias'].data);
  groupNorm(h, T, C, groups, eps, w[p + 'n.weight'].data, w[p + 'n.bias'].data);
  for (let j = 0; j < h.length; j++) h[j] = gelu(h[j]);
  const y = conv1x1(h, T, C, w[p + 'c2.weight'].data, w[p + 'c2.bias'].data, C);
  for (let j = 0; j < y.length; j++) y[j] += X[j];
  return y;
}

/** One GRU direction. X[T][C] → H[T][C]; `reverse` runs t from T−1 down and writes into the same t. */
function gruDirection(X, T, C, Wih, Whh, bih, bhh, reverse) {
  const H = new Float32Array(T * C),
    h = new Float32Array(C),
    gi = new Float32Array(3 * C),
    gh = new Float32Array(3 * C);
  for (let step = 0; step < T; step++) {
    const t = reverse ? T - 1 - step : step,
      xo = t * C;
    for (let g = 0; g < 3 * C; g++) {
      let si = bih[g],
        sh = bhh[g];
      const wo = g * C;
      for (let i = 0; i < C; i++) {
        si += Wih[wo + i] * X[xo + i];
        sh += Whh[wo + i] * h[i];
      }
      gi[g] = si;
      gh[g] = sh;
    }
    for (let c = 0; c < C; c++) {
      const r = sigmoid(gi[c] + gh[c]);
      const z = sigmoid(gi[C + c] + gh[C + c]);
      const n = Math.tanh(gi[2 * C + c] + r * gh[2 * C + c]);
      h[c] = (1 - z) * n + z * h[c];
    }
    H.set(h, xo);
  }
  return H;
}

/**
 * Forward pass. X: Float32Array [T][kin] (already tensorised: features, missing fraction, presence flags).
 * Returns { logits: [T][K], proba: [T][K], hidden: [T][2ch] } as Float32Arrays, plus T and K.
 */
function seqnetForward(model, X, T, opts = {}) {
  const { arch, w } = model;
  const C = arch.ch,
    K = arch.K,
    k = arch.k,
    groups = arch.groupnorm_groups,
    eps = arch.gn_eps;
  const kin = w['stem.weight'].shape[1];
  if (X.length !== T * kin) throw new Error(`seqnetForward: X has ${X.length} values, expected T·kin = ${T}·${kin}`);
  let h = conv1x1(X, T, kin, w['stem.weight'].data, w['stem.bias'].data, C);
  const taps = { stem: opts.taps ? Float32Array.from(h) : null };
  arch.dilations.forEach((d, i) => {
    h = block(h, T, C, k, d, w, i, groups, eps);
    if (opts.taps && i === 0) taps.block0 = Float32Array.from(h);
  });
  if (opts.taps) taps.blocks = Float32Array.from(h);
  const fwd = gruDirection(h, T, C, w['gru.weight_ih_l0'].data, w['gru.weight_hh_l0'].data, w['gru.bias_ih_l0'].data, w['gru.bias_hh_l0'].data, false);
  const bwd = gruDirection(h, T, C, w['gru.weight_ih_l0_reverse'].data, w['gru.weight_hh_l0_reverse'].data, w['gru.bias_ih_l0_reverse'].data, w['gru.bias_hh_l0_reverse'].data, true);
  const hidden = new Float32Array(T * 2 * C);
  for (let t = 0; t < T; t++) {
    hidden.set(fwd.subarray(t * C, t * C + C), t * 2 * C);
    hidden.set(bwd.subarray(t * C, t * C + C), t * 2 * C + C);
  }
  const logits = conv1x1(hidden, T, 2 * C, w['out.weight'].data, w['out.bias'].data, K);
  const proba = new Float32Array(T * K);
  for (let t = 0; t < T; t++) {
    let m = -Infinity;
    for (let c = 0; c < K; c++) m = Math.max(m, logits[t * K + c]);
    let s = 0;
    for (let c = 0; c < K; c++) {
      const e = Math.exp(logits[t * K + c] - m);
      proba[t * K + c] = e;
      s += e;
    }
    for (let c = 0; c < K; c++) proba[t * K + c] /= s;
  }
  return { logits, proba, hidden, T, K, taps };
}

/**
 * seqnet.py / stage-lab.mjs fold hash: the night's 5-fold bucket from its cohort + id (31-multiplier string hash,
 * uint32). With `groupSubjects`, SHHS1 and SHHS2 nights of one subject share a key so they land in one fold.
 */
function foldOf(cohort, nid, groupSubjects) {
  const key = groupSubjects && /^shhs[12]-/.test(nid) ? 'shhs' + nid.replace(/^shhs[12]-/, '') : cohort + nid;
  let h = 0;
  for (const ch of key) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return h % 5;
}

/** HMM Viterbi exactly as seqnet.py: D = log(P + 1e-9) − logPrior, D[0] += logPrior, then max-product with logT. */
function viterbi(P, T, K, logT, logPrior) {
  const D = new Float64Array(T * K),
    B = new Int32Array(T * K);
  for (let c = 0; c < K; c++) D[c] = Math.log(P[c] + 1e-9) - logPrior[c] + logPrior[c];
  for (let t = 1; t < T; t++) {
    for (let c = 0; c < K; c++) {
      let best = -Infinity,
        arg = 0;
      for (let p = 0; p < K; p++) {
        const v = D[(t - 1) * K + p] + logT[p * K + c];
        if (v > best) {
          best = v;
          arg = p;
        }
      }
      D[t * K + c] = Math.log(P[t * K + c] + 1e-9) - logPrior[c] + best;
      B[t * K + c] = arg;
    }
  }
  const path = new Int32Array(T);
  let arg = 0,
    best = -Infinity;
  for (let c = 0; c < K; c++)
    if (D[(T - 1) * K + c] > best) {
      best = D[(T - 1) * K + c];
      arg = c;
    }
  path[T - 1] = arg;
  for (let t = T - 1; t > 0; t--) path[t - 1] = B[t * K + path[t]];
  return path;
}

/* One export list, no `export function` / `export const`: the owned bundler leaves `export function` in place and
   rewrites `export const X =` to `__exports.X =` (dropping the local binding); plain declarations + this list serve
   node, the tests and the OxyDex bundle alike. */
export { erf, loadWeights, seqnetForward, foldOf, viterbi };

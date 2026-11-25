/*
 * eegdex-stage-model.js — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═════════════════════════════════════════════════════════════════════════════
 * EEGDex — the evaluator of the stage formula. `window.EEGSTAGE`.
 *
 * ── THE NUMBERS ARE DATA, THE CODE IS NOT ────────────────────────────────────
 * A model file of schema `tepna.stage-formula/1` names its design blocks and
 * its passes; this file holds every block kind and every pass kind that the fit
 * has produced, and it holds no coefficient. So a better model is a NEW FILE
 * and no new code, which a test proves over a small synthetic second file.
 * The model this repository ships uses 3 of those kinds: `linear109`,
 * `products630` and one `softmax` pass over 739 columns.
 *
 * ── THE NUMBER TYPES ARE PART OF THE CONTRACT ────────────────────────────────
 * The prepared inputs and every design column round to 32-BIT floats, and the
 * product with the coefficients and the softmax run in 64-BIT. A port that
 * stays in 64-bit throughout disagrees with the fit's own results, so the
 * `Float32Array` of each block below is load-bearing and never an optimisation.
 * The parity assertion in `tests/dex-tests.js` holds every posterior of the
 * committed vector against the fit's stored result.
 *
 * THE FIT IS NOT IN THIS REPOSITORY, so this file carries no `@port-from`
 * declaration and `tools/port-parity.mjs` reads nothing about it. The pin is
 * the committed vector, which compares the two sides' NUMBERS rather than
 * noticing that a source file moved.
 *
 * ── WHAT THIS FILE IS NOT ────────────────────────────────────────────────────
 * It is not the shipped stager. `eegdex-dsp.js` holds the band-power stager,
 * and that stays the default. This file reads the 35 columns of
 * `eegdex-stage-features.js` and a model file, and it surfaces no number by
 * itself.
 *
 * ── ABSENCE (§∅) ─────────────────────────────────────────────────────────────
 * The formula tolerates a gap by design: `prepare` puts a 0 in the place of
 * every absent input and carries the missing share as a column. That keeps the
 * arithmetic finite, and it is exactly the substitution that §∅ forbids a
 * surface to report as a measurement. `stages()` therefore reads the posterior
 * and reports `null` with a named reason where the epoch does not describe a
 * measured stretch of signal. The step runs AFTER the posterior, so the parity
 * assertion still compares every posterior the formula gives.
 */
(function (root) {
  'use strict';

  const NB = 35;
  const NAMED = ['eeg.lp.delta', 'eeg.lp.theta', 'eeg.lp.alpha', 'eeg.lp.sigma', 'eeg.lp.beta', 'eeg.hj.mob', 'eeg.sef95', 'eeg.ev.sw', 'eeg.ev.spd', 'eeg.ev.eye', 'eeg.ev.hf', 'eeg.r.delta_beta'];
  const LAGS = [-2, -1, 1, 2];
  const SCHEMA = 'tepna.stage-formula/1';
  const f32 = Math.fround;

  function mat(n, m, single) {
    return { n: n, m: m, d: single ? new Float32Array(n * m) : new Float64Array(n * m) };
  }

  function _isNum(v) {
    return v !== null && v !== undefined && Number.isFinite(v);
  }

  function hcat(parts) {
    const n = parts[0].n;
    let m = 0;
    for (const P of parts) {
      if (P.n !== n) throw new Error('a design block has ' + P.n + ' epochs, not ' + n);
      m += P.m;
    }
    const O = mat(n, m, true);
    for (let i = 0; i < n; i++) {
      let o = i * m;
      for (const P of parts) {
        const b = i * P.m;
        for (let j = 0; j < P.m; j++) O.d[o + j] = P.d[b + j];
        o += P.m;
      }
    }
    return O;
  }

  // -- the prepared inputs -----------------------------------------------------

  function prepare(F) {
    const n = F.length;
    const NC = F[0].length;
    let measured = false;
    for (let i = 0; i < n && !measured; i++) {
      for (let j = 0; j < NB; j++) {
        const v = F[i][j];
        if (v !== null && v !== undefined && !Number.isNaN(v)) {
          measured = true;
          break;
        }
      }
    }
    const pres = measured ? 1 : 0;
    const A = mat(n, NC + 2, true);
    for (let i = 0; i < n; i++) {
      const row = F[i];
      let nan = 0;
      for (let j = 0; j < NC; j++) {
        const raw = row[j];
        const v = raw === null || raw === undefined ? NaN : f32(raw);
        if (Number.isNaN(v)) nan++;
        let x = Number.isFinite(v) ? v : 0;
        if (x > 8) x = 8;
        else if (x < -8) x = -8;
        A.d[i * A.m + j] = x;
      }
      A.d[i * A.m + NC] = f32(nan / NC);
      A.d[i * A.m + NC + 1] = pres;
    }
    return A;
  }

  // -- the design blocks -------------------------------------------------------

  function linear109(A) {
    const n = A.n;
    const c = new Float64Array((n + 1) * NB);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < NB; j++) c[(i + 1) * NB + j] = c[i * NB + j] + A.d[i * A.m + j];
    }
    function roll(w) {
      const h = Math.floor(w / 2);
      const M = mat(n, NB, false);
      for (let i = 0; i < n; i++) {
        const lo = Math.max(i - h, 0);
        const hi = Math.min(i + h + 1, n);
        const k = hi - lo;
        for (let j = 0; j < NB; j++) M.d[i * NB + j] = (c[hi * NB + j] - c[lo * NB + j]) / k;
      }
      return M;
    }
    const m5 = roll(5);
    const m21 = roll(21);
    const x1 = mat(n, 109, true);
    for (let i = 0; i < n; i++) {
      const o = i * 109;
      for (let j = 0; j < A.m; j++) x1.d[o + j] = A.d[i * A.m + j];
      for (let j = 0; j < NB; j++) x1.d[o + 38 + j] = m5.d[i * NB + j];
      for (let j = 0; j < NB; j++) x1.d[o + 73 + j] = m21.d[i * NB + j];
      x1.d[o + 108] = Math.min(i / 120, 10);
    }
    return { x1: x1, m5: m5 };
  }

  function products630(m5) {
    const n = m5.n;
    const O = mat(n, 630, true);
    for (let i = 0; i < n; i++) {
      let k = i * 630;
      const b = i * NB;
      for (let a = 0; a < NB; a++) {
        for (let d = a; d < NB; d++) O.d[k++] = m5.d[b + a] * m5.d[b + d];
      }
    }
    return O;
  }

  function lagdiff72(x1, idx) {
    const n = x1.n;
    const nc = idx.length;
    const O = mat(n, 6 * nc, true);
    const cl = (i) => (i < 0 ? 0 : i > n - 1 ? n - 1 : i);
    const at = (i, j) => x1.d[i * x1.m + idx[j]];
    for (let i = 0; i < n; i++) {
      let p = i * O.m;
      for (const k of LAGS) {
        const r = cl(i + k);
        for (let j = 0; j < nc; j++) O.d[p++] = at(r, j);
      }
      const pv = cl(i - 1);
      const nx = cl(i + 1);
      for (let j = 0; j < nc; j++) O.d[p++] = f32(at(i, j) - at(pv, j));
      for (let j = 0; j < nc; j++) O.d[p++] = f32(at(nx, j) - at(i, j));
    }
    return O;
  }

  function _pct(sorted, q) {
    const R = sorted.length;
    const pos = (R - 1) * (q / 100);
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, R - 1);
    return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
  }

  function _left(sorted, v) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function _right(sorted, v) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function endOfNight38(x1, idx) {
    const n = x1.n;
    const O = mat(n, 38, true);
    const sig = [];
    for (let i = 0; i < n; i++) if (x1.d[i * x1.m + NB + 1] < 0.5) sig.push(i);
    if (!sig.length) return O;
    for (let j = 0; j < idx.length; j++) {
      const col = NB + 3 + idx[j];
      const v = new Float64Array(n);
      for (let i = 0; i < n; i++) v[i] = x1.d[i * x1.m + col];
      const ref = new Float64Array(sig.length);
      for (let k = 0; k < sig.length; k++) ref[k] = v[sig[k]];
      ref.sort();
      const R = ref.length;
      const p10 = _pct(ref, 10);
      const p90 = _pct(ref, 90);
      for (let i = 0; i < n; i++) {
        O.d[i * 38 + 3 * j] = (_left(ref, v[i]) + _right(ref, v[i])) / (2 * R);
        O.d[i * 38 + 3 * j + 1] = v[i] - p10;
        O.d[i * 38 + 3 * j + 2] = v[i] - p90;
      }
    }
    const dcol = NB + 3 + NB + idx[0];
    let e = sig[0];
    let best = -Infinity;
    for (const i of sig) {
      const d = x1.d[i * x1.m + dcol];
      if (d > best) {
        best = d;
        e = i;
      }
    }
    for (let i = 0; i < n; i++) {
      let h = (i - e) / 120;
      if (h > 10) h = 10;
      else if (h < -10) h = -10;
      O.d[i * 38 + 36] = h;
      O.d[i * 38 + 37] = Math.abs(h);
    }
    return O;
  }

  // -- the second pass's posterior columns -------------------------------------

  function pfeat55(p) {
    const n = p.n;
    const q = new Float64Array(n * 4);
    for (let i = 0; i < n * 4; i++) q[i] = f32(p.d[i]);
    const c = new Float64Array((n + 1) * 4);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 4; j++) c[(i + 1) * 4 + j] = c[i * 4 + j] + q[i * 4 + j];
    }
    const a = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      let k = 0;
      for (let j = 1; j < 4; j++) if (q[i * 4 + j] > q[i * 4 + k]) k = j;
      a[i] = k;
    }
    const ms = new Float64Array(n * 3);
    const order = [2, 3, 0];
    for (let col = 0; col < 3; col++) {
      let last = -1;
      for (let i = 0; i < n; i++) {
        if (a[i] === order[col]) last = i;
        const gap = last >= 0 ? i - last : i + 1;
        ms[i * 3 + col] = Math.min(gap * 0.5, 120);
      }
    }
    const O = mat(n, 55, true);
    const cl = (i) => (i < 0 ? 0 : i > n - 1 ? n - 1 : i);
    for (let i = 0; i < n; i++) {
      let o = i * 55;
      for (const k of [-2, -1, 0, 1, 2]) {
        const r = cl(i + k);
        for (let j = 0; j < 4; j++) O.d[o++] = q[r * 4 + j];
      }
      for (const h of [5, 10]) {
        const lo = Math.max(i - h, 0);
        const hi = Math.min(i + h + 1, n);
        const k = hi - lo;
        for (let j = 0; j < 4; j++) O.d[o++] = (c[hi * 4 + j] - c[lo * 4 + j]) / k;
      }
      for (const w of [40, 80, 160]) {
        const lo = Math.max(i - w, 0);
        const k = i - lo;
        for (let j = 0; j < 4; j++) O.d[o++] = k > 0 ? (c[i * 4 + j] - c[lo * 4 + j]) / k : q[i * 4 + j];
      }
      for (const w of [40, 80, 160]) {
        const hi = Math.min(i + w, n - 1);
        const k = hi - i;
        for (let j = 0; j < 4; j++) O.d[o++] = k > 0 ? (c[(hi + 1) * 4 + j] - c[(i + 1) * 4 + j]) / k : q[i * 4 + j];
      }
      for (let j = 0; j < 3; j++) O.d[o++] = ms[i * 3 + j];
    }
    return O;
  }

  // -- the passes --------------------------------------------------------------

  function _affine(cols, W, b) {
    const n = cols.n;
    const k = b.length;
    const O = mat(n, k, false);
    if (W.length !== cols.m) throw new Error('the coefficient block has ' + W.length + ' rows, not ' + cols.m);
    for (let i = 0; i < n; i++) {
      const base = i * cols.m;
      for (let j = 0; j < k; j++) O.d[i * k + j] = b[j];
      for (let col = 0; col < cols.m; col++) {
        const x = cols.d[base + col];
        if (x === 0) continue;
        const Wr = W[col];
        for (let j = 0; j < k; j++) O.d[i * k + j] += x * Wr[j];
      }
    }
    return O;
  }

  function softmax(Z) {
    const n = Z.n;
    const k = Z.m;
    const O = mat(n, k, false);
    for (let i = 0; i < n; i++) {
      let mx = -Infinity;
      for (let j = 0; j < k; j++) if (Z.d[i * k + j] > mx) mx = Z.d[i * k + j];
      let s = 0;
      for (let j = 0; j < k; j++) {
        const e = Math.exp(Z.d[i * k + j] - mx);
        O.d[i * k + j] = e;
        s += e;
      }
      for (let j = 0; j < k; j++) O.d[i * k + j] /= s;
    }
    return O;
  }

  function _tree(S) {
    const n = S.n;
    const O = mat(n, 4, false);
    for (let i = 0; i < n; i++) {
      const s0 = 1 / (1 + Math.exp(-S.d[i * 3]));
      const s1 = 1 / (1 + Math.exp(-S.d[i * 3 + 1]));
      const s2 = 1 / (1 + Math.exp(-S.d[i * 3 + 2]));
      O.d[i * 4] = s0;
      O.d[i * 4 + 1] = (1 - s0) * (1 - s1) * s2;
      O.d[i * 4 + 2] = (1 - s0) * (1 - s1) * (1 - s2);
      O.d[i * 4 + 3] = (1 - s0) * s1;
    }
    return O;
  }

  // -- the evaluator ------------------------------------------------------------

  function _rows(F) {
    if (!Array.isArray(F) || !F.length) throw new Error('the night holds no epoch');
    const w = F[0].length;
    if (w === NB) {
      const n = F.length;
      return F.map((r, i) => r.concat([i / n]));
    }
    if (w !== NB + 1) throw new Error('an epoch holds ' + w + ' values, not ' + NB + ' or ' + (NB + 1));
    return F;
  }

  function evaluate(model, F) {
    if (!model || model.schema !== SCHEMA) {
      throw new Error('the model file reads schema ' + (model && model.schema) + ', not ' + SCHEMA);
    }
    const names = model.inputs.names;
    const idx = NAMED.map((nm) => {
      const k = names.indexOf(nm);
      if (k < 0) throw new Error('the model file does not name the input ' + nm);
      return k;
    });
    const rows = _rows(F);
    const A = prepare(rows);
    const lin = linear109(A);
    const parts = model.design.map((blk) => {
      if (blk === 'linear109') return lin.x1;
      if (blk === 'products630') return products630(lin.m5);
      if (blk === 'lagdiff72') return lagdiff72(lin.x1, idx);
      if (blk === 'end_of_night38') return endOfNight38(lin.x1, idx);
      throw new Error('unknown design block ' + blk);
    });
    const X = parts.length === 1 ? parts[0] : hcat(parts);
    let p = null;
    for (const ps of model.passes) {
      const cols = ps.posterior_columns ? hcat([X, pfeat55(p)]) : X;
      if (cols.m !== ps.columns.length) {
        throw new Error('a pass names ' + ps.columns.length + ' columns and the design gives ' + cols.m);
      }
      if (ps.kind === 'softmax') p = softmax(_affine(cols, ps.W, ps.b));
      else if (ps.kind === 'tree') p = _tree(_affine(cols, ps.D, ps.c));
      else throw new Error('unknown pass kind ' + ps.kind);
    }
    const n = p.n;
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = [];
      for (let j = 0; j < 4; j++) r.push(p.d[i * 4 + j]);
      out.push(r);
    }
    return { classes: model.classes.slice(), id: model.id, posterior: out };
  }

  // -- absence (ABSENCE IS NULL, after the posterior) --------------------------
  //
  // The formula itself tolerates a gap: `prepare` puts 0 in the place of every
  // absent input and carries the missing share as a column of its own. That
  // keeps the arithmetic finite, and it is exactly the substitution that §∅ of
  // CLAUDE.md forbids a SURFACE to report as a measurement. So this step reads
  // the posterior the formula gave, and it reports `null` where the epoch does
  // not describe a measured stretch of signal.
  //
  // THE LINE IS THE FORMULA'S OWN. `end_of_night38` holds the night's reference
  // population to the epochs whose missing share is under 0.5, so the fit itself
  // states where an epoch stops describing the signal. This step reads the same
  // 0.5 and derives nothing from the night it judges.
  //
  // A night with no measured block value at all refuses on every epoch, because
  // `present` is then 0 and every design column rests on a substituted zero.
  // THE DENOMINATOR IS THE EPOCH'S 36 INPUTS, which is the population that
  // `end_of_night38` counts (board #8491): the 35 feature columns and
  // `time_of_night`. Exactly half absent refuses; one more measured input
  // scores. The count below reads FINITENESS, so a non-finite input counts as
  // absent here. `prepare` keeps its own `miss` column as the fit wrote it,
  // where an infinity counts as measured, because the posterior must reproduce
  // the fit's own numbers.
  const MISS_REFUSE = 0.5;

  function stages(model, F, post) {
    const rows = _rows(F);
    const p = post || evaluate(model, rows);
    const classes = p.classes;
    const n = rows.length;
    const nInputs = rows[0].length;
    let nightMeasured = false;
    for (let i = 0; i < n && !nightMeasured; i++) {
      for (let j = 0; j < NB; j++) {
        if (_isNum(rows[i][j])) {
          nightMeasured = true;
          break;
        }
      }
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      let nMeasured = 0;
      for (let j = 0; j < nInputs; j++) if (_isNum(rows[i][j])) nMeasured++;
      const miss = (nInputs - nMeasured) / nInputs;
      let reason = null;
      if (!nightMeasured) reason = 'no-measured-signal';
      else if (miss >= MISS_REFUSE) reason = 'under-half-measured';
      if (reason) {
        out.push({ stage: null, reason: reason, nMeasured: nMeasured, nInputs: nInputs, posterior: null });
        continue;
      }
      const row = p.posterior[i];
      let k = 0;
      for (let j = 1; j < row.length; j++) if (row[j] > row[k]) k = j;
      out.push({
        stage: classes[k],
        reason: null,
        nMeasured: nMeasured,
        nInputs: nInputs,
        posterior: row
      });
    }
    const scored = out.filter((e) => e.stage !== null).length;
    return { id: p.id, classes: classes.slice(), epochs: out, scored: scored, refused: n - scored };
  }

  root.EEGSTAGE = {
    SCHEMA: SCHEMA,
    NAMED: NAMED,
    prepare: prepare,
    linear109: linear109,
    products630: products630,
    lagdiff72: lagdiff72,
    endOfNight38: endOfNight38,
    pfeat55: pfeat55,
    softmax: softmax,
    evaluate: evaluate,
    stages: stages,
    MISS_REFUSE: MISS_REFUSE
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

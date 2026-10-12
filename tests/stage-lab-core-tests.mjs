// Tepna — tests/stage-lab-core-tests.mjs
// Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
/* The sleep-stage lab's feature core (tools/stage-lab-core.mjs), pinned where a drift would read as
   a result: the oxy1 column LAYOUT (466 names, their order, the per-block counts — a trained model's
   weights are indexed by it), the harmonisation known answers, absence as NaN columns, the 1-bit
   motion rule, and the learners' non-vacuity (a toy they must learn, and shuffled labels they must
   not). The lab's results stay in the private brief; nothing here asserts a κ on real nights. */
import { createHash } from 'node:crypto';
import {
  BLOCKS,
  CONTEXT_EPOCHS,
  EPOCH_S,
  MOTION_BIT_G,
  STAGES,
  blockLayout,
  confusion,
  fitGBDT,
  harmonizeSpo2,
  kappa,
  nightFeatures,
  predictProba,
  viterbi,
  withContext
} from '../tools/stage-lab-core.mjs';

let pass = 0;
const fails = [];
const ok = (cond, what) => {
  if (cond) pass++;
  else fails.push(what);
};
const sig = (v, n) => ({ fs: 1, data: new Float64Array(EPOCH_S * n).fill(v) });

// ── the oxy1 layout is a contract: a trained model indexes its weights by these names in this order ──
{
  const n = 4;
  const f = nightFeatures({ nEpochs: n, signals: { spo2: sig(96, n), pulse: sig(60, n), motion: sig(0.01, n) } }, ['spo2', 'pulse', 'motion']);
  ok(f.k === 466 && f.names.length === 466 && f.X.length === n * 466, `oxy1 layout: k ${f.k}, names ${f.names.length}, X ${f.X.length}`);
  const sha = createHash('sha256').update(f.names.join('\n')).digest('hex').slice(0, 16);
  ok(sha === '165151a3bd817327', `oxy1 name list sha256 ${sha} (pinned 165151a3bd817327; a changed layout invalidates every trained weights file)`);
  ok(blockLayout('spo2').length === 135 && blockLayout('pulse').length === 120 && blockLayout('motion').length === 210, 'per-block counts 135 / 120 / 210');
  ok(f.names[0] === 'spo2.mean@60s' && f.names[f.names.length - 1] === 'time_of_night', 'first and last names');
  ok(STAGES.length === 4 && STAGES[1] === 'Light' && EPOCH_S === 30 && CONTEXT_EPOCHS.join(',') === '2,10,30', 'constants: four stages, 30 s epochs, context 2/10/30');
  ok(!BLOCKS['ecg-hrv'].implemented && !BLOCKS.eeg.implemented, 'declared-but-unimplemented blocks stay declared');
  let threw = false;
  try {
    nightFeatures({ nEpochs: 1, signals: {} }, ['eeg']);
  } catch {
    threw = true;
  }
  ok(threw, 'asking for an unimplemented block is a refusal, not NaN columns');
}

// ── absence is NaN columns of the right width, never zeros ────────────────────────────────────────
{
  const n = 3;
  const f = nightFeatures({ nEpochs: n, signals: { spo2: sig(95, n) } }, ['spo2', 'pulse', 'motion']);
  ok(f.k === 466, 'an absent block keeps the layout width');
  const pulseCols = f.names.map((nm, j) => (nm.startsWith('pulse.') ? j : -1)).filter((j) => j >= 0);
  const allNaN = pulseCols.every((j) => Number.isNaN(f.X[j]) && Number.isNaN(f.X[(n - 1) * 466 + j]));
  ok(allNaN && pulseCols.length === 120, 'absent pulse → its 120 columns are NaN in every epoch');
  const n12 = 12;
  const g = nightFeatures({ nEpochs: n12, signals: { spo2: sig(95, n12) } }, ['spo2']);
  const spo2Mean = g.names.indexOf('spo2.mean@60s');
  ok(Number.isFinite(g.X[spo2Mean]) && Math.abs(g.X[spo2Mean]) < 1e-9, 'present SpO₂ → a finite per-night z (0 for a flat night), never NaN');
  ok(
    nightFeatures({ nEpochs: 4, signals: { spo2: sig(95, 4) } }, ['spo2'])
      .X.slice(0, 135)
      .every(Number.isNaN),
    'a night with under 10 measured epochs has no z (NaN), not a fabricated 0'
  );
}

// ── harmonisation: 8 s centred mean over the MEASURED seconds, whole percent, missing stays missing ──
{
  const d = Float64Array.from([96, 96, 96, 96, NaN, 92, 92, 92, 92, 92]);
  const h = harmonizeSpo2(d);
  ok(Number.isNaN(h[4]), 'a missing second stays missing');
  ok(h[0] === 96 && h[9] === 92, 'flat runs are unchanged');
  ok(Number.isInteger(h[3]) && h[3] < 96 && h[3] > 92, `the edge second is the rounded local mean (${h[3]})`);
  ok(harmonizeSpo2(new Float64Array(5).fill(NaN)).every(Number.isNaN), 'all-missing stays all-missing');
}

// ── context windows: mean over ±w epochs, and the layout names say so ─────────────────────────────
{
  const n = 12;
  const raw = { names: ['a'], cols: [Float32Array.from({ length: n }, (_, i) => i)] };
  const c = withContext(raw, n);
  ok(c.names.join(',') === 'a,a@±2ep,a@±10ep,a@±30ep,a-ctx30', `context names: ${c.names.join(',')}`);
  const z = c.cols[0],
    col2 = c.cols[1];
  ok(Math.abs(z[5] - (5 - 5.5) / 5.5) < 1e-9, `per-night robust z: (v − median) / IQR (got ${z[5]})`);
  ok(
    Math.abs(col2[5] - (z[3] + z[4] + z[5] + z[6] + z[7]) / 5) < 1e-9 && Math.abs(col2[0] - (z[0] + z[1] + z[2]) / 3) < 1e-9,
    'the ±2-epoch context is the centred mean over the finite neighbours, truncated at the edges'
  );
  const ctx = c.cols[4];
  ok(Math.abs(ctx[5] - (z[5] - c.cols[3][5])) < 1e-9, 'the -ctx30 column is z minus its ±30 context');
}

// ── 1-bit motion: the stated threshold, not a tuned one ───────────────────────────────────────────
ok(MOTION_BIT_G === 0.02, `MOTION_BIT_G is 0.02 g (got ${MOTION_BIT_G})`);
{
  const n = 12;
  // first half still (0.001 g < threshold), second half moving (0.2 g): the 1-bit mean separates them
  const d = Float64Array.from({ length: EPOCH_S * n }, (_, i) => (i < (EPOCH_S * n) / 2 ? 0.001 : 0.2));
  const f = nightFeatures({ nEpochs: n, signals: { motion: { fs: 1, data: d } } }, ['motion']);
  const bit = f.names.indexOf('mbit.mean@60s');
  ok(bit >= 0, 'mbit.mean@60s exists');
  ok(f.X[1 * f.k + bit] < f.X[10 * f.k + bit], `still epochs sit below moving epochs on the 1-bit mean (${f.X[1 * f.k + bit]} < ${f.X[10 * f.k + bit]})`);
}

// ── κ, confusion, Viterbi known answers ───────────────────────────────────────────────────────────
{
  const y = Int8Array.from([0, 1, 2, 3, 0, 1, 2, 3]);
  const M = confusion(y, y);
  ok(Math.abs(kappa(M) - 1) < 1e-12, 'κ of a perfect confusion is 1');
  const Mbad = confusion(y, Int8Array.from([1, 2, 3, 0, 1, 2, 3, 0]));
  ok(kappa(Mbad) < 0, 'κ of a cyclic mislabel is negative');
  ok(Math.abs(kappa([Float64Array.from([20, 5]), Float64Array.from([10, 15])]) - 0.4) < 1e-12, 'kappa known answer: [[20,5],[10,15]] = 0.4');
  const lp = [Math.log(0.5), Math.log(0.5)];
  const Tm = [
    [Math.log(0.99), Math.log(0.01)],
    [Math.log(0.01), Math.log(0.99)]
  ];
  const path = Array.from(viterbi(Float64Array.from([0.9, 0.1, 0.9, 0.1, 0.4, 0.6, 0.9, 0.1, 0.9, 0.1]), 5, 2, Tm, lp)).join('');
  ok(path === '00000', `a sticky chain smooths a one-epoch blip: ${path}`);
}

// ── the GBDT learns a toy where one class is known only by a MISSING value, and not shuffled labels ─
{
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const n = 2000,
    k = 3,
    X = new Float32Array(n * k),
    y = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    const c = i % 4;
    y[i] = c;
    X[i * k] = c < 3 ? c + rnd() * 0.8 : rnd() * 3;
    X[i * k + 1] = rnd();
    X[i * k + 2] = c === 3 ? NaN : rnd();
  }
  const acc = (m, labels) => {
    const Pm = predictProba(m, X, n, k);
    let hit = 0;
    for (let r = 0; r < n; r++) {
      let b = 0;
      for (let q = 1; q < 4; q++) if (Pm[r * 4 + q] > Pm[r * 4 + b]) b = q;
      if (b === labels[r]) hit++;
    }
    return hit / n;
  };
  const m = fitGBDT(X, y, n, k, { iters: 25, minLeaf: 20 });
  ok(acc(m, y) > 0.97, `GBDT learns the toy incl. the NaN-only class: acc ${acc(m, y).toFixed(3)}`);
  const ys = Int8Array.from(y);
  for (let i = ys.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [ys[i], ys[j]] = [ys[j], ys[i]];
  }
  const ms = fitGBDT(X, ys, n, k, { iters: 25, minLeaf: 20 });
  ok(acc(ms, y) < 0.45, `non-vacuity: a model fitted to shuffled labels scores near chance on the true ones: acc ${acc(ms, y).toFixed(3)}`);
}

if (fails.length) {
  console.error(`stage-lab-core: ${fails.length} failed, ${pass} ok`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`stage-lab-core: all ${pass} checks ok`);

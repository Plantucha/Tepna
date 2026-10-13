// Tepna — tests/seqnet-port-tests.mjs
// Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
/* The JS port of the stage-lab control net (tools/seqnet-infer.mjs) held to PyTorch on COMMITTED golden
   vectors (STAGE-LAB brief §24). A wrong port fails silently — it still produces plausible stage
   posteriors — so the only honest check is numerical: every intermediate tap of a seeded random
   SeqNet (ch 16, kin 6, T 40, tests/fixtures/seqnet/) must agree with torch to 1e-4, and the pieces that
   have closed forms (erf, the fold hash, Viterbi on a hand-worked case) are pinned on their own. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARITY, parityVerdict } from '../tools/seqnet-eval.mjs';
import { erf, foldOf, loadWeights, seqnetForward, viterbi } from '../tools/seqnet-infer.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0;
const fails = [];
const ok = (cond, what) => {
  if (cond) pass++;
  else fails.push(what);
};
const maxAbs = (a, b) => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};
const flat = (m) => Float32Array.from(m.flat());

// ── golden parity, every tap ───────────────────────────────────────────────────────────────────
const model = loadWeights(JSON.parse(readFileSync(join(HERE, 'fixtures/seqnet/random-ch16-weights.json'), 'utf8')));
const g = JSON.parse(readFileSync(join(HERE, 'fixtures/seqnet/random-ch16-golden.json'), 'utf8'));
const r = seqnetForward(model, flat(g.x), g.T, { taps: true });
for (const [name, got, want] of [
  ['stem', r.taps.stem, flat(g.stem)],
  ['block0', r.taps.block0, flat(g.block0)],
  ['blocks', r.taps.blocks, flat(g.blocks)],
  ['gru', r.hidden, flat(g.gru)],
  ['logits', r.logits, flat(g.logits)],
  ['proba', r.proba, flat(g.proba)]
]) {
  const d = maxAbs(got, want);
  ok(got.length === want.length && d < 1e-4, `${name}: max |Δ| ${d} over ${got.length} values (band 1e-4)`);
}
ok(model.arch.ch === 16 && model.meta.kin === 6, 'the committed fixture is the SMALL model (ch 16, kin 6), not a 4 MB export');
for (let t = 0; t < g.T; t++) {
  let s = 0;
  for (let c = 0; c < r.K; c++) s += r.proba[t * r.K + c];
  if (Math.abs(s - 1) > 1e-5) fails.push(`softmax row ${t} sums to ${s}`);
}
pass++;

// ── a wrong input width is a refusal, never a silent reshape ───────────────────────────────────
let threw = false;
try {
  seqnetForward(model, new Float32Array(g.T * (model.meta.kin + 1)), g.T);
} catch {
  threw = true;
}
ok(threw, 'X with the wrong kin is refused');

// ── erf: exact values, both tails, symmetry ────────────────────────────────────────────────────
ok(Math.abs(erf(0.5) - 0.5204998778130465) < 1e-12, `erf(0.5) = ${erf(0.5)}`);
ok(Math.abs(erf(-2) + 0.9953222650189527) < 1e-12, `erf(-2) = ${erf(-2)}`);
ok(Math.abs(erf(4.5) - 0.9999999998033839) < 1e-12 && erf(0) === 0 && erf(-1.3) === -erf(1.3), 'erf tails and symmetry');

// ── Viterbi: a hand-worked case ────────────────────────────────────────────────────────────────
// Two classes, four epochs. Emission favours class 1 at t=1 only; a strong stay-put transition keeps
// the path on class 0 throughout — the smoothing the control net relies on. The uniform prior cancels.
{
  const K = 2,
    T = 4;
  const P = Float32Array.from([0.9, 0.1, 0.4, 0.6, 0.9, 0.1, 0.9, 0.1]);
  const logT = Float64Array.from([Math.log(0.99), Math.log(0.01), Math.log(0.01), Math.log(0.99)]);
  const logPrior = Float64Array.from([Math.log(0.5), Math.log(0.5)]);
  const path = Array.from(viterbi(P, T, K, logT, logPrior));
  ok(path.join('') === '0000', `Viterbi smooths a one-epoch blip under a sticky transition: got ${path.join('')}`);
  const loose = Float64Array.from([Math.log(0.5), Math.log(0.5), Math.log(0.5), Math.log(0.5)]);
  ok(Array.from(viterbi(P, T, K, loose, logPrior)).join('') === '0100', 'with a flat transition the argmax posterior wins epoch by epoch');
}

// ── the fold hash, pinned to seqnet.py's own answers (GROUP_SUBJECTS on) ───────────────────────
for (const [c, id, want] of [
  ['ucddb', 'ucddb002', 1],
  ['shhs', 'shhs1-900004', 2],
  ['shhs2', 'shhs2-900004', 2],
  ['boas', 'sub-001', 3],
  ['challenge', 'tr03-0005', 4]
]) {
  ok(foldOf(c, id, true) === want, `foldOf(${c}, ${id}) = ${foldOf(c, id, true)}, python says ${want}`);
}
ok(foldOf('shhs', 'shhs1-900004', true) === foldOf('shhs2', 'shhs2-900004', true), 'SHHS1/SHHS2 nights of one subject share a fold');

// ── the real-night parity verdict (tools/seqnet-eval.mjs) is pre-stated and never a pass by absence ──
{
  const AT = { commit: null, commitReason: 'test', evidence: ['test: planted deltas'] };
  const nights = [
    { cohort: 'a', id: '1', n: 10, maxDelta: PARITY.probaTol },
    { cohort: 'b', id: '2', n: 10, maxDelta: null }
  ];
  const v = parityVerdict(nights, { kappaJs: 0.6, kappaPy: 0.6, ...AT });
  ok(v.status === 'PASS' && v.population.checked === 1 && v.population.excluded === 1, 'a night AT the tolerance passes; an uncompared night is excluded, not counted');
  ok(parityVerdict([{ cohort: 'a', id: '1', n: 10, maxDelta: PARITY.probaTol * 1.01 }], { kappaJs: 0.6, ...AT }).status === 'FAIL', 'just over the tolerance fails');
  ok(parityVerdict([{ cohort: 'a', id: '1', n: 10, maxDelta: null }], { kappaJs: 0.6, ...AT }).status === 'NOT_RUN', 'nothing compared is NOT_RUN');
}

if (fails.length) {
  console.error(`seqnet-port: ${fails.length} failed, ${pass} passed`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`seqnet-port: ${pass} passed`);

// Tepna — tests/oxydex-stager-tests.mjs
// Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
/* The OxyDex stager's plumbing (oxydex-stager.js), with a tiny random model built HERE: the series →
   night contract, selection of columns BY NAME from the weights file, the presence flags (motion
   absent by design), the refusal on an unknown name or a malformed file, the stage/minute bookkeeping
   and the hypnogram markup. The arithmetic of the net is proven in seqnet-port-tests; nothing here
   asserts a κ. */
import { EPOCH_S, STAGES } from '../tools/stage-lab-core.mjs';
import { hypnogramSvg, nightFromSeries, parseWeights, stageFromSeries, tensoriseByNames } from '../oxydex-stager.js';

let pass = 0;
const fails = [];
const ok = (cond, what) => {
  if (cond) pass++;
  else fails.push(what);
};

// a seeded random tepna-seqnet/1 file, ch 8, over six named oxy1 columns (kin 6 + 1 + 3 = 10)
let seed = 3;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296 - 0.5;
};
const NAMES = ['spo2.mean@60s', 'spo2.sd@60s', 'pulse.mean@60s', 'pulse.sd@60s', 'mbit.mean@60s', 'time_of_night'];
function randomWeights(names, ch = 8, K = 4) {
  const kin = names.length + 1 + 3;
  const layer = (shape, scale = 0.3) => ({ shape, data: Array.from({ length: shape.reduce((a, b) => a * b, 1) }, () => rnd() * scale) });
  const layers = { 'stem.weight': layer([ch, kin, 1]), 'stem.bias': layer([ch]) };
  for (let i = 0; i < 6; i++) {
    layers[`blocks.${i}.c1.weight`] = layer([ch, ch, 5]);
    layers[`blocks.${i}.c1.bias`] = layer([ch]);
    layers[`blocks.${i}.n.weight`] = { shape: [ch], data: Array(ch).fill(1) };
    layers[`blocks.${i}.n.bias`] = layer([ch]);
    layers[`blocks.${i}.c2.weight`] = layer([ch, ch, 1]);
    layers[`blocks.${i}.c2.bias`] = layer([ch]);
  }
  for (const sfx of ['', '_reverse']) {
    layers[`gru.weight_ih_l0${sfx}`] = layer([3 * ch, ch]);
    layers[`gru.weight_hh_l0${sfx}`] = layer([3 * ch, ch]);
    layers[`gru.bias_ih_l0${sfx}`] = layer([3 * ch]);
    layers[`gru.bias_hh_l0${sfx}`] = layer([3 * ch]);
  }
  layers['out.weight'] = layer([K, 2 * ch]);
  layers['out.bias'] = layer([K]);
  const u = Math.log(1 / K);
  return {
    format: 'tepna-seqnet/1',
    arch: { K, ch, k: 5, dilations: [1, 2, 4, 8, 16, 32], groupnorm_groups: 8, gn_eps: 1e-5 },
    meta: {
      names,
      block_prefixes: ['spo2.', 'pulse.', 'motion.'],
      logT: Array.from({ length: K }, () => Array(K).fill(u)),
      logPrior: Array(K).fill(u),
      tag: 'test',
      fold: 0,
      inner_val_kappa: 0.5,
      class_weight: 'none',
      cohorts: 'a,b',
      random: true
    },
    layers
  };
}

// ── series → night ─────────────────────────────────────────────────────────────────────────────────
{
  const n = 40;
  const spo2 = Array.from({ length: EPOCH_S * n + 17 }, (_, i) => (i % 97 === 0 ? null : 94 + Math.sin(i / 50)));
  const hr = Array.from({ length: EPOCH_S * n + 17 }, (_, i) => (i % 101 === 0 ? 250 : 58 + Math.cos(i / 70) * 4));
  const night = nightFromSeries(spo2, hr);
  ok(night.nEpochs === n, `a trailing partial epoch is dropped: ${night.nEpochs} epochs`);
  ok(Number.isNaN(night.signals.spo2.data[0]) && Number.isInteger(night.signals.spo2.data[1]), 'SpO₂: a null second stays missing, the rest is harmonised to whole percent');
  ok(Number.isNaN(night.signals.pulse.data[101]) && night.signals.pulse.data[1] > 50, 'pulse: 250 bpm is out of range → missing');
  ok(!('motion' in night.signals), 'motion is ABSENT by design (the ring byte was never a training input)');
  ok(nightFromSeries([], []) === null && nightFromSeries(Array(29).fill(95), null) === null, 'fewer than one whole epoch → null, never a one-epoch guess');
}

// ── weights: format, names, width ──────────────────────────────────────────────────────────────────
{
  const good = randomWeights(NAMES);
  const parsed = parseWeights(good);
  ok(parsed.meta.names.length === 6 && parsed.model.arch.ch === 8, 'a valid file parses');
  const thrown = (f) => {
    try {
      f();
      return null;
    } catch (e) {
      return e.message;
    }
  };
  ok(/not a tepna-seqnet\/1/.test(thrown(() => parseWeights({ format: 'x' }))), 'wrong format is refused');
  ok(/meta\.names/.test(thrown(() => parseWeights({ ...good, meta: { ...good.meta, names: [] } }))), 'a file without names is refused');
  const bad = randomWeights(NAMES);
  bad.layers['stem.weight'].shape = [8, 11, 1];
  ok(/stem width/.test(thrown(() => parseWeights(bad))), 'a stem width that does not match names + flags is refused');
  const unknown = randomWeights([...NAMES.slice(0, 5), 'spo2.no-such-column@1s']);
  const n = 20;
  const spo2 = Array(EPOCH_S * n).fill(95);
  const hr = Array(EPOCH_S * n).fill(60);
  ok(/does not produce/.test(thrown(() => stageFromSeries(parseWeights(unknown), spo2, hr))), 'an unknown feature name is a refusal, never a zero column');
}

// ── staging: shapes, presence, minutes ─────────────────────────────────────────────────────────────
{
  const parsed = parseWeights(randomWeights(NAMES));
  const n = 24;
  const spo2 = Array.from({ length: EPOCH_S * n }, (_, i) => 93 + (((i / 300) | 0) % 4));
  const hr = Array.from({ length: EPOCH_S * n }, (_, i) => 55 + (((i / 200) | 0) % 9));
  const r = stageFromSeries(parsed, spo2, hr);
  ok(r.nEpochs === n && r.stages.length === n && r.proba.length === n * 4, `one stage per epoch: ${r.stages.length}`);
  ok(
    Array.from(r.stages).every((s) => s >= 0 && s < STAGES.length),
    'every stage is one of the four'
  );
  ok(r.presence.spo2 === 1 && r.presence.pulse === 1 && r.presence.motion === 0, `presence flags spo2/pulse/motion = ${r.presence.spo2}/${r.presence.pulse}/${r.presence.motion}`);
  const total = Object.values(r.minutes).reduce((a, b) => a + b, 0);
  ok(Math.abs(total - (n * EPOCH_S) / 60) < 1e-9, `stage minutes sum to the night: ${total}`);
  ok(r.model.tag === 'test' && r.model.fold === 0 && r.model.innerValKappa === 0.5 && r.model.cohorts === 2 && r.model.random === true, 'the model provenance travels with the result');
  const r2 = stageFromSeries(parsed, spo2, null);
  ok(r2.presence.pulse === 0 && r2.nEpochs === n, 'no pulse series → pulse absent, the night still stages from SpO₂ alone');
  // tensorise by name: the missing-fraction column and the clip
  const feat = { k: 2, names: ['a', 'b'], X: Float32Array.from([NaN, 9, 1, -9]) };
  const t = tensoriseByNames(feat, ['b', 'a'], ['a', 'b']);
  ok(
    t.kin === 5 && t.X[0] === 8 && t.X[1] === 0 && t.X[2] === 0.5 && t.X[5] === -8 && t.X[6] === 1 && t.X[7] === 0,
    `by-name order, clip ±8, missing fraction, presence: ${Array.from(t.X).join(',')}`
  );
}

// ── hypnogram markup ────────────────────────────────────────────────────────────────────────────────
{
  const svg = hypnogramSvg(Int32Array.from([0, 0, 1, 1, 1, 2, 3, 3]), 100, 40);
  ok(svg.startsWith('<svg') && (svg.match(/<rect /g) || []).length === 4 && /Wake/.test(svg) && /REM/.test(svg), `one rect per run of equal stages (4), lane labels present`);
}

if (fails.length) {
  console.error(`oxydex-stager: ${fails.length} failed, ${pass} ok`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`oxydex-stager: all ${pass} checks ok`);

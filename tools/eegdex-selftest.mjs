#!/usr/bin/env node
/*
 * tools/eegdex-selftest.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═════════════════════════════════════════════════════════════════════════════
 * Assertions for `eegdex-dsp.js`, on PLANTED signals rather than the corpus — a staging engine that
 * only demonstrates itself on real EEG cannot show WHY it is right, and a corpus test cannot separate
 * "the rule fired" from "the night happened to be mostly N2".
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { Math, console, isFinite, Float64Array, Object, Array, Number };
vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT, 'eegdex-dsp.js'), 'utf8'), ctx, { filename: 'eegdex-dsp.js' });
const D = ctx.EEGDSP;

/* a pure sine at `hz`, so a band's power must land in that band and nowhere else */
function sine(hz, fs, sec, amp = 20) {
  const n = Math.round(fs * sec),
    a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * hz * i) / fs);
  return a;
}

let bad = 0,
  good = 0;
const A = (n, c, d) => {
  if (c) {
    good++;
    console.log('  ✓ ' + n);
  } else {
    bad++;
    console.log('  ✕ ' + n + (d ? '  — ' + d : ''));
  }
};
console.log('▸ eegdex --selftest\n');

const fs = 125;
for (const [hz, band] of [
  [2, 'delta'],
  [6, 'theta'],
  [10, 'alpha'],
  [14, 'sigma'],
  [22, 'beta']
]) {
  const b = D.epochBands(sine(hz, fs, 30), 0, fs * 30, fs);
  const top = Object.keys(b.rel).reduce((x, y) => (b.rel[y] > b.rel[x] ? y : x));
  A('spectrum: a ' + hz + ' Hz sine lands in ' + band, top === band, 'got ' + top + ' (' + b.rel[top].toFixed(3) + ')');
}
A(
  'spectrum: relative powers sum to <= 1',
  (() => {
    const b = D.epochBands(sine(10, fs, 30), 0, fs * 30, fs);
    return Object.values(b.rel).reduce((x, y) => x + y, 0) <= 1.000001;
  })()
);

/* §∅ — the cases that must refuse rather than return a spectrum of zeros */
const flat = new Float64Array(fs * 30);
A('§∅: a flat epoch refuses (disconnected electrode, not a stage)', D.epochBands(flat, 0, fs * 30, fs) === null);
const holed = sine(10, fs, 30);
holed[100] = NaN;
A('§∅: an epoch containing a hole refuses, never treats it as 0', D.epochBands(holed, 0, fs * 30, fs) === null);
A('§∅: a sub-5s window refuses', D.epochBands(sine(10, fs, 30), 0, fs * 2, fs) === null);
A('§∅: fs of 0 refuses rather than dividing', D.epochBands(sine(10, fs, 30), 0, fs * 30, 0) === null);
A('§∅: stageEpoch(null) is null, NOT a default of W', D.stageEpoch(null, 1, 1) === null);

/* the stager's own rules, each fired by a planted spectrum */
const mkRel = (r) => ({ rel: Object.assign({ delta: 0, theta: 0, alpha: 0, sigma: 0, beta: 0 }, r) });
A('stager: delta-dominant epoch → N3', D.stageEpoch(mkRel({ delta: 0.8 }), 1, 1) === 'N3');
A('stager: low delta + low EMG + eye movement → REM', D.stageEpoch(mkRel({ delta: 0.2, theta: 0.3 }), 0.5, 1.5) === 'REM');
A('stager: spindle band over moderate delta → N2', D.stageEpoch(mkRel({ delta: 0.35, sigma: 0.15 }), 1.2, 0.5) === 'N2');
A('stager: fast activity with tone → W', D.stageEpoch(mkRel({ beta: 0.4, alpha: 0.2, delta: 0.05 }), 1.5, 0.5) === 'W');
/* the control: REM and N1 differ ONLY by EMG tone in this feature space, so the EMG leg must matter */
A('stager: the SAME spectrum with high EMG tone is not REM', D.stageEpoch(mkRel({ delta: 0.2, theta: 0.3 }), 2.0, 1.5) !== 'REM');
A('stager: an absent EMG channel is permissive, not disqualifying', D.stageEpoch(mkRel({ delta: 0.2, theta: 0.3 }), null, 1.5) === 'REM');

/* analyze() end to end on a planted night: 20 min delta, then 20 min beta */
const night = new Float64Array(fs * 2400);
{
  const d = sine(2, fs, 1200),
    b = sine(22, fs, 1200);
  night.set(d, 0);
  night.set(b, fs * 1200);
}
const out = D.analyze({ eeg: night, fs });
A('analyze: produces one epoch per 30 s', out.nEpochs === 80, String(out.nEpochs));
A(
  'analyze: the delta half is staged N3',
  out.hypnogram.slice(0, 39).every((h) => h.stage === 'N3')
);
A(
  'analyze: the beta half is NOT staged N3',
  out.hypnogram.slice(41, 79).every((h) => h.stage !== 'N3')
);
A('analyze: architecture is present when epochs scored', out.architecture.TST != null);
A(
  'analyze: §∅ — an all-flat recording yields no stages and a null architecture',
  (() => {
    const o = D.analyze({ eeg: new Float64Array(fs * 300), fs });
    return o.quality.analyzablePct === 0 && o.architecture.TST === null;
  })()
);
A('analyze: refuses an absent signal rather than returning an empty hypnogram', !!D.analyze({ fs }).err);

console.log('\n' + (bad ? '✕ ' + bad + ' failed, ' : '✓ ') + good + ' assertions passed');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(bad ? 1 : 0);

#!/usr/bin/env node
/*
 * tools/eegdex-selftest.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ═════════════════════════════════════════════════════════════════════════════
 * Assertions for `eegdex-dsp.js`, on PLANTED signals rather than the corpus — a staging engine that
 * only demonstrates itself on real EEG cannot show WHY it is right, and a corpus test cannot separate
 * "the model answered" from "the night happened to be mostly one class".
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { isCliEntry } from './argv-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/* `eegdex-dsp.js` is a DUAL-MODE module: the IIFE attaches `window.EEGDSP` and a trailing
   `export const` re-exports it for the app's ESM graph. A vm script cannot evaluate a top-level
   `export`, and the classic attach needs a `window`, so this loader does what both test lanes do —
   classicify the text and give the realm a self-referential `window`. Loading the raw text instead
   throws a SyntaxError, which is the honest failure rather than a silent one. */
const DexBuild = createRequire(import.meta.url)(join(ROOT, 'tools', 'build-core.js'));
const ctx = { Math, console, isFinite, Float64Array, Float32Array, Object, Array, Number, JSON };
ctx.window = ctx;
vm.createContext(ctx);
/* THE TWO STAGE MODULES LOAD BESIDE THE DSP (the spine-module realm sweep). The DSP's one stage
   path reads `global.EEGFEAT` and `global.EEGSTAGE` at CALL time and refuses by name when either is
   absent, so a realm without them would not throw — every epoch would read `null` and the staging
   assertions below would pass over a series nothing scored. */
for (const f of ['eegdex-stage-features.js', 'eegdex-stage-model.js', 'eegdex-dsp.js']) vm.runInContext(DexBuild.classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
const D = ctx.EEGDSP;
/* The model the page itself carries, read from the repository root. It is the one-pass file: the
   two-pass file refuses an import under 160 epochs, and the planted nights here are shorter. */
const MODEL = JSON.parse(readFileSync(join(ROOT, 'eeg-stage-model-base-2026-11-17.json'), 'utf8'));

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
A('the stage modules reached this realm', !!(ctx.EEGFEAT && ctx.EEGSTAGE), 'eegdex-stage-features.js or eegdex-stage-model.js did not load, so every epoch would read null');
A('the model file reads the formula schema', MODEL.schema === 'tepna.stage-formula/1', String(MODEL.schema));

/* ── THE ONE STAGE PATH ────────────────────────────────────────────────────────────────────────
   `stageEpoch`, `smoothHypnogram` and the fitted `TUNED` block are GONE (owner order 2026-11-25,
   board #8966). The assertions that fired each arm of that rule set went with it, and nothing here
   replaces them with an accuracy claim: the model's agreement with an expert score is unmeasured in
   this repository, so these legs test the PATH — the four class names, the refusals and the seams —
   and never how well it stages a person. */
const CLASSES = ['wake', 'light', 'deep', 'REM'];

/* analyze() end to end on a planted night: 20 min delta, then 20 min beta */
const night = new Float64Array(fs * 2400);
{
  const d = sine(2, fs, 1200),
    b = sine(22, fs, 1200);
  night.set(d, 0);
  night.set(b, fs * 1200);
}
const out = D.analyze({ eeg: night, fs }, { model: MODEL });
A('analyze: produces one epoch per 30 s', out.nEpochs === 80, String(out.nEpochs));
A(
  'analyze: every epoch reads one of the four classes, or null',
  out.hypnogram.every((h) => h.stage === null || CLASSES.indexOf(h.stage) >= 0),
  'an epoch names a class outside the model: ' + JSON.stringify(out.hypnogram.map((h) => h.stage).filter((x) => x !== null && CLASSES.indexOf(x) < 0)[0])
);
A(
  '§∅: every unscored epoch names its own reason',
  out.hypnogram.every((h) => h.stage !== null || !!h.absentReason),
  'an epoch reads null with no reason beside it'
);
A(
  'analyze: no epoch carries a retired stage name',
  out.hypnogram.every((h) => ['W', 'N1', 'N2', 'N3'].indexOf(h.stage) < 0)
);
A('analyze: the summary names the model that scored it', out.stageSource && out.stageSource.kind === 'model' && out.stageSource.id === (MODEL.id || null), JSON.stringify(out.stageSource));
A(
  'analyze: the series equals formulaStages over the same frame',
  (() => {
    const f = D.formulaStages({ samples: night, fs }, MODEL);
    if (f.err || !f.epochs) return false;
    return out.hypnogram.every((h, k) => (f.epochs[k] ? f.epochs[k].stage : null) === h.stage);
  })(),
  'the hypnogram is not the model output over the same epochs'
);
A(
  '§∅: WITH NO MODEL, no epoch is staged and each names the absence',
  (() => {
    const o = D.analyze({ eeg: night, fs });
    return o.hypnogram.every((h) => h.stage === null && h.absentReason === 'no-stage-model') && o.stageSource.kind === 'none';
  })(),
  'a frame with no model produced a stage, or an unnamed absence'
);
A(
  '§∅: a model of the wrong schema REFUSES by name, it does not fall back',
  (() => {
    const o = D.analyze({ eeg: night, fs }, { model: { schema: 'something.else/1' } });
    return !!o.stageSource.err && o.hypnogram.every((h) => h.stage === null);
  })()
);
A('analyze: architecture is present when epochs scored', out.architecture.TST != null);
A(
  'architecture: the two NREM shares are light and deep, and the three AASM shares are gone',
  'lightPct' in out.architecture && 'deepPct' in out.architecture && !('n1Pct' in out.architecture) && !('n2Pct' in out.architecture) && !('n3Pct' in out.architecture)
);
A(
  'analyze: §∅ — an all-flat recording yields no stages and a null architecture',
  (() => {
    const o = D.analyze({ eeg: new Float64Array(fs * 300), fs }, { model: MODEL });
    return o.quality.analyzablePct === 0 && o.architecture.TST === null;
  })()
);
A('analyze: refuses an absent signal rather than returning an empty hypnogram', !!D.analyze({ fs }).err);

/* THE GIVEN-SERIES SEAM, which is how the spindle and slow-wave groups hold their own truth: a
   caller may hand `analyze` a stage series, and the node then measures none of it and says so. */
A(
  'analyze: a given series is used verbatim, and the source says the node measured none of it',
  (() => {
    const given = [];
    for (let k = 0; k < 80; k++) given.push(k < 40 ? 'deep' : 'light');
    const o = D.analyze({ eeg: night, fs }, { stages: given });
    return o.stageSource.kind === 'given' && o.hypnogram[0].stage === 'deep' && o.hypnogram[79].stage === 'light';
  })()
);
A(
  '§∅: a given series SHORTER than the night leaves the rest absent, with its own reason',
  (() => {
    const o = D.analyze({ eeg: night, fs }, { stages: ['deep'] });
    return o.hypnogram[0].stage === 'deep' && o.hypnogram[79].stage === null && o.hypnogram[79].absentReason === 'not-in-given-series';
  })()
);

/* ∅ · THE SIGNAL'S OWN ABSENCE OVERRULES A CLASS (owner ruling 2026-09-17: a discontinuity
   refuses). The fit's floor is the SHARE of its feature inputs it could measure, so one hole in an
   otherwise whole epoch leaves it well over that floor and the fit answers a class. The engine
   refuses the epoch anyway and names the hole, because a stage over a seam is a number standing on
   a discontinuity. The leg plants ONE non-finite sample in the first epoch and holds the rest of
   the night as the control, so a gate that refused the whole night would red here too. */
A(
  '∅: one hole in an epoch refuses that epoch and names the hole, whatever the model answered',
  (() => {
    const whole = D.analyze({ eeg: night, fs }, { model: MODEL });
    const holed = night.slice(0);
    holed[Math.round(10 * fs)] = NaN;
    const o = D.analyze({ eeg: holed, fs }, { model: MODEL });
    return (
      whole.hypnogram[0].stage !== null &&
      o.hypnogram[0].stage === null &&
      o.hypnogram[0].absentReason === 'partial-hole' &&
      o.hypnogram[0].conf === null &&
      o.hypnogram[1].stage === whole.hypnogram[1].stage
    );
  })()
);

console.log('\n' + (bad ? '✕ ' + bad + ' failed, ' : '✓ ') + good + ' assertions passed');
if (isCliEntry(import.meta.url)) process.exit(bad ? 1 : 0);

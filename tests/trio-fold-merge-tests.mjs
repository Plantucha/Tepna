// Tepna — tests/trio-fold-merge-tests.mjs
// Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
/* `tools/trio-fold-merge.mjs` — a night's fragments merge on PARSED records, and every tool that
   folds a night owes the same merge (residue 2026-11-06-the-sigma-window-concat-joins-a-nights-parts-
   as-text).

   `trio-batch.mjs` held both merges inside its night loop, so nothing could call them: no test, and
   no second tool. `tools/derive-sigma-window.mjs` joined its parts as TEXT instead — one header, one
   `t0Ms`, and no entry for the silence between two parts, so a break reached both detectors as
   continuous signal. These are the extracted merges' plants, and the ones that matter are the
   BOUNDARY cases, because that is where a text join and a record fold differ: the silence between
   two fragments, the rate that is imposed on all of them, and the annotations that must move when the
   sample arrays move under them. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// A namespace import, so an ABSENT export reads as a failed assertion rather than a link error.
import * as Fold from '../tools/trio-fold-merge.mjs';
import { mergeEcg, mergePpg } from '../tools/trio-fold-merge.mjs';

let pass = 0;
const fails = [];
const ok = (cond, what) => {
  if (cond) pass++;
  else fails.push(what);
};
const eq = (got, want, what) => ok(got === want, `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const same = (got, want, what) => ok(JSON.stringify(got) === JSON.stringify(want), `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const throws = (fn, re, what) => {
  try {
    fn();
    fails.push(`${what}: it returned instead of refusing`);
  } catch (e) {
    ok(re.test(e.message), `${what}: got ${JSON.stringify(e.message)}`);
  }
};
// Every merge takes `opts.warn`, so a test reads the warnings instead of the console.
const sink = () => {
  const lines = [];
  return { warn: (m) => lines.push(String(m)), lines };
};

ok(typeof Fold.mergeEcg === 'function', 'the module exports mergeEcg');
ok(typeof Fold.mergePpg === 'function', 'the module exports mergePpg');

/* ── ECG ──────────────────────────────────────────────────────────────────────────────────────────
   130 Hz, so 1300 samples is exactly 10 s. A fragment is `{ int16, fs, t0Ms, … }` as
   `ECGDSP.parseECGLines` returns it. */
const FS = 130;
const ecg = (t0Ms, n, extra) => ({ int16: new Int16Array(n), fs: FS, t0Ms, ...(extra || {}) });

eq(mergeEcg([]), null, 'no fragment → null');
eq(mergeEcg([null, { int16: new Int16Array(0), fs: FS, t0Ms: 0 }]), null, 'an empty fragment is not a record');
const one = ecg(1000, 1300);
eq(mergeEcg([one]), one, 'one fragment is returned AS IS — a fold of one night part invents nothing');

/* THE DEFECT THIS MODULE EXISTS FOR. Two fragments 10 s long, 60 s apart: the silence is 50 s and it
   is REAL (the sensor was off-link). A text join carries no entry for it, so a detector reads 20 s of
   continuous signal; the fold writes one gap at the first sample AFTER the hole. */
const twoFrag = mergeEcg([ecg(1_000_000, 1300), ecg(1_060_000, 1300)], sink());
eq(twoFrag.int16.length, 2600, 'the samples of both fragments are kept');
same(twoFrag.gaps, [{ idx: 1300, ms: 50_000 }], 'the inter-fragment silence is one gap at the first sample after it');
eq(twoFrag.durSec, 20, 'and `durSec` counts SAMPLES, so it does not absorb the silence');
eq(twoFrag.t0Ms, 1_000_000, 'the merged record starts at the earliest fragment');
same(twoFrag.overlaps, [], 'two fragments that do not overlap record no overlap');
eq(twoFrag.blankingSpans, undefined, 'no fragment carried a sidecar → no field, so the night keeps today’s record shape');

// Order on the command line is not the night's order: the merge sorts by t0Ms.
same(mergeEcg([ecg(1_060_000, 1300), ecg(1_000_000, 1300)], sink()).gaps, [{ idx: 1300, ms: 50_000 }], 'fragments handed over out of order are sorted by t0Ms first');

// A gap INSIDE a fragment moves by the fragment's offset, so both kinds land on one axis.
same(
  mergeEcg([ecg(0, 1300, { gaps: [{ idx: 650, ms: 400 }] }), ecg(20_000, 1300, { gaps: [{ idx: 10, ms: 900 }] })], sink()).gaps,
  [
    { idx: 650, ms: 400 },
    { idx: 1300, ms: 10_000 },
    { idx: 1310, ms: 900 }
  ],
  'an in-fragment gap is rebased by the samples ahead of it'
);

/* THE RATE IS THE LONGEST FRAGMENT'S, not the first one's: a 5 s reconnect stub carries the raw
   crystal while the 7 h fragment carries the host-axis correction, and sample index → duration is
   imposed on every fragment here. */
eq(
  mergeEcg(
    [
      { int16: new Int16Array(100), fs: 130.05, t0Ms: 0 },
      { int16: new Int16Array(100_000), fs: 130.01, t0Ms: 10_000_000 }
    ],
    sink()
  ).fs,
  130.01,
  'fs comes from the fragment holding the samples, not the stub that came first'
);

/* A rate change mid-night would make one sample index mean two durations, so the merge REFUSES. An
   H10 crystal lives within ~30 ppm; 0.05 Hz is 385 ppm. */
throws(() => mergeEcg([ecg(0, 1300), { int16: new Int16Array(1300), fs: 130.2, t0Ms: 20_000 }], sink()), /disagree on fs/, 'fragments disagreeing on fs by more than 0.05 Hz refuse to merge');
eq(mergeEcg([ecg(0, 1300), { int16: new Int16Array(1300), fs: 130.04, t0Ms: 20_000 }], sink()).fs, FS, 'and 0.04 Hz apart still merges');

/* A NEGATIVE boundary is a tripwire, not a repair: the merged timeline is longer than reality and
   there is no honest single-scalar fix, so it is counted and NAMED rather than dropped silently. */
const sk = sink();
const neg = mergeEcg([ecg(0, 1300), ecg(5_000, 1300)], sk);
same(neg.gaps, [], 'a fragment starting before the previous one ends is not a gap');
same(neg.overlaps, [{ idx: 1300, ms: -5000 }], 'it is counted as an overlap, with the milliseconds it over-states');
ok(
  sk.lines.some((l) => /negative session boundary/.test(l) && /OVER-stated/.test(l)),
  'and the merge says so through `opts.warn`, never only in the record'
);

/* A mid-file clock resync is a property of the NIGHT. `idx` rebases onto the merged sample index and
   `atRelMs` onto the merged relative axis — the same axis the gaps above land on. */
same(
  mergeEcg([ecg(1_000_000, 1300, { clockResyncs: [{ idx: 100, atRelMs: 770, deviceStepMs: 420 }] }), ecg(1_060_000, 1300, { clockResyncs: [{ idx: 7, atRelMs: 54, deviceStepMs: -900 }] })], sink())
    .clockResyncs,
  [
    { idx: 100, atRelMs: 770, deviceStepMs: 420 },
    { idx: 1307, atRelMs: 60_054, deviceStepMs: -900 }
  ],
  'the later fragment’s resync lands on the merged index and the merged relative axis'
);

/* The timing provenance survives the fold, because a folded night that publishes no `hostAxis` is a
   night whose export claims no timing source — and BLE reconnects fragment exactly the long nights. */
const ax = mergeEcg([ecg(0, 1300, { hostAxis: { ok: true, independent: true, ppm: 12 } }), ecg(20_000, 1300, { hostAxis: { ok: true, independent: null } })], sink()).hostAxis;
same(
  { ok: ax.ok, merged: ax.merged, fragments: ax.fragments, independent: ax.independent, timingSource: ax.timingSource },
  { ok: false, merged: true, fragments: 2, independent: true, timingSource: 'device+host' },
  'any fragment that resolved independence speaks for the night, and a merged axis is `ok:false`'
);
ok(/merged night/.test(ax.reason), 'and it carries the reason it is not ok, rather than reading as a failed axis');
eq(mergeEcg([ecg(0, 1300), ecg(20_000, 1300)], sink()).hostAxis, undefined, 'a night with no fragment axis publishes none');

/* `deviceDrawn` IS A FOLDED FIELD, NOT A DROPPED ONE (§∅ on the fold's own output). `clock.js`
   publishes it per fragment; a fresh merged object that does not name it hands every consumer
   refusing on `deviceDrawn === true` an `undefined` that reads as "not drawn". A drawn counter stays
   drawn across a merge, so one drawn fragment speaks for the night. Three states, three plants —
   and the all-false plant is what proves the fold is not a constant. */
eq(
  mergeEcg([ecg(0, 1300, { hostAxis: { ok: true, deviceDrawn: false } }), ecg(20_000, 1300, { hostAxis: { ok: true, deviceDrawn: true } })], sink()).hostAxis.deviceDrawn,
  true,
  'one drawn fragment makes the folded night drawn'
);
eq(
  mergeEcg([ecg(0, 1300, { hostAxis: { ok: true, deviceDrawn: false } }), ecg(20_000, 1300, { hostAxis: { ok: true, deviceDrawn: false } })], sink()).hostAxis.deviceDrawn,
  false,
  'and a night whose every fragment carried a real counter folds to false, never to true'
);
eq(
  mergeEcg([ecg(0, 1300, { hostAxis: { ok: true, independent: true } }), ecg(20_000, 1300, { hostAxis: { ok: true } })], sink()).hostAxis.deviceDrawn,
  null,
  'an unmeasured drawn-ness folds to null — never to false, which would claim a measurement'
);
eq(
  mergeEcg([ecg(0, 1300, { hostAxis: { ok: true, independent: true, deviceDrawn: true } }), ecg(20_000, 1300, { hostAxis: { ok: true, independent: true } })], sink()).hostAxis.timingSource,
  'device+host',
  'and it is carried ADDITIVELY: it does not gate `independent`, which is clock.js’s own discipline'
);

// The device epoch is bimodal years-vs-seconds, so the published offset is the WORST fragment's.
same(
  mergeEcg([ecg(0, 1300, { deviceEpoch: { offsetMs: 12, plausible: true } }), ecg(20_000, 1300, { deviceEpoch: { offsetMs: -9e11, plausible: false } })], sink()).deviceEpoch,
  { offsetMs: -9e11, plausible: false },
  'one implausible fragment makes the night implausible, at the worst offset'
);

/* ── PPG ──────────────────────────────────────────────────────────────────────────────────────────
   A fragment is `{ ch, relSec, fs, n, t0Ms, site, … }` as `PPGDSP.parsePPG` returns it. */
const ppg = (t0Ms, n, fs, extra) => ({
  ch: [Float32Array.from({ length: n }, (_, i) => i + 1)],
  relSec: Float64Array.from({ length: n }, (_, i) => i / fs),
  fs,
  n,
  t0Ms,
  site: 'wrist',
  ...(extra || {})
});

eq(mergePpg([]), null, 'no fragment → null');
const p1 = ppg(0, 10, 55);
eq(mergePpg([p1]), p1, 'one fragment is returned AS IS');

/* The hole shows up in `relSec`, because a later fragment's samples land at their TRUE offset from
   the first fragment's t0 — the PPG twin of the ECG gap entry. */
const twoPpg = mergePpg([ppg(1_000_000, 10, 55), ppg(1_060_000, 10, 55)], sink());
eq(twoPpg.n, 20, 'both fragments’ samples are kept');
eq(twoPpg.relSec[10], 60, 'the second fragment starts 60 s along the merged axis, so the silence is visible');
eq(twoPpg.relSec[9] < 1, true, 'while the first fragment still starts at its own zero');
eq(twoPpg.durSec, twoPpg.relSec[19], 'and the duration is the last sample’s own offset');
eq(twoPpg.ch[0][10], 1, 'the second fragment’s first sample is its own first sample, not a padded zero');

/* SESSIONS AT DIFFERENT SAMPLE RATES MUST NOT SHARE A GRID. Measured 2026-08-03: a night merged
   under the first fragment's 55 Hz while most of it was 176 Hz exported 108.6 bpm against the chest
   ECG's 52.1, because beat detection derives its refractory window in SAMPLES from `fs`. The
   minority-rate fragments are DROPPED and named, rather than the night refused. */
const sk2 = sink();
const mixed = mergePpg([ppg(0, 10, 55), ppg(1_000_000, 1000, 176), ppg(2_000_000, 500, 176)], sk2);
eq(mixed.fs, 176, 'the dominant rate is the one that keeps the samples, not the one that came first');
eq(mixed.n, 1500, 'and the off-rate fragment’s samples are not on the merged grid');
ok(
  sk2.lines.some((l) => /different sample rate/.test(l) && /55\.0/.test(l) && /176\.0/.test(l)),
  'the drop is NAMED with both rates, because a silent drop is a night reported over less data than it says'
);
eq(mergePpg([ppg(0, 1000, 55), ppg(1_000_000, 10, 176)], sink()).n, 1000, 'and the rule is by samples, so the stray fragment is dropped whichever end it sits at');

throws(() => mergePpg([ppg(0, 10, 55), { ...ppg(1_000_000, 10, 55), site: 'finger' }], sink()), /channel count or site/, 'two different sites refuse to merge');
throws(
  () => mergePpg([ppg(0, 10, 55), { ...ppg(1_000_000, 10, 55), ch: [new Float32Array(10), new Float32Array(10)] }], sink()),
  /channel count or site/,
  'two different channel counts refuse to merge'
);

// The clock annotations ride the same axis as the samples (`tools/trio-fold-clock.mjs` owns the rule).
same(mergePpg([ppg(0, 10, 55, { clockResyncs: [{ idx: 3, deviceStepMs: 7 }] }), ppg(1_000_000, 10, 55)], sink()).clockResyncs, [{ idx: 3, deviceStepMs: 7 }], 'a fragment resync survives the fold');
eq(mergePpg([ppg(0, 10, 55), ppg(1_000_000, 10, 55)], sink()).clockResyncs, undefined, 'and a night with none publishes none');

/* ── THE WIRING, so neither merge can be un-called without a red ────────────────────────────────── */
const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, '..', 'tools', f), 'utf8');
const tb = src('trio-batch.mjs');
const dsw = src('derive-sigma-window.mjs');
const imports = (s, k) => new RegExp(`import\\s*\\{[^}]*\\b${k}\\b[^}]*\\}\\s*from\\s*'\\./trio-fold-merge\\.mjs'`).test(s);
const localDef = (s, k) => new RegExp(`(^|\\n)\\s*(export\\s+)?(const\\s+${k}\\s*=|function\\s+${k}\\s*\\()`).test(s);
for (const [name, s] of [
  ['trio-batch.mjs', tb],
  ['derive-sigma-window.mjs', dsw]
]) {
  for (const k of ['mergeEcg', 'mergePpg']) {
    ok(imports(s, k), `${name} imports ${k} from ./trio-fold-merge.mjs`);
    ok(!localDef(s, k), `${name} does not re-derive ${k} locally`);
  }
}
ok(/mergeEcg\(p\.ecg\.map\(/.test(tb), 'the fold still merges its ECG fragments');
ok(/mergePpg\(p\.ppg\.map\(/.test(tb), 'the fold still merges its PPG fragments');

/* The sigma-window tool's own two rows: no text join of a night's parts, and no parser of its own.
   Both are stated as an ABSENCE, which is the half a positive assertion cannot cover — the join and
   the local reader each passed every test this tool had while they were there. */
ok(!/function concatParts|const concatParts/.test(dsw), 'derive-sigma-window.mjs no longer joins a night’s parts as text');
ok(!/function parseECG\s*\(/.test(dsw), 'and no longer carries a parser of its own');
ok(/ECGDSP\.parseECGLines\(/.test(dsw), 'it runs the DSP’s own ECG parse');
ok(/PPGDSP\.parsePPG\(/.test(dsw), 'and the DSP’s own PPG parse');
ok(/readLinesBounded/.test(dsw) && /from '\.\/read-lines-bounded\.mjs'/.test(dsw), 'over the bounded line reader, so a 350 MB part is never one string');
ok(/readRunsSidecar\(path, stream/.test(dsw), 'each part’s validity sidecar is read for that part, so no index needs rebasing');
/* A seam is a change of clock, so the weight over it is OMITTED rather than defaulted to 1 (§∅). The
   local parser could not see a seam, which is why this leg wrote a weight over a changed clock. */
ok(/const ecgSeam = !!\(rec\.clockResyncs && rec\.clockResyncs\.length\)/.test(dsw), 'the ECG leg reads the seams the production parse reports');
ok(/ecgSeam \? null : ECGDSP\.beatConfidence\(/.test(dsw), 'and omits the `c` column across one, as the PPG leg beside it already did');

if (fails.length) {
  console.error(`trio-fold-merge: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`trio-fold-merge: ✓ ${pass} assertions — a night folds on parsed records, and the silence between two parts stays visible`);

// Tepna — tests/trio-fold-clock-tests.mjs
// Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
/* `tools/trio-fold-clock.mjs` — a folded night keeps the clock annotations of its fragments
   (residue 2026-10-29-the-fold-merge-drops-the-ring-segmentation-it-now-publishes).

   `trio-batch.mjs` runs its night loop at import, so nothing inside it is callable from a test — the
   same reason `tools/trio-anchor.mjs` was extracted, and these are the extracted rule's plants. The
   cases that matter are the EPOCH ones: PpgDex keys each anchor on the fragment's own first sample, so
   a second fragment's segment bounds mean nothing until the fold moves them, and a bound the fold
   cannot move is null rather than a fragment-local number dressed as a merged one. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeClockResyncs, mergeOffsetSegments } from '../tools/trio-fold-clock.mjs';
// A namespace import, so an ABSENT export reads as a failed assertion below rather than a link error.
import * as Fold from '../tools/trio-fold-clock.mjs';

let pass = 0;
const fails = [];
const ok = (cond, what) => {
  if (cond) pass++;
  else fails.push(what);
};
const eq = (got, want, what) => ok(got === want, `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const same = (got, want, what) => ok(JSON.stringify(got) === JSON.stringify(want), `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

ok(typeof Fold.mergeClockResyncs === 'function', 'the module exports mergeClockResyncs');
ok(typeof Fold.mergeOffsetSegments === 'function', 'the module exports mergeOffsetSegments');

/* ── THE RESYNCS ──────────────────────────────────────────────────────────────────────────────────
   A PpgDex resync entry is `{ idx, deviceStepMs, phoneDeltaMs }` and `idx` indexes the record's own
   samples, so the fold MUST move it: the merge rewrote the sample arrays under it. */
eq(mergeClockResyncs(undefined), undefined, 'no record list → undefined');
eq(mergeClockResyncs([]), undefined, 'an empty record list → undefined');
eq(mergeClockResyncs([{ n: 100 }, { n: 50, clockResyncs: [] }]), undefined, 'a night with no resync keeps today’s bytes');

const twoFrags = [
  { n: 100, t0Ms: 1000, clockResyncs: [{ idx: 7, deviceStepMs: 420, phoneDeltaMs: 13 }] },
  { n: 50, t0Ms: 2000, clockResyncs: [{ idx: 5, deviceStepMs: -900, phoneDeltaMs: null }] }
];
same(
  mergeClockResyncs(twoFrags),
  [
    { idx: 7, deviceStepMs: 420, phoneDeltaMs: 13 },
    { idx: 105, deviceStepMs: -900, phoneDeltaMs: null }
  ],
  'the second fragment’s resync lands at 100 + 5, and an unmeasured phone delta stays null'
);
eq(twoFrags[1].clockResyncs[0].idx, 5, 'the input record is untouched');

same(mergeClockResyncs([{ n: 10, clockResyncs: [{ idx: null, deviceStepMs: 5 }] }]), [{ idx: null, deviceStepMs: 5 }], 'a resync with no index keeps the event and reports no position');
same(
  mergeClockResyncs([{ clockResyncs: [{ idx: 1 }] }, { n: 10, clockResyncs: [{ idx: 2 }] }]),
  [{ idx: 1 }, { idx: null }],
  'one fragment of unknown length makes every later index null, never off by that fragment'
);
same(mergeClockResyncs([{ n: 10, clockResyncs: [null, { idx: 0 }] }]), [{ idx: 0 }], 'an empty entry is dropped');

/* ── THE SEGMENTS ─────────────────────────────────────────────────────────────────────────────────
   `fromDevMs`/`toDevMs` are anchor `devMs` values, and PpgDex keys them on the fragment's own first
   sample (`ppgdex-dsp.js:1105`). Two fragments therefore both start near zero. */
const seg = (from, to, extra) => ({
  fromDevMs: from,
  toDevMs: to,
  anchors: 40,
  spanS: (to - from) / 1000,
  flatOffsetMs: 12.5,
  residualRmsMs: 1.5,
  jitterMs: 3,
  ppm: -11.4,
  rate: 'measured',
  rateReason: null,
  ...extra
});

eq(mergeOffsetSegments([{ n: 10, t0Ms: 0 }], 0), undefined, 'a night with no segmentation keeps today’s bytes');
eq(mergeOffsetSegments(undefined, 0), undefined, 'no record list → undefined');

const firstOnly = [{ n: 100, t0Ms: 5000, offsetSegments: [seg(0, 3000), seg(3000, 9000)] }];
same(mergeOffsetSegments(firstOnly, 5000), [seg(0, 3000), seg(3000, 9000)], 'the first fragment’s bounds do not move');

const bothSeg = [
  { n: 100, t0Ms: 5000, offsetSegments: [seg(0, 3000), seg(3000, 9000)] },
  { n: 80, t0Ms: 65000, offsetSegments: [seg(0, 2000, { ppm: null, rate: 'unknown', rateReason: 'span 2 s under the 2400 s floor' }), seg(2000, 7000)] }
];
const merged = mergeOffsetSegments(bothSeg, 5000);
eq(merged.length, 4, 'every fragment’s segments reach the merged night');
eq(merged[2].fromDevMs, 60000, 'the second fragment’s first bound moves by its own wall-clock offset');
eq(merged[2].toDevMs, 62000, 'and so does its end bound');
eq(merged[3].fromDevMs, 62000, 'the merged bounds are ordered, so a reader can place each segment');
eq(merged[2].ppm, null, 'a rate the node refused stays refused');
eq(merged[2].rateReason, 'span 2 s under the 2400 s floor', 'and its reason travels with it');
eq(merged[1].ppm, -11.4, 'a measured rate rides through untouched');
eq(merged[1].anchors, 40, 'the anchor count rides beside it, per Clock Contract §7');
eq(bothSeg[1].offsetSegments[0].fromDevMs, 0, 'the input record is untouched');

const noBase = mergeOffsetSegments(bothSeg, null);
eq(noBase.length, 4, 'the segmentation survives when the merged origin is absent');
eq(noBase[0].fromDevMs, null, 'a bound the fold cannot place is null, never a fragment-local number');
eq(noBase[0].ppm, -11.4, 'and the rate it measured is still a fact about its own anchors');
same(mergeOffsetSegments([{ n: 10, t0Ms: 0, offsetSegments: [seg(null, 500)] }], 0), [seg(null, 500)], 'an absent bound stays absent');

/* ── THE WIRING, so the rule cannot be un-called without a red ────────────────────────────────── */
const here = dirname(fileURLToPath(import.meta.url));
const tb = readFileSync(join(here, '..', 'tools', 'trio-batch.mjs'), 'utf8');
const imports = (src, k) => new RegExp(`import\\s*\\{[^}]*\\b${k}\\b[^}]*\\}\\s*from\\s*'\\./trio-fold-clock\\.mjs'`).test(src);
const localDef = (src, k) => new RegExp(`(^|\\n)\\s*(export\\s+)?(const\\s+${k}\\s*=|function\\s+${k}\\s*\\()`).test(src);
for (const k of ['mergeClockResyncs', 'mergeOffsetSegments']) {
  ok(imports(tb, k), `trio-batch.mjs imports ${k} from ./trio-fold-clock.mjs`);
  ok(!localDef(tb, k), `trio-batch.mjs does not re-derive ${k} locally`);
}
ok(/clockResyncs: mergeClockResyncs\(recs\)/.test(tb), 'the merged PPG record publishes clockResyncs');
ok(/offsetSegments: mergeOffsetSegments\(recs, base\.t0Ms\)/.test(tb), 'the merged PPG record publishes offsetSegments');

if (fails.length) {
  console.error(`trio-fold-clock: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`trio-fold-clock: ✓ ${pass} assertions — a folded night keeps its segmentation, on the merged axis`);

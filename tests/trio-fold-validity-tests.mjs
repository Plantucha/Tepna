// Tepna — tests/trio-fold-validity-tests.mjs
// Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
/* `tools/trio-fold-validity.mjs` — a folded night keeps the validity of its fragments
   (residue 2026-10-17-sample-parsers-called-without-their-sidecar, the `tools/trio-batch.mjs` slice).

   `trio-batch.mjs` runs its night loop at import, so nothing inside it is callable from a test — the
   reason `tools/trio-fold-clock.mjs` was extracted, and these are this rule's plants. The cases that
   matter are the AXIS ones: a span is a sample index into ONE fragment, so a second fragment's span
   means nothing until the fold moves it by the samples before it. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeBlankingSpans, mergePinnedSpans, runsSidecarPath } from '../tools/trio-fold-validity.mjs';

let pass = 0;
const fails = [];
const ok = (cond, what) => {
  if (cond) pass++;
  else fails.push(what);
};
const same = (got, want, what) => ok(JSON.stringify(got) === JSON.stringify(want), `${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/* ── THE SIDECAR PATH ── */
same(runsSidecarPath('/n/Polar_H10_X_20261025205205_ECG.txt', 'ECG'), '/n/Polar_H10_X_20261025205205_ECGRUNS.txt', 'ECG → ECGRUNS');
same(runsSidecarPath('/n/Wellue_O2Ring-S_S_20261025205206_PPG.txt', 'PPG'), '/n/Wellue_O2Ring-S_S_20261025205206_PPGRUNS.txt', 'ring PPG → PPGRUNS');
same(runsSidecarPath('/n/x_PPG2W.txt', 'PPG'), null, 'a path that is not `_PPG.txt` gets no guessed name');
same(runsSidecarPath('/n/x_ECG.txt', 'PPG'), null, 'a stream mismatch gets no guessed name');
same(runsSidecarPath(undefined, 'ECG'), null, 'no path → null');

/* ── THE ECG BLANKING SPANS ── */
const ecg = (len, spans) => ({ int16: new Int16Array(len), ...(spans ? { blankingSpans: spans } : {}) });
same(mergeBlankingSpans([ecg(10), ecg(20)]), undefined, 'no fragment carried a sidecar → undefined, today’s record shape');
same(mergeBlankingSpans([ecg(10, []), ecg(20)]), { spans: [], unplaced: 0, refused: 0, reason: null }, 'a sidecar that recorded no run is an empty list, not an absence');
same(
  mergeBlankingSpans([ecg(100, [{ first: 5, n: 30, value: 7 }]), ecg(50), ecg(40, [{ first: 2, n: 30, value: 9 }])]),
  {
    spans: [
      { first: 5, n: 30, value: 7 },
      { first: 152, n: 30, value: 9 }
    ],
    unplaced: 0,
    refused: 0,
    reason: null
  },
  'the third fragment’s span moves by the 150 samples before it; the value rides through'
);
same(
  mergeBlankingSpans([{ blankingSpans: [{ first: 1, n: 30 }] }, ecg(10, [{ first: 2, n: 30 }])]),
  { spans: [{ first: 1, n: 30 }], unplaced: 1, refused: 0, reason: null },
  'after a fragment of unknown length a span is dropped and counted, never placed'
);

/* ── ∅ AN UNREAD SIDECAR AND AN ABSENT ONE MUST NOT FOLD ALIKE ──
   Row `2026-11-01-the-ecg-fold-cannot-tell-an-absent-sidecar-from-an-unreadable-one`. `ecgdex-dsp.js`
   spells a sidecar it could not place as `null` plus a `blankingSpansReason`, and this merge read that
   refusal as the one-argument parse that states nothing. The direction was the harmful one: a night the
   parse could not place looked like a night the box never wrote a sidecar for. */
const refus = (len, why) => ({ int16: new Int16Array(len), blankingSpans: null, ...(why ? { blankingSpansReason: why } : {}) });
same(
  mergeBlankingSpans([refus(10, 'sidecar rows unplaced: channel 0'), ecg(20)]),
  { spans: null, unplaced: 0, refused: 1, reason: '1 of 1 fragment(s) with a sidecar went unread: sidecar rows unplaced: channel 0' },
  'the only sidecar placed no row → null and the fragment’s own reason, never an empty list'
);
ok(
  JSON.stringify(mergeBlankingSpans([refus(10, 'sidecar rows unplaced: channel 0'), ecg(20)])) !== JSON.stringify(mergeBlankingSpans([ecg(10), ecg(20)])),
  'the unread sidecar and the absent one do not fold alike'
);
same(mergeBlankingSpans([ecg(10), ecg(20)]), undefined, 'and the absent one still reads undefined, so a sidecar-less night keeps its record shape');
same(
  mergeBlankingSpans([refus(10)]),
  { spans: null, unplaced: 0, refused: 1, reason: '1 of 1 fragment(s) with a sidecar went unread: no reason stated' },
  'a refusal carrying no reason still says a sidecar went unread'
);
same(
  mergeBlankingSpans([refus(100, 'sidecar rows unplaced: channel 0'), ecg(40, [{ first: 2, n: 30 }])]),
  { spans: [{ first: 102, n: 30 }], unplaced: 0, refused: 1, reason: '1 of 2 fragment(s) with a sidecar went unread: sidecar rows unplaced: channel 0' },
  'a part-read night keeps the spans it placed, rebased past the refusing fragment, and says the rest went unread'
);

/* ── THE PPG PINNED SPANS ── */
const ppg = (n, spans) => ({ n, spans });
same(mergePinnedSpans([ppg(10, undefined), ppg(10, undefined)], 2), { spans: [null, null], unplaced: 0 }, 'no fragment measured a channel → null per channel');
same(
  mergePinnedSpans(
    [
      ppg(100, [{ spans: [{ first: 10, n: 40 }], lo: 1, hi: 9 }, null]),
      ppg(60, [
        { spans: [{ first: 0, n: 30 }], lo: 2, hi: 8 },
        { spans: [], lo: 0, hi: 5 }
      ])
    ],
    2
  ),
  {
    spans: [
      {
        spans: [
          { first: 10, n: 40 },
          { first: 100, n: 30 }
        ],
        lo: null,
        hi: null
      },
      { spans: [], lo: null, hi: null }
    ],
    unplaced: 0
  },
  'channel 0 rebases the second fragment by 100; one fragment’s rail threshold is never published as the night’s'
);
same(
  mergePinnedSpans([{ spans: [{ spans: [{ first: 3, n: 30 }] }] }, ppg(10, [{ spans: [{ first: 4, n: 30 }] }])], 1),
  { spans: [{ spans: [{ first: 3, n: 30 }], lo: null, hi: null }], unplaced: 1 },
  'after a fragment of unknown length a pinned span is dropped and counted'
);

/* ── THE FOLD CALLS IT ── */
const here = dirname(fileURLToPath(import.meta.url));
const tb = readFileSync(join(here, '..', 'tools', 'trio-batch.mjs'), 'utf8');
ok(/import\s*\{[^}]*\bmergeBlankingSpans\b[^}]*\}\s*from\s*'\.\/trio-fold-validity\.mjs'/.test(tb), 'trio-batch.mjs imports mergeBlankingSpans');
ok(/import\s*\{[^}]*\bmergePinnedSpans\b[^}]*\}\s*from\s*'\.\/trio-fold-validity\.mjs'/.test(tb), 'trio-batch.mjs imports mergePinnedSpans');
ok(/blankingSpans: blank \? blank\.spans : undefined/.test(tb), 'the merged ECG record publishes blankingSpans');
ok(/blankingSpansReason: blank\.reason/.test(tb), 'the merged ECG record publishes the refusal reason beside the spans');
ok(/spans: pinned\.spans,/.test(tb), 'the merged PPG record publishes spans');
ok(/ECGDex\.parseECGLines\(readLinesBounded\(f\.full\), \{ runsText: readRuns\(f\.full, 'ECG'\) \}\)/.test(tb), 'the fold hands _ECGRUNS.txt to the ECG parser');
ok(
  (tb.match(/PpgDex\.parsePPG\(readFileSync\(f\.full, 'utf8'\), \{ runsText: readRuns\(f\.full, 'PPG'\) \}\)/g) || []).length === 2,
  'the fold hands _PPGRUNS.txt to both PPG parses (Verity and ring)'
);

if (fails.length) {
  console.error(`trio-fold-validity: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`trio-fold-validity: ✓ ${pass} assertions — a folded night keeps its validity spans, on the merged axis`);

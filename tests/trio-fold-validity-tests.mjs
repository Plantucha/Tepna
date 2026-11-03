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
import { VALIDITY_STATES, mergeBlankingSpans, mergePinnedSpans, readRunsSidecar, runsSidecarPath, validityLine } from '../tools/trio-fold-validity.mjs';

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

/* ── THE SIDECAR READ, AND WHICH OF FOUR THINGS HAPPENED ──────────────────────────────────────────
   Row 2026-10-17-sample-parsers-called-without-their-sidecar. The states are not interchangeable: an
   ABSENT sidecar is validity UNKNOWN for that stream, while an EMPTY one is informative, because its
   header states what was looked for. A reader that answered `''` for both would hand every consumer
   a clean stream for a night nothing was measured on. `opts.io` plants all four with no disk. */
const planted = (map) => ({
  readFileSync(path) {
    if (!(path in map)) {
      const e = new Error(`ENOENT: ${path}`);
      e.code = 'ENOENT';
      throw e;
    }
    const v = map[path];
    if (typeof v !== 'string') {
      const e = new Error('permission denied');
      e.code = 'EACCES';
      throw e;
    }
    return v;
  }
});
const PPG_PATH = '/n/Polar_VeritySense_0C301E3F_20261006190137_PPG.txt';
const PPG_RUNS = '/n/Polar_VeritySense_0C301E3F_20261006190137_PPGRUNS.txt';

let v = readRunsSidecar(PPG_PATH, 'PPG', { io: planted({ [PPG_RUNS]: '# stream=ppg min_run=200\nPhone timestamp;stream\n' }) });
same([v.state, v.path, v.stream, typeof v.runsText, v.reason], ['read', PPG_RUNS, 'PPG', 'string', null], 'a readable sidecar reads, and names no reason');
v = readRunsSidecar(PPG_PATH, 'PPG', { io: planted({ [PPG_RUNS]: '' }) });
same([v.state, v.runsText], ['read', ''], 'an EMPTY sidecar is READ — its header states what was looked for');
v = readRunsSidecar(PPG_PATH, 'PPG', { io: planted({}) });
same([v.state, v.runsText], ['absent', null], 'a missing sidecar is ABSENT with NO text — an empty string would read as a clean stream');
ok(v.reason.includes(PPG_RUNS) && /UNKNOWN/.test(v.reason), `the absent reason names the path and says UNKNOWN: ${v.reason}`);
v = readRunsSidecar(PPG_PATH, 'PPG', { io: planted({ [PPG_RUNS]: 7 }) });
same([v.state, v.runsText], ['unreadable', null], 'a sidecar that will not open is UNREADABLE, never absent');
ok(/EACCES/.test(v.reason), `the unreadable reason carries the error code: ${v.reason}`);
v = readRunsSidecar('/n/x_PPG2W.txt', 'PPG', { io: planted({}) });
same([v.state, v.path, v.runsText], ['unnamed', null, null], 'a path that yields no sidecar name reads nothing and says so');
let reads = 0;
readRunsSidecar('/n/x_PPG2W.txt', 'PPG', {
  io: {
    readFileSync() {
      reads++;
      return '';
    }
  }
});
same(reads, 0, 'an unnamed path is never read — a guessed name is worse than no answer');
same(readRunsSidecar('/nonexistent-tepna-test-dir/x_PPG.txt', 'PPG').state, 'absent', 'with no planted io the default node reader answers');

/* ── THE TALLY A TOOL PRINTS BESIDE ITS NUMBERS ── */
const tally = {};
readRunsSidecar(PPG_PATH, 'PPG', { io: planted({}), tally });
readRunsSidecar(PPG_PATH, 'PPG', { io: planted({}), tally });
readRunsSidecar(PPG_PATH, 'PPG', { io: planted({ [PPG_RUNS]: 'x' }), tally });
same([tally.read, tally.absent, tally.unreadable, tally.unnamed], [1, 2, undefined, undefined], 'the tally counts each state by its own name');
same(VALIDITY_STATES.slice(), ['read', 'absent', 'unreadable', 'unnamed'], 'the four states are stated in print order');
ok(validityLine(tally).startsWith('validity sidecars: 1 read \u00b7 2 absent \u00b7 0 unreadable \u00b7 0 unnamed'), `the line prints every state: ${validityLine(tally)}`);
ok(/UNKNOWN/.test(validityLine(tally)), 'the line says what an absent sidecar means for the numbers beside it');
same(validityLine({}), null, 'an empty tally prints nothing — four zeros read exactly like a sweep where every sidecar was there');
same(validityLine(null), null, 'no tally prints nothing');
same(validityLine({ absent: 'two' }), null, 'a non-numeric count is no count');

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

/* ── AND THE EIGHT PAT TOOLS CALL IT ───────────────────────────────────────────────────────────────
   The per-call arithmetic lives in `tests/dex-tests.js` ("SAMPLE-VALIDITY-ENVELOPE done-when 4"),
   which pins how many call sites under `tools/` still pass no sidecar. These legs pin the OTHER half
   for the eight tools this slice migrated: each reads through the shared reader rather than a
   hand-rolled path, counts what it read, and prints the tally beside its own numbers. A tool that
   passes the sidecar and reports nothing leaves a reader unable to tell a measured night from an
   unmeasured one. */
for (const f of [
  'pat-axis-leg-audit.mjs',
  'pat-fiducial-jitter.mjs',
  'pat-host-offset.mjs',
  'pat-hrv-windows.mjs',
  'pat-per-led.mjs',
  'pat-ppg-ppg-control.mjs',
  'pat-three-corner.mjs',
  'pat-window-scaling.mjs'
]) {
  const src = readFileSync(join(here, '..', 'tools', f), 'utf8');
  ok(/import \{ readRunsSidecar, validityLine \} from '\.\/trio-fold-validity\.mjs';/.test(src), `${f} imports the shared reader`);
  ok(/const runsOf = \(streamPath, stream\) => readRunsSidecar\(streamPath, stream, \{ tally: VALIDITY \}\)\.runsText;/.test(src), `${f} reads every sidecar through one tallying helper`);
  ok(/validityLine\(VALIDITY\)/.test(src), `${f} prints the tally beside its own numbers`);
  ok(/runsText \? [\w$.]+\(\w+, \{ runsText \}\) :/.test(src) || /\{ runsText: \w+ \}\) :/.test(src), `${f} parses through the guarded ternary, so a stream with no sidecar parses as it did`);
  ok(!/RUNS\.txt'/.test(src), `${f} spells no sidecar path of its own`);
}

if (fails.length) {
  console.error(`trio-fold-validity: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`trio-fold-validity: ✓ ${pass} assertions — a folded night keeps its validity spans, on the merged axis`);

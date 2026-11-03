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

ok(
  ownSidecarPaths(`    pinnedSource: rec.pinnedCrossCheck ? '_PPGRUNS.txt' : recomputeRan ? 'recompute' : null`).length === 0,
  'CONTROL · a provenance LABEL naming the sidecar is not a path this tool built'
);
ok(ownSidecarPaths("const p = base + '_PPGRUNS.txt';").length === 1, 'and a hand-built sidecar path still reads as one');

function stripComments(src, keepStrings) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      /* A STRING IS NOT A COMMENT, and `keepStrings` is which of the two readers below is asking.
         The arity reader must not see a call spelled inside a string; the sidecar-path reader must
         still see the label `'_PPGRUNS.txt'`, because that label is the thing it judges. */
      const q = c;
      const start = i;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      out += keepStrings ? src.slice(start, i) : ' ';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Every INVOCATION of `name` in `src`, as its top-level argument count. A definition is not an
 *  invocation, so `function name(` is skipped; a call with no argument reads 0. */
function callArity(src, name) {
  const bare = stripComments(src);
  const out = [];
  const re = new RegExp(`(function\\s+)?\\b${name}\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(bare)) !== null) {
    if (m[1]) continue;
    let i = re.lastIndex;
    let depth = 1;
    let args = 0;
    let seen = false;
    while (i < bare.length && depth > 0) {
      const c = bare[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ',' && depth === 1) args++;
      if (depth > 0 && !/\s/.test(c)) seen = true;
      i++;
    }
    out.push(seen ? args + 1 : 0);
  }
  return out;
}

/** The sidecar NAME is derived in one place. A line that merely REPORTS which source a pinned span
 *  came from (`pinnedSource: rec.pinnedCrossCheck ? '_PPGRUNS.txt' : …`) spells a label, not a path,
 *  and two tools publish exactly that field — so this reader asks whether the spelling is being
 *  BUILT INTO a path, never whether the characters appear. */
function ownSidecarPaths(src) {
  return stripComments(src, true)
    .split('\n')
    .filter((l) => /RUNS\.txt/.test(l))
    .filter((l) => /join\(|replace\(|existsSync|readFileSync|`|\+/.test(l));
}

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
  ok(ownSidecarPaths(src).length === 0, `${f} builds no sidecar path of its own (${ownSidecarPaths(src).join(' | ').slice(0, 90)})`);
}

/* ── AND THE FOOT CALLERS HAND IT OVER ─────────────────────────────────────────────────────────────
   Row 2026-11-02-no-caller-hands-the-shared-pat-foot-extractor-its-sidecar: the shared extractor has
   taken a `runsText` sidecar since the PAT foot ports landed, and every call site handed it none, so
   the guarded ternary inside the extractor ran its sidecar-less arm every time. The done-when 4
   ratchet cannot see this: it counts calls to the six sample parsers BY NAME, and a tool reaching a
   parser through this helper leaves no mark in that population.

   ⚠ A LEG THAT GREPS FOR `ppgFootTimes(` MISSES THE CALLS THIS ROW WAS FILED FROM. The row's own
   evidence was built that way and found ten sites; a callback (`parse(list, ppgFootTimes)`) and a
   parenthesised indirection (`(opts.ppgFootTimes || ppgFootTimes)(text)`) both call the extractor
   with the name never followed by `(`. So this block counts ARGUMENTS at each invocation instead,
   over a source with its comments and string literals removed, and names the indirection on its
   own. */
/* The arity reader is itself read by a planted source, because a reader that matched nothing would
   hand every leg below an empty population, and every answer over an empty population reads clean. */
const PLANT = `
/* a comment naming ppgFootTimes(text) and nothing else */
function ppgFootTimes(text, runsText) { return [text, runsText]; }
const a = ppgFootTimes(readFileSync(pF, 'utf8'));
const b = ppgFootTimes(readFileSync(pF, 'utf8'), runsOf(pF, 'PPG'));
const c = "a string with ppgFootTimes(x, y, z) inside it";
const d = ppgFootTimes(text, runsOf(p, 'PPG'), { pinnedFromRecompute: true });
`;
ok(JSON.stringify(callArity(PLANT, 'ppgFootTimes')) === '[1,2,3]', 'the arity reader counts calls, skips the definition, and reads neither comments nor strings');
ok(callArity('const x = 1;', 'ppgFootTimes').length === 0, 'CONTROL · a source that never calls it yields no invocation, so an empty population is visible as empty');

/* The twelve files this slice migrated. `calls` is the callee each one reaches the parser through:
   the shared extractor, a local port of it, or a local re-derivation. Every invocation of it must
   carry the sidecar, which is the second argument. */
for (const [f, callees] of [
  ['beat-correspondence.mjs', ['ppgFootTimes']],
  ['oracle-ppg-device-beats.mjs', []],
  ['pat-connection-stability.mjs', ['ppgFootTimes']],
  ['pat-dip-index.mjs', ['ppgFootTimes']],
  ['pat-drift-attribution.mjs', ['ppgFootTimes']],
  ['pat-ecg-axis-residual.mjs', ['ppgFootTimes']],
  ['pat-finger-coupler.mjs', ['ppgFootTimes', 'ppgFiducialTimes']],
  ['pat-literature-spec.mjs', ['ppgFootTimes']],
  ['pat-matchrate-strict.mjs', ['ppgFootTimes']],
  ['pat-mode-posture.mjs', ['ppgFootTimes']],
  ['pat-residual-structure.mjs', ['ppgFootTimes']],
  ['pat-window-oracle.mjs', ['ppgFootTimes']]
]) {
  const src = readFileSync(join(here, '..', 'tools', f), 'utf8');
  ok(/import \{ readRunsSidecar, validityLine \} from '\.\/trio-fold-validity\.mjs';/.test(src), `${f} imports the shared reader`);
  ok(/const runsOf = \(streamPath, stream\) => readRunsSidecar\(streamPath, stream, \{ tally: VALIDITY \}\)\.runsText;/.test(src), `${f} reads every sidecar through one tallying helper`);
  ok(/validityLine\(VALIDITY\)/.test(src), `${f} prints the tally beside its own numbers`);
  ok(ownSidecarPaths(src).length === 0, `${f} builds no sidecar path of its own (${ownSidecarPaths(src).join(' | ').slice(0, 90)})`);
  for (const callee of callees) {
    const arity = callArity(src, callee);
    ok(arity.length > 0, `${f} calls ${callee}, so this leg judges something`);
    ok(
      arity.every((n) => n >= 2),
      `${f} hands ${callee} its sidecar at every call site (arity ${JSON.stringify(arity)})`
    );
  }
}

/* THE INDIRECTION, NAMED. `oracle-ppg-device-beats.mjs` reaches the extractor as
   `(opts.ppgFootTimes || ppgFootTimes)(ppgText, …)`, where the name is never followed by `(`, so the
   arity reader above sees no invocation at all and the row's grep saw none either. Its sidecar
   rides `opts`, because `scoreNight` takes the TEXT and cannot name a sidecar from a path. */
{
  const src = readFileSync(join(here, '..', 'tools', 'oracle-ppg-device-beats.mjs'), 'utf8');
  ok(callArity(src, 'ppgFootTimes').length === 0, 'CONTROL · the arity reader finds no `ppgFootTimes(` invocation here, which is why this leg exists');
  ok(/\(opts\.ppgFootTimes \|\| ppgFootTimes\)\(ppgText, opts\.runsText\)/.test(src), 'the indirection hands the extractor the sidecar that rode in on `opts`');
  ok(/opts\.runsText \? PPGDSP\.parsePPG\(ppgText, \{ runsText: opts\.runsText \}\) : PPGDSP\.parsePPG\(ppgText\)/.test(src), 'and its own parse takes the guarded ternary');
  ok(/scoreNight\(PPGDSP, readFileSync\(fp, 'utf8'\), \{ runsText: runsOf\(fp, 'PPG'\) \}\)/.test(src), 'the caller that holds the path is the one that reads the sidecar');
}

if (fails.length) {
  console.error(`trio-fold-validity: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`trio-fold-validity: ✓ ${pass} assertions — a folded night keeps its validity spans, on the merged axis`);

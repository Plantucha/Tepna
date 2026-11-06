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
import { ecgRpeakTimes, getDsps, loadDsps, ppgFootTimes } from '../tools/pat-matchrate-strict.mjs';
import { loadDsps as loadBc, ppgFootTimes as bcPpgFootTimes } from '../tools/beat-correspondence.mjs';

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

/* ── AND THE ECG LEG TAKES ITS SIDECAR TOO ──────────────────────────────────────
   Row 2026-11-03-the-ecg-leg-of-the-shared-pat-extractor-takes-no-sidecar. `ppgFootTimes` has taken
   the `_PPGRUNS.txt` bytes since #4069 and `ecgRpeakTimes` took none, so every R peak inside a
   blanking run the box recorded reached the matcher as a beat. The `_ECGRUNS.txt` companion exists
   beside every `_ECG.txt` file this corpus holds, so this is the stream where the omission costs a
   number.
   Position two is TYPED rather than re-ordered, because `opts` already held that slot: a STRING is
   the sidecar and an OBJECT is `opts`. The executed legs below judge both arms, since a typed slot
   that silently ignored one type would read here exactly like a wired one. */
for (const f of [
  'beat-correspondence.mjs',
  'pat-connection-stability.mjs',
  'pat-dip-index.mjs',
  'pat-drift-attribution.mjs',
  'pat-ecg-axis-residual.mjs',
  'pat-finger-coupler.mjs',
  'pat-literature-spec.mjs',
  'pat-matchrate-strict.mjs',
  'pat-mode-posture.mjs',
  'pat-residual-structure.mjs',
  'pat-window-oracle.mjs'
]) {
  const src = readFileSync(join(here, '..', 'tools', f), 'utf8');
  const arity = callArity(src, 'ecgRpeakTimes');
  ok(arity.length > 0, `${f} calls ecgRpeakTimes, so this leg judges something`);
  ok(
    arity.every((n) => n >= 2),
    `${f} hands ecgRpeakTimes its sidecar at every call site (arity ${JSON.stringify(arity)})`
  );
  ok(/runsOf\([^;]{0,60}'ECG'\)/.test(stripComments(src, true)), `${f} names the ECG sidecar through the shared reader`);
}

/* ── ∅ THE THREE SIDECAR STATES, EXECUTED ─────────────────────────────────────────
   A source scan cannot tell a parameter that is READ from one that is accepted and dropped, and it
   cannot tell `null` from `0`. The legs below run the shared extractor over a synthetic H10 stream
   at 130 Hz: no sidecar, a sidecar naming no run, a sidecar naming one run, and a sidecar whose rows
   belong to another stream. ∅ the four answers must differ, because an absent sidecar is validity
   UNKNOWN and a sidecar that looked and found nothing is a measured zero. */
const ECG_FS = 130;
function synthEcg(nSamples) {
  const rows = ['Phone timestamp;sensor timestamp [ns];timestamp [ms];ecg [uV]'];
  for (let i = 0; i < nSamples; i++) {
    const ph = (i % ECG_FS) / ECG_FS;
    let v = 40 * Math.sin(2 * Math.PI * ph);
    if (ph > 0.2 && ph < 0.3) v += 900 * Math.exp(-(((ph - 0.2537) / 0.012) ** 2));
    rows.push(`2026-06-17T01:06:17.723;${Math.round((i * 1e9) / ECG_FS)};${Math.round((i * 1000) / ECG_FS)};${Math.round(v)}`);
  }
  return rows.join('\n');
}
/* The writer's own shape: a rule line, a `# stream=… channel=… class=…` declaration, then one
   semicolon row per run whose columns 3 and 4 are the SAMPLE index and the run length. */
function ecgRuns(spans, { stream = 'ecg', channel = 'ecg [uV]' } = {}) {
  const out = [`# stream=${stream} min_run=30 merge_gap_max=2`, `# stream=${stream} channel=${channel} class=variable unit=uV`];
  for (const sp of spans) out.push(['2026-06-17T01:06:17.723', channel, '0', String(sp.first), String(sp.n), '0', '0', '0'].join(';'));
  return out.join('\n');
}
{
  loadDsps();
  const txt = synthEcg(4000);
  const base = ecgRpeakTimes(txt);
  ok(base.n > 20, `ANTI-VACUITY · the synthetic stream yields R peaks at all (n=${base.n})`);
  ok(
    base.blanking.sidecar === 'absent' && base.blanking.nDropped === null && base.blanking.nRanges === null,
    `∅ no sidecar reads ABSENT with null counts, never a clean zero (${JSON.stringify(base.blanking)})`
  );

  const empty = ecgRpeakTimes(txt, ecgRuns([]));
  ok(empty.blanking.sidecar === 'read' && empty.blanking.nDropped === 0 && empty.blanking.nRanges === 0, `∅ a sidecar that names no run reads a MEASURED zero (${JSON.stringify(empty.blanking)})`);
  same(Array.from(empty.times), Array.from(base.times), 'and it moves no beat, so no published number walks on the empty-sidecar path');

  const RUN = { first: 1000, n: 400 };
  const cut = ecgRpeakTimes(txt, ecgRuns([RUN]));
  const loMs = base.t0Ms + (RUN.first / base.fs) * 1000;
  const hiMs = base.t0Ms + ((RUN.first + RUN.n) / base.fs) * 1000;
  const insideBase = Array.from(base.times).filter((t) => t >= loMs && t < hiMs).length;
  ok(insideBase > 0, `CONTROL · the sidecar-less run DID report beats inside that span (${insideBase}), so the legs below are not vacuous`);
  ok(cut.blanking.sidecar === 'read' && cut.blanking.nRanges === 1, `one recorded run reads as one range (${JSON.stringify(cut.blanking)})`);
  ok(cut.blanking.nDropped === insideBase, `and it drops exactly the beats the baseline reported there (${cut.blanking.nDropped} of ${insideBase})`);
  ok(Array.from(cut.times).filter((t) => t >= loMs && t < hiMs).length === 0, 'no kept beat sits inside the run the box recorded as measuring nothing');
  ok(cut.n === base.n - insideBase, `the kept train is the detected train less the dropped peaks (${cut.n})`);
  ok(cut.nDetected === base.n, `nDetected keeps naming the DETECTOR's own count, so the "of N detected" line stays true (${cut.nDetected})`);

  /* A sidecar whose rows belong to another stream places none, and `parseECG` nulls the spans with a
     reason rather than publishing an empty set — the one state a count cannot carry. */
  const foreign = ecgRpeakTimes(txt, ecgRuns([RUN], { stream: 'ppg', channel: 'channel 0' }));
  ok(
    foreign.blanking.sidecar === 'unplaced' && foreign.blanking.nDropped === null && typeof foreign.blanking.reason === 'string',
    `∅ a sidecar whose rows went unplaced reads UNPLACED with its own reason (${JSON.stringify(foreign.blanking)})`
  );
  same(Array.from(foreign.times), Array.from(base.times), 'and it drops nothing, because an unread sidecar refuses rather than blanking a guess');

  /* ── POSITION TWO IS TYPED ── */
  const asOpts = ecgRpeakTimes(txt, { refine: true });
  ok(asOpts.refined === true, 'an OBJECT at position two is still `opts`, so no existing caller moved');
  ok(asOpts.blanking.sidecar === 'absent', '…and it carries no sidecar');
  const viaField = ecgRpeakTimes(txt, { runsText: ecgRuns([RUN]) });
  ok(viaField.blanking.nDropped === insideBase, '`opts.runsText` carries the same bytes to the same drop');
  let threw = null;
  try {
    ecgRpeakTimes(txt, 42);
  } catch (e) {
    threw = e.message;
  }
  ok(!!threw && /position two/.test(threw), `a number at position two refuses by name (${threw})`);
  let twice = null;
  try {
    ecgRpeakTimes(txt, { refine: true }, { refine: true });
  } catch (e) {
    twice = e.message;
  }
  ok(!!twice && /position two and position three/.test(twice), `opts in both slots refuses (${twice})`);
}

/* ── ∅ AN UNCONFIRMED SPAN SET STILL HAS A SIZE, EXECUTED ─────────────────────────
   Row 2026-10-28-pat-legs-refuse-only-the-spans-a-sidecar-confirmed. `parsePPG` publishes per-channel
   pinned spans on every path, and only a `_PPGRUNS.txt` companion sets `pinnedCrossCheck`. So the
   default path held a span set it never sized, and published `null` counts beside a `null` source.
   A reader could not tell "the recompute would refuse nothing here" from "nobody looked" (§∅).
   The annotate path walks the same feet, keeps every one, and reports the magnitude as
   `wouldDropAllPinned` / `wouldPartialPinned`. The legs below need all three states to differ.

   THE RAIL WINDOW IS A MEASURED ONE, never a guessed one. A rail reshapes the upstroke, so it MOVES
   the detected foot — three earlier constructions clipped the trough and the foot walked out ahead of
   the run every time. A sweep over clip windows found the one that walks the foot INTO the rail. The
   clean twin's own feet sit at phase 47, outside this window, which is why it reads a zero. */
const PPG_FS = 55;
function synthPpg(nSamples, clipFrom, clipTo) {
  const rows = ['Phone timestamp;sensor timestamp [ns];channel 0'];
  for (let i = 0; i < nSamples; i++) {
    const ph = (i % PPG_FS) / PPG_FS;
    let v = 200000 + Math.round(9000 * Math.sin(2 * Math.PI * ph) + 2500 * Math.sin(4 * Math.PI * ph + 0.7));
    /* The rail starts at beat 4, so the histogram sees a stream that is clean first. */
    if (clipFrom >= 0 && Math.floor(i / PPG_FS) >= 4) {
      const k = i % PPG_FS;
      if (k >= clipFrom && k < clipTo) v = 188000;
    }
    const ms = Math.round((i * 1000) / PPG_FS);
    const stamp = new Date(Date.UTC(2026, 5, 17, 1, 6, 17, 723) + ms).toISOString().slice(0, 23);
    rows.push(`${stamp};${Math.round((i * 1e9) / PPG_FS)};${v}`);
  }
  return rows.join('\n');
}
{
  loadDsps();

  /* ── THE MEASURED ZERO ── a stream with no rail run. `parsePPG` publishes an empty span set, the
     scan walks every foot, and it refuses none. That answer is 0, and 0 is not an absence. */
  const clean = ppgFootTimes(synthPpg(3300, -1, -1));
  ok(clean.n > 20, `ANTI-VACUITY · the synthetic stream yields feet at all (n=${clean.n})`);
  ok(
    clean.wouldDropAllPinned === 0 && clean.wouldPartialPinned === 0,
    `∅ a span set that refused nothing reads a MEASURED zero (${JSON.stringify([clean.wouldDropAllPinned, clean.wouldPartialPinned])})`
  );
  ok(clean.pinnedSource === null, 'and the source stays null, so no reader takes the annotation for a confirmed sidecar');
  ok(
    clean.droppedAllPinned === null && clean.partialPinned === null,
    `∅ the consuming fields stay null on this path, because no leg dropped a foot (${JSON.stringify([clean.droppedAllPinned, clean.partialPinned])})`
  );
  ok(JSON.stringify(clean.wouldDropAllPinned) !== JSON.stringify(clean.droppedAllPinned), '∅ the measured zero and the null do not serialise alike');

  /* ── THE COUNT ── the rail covers the clean stream's measured foot phase, so a consensus foot lands
     inside a qualifying run and the counterfactual has something to refuse. */
  const phases = (rec) => Array.from(rec.times, (t) => Math.floor((((t - rec.t0Ms) / 1000) * PPG_FS) % PPG_FS));
  const inRail = (rec) => phases(rec).filter((k) => k >= 18 && k < 24).length;
  ok(inRail(clean) === 0, `CONTROL · the clean twin places no foot in the window this test rails (phases ${phases(clean).slice(0, 4).join(' ')})`);
  const railed = synthPpg(3300, 18, 24);
  const annot = ppgFootTimes(railed);
  ok(inRail(annot) > 0, `CONTROL · the railed twin places feet inside the rail run, which is the thing the count sizes (${inRail(annot)})`);
  ok(annot.wouldDropAllPinned >= 1, `∅ the unconfirmed span set reports what it WOULD refuse (${annot.wouldDropAllPinned})`);
  ok(annot.wouldPartialPinned >= annot.wouldDropAllPinned, `and the partial count covers the whole-channel count (${annot.wouldPartialPinned})`);
  ok(annot.droppedAllPinned === null && annot.partialPinned === null, '∅ it refused no foot, so the consuming fields stay null');
  ok(annot.pinnedSource === null, 'the source is still null — nothing confirmed these spans');

  /* ── AND THE COUNT IS THE MOVE ── the same bytes through the counterfactual switch drop exactly the
     feet the annotation sized. That equality is what makes `wouldDropAllPinned` a measurement. */
  const cut = ppgFootTimes(railed, null, { pinnedFromRecompute: true });
  ok(cut.pinnedSource === 'recompute', `the switch names the recompute as the source (${cut.pinnedSource})`);
  ok(cut.droppedAllPinned === annot.wouldDropAllPinned, `the recompute drops exactly the sized feet (${cut.droppedAllPinned} of ${annot.wouldDropAllPinned})`);
  ok(cut.n === annot.n - annot.wouldDropAllPinned, `so the kept train is the annotated train less that count (${cut.n} = ${annot.n} - ${annot.wouldDropAllPinned})`);
  ok(cut.wouldDropAllPinned === null && cut.wouldPartialPinned === null, '∅ and the would-fields null out where a leg really dropped, so one figure never reads twice');
  ok(annot.n === clean.n || annot.n !== cut.n, `CONTROL · the annotate path published its own feet unchanged (n=${annot.n})`);
}

/* ── ∅ THE THIRD COPY REPORTS WHAT THE SIDECAR PLACED, EXECUTED ───────────────────
   Rows 2026-11-03-a-third-foot-detector-copy-carries-no-port-declaration and
   2026-10-17-sample-parsers-called-without-their-sidecar. `tools/beat-correspondence.mjs` holds its
   own `ppgFootTimes`. It handed the sidecar bytes to `parsePPG` and returned a bare `Float64Array`,
   so the arity leg above read it as wired while no reader ever saw a pinned span. The source scan
   cannot catch that shape, which is why these legs EXECUTE the copy over the same synthetic stream.
   The companion rows carry the pinned class, and `parsePPG` sets `pinnedCrossCheck` from them: the
   recompute's own spans still win where the file could not see, so the counts below come from the
   stream and the companion only confirms them. */
const ppgRuns = (spans) => ecgRuns(spans, { stream: 'ppg', channel: 'channel 0' });
{
  loadBc();
  const clean = bcPpgFootTimes(synthPpg(3300, -1, -1));
  ok(clean.n > 20, `ANTI-VACUITY · the copy yields feet at all (n=${clean.n})`);
  ok(
    clean.wouldDropAllPinned === 0 && clean.wouldPartialPinned === 0,
    `∅ a span set that refused nothing reads a MEASURED zero (${JSON.stringify([clean.wouldDropAllPinned, clean.wouldPartialPinned])})`
  );
  ok(clean.droppedAllPinned === null && clean.partialPinned === null, '∅ the consuming fields stay null where nothing confirmed the spans');
  ok(clean.pinnedSource === null, 'and the source stays null, so no reader takes the annotation for a confirmed sidecar');
  ok(JSON.stringify(clean.wouldDropAllPinned) !== JSON.stringify(clean.droppedAllPinned), '∅ the measured zero and the null do not serialise alike');

  const railed = synthPpg(3300, 18, 24);
  const annot = bcPpgFootTimes(railed);
  ok(annot.wouldDropAllPinned >= 1, `∅ the unconfirmed span set reports what it WOULD refuse (${annot.wouldDropAllPinned})`);
  ok(annot.n === annot.nDetected, `the annotate path keeps every foot, so no published number moves there (${annot.n})`);

  const cut = bcPpgFootTimes(railed, ppgRuns([{ first: 18 + 4 * PPG_FS, n: 60 }]));
  ok(cut.pinnedSource === '_PPGRUNS.txt', `a companion CONFIRMS the spans, and the record names it (${cut.pinnedSource})`);
  ok(cut.droppedAllPinned === annot.wouldDropAllPinned, `the confirmed path drops exactly the feet the annotation sized (${cut.droppedAllPinned} of ${annot.wouldDropAllPinned})`);
  ok(cut.n === annot.n - annot.wouldDropAllPinned, `so the kept train is the annotated train less that count (${cut.n} = ${annot.n} - ${annot.wouldDropAllPinned})`);
  ok(cut.wouldDropAllPinned === null && cut.wouldPartialPinned === null, '∅ the would-fields null out where a leg really dropped, so one figure never reads twice');
  ok(cut.nDetected === annot.nDetected, `nDetected keeps naming the consensus train, so the "of N" line stays true (${cut.nDetected})`);
  ok(cut.channelsScanned === 1, `the record names the channel set it scanned (${cut.channelsScanned})`);

  const bcSrc = readFileSync(join(here, '..', 'tools', 'beat-correspondence.mjs'), 'utf8');
  ok(/@port-from pat-feasibility-worker\.js#ppgFootTimes/.test(bcSrc), 'the copy declares its source, so `port-parity` reads a later source move as drift');
  ok(ownSidecarPaths(bcSrc).length === 0, `and the pinnedSource label builds no sidecar path of its own (${ownSidecarPaths(bcSrc).join(' | ').slice(0, 90)})`);
}

/* ── ∅ SLICE 1: THE NIGHT READERS THAT ALREADY HELD A PATH ─────────────────────────
   Row 2026-10-17-sample-parsers-called-without-their-sidecar. Fourteen `tools/` files read a PPG or
   ECG stream FROM A PATH and parsed it with no `runsText`, so every sample inside a run the box
   recorded reached the numbers as a reading. Thirteen of them take the shared reader here;
   `pat-drift-attribution.mjs` already imported it for its foot legs and its two bare `hostAxis`
   parses now reuse the hoisted consts, so the tally counts each stream once rather than twice.
   `resp-cardiac-suppression-e8.mjs` is wired on both of its sidecars, because its own night-key probe
   already held the ACC shape; the other ACC readers are slice 2, where `_ACCRUNS.txt`'s time-keyed
   spans are a different verification from a sample-index run.

   Passing the sidecar is not reporting its absence (§∅), so each of the ten also prints
   `validityLine`'s tally beside its own numbers: most of this corpus predates the writer, so most
   streams read `absent`, and an absent sidecar is validity UNKNOWN for that stream, never a clean one. */
for (const f of [
  'beat-leg-closure.mjs',
  'cvhr-fold-rescore.mjs',
  'ecg-rate-transfer.mjs',
  'gap-s-sweep.mjs',
  'geometry-scan.mjs',
  'o2ring-finger-roundtrip.mjs',
  'o2ring-finger-validate-batch.mjs',
  'oracle-ecg-firmware-rr.mjs',
  'pin-coverage.mjs',
  'resp-cardiac-suppression-e8.mjs',
  'ring-offset-census.mjs',
  'tch-firmware-reference.mjs',
  'tch-reference-validation.mjs'
]) {
  const src = readFileSync(join(here, '..', 'tools', f), 'utf8');
  ok(/import \{ readRunsSidecar, validityLine \} from '\.\/trio-fold-validity\.mjs';/.test(src), `${f} imports the shared reader`);
  ok(/const runsOf = \(streamPath, stream\) => readRunsSidecar\(streamPath, stream, \{ tally: VALIDITY \}\)\.runsText;/.test(src), `${f} reads every sidecar through one tallying helper`);
  ok(/validityLine\(VALIDITY\)/.test(src), `${f} prints the tally beside its own numbers`);
  ok(ownSidecarPaths(src).length === 0, `${f} builds no sidecar path of its own (${ownSidecarPaths(src).join(' | ').slice(0, 90)})`);
}

/* ── ∅ A REWRITTEN TEXT INVALIDATES THE SIDECAR'S INDICES, AND THAT IS NOT AN ABSENCE ──
   `gap-s-sweep.mjs` is the one slice-1 reader that REWRITES the bytes it scores: `--restrict-overlap`
   cuts both streams to their shared host window and `--ppg-keep-hz` drops PPG rows to a coarser grid.
   A sidecar's rows are SAMPLE INDICES into the text as written, so under either switch the indices
   address samples that are no longer there — passing it would place a blanking run over clean signal.
   The sidecar is therefore WITHHELD from that leg, and the row says so in its own words, because a
   silent drop reads exactly like a night that never had a sidecar. The four cases below are EXECUTED:
   a source scan cannot tell a withheld sidecar from a dropped one. */
{
  const { scoreNight } = await import('../tools/gap-s-sweep.mjs');
  let sawEcg = null;
  let sawPpg = null;
  const realms = {
    ecg: {
      ECGDSP: {
        parseECG: (_t, o) => {
          sawEcg = o && o.runsText ? o.runsText : null;
          return { int16: new Int16Array(8), fs: 130 };
        },
        analyze: () => ({ cvhr: { index: 1.5, denomSec: 100, events: [] }, nBeats: 10 })
      }
    },
    ppg: {
      PPGDSP: {
        parsePPG: (_t, o) => {
          sawPpg = o && o.runsText ? o.runsText : null;
          return { ch: [new Float32Array(8)], fs: 135 };
        },
        analyze: () => ({ cvhrIndex: 2.5, cvhrEvents: 1, nBeats: 11, cvhrReason: null })
      }
    }
  };
  const mk = (from, to) => `Phone timestamp;sensor timestamp [ns];value\n2026-06-15T${from}:00:00.000;1000000000;11\n2026-06-15T${to}:00:00.000;2000000000;12\n`;
  const eText = mk('20', '23');
  const pText = mk('20', '23');
  const runs = { ecgRunsText: 'E-RUNS', ppgRunsText: 'P-RUNS' };

  sawEcg = sawPpg = null;
  const plain = scoreNight(realms, eText, pText, { ...runs });
  ok(sawEcg === 'E-RUNS' && sawPpg === 'P-RUNS', `an untouched text takes both sidecars (ecg ${sawEcg}, ppg ${sawPpg})`);
  ok(plain.ecg.validity === 'sidecar read' && plain.ppg.validity === 'sidecar read', `and each leg says which it holds (${plain.ecg.validity})`);

  sawEcg = sawPpg = null;
  const cut = scoreNight(realms, eText, pText, { ...runs, restrictOverlap: true });
  ok(cut.overlap && cut.overlap.bothHours >= 2, `CONTROL · the overlap cut really ran (${cut.overlap && cut.overlap.bothHours} h)`);
  ok(sawEcg === null && sawPpg === null, '∅ a text cut to the overlap takes neither sidecar, because the indices no longer address it');
  ok(/withheld/.test(cut.ecg.validity) && /cut to the overlap/.test(cut.ecg.validity), `and the ECG row names the withholding (${cut.ecg.validity})`);
  ok(/withheld/.test(cut.ppg.validity) && /cut to the overlap/.test(cut.ppg.validity), `and so does the PPG row (${cut.ppg.validity})`);

  sawEcg = sawPpg = null;
  const thin = scoreNight(realms, eText, pText, { ...runs, ppgKeepHz: 10 });
  ok(sawEcg === 'E-RUNS', `the keep grid touches the PPG alone, so the ECG keeps its sidecar (${sawEcg})`);
  ok(sawPpg === null && /keep grid/.test(thin.ppg.validity), `and the decimated PPG names its own withholding (${thin.ppg.validity})`);

  sawEcg = sawPpg = null;
  const none = scoreNight(realms, eText, pText, {});
  ok(sawEcg === null && sawPpg === null, 'CONTROL · with no sidecar read there is nothing to pass');
  ok(/absent/.test(none.ecg.validity) && !/withheld/.test(none.ecg.validity), `and an absence reads as UNKNOWN rather than as a withholding (${none.ecg.validity})`);
}

/* ── ∅ AND THE TEXT-TAKING ORACLE TAKES ITS SIDECAR ON `opts` ──────────────────────
   `oracle-ecg-firmware-rr.mjs`'s `scoreNight` takes the ECG TEXT, so it cannot name a sidecar from a
   path: the caller that holds the path reads it and the bytes ride `opts.runsText`, the shape
   `oracle-ppg-device-beats.mjs` already uses. Executed on both arms, because a typed slot that
   accepted the bytes and dropped them would read here exactly like a wired one. */
{
  const { scoreNight } = await import('../tools/oracle-ecg-firmware-rr.mjs');
  let saw = null;
  const ECGDSP = {
    parseECG: (_t, o) => {
      saw = o && o.runsText ? o.runsText : null;
      return { int16: new Int16Array(8), fs: 130 };
    },
    parseDeviceRR: () => [],
    analyze: () => ({ nn: [] })
  };
  saw = null;
  const withRuns = scoreNight(ECGDSP, 'ecg', 'rr', { runsText: 'E-RUNS' });
  ok(saw === 'E-RUNS', `the sidecar that rode in on \`opts\` reaches the parse (${saw})`);
  saw = null;
  const bare = scoreNight(ECGDSP, 'ecg', 'rr', {});
  ok(saw === null, 'CONTROL · no sidecar on `opts` means none is invented');
  ok(withRuns.ok === false && bare.ok === false && withRuns.reason === bare.reason, `and both arms refuse on the same stubbed RR file (${bare.reason})`);
}

/* ── ∅ SLICE 2: THE ACC READERS, AGAINST A TIME-KEYED SIDECAR ──────────────────────
   Row 2026-10-17-sample-parsers-called-without-their-sidecar. Four `tools/` files read an
   accelerometer stream FROM A PATH and parsed it bare, so a span the box recorded as one held value
   reached a motion grid as a stillness it never measured — and a held run is the shape that matters
   most here, because the PAT quiet split reads stillness as evidence.

   `_ACCRUNS.txt` is a DIFFERENT sidecar from the stream ones above. Its rows carry the writer's own
   host stamp and a `dur_ms`, so `parseAccRunsTimed` places TIME spans; the index-keyed intersection
   the PPG and ECG sidecars use would slide here, because these parsers drop an implausible row.
   Three of the four take the shared reader. `trio-batch.mjs` keeps its own `readRuns`, which it
   already uses for both of its other streams. */
for (const f of ['acc-shared-movement.mjs', 'pat-dip-validate.mjs', 'pat-matchrate-strict.mjs']) {
  const src = readFileSync(join(here, '..', 'tools', f), 'utf8');
  ok(/import \{ readRunsSidecar, validityLine \} from '\.\/trio-fold-validity\.mjs';/.test(src), `${f} imports the shared reader`);
  ok(/const runsOf = \(streamPath, stream\) => readRunsSidecar\(streamPath, stream, \{ tally: VALIDITY \}\)\.runsText;/.test(src), `${f} reads every sidecar through one tallying helper`);
  ok(/runsOf\([^)]*, 'ACC'\)/.test(src), `${f} asks for the ACC sidecar by its own stream name`);
  ok(/validityLine\(VALIDITY\)/.test(src), `${f} prints the tally beside its own numbers`);
  ok(ownSidecarPaths(src).length === 0, `${f} builds no sidecar path of its own (${ownSidecarPaths(src).join(' | ').slice(0, 90)})`);
}
{
  const src = readFileSync(join(here, '..', 'tools', 'trio-batch.mjs'), 'utf8');
  ok(
    /parseDeviceACC\(readFileSync\(f\.full, 'utf8'\), \{ runsText: readRuns\(f\.full, 'ACC'\) \}\)/.test(src),
    'trio-batch hands the H10 ACC its sidecar through the reader its other two streams use'
  );
  ok(/const xyz = \(l, stream\) =>/.test(src), 'the Verity XYZ helper takes the stream NAME, because only the accelerometer has a writer');
  ok(
    /rec\.acc = xyz\(p\.accVer, 'ACC'\);/.test(src) && /rec\.gyro = xyz\(p\.gyro, null\);/.test(src) && /rec\.magn = xyz\(p\.magn, null\);/.test(src),
    'and gyro and magn ask for NO sidecar, because no writer wrote one beside them'
  );
}
/* Why that `null` is not a convenience: the name is derived from the path's own `_<stream>.txt` tail,
   so a gyro path handed the ACC stream names nothing at all — and a reader that guessed would read a
   DIFFERENT stream's validity onto this one. */
{
  let gyroReads = 0;
  const g = readRunsSidecar('/n/Polar_VeritySense_0C301E3F_20261006190137_GYRO.txt', 'ACC', {
    io: {
      readFileSync() {
        gyroReads++;
        return '';
      }
    }
  });
  same([g.state, g.path, g.runsText, gyroReads], ['unnamed', null, null, 0], 'a GYRO path handed the ACC stream names nothing and reads nothing');
}

/* ── ∅ AND THE TIME SPANS ARRIVE, EXECUTED, IN BOTH WRITER GENERATIONS ──────────────
   A source scan cannot tell a sidecar that is READ from one accepted and dropped, and it cannot tell
   a sidecar that found no run from no sidecar at all. Both ACC parsers are run over a synthetic
   26 Hz stream: no sidecar, a sidecar naming no run, and a sidecar naming one. The writer's own
   column header is used verbatim, and the per-channel declaration is planted in BOTH generations the
   corpus holds — `class=held` beside `class=variable` — because a reader keying on that word would
   pass one night and silently skip the other. */
const ACC_FS = 26;
const ACC_T0 = Date.UTC(2026, 5, 17, 1, 6, 17, 723);
const accStamp = (ms) => new Date(ms).toISOString().replace('Z', '');
function synthAcc(nRows) {
  const rows = ['Phone timestamp;sensor timestamp [ns];X [mg];Y [mg];Z [mg]'];
  for (let i = 0; i < nRows; i++) {
    const ms = ACC_T0 + Math.round((i * 1000) / ACC_FS);
    const w = Math.sin((2 * Math.PI * i) / 70);
    rows.push(`${accStamp(ms)};${Math.round((i * 1e9) / ACC_FS)};${Math.round(60 * w)};${Math.round(-40 * w)};${990 + Math.round(20 * w)}`);
  }
  return rows.join('\n');
}
/* `writers.py` `_RunSidecar.HEADER`, verbatim: the stamp is column 0 and `dur_ms` is column 5. */
const ACC_RUNS_HEADER = 'Phone timestamp;stream;value;first_index;n_samples;dur_ms;closed;rule;bracket;contact';
function accRuns(spans, { cls = 'variable' } = {}) {
  const out = ['# stream=acc rule=stuck min_run=30 t_stuck=3 merge_gap_max=2 annotations=none unit=unknown contact_source=none', `# stream=acc channel=X [mg] class=${cls} unit=mg`, ACC_RUNS_HEADER];
  for (const sp of spans) out.push([accStamp(sp.t0Ms), 'acc', '0', String(sp.first), String(sp.n), String(sp.durMs), '1', 'stuck', 'varied/varied', 'none'].join(';'));
  return out.join('\n');
}
{
  const { PPGDSP, ECGDSP, PATAlign } = getDsps();
  const txt = synthAcc(600);
  const SPAN = { t0Ms: ACC_T0 + 4000, first: 104, n: 130, durMs: 5000 };

  for (const [name, parse] of [
    ['parseSensorXYZ', (t, o) => (o ? PPGDSP.parseSensorXYZ(t, o) : PPGDSP.parseSensorXYZ(t))],
    ['parseDeviceACC', (t, o) => (o ? ECGDSP.parseDeviceACC(t, o) : ECGDSP.parseDeviceACC(t)).acc]
  ]) {
    const bare = parse(txt);
    ok(bare.length > 500, `ANTI-VACUITY · ${name} reads the synthetic stream at all (${bare.length} rows)`);
    same([bare._runsSidecar === undefined, bare._blankSpans === undefined], [true, true], `∅ ${name} with no sidecar carries NO parsed sidecar — validity UNKNOWN, never a clean zero`);

    const empty = parse(txt, { runsText: accRuns([]) });
    ok(empty._runsSidecar && empty._runsSidecar.spans.length === 0 && empty._blankSpans === undefined, `∅ ${name}: a sidecar naming no run is a MEASURED zero, and it blanks nothing`);
    same([empty._runsSidecar.minRun, empty._runsSidecar.comparable], [30, true], `${name} reads the writer's own \`min_run\`, which is what makes two nights comparable`);

    const cut = parse(txt, { runsText: accRuns([SPAN]) });
    same(cut._blankSpans, [{ t0Ms: SPAN.t0Ms, t1Ms: SPAN.t0Ms + SPAN.durMs }], `${name} places the span by TIME, from the stamp and \`dur_ms\``);
    ok(cut.length === bare.length, `and it drops no row (${cut.length}), because the spans ride BESIDE the samples`);

    const held = parse(txt, { runsText: accRuns([SPAN], { cls: 'held' }) });
    same(held._blankSpans, cut._blankSpans, `${name} reads the 2026-09-08 \`class=held\` generation identically — the span and \`min_run\` are the keys, never the class word`);
  }

  /* ── CONTROL · THE CARRIER IS WIRED AND THE PAT GRID DOES NOT YET READ IT ────────
     `PATAlign.envelope` bins |acc| against its own EMA and never looks at `_blankSpans`, so a held
     run still enters the grid — as a near-zero deviation, i.e. as stillness. That is §∅ exactly, and
     it is a PUBLISHED number in `pat-dip-validate`'s quiet split. The two grids below are asserted
     EQUAL to pin that gap where a reader will find it: row
     2026-11-05-the-pat-motion-envelope-ignores-the-acc-blanking-spans-it-is-handed owns the fix, and
     when it lands this assertion is the one that must change. */
  const rowsBare = PPGDSP.parseSensorXYZ(txt);
  const rowsCut = PPGDSP.parseSensorXYZ(txt, { runsText: accRuns([SPAN]) });
  const t1 = rowsBare[rowsBare.length - 1].tMs;
  const envBare = PATAlign.envelope(rowsBare, ACC_T0, t1, {});
  const envCut = PATAlign.envelope(rowsCut, ACC_T0, t1, {});
  ok(envBare && envBare.length > 20, `ANTI-VACUITY · the envelope has bins to compare (${envBare && envBare.length})`);
  same(Array.from(envCut), Array.from(envBare), 'CONTROL · the motion envelope is UNCHANGED by the spans it is now handed — the sidecar reaches the parser, and no PAT consumer honours it yet');
}

if (fails.length) {
  console.error(`trio-fold-validity: ${fails.length} FAILED of ${pass + fails.length}`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`trio-fold-validity: ✓ ${pass} assertions — a folded night keeps its validity spans, on the merged axis`);

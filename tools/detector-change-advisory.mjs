#!/usr/bin/env node
/*
 * tools/detector-change-advisory.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * ROUTE THE COMMON-MODE PROTOCOL TO A DIFF THAT TOUCHES A DETECTOR.
 *
 * `briefs/CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14-BRIEF.md` §7 adopts BLIND ANALYSIS as the
 * countermeasure for common-mode blindness: a new detector validated against a reference by an
 * author who cannot see which side is which. Its Done-when box says the protocol "cannot be
 * manufactured", so it waits for the next real detector change, and residue row
 * `2026-10-26-the-common-mode-protocol-has-run-on-no-detector-change` records that it has not run.
 *
 * ⚠️ THE ROW'S PREMISE IS REFUTED, AND THIS TOOL EXISTS BECAUSE OF WHAT REPLACED IT. The occasion
 * came at least twice and nobody was told. Measured 2026-11-13 over `origin/main` since 2026-08-14:
 * 41 commits change a `detect…(` call site under `*-dsp.js` or `capture-host/*.py`, and two of them
 * are unambiguous occasions —
 *   · #1395 (2026-08-16) shipped a NEW periodic-breathing detector, two days after the brief;
 *   · #2759 (2026-09-21) re-based the live strip's `detectRs` on a 5–15 Hz bandpass and validated it
 *     against the device RR stream on real H10 nights, per 7 s window.
 * Both landed BEFORE the row was created on 2026-10-26. So the gap is not an absent occasion. The
 * gap is that nothing carries §7 to the author of such a diff, and a protocol nobody is handed at
 * the moment it applies is indistinguishable from a protocol nobody adopted.
 *
 * SO THIS TOOL IS A ROUTER, NOT A JUDGE OF SCIENCE. It cannot tell a validated detector from an
 * unvalidated one, and it does not try. It does two things a reader can check:
 *   1. It holds a DECLARED detector set and a DECLARED exclusion set, each entry carrying its
 *      reason, and it REFUSES (exit 1) when the tree grows a `detect…`-shaped definition that sits
 *      in neither, or when a declared site stops resolving. An undeclared detector is the state in
 *      which the census below silently stops covering the thing it was built for.
 *   2. Under `--base <ref>` it prints an ADVISORY census: which declared detector sites the diff
 *      touches, and §7's four-step protocol beside them. It exits 0 either way.
 *
 * WHY THE CENSUS IS ADVISORY AND STAYS ADVISORY. A blinded validation is a PROCESS, run by a person
 * over real nights; a gate cannot witness one, and a gate that demanded an unwitnessable artefact
 * would be answered with a checkbox. `tools/residue-cite-drift.mjs --delta` is the precedent (board
 * #5793): it reports a transition it has no legal repair for, and exits 0. Blocking is rejected here
 * for the same reason.
 *
 * THE READING FOR THIS TOOL (§6.4, judge arm). It scans the root `*.js` and `capture-host/` files of
 * the RUN's work-unit, and it reads that tree's base ref, so it resolves through `judgeRoot` inside
 * `main` and refuses a cross-checkout run with one NOT_RUN object and exit 2. A declared set is a
 * fact about ONE tree: run from the shared root against a worktree's branch, the scan would reconcile
 * the root's files and call the answer this branch's. A library import, `--selftest` and
 * `--verdict-sample` examine no tree, so none of the three can refuse.
 *
 * USAGE
 *   node tools/detector-change-advisory.mjs                  # reconcile the declared sets, print the protocol
 *   node tools/detector-change-advisory.mjs --base origin/main   # + the advisory census for this branch
 *   node tools/detector-change-advisory.mjs --json           # the whole result as one object
 *   node tools/detector-change-advisory.mjs --selftest       # the plants: undeclared · unresolved · prose · call site
 *   node tools/detector-change-advisory.mjs --verdict-sample # the tepna.verdict/1 object alone
 *
 * EXIT · 1 an undeclared definition or an unresolved declaration · 2 the base ref could not be read
 * (NOT_RUN — it could not look, §4c) · 0 otherwise, the census included.
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';
import { blankComments, codeMask } from './js-lex.mjs';
import { WriteRootRefusal, judgeRoot } from './write-root.mjs';

let REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)('../verdict.js');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : d;
};

/* ── THE CRITERION IS PRE-STATED (§🧾) ─────────────────────────────────────────────────────────── */
export const CRITERION = { name: 'undeclared_detector_definitions', threshold: 0, unit: 'definitions', direction: 'lte' };

/* ── §7's PROTOCOL, PRINTED WHERE IT APPLIES ───────────────────────────────────────────────────────
   Four steps, in the brief's own order. The point of each is that the author cannot see which arm is
   which while the thresholds are still movable. */
export const PROTOCOL = [
  'STATE the comparison before you run it: which detector, which reference, which nights, which metric, and the band you will call agreement.',
  'BLIND the arms: label the two series by an opaque key, so the person tuning the new detector cannot tell its output from the reference.',
  'TUNE and FREEZE under the blind: every threshold is fixed while the labels are still hidden, and the freeze is recorded.',
  'UNBLIND once, then report both arms with their population — the nights, the windows, the excluded spans and the reason for each.'
];

/* ── THE DECLARED DETECTOR SET ─────────────────────────────────────────────────────────────────────
   A genuine signal detector: it reads a physiological stream and emits events, beats or spans. These
   are the sites whose change §7 is about, and the census names them.
   The `why` is load-bearing — it is what a later reader checks the classification against. */
export const DETECTORS = [
  { file: 'ecgdex-dsp.js', name: 'detectPeaks', why: 'Pan–Tompkins R-peak detection over raw ECG int16' },
  { file: 'ecgdex-dsp.js', name: 'detectPeaksB', why: 'the bandpassed R-peak variant the live comparison uses' },
  { file: 'ecgdex-dsp.js', name: 'detectCVHR', why: 'cyclic-variation-of-heart-rate event detection over an NN series' },
  { file: 'ppgdex-dsp.js', name: 'detectBeats', why: 'PPG beat detection over one bandpassed channel' },
  { file: 'ppgdex-dsp.js', name: 'detectChannel', why: 'the per-LED channel detector the 3-LED consensus fuses' },
  { file: 'oxydex-dsp.js', name: 'detectDesatEvents', why: 'SpO2 desaturation event detection' },
  { file: 'oxydex-dsp.js', name: 'detectODI', why: 'oxygen-desaturation-index event counting over SpO2' },
  { file: 'oxydex-dsp.js', name: 'detectSpikes', why: 'pulse-rate spike detection over the ring rows' },
  { file: 'oxydex-dsp.js', name: 'detectPeriodicity', why: 'periodic-breathing detection over the spike train' },
  { file: 'oxydex-dsp.js', name: 'detectSpO2Periodicity', why: 'periodic-breathing detection over SpO2 itself' },
  { file: 'oxydex-dsp.js', name: 'detectOscillations', why: 'oscillation detection over the ring rows' },
  { file: 'oxydex-dsp.js', name: 'detectDesatEventsGated', why: 'the hysteresis-gated desaturation detector' },
  { file: 'cpapdex-dsp.js', name: 'detectDesats', why: 'desaturation event detection over the CPAP SpO2 channel' },
  { file: 'cpapdex-dsp.js', name: 'detectBreaths', why: 'breath detection over the CPAP flow channel' },
  { file: 'glucodex-dsp.js', name: 'detectSessions', why: 'CGM session segmentation over the glucose series' },
  { file: 'glucodex-dsp.js', name: 'detectClampSaturation', why: 'sensor-clamp detection over the glucose series' },
  { file: 'integrator-dsp.js', name: 'detectClockSkew', why: 'clock-skew detection across node recordings' },
  { file: 'resp-acc-analysis.js', name: 'detectBreaths', why: 'breath detection over an accelerometer-derived flow series' },
  { file: 'treatment-response-analysis.js', name: 'detect', why: 'the three change-point detectors this study compares' },
  { file: 'capture-host/monitor.html', name: 'detectRs', why: 'the live strip R-peak detector, the subject of #2759' },
  { file: 'capture-host/monitor.html', name: 'detectPulses', why: 'the live strip pulse detector over the PPG channel' }
];

/* ── THE DECLARED EXCLUSION SET ────────────────────────────────────────────────────────────────────
   A `detect…`-shaped name that reads no physiological stream. Format sniffing, plumbing and
   diagnostics over an already-detected series all land here. The reason is the whole content of the
   declaration: a reader who disagrees with one can move it, and the census changes with it. */
export const EXCLUSIONS = [
  { file: 'cpapdex-coimport.js', name: 'detectNodeExport', why: 'format sniffing — it reads a JSON envelope, not a signal' },
  { file: 'integrator-dsp.js', name: 'detectNode', why: 'format sniffing — it names which node wrote an export' },
  { file: 'glucodex-dsp.js', name: 'detectDelimiter', why: 'format sniffing — it reads a CSV header line' },
  { file: 'signal-adapters.js', name: 'detectAdapters', why: 'format sniffing — it picks a parser from a file head' },
  { file: 'ppgdex-dsp.js', name: 'detectorStability', why: 'a diagnostic OVER two detectors, computing nothing from the signal' },
  { file: 'ppgdex-dsp.js', name: 'detectorAgreementTriplet', why: 'an agreement metric over three already-detected trains' },
  { file: 'ppgdex-dsp.js', name: '_detectSerial', why: 'plumbing — the sequential dispatch that maps channels through detectChannel' },
  { file: 'ppgdex-dsp.js', name: 'detectChannelsAsync', why: 'plumbing — the worker dispatch around the same detectChannel' },
  { file: 'capture-host/cpap_live.py', name: 'detector_age_s', why: 'arithmetic over two stamps, no stream read' },
  { file: 'capture-host/mutation_diff.py', name: 'kill_is_a_detection', why: 'a mutation-gate predicate over an exit code' },
  { file: 'capture-host/stitch_31d.py', name: '_detect_delimiter', why: 'format sniffing — it reads a CSV header line' },
  /* The four below carry `Detect` INSIDE the name rather than at its head, and the scanner reads them
     because a detector written as `newDetectBeats` would hide from a head-anchored pattern. None of
     them reads a stream. */
  { file: 'dex-profile.js', name: 'setDetected', why: 'a profile setter — it stores a flag another module decided' },
  { file: 'dex-profile.js', name: 'getDetected', why: 'a profile getter — it reads that same stored flag' },
  { file: 'integrator-dsp.js', name: 'readDetectorStability', why: 'it reads an already-computed stability field off a node export' },
  { file: 'oxydex-profile.js', name: 'profileAutoDetectUpdate', why: 'profile plumbing — it updates a form from values already parsed' }
];

/* ── THE SCAN SET ──────────────────────────────────────────────────────────────────────────────────
   `capture-host/*.html` is in it because `detectRs` lives as INLINE JS inside
   `capture-host/monitor.html`, pinned by `capture-host/tests/test_monitor_ecg_bandpass.py`. A scan
   over `*.js` alone would miss the one detector a merged PR actually validated against a reference,
   which is the exact blind spot this tool exists to close. */
export function scanSet(readDir = (d) => fs.readdirSync(path.join(REPO, d))) {
  const js = readDir('.')
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => f);
  const ch = readDir('capture-host')
    .filter((f) => f.endsWith('.py') || f.endsWith('.html'))
    .sort()
    .map((f) => 'capture-host/' + f);
  return [...js, ...ch];
}

/* ── THE DEFINITION SCANNER ────────────────────────────────────────────────────────────────────────
   Three legs, and the first two are the safe ones because a KEYWORD proves a definition:
     · `function NAME(` — any parameter list, destructuring included;
     · `const|let|var NAME =` followed by an arrow or a function;
     · `def NAME(` for python, any parameter list.
   The third leg has no keyword — an object or class METHOD, which is how `detectRs(s,fs){` is
   written — so it must be told apart from a CALL at line start. It is, by the parameter list: a
   definition's list is identifiers, while `detectDesatEvents(spo2, { dropPct: … })` carries a brace
   and prose carries a slash or a backtick. Measured over the tree on 2026-11-13: the conservative
   list drops exactly two false hits (`oxydex-dsp.js:1832`, a call; `ppgdex-app.js:681`, prose the
   lexer does not read as a comment) and loses no definition.
   🔴 ITS KNOWN BLIND SPOT, STATED RATHER THAN GUESSED AT: a method whose parameter list is
   destructured — `detectX({ a, b }) {` — has no keyword and a brace, so leg three cannot see it. The
   selftest pins that case so a later reader meets the limit instead of trusting the count. Write a
   new detector with `function`, or declare it. */
const DEF_KEYWORD = /^[ \t]*(?:export[ \t]+)?(?:async[ \t]+)?(?:function[ \t]+|(?:const|let|var)[ \t]+)([A-Za-z0-9_$]*[Dd]etect[A-Za-z0-9_$]*)[ \t]*(?:\(|=[ \t]*(?:async[ \t]*)?(?:\(|function))/;
const DEF_PY = /^[ \t]*(?:async[ \t]+)?def[ \t]+([A-Za-z0-9_]*detect[A-Za-z0-9_]*)[ \t]*\(/;
const DEF_METHOD = /^[ \t]*([A-Za-z0-9_$]*[Dd]etect[A-Za-z0-9_$]*)[ \t]*\([ \t]*([A-Za-z0-9_$,.\][ \t:='"|*-]*)\)[ \t]*\{/;

export function scanText(relPath, src) {
  const out = [];
  const py = relPath.endsWith('.py');
  /* A python file is not JS, so the JS lexer never reads it — a `#` comment cannot hold a `def`
     anyway, and a docstring that spells one is this scanner's stated limit, not a silent one. */
  const text = py ? src : blankComments(src);
  const mask = py ? null : codeMask(src);
  let off = 0;
  let lineNo = 0;
  for (const line of text.split('\n')) {
    lineNo += 1;
    const m = py ? DEF_PY.exec(line) : DEF_KEYWORD.exec(line) || DEF_METHOD.exec(line);
    if (m) {
      const col = line.indexOf(m[1]);
      /* A hit inside a string literal is not a definition. The lexer answers that; prose inside a
         comment is already blank by here. */
      if (mask === null || mask[off + col] === 1) out.push({ file: relPath, line: lineNo, name: m[1] });
    }
    off += line.length + 1;
  }
  return out;
}

/* ── RECONCILIATION ────────────────────────────────────────────────────────────────────────────────
   Both directions, because each one hides a different failure. An UNDECLARED definition means the
   census has stopped covering the tree. An UNRESOLVED declaration means the census names a site that
   no longer exists, and a pointer that points nowhere reads exactly like a pointer that points. */
export function reconcile(found, detectors = DETECTORS, exclusions = EXCLUSIONS) {
  const key = (d) => d.file + '#' + d.name;
  const declared = new Set([...detectors, ...exclusions].map(key));
  const seen = new Set(found.map(key));
  const undeclared = found.filter((f) => !declared.has(key(f)));
  const unresolved = [...detectors, ...exclusions].filter((d) => !seen.has(key(d))).map((d) => ({ file: d.file, name: d.name, kind: detectors.includes(d) ? 'detector' : 'exclusion' }));
  return { definitions: found.length, detectors: detectors.length, exclusions: exclusions.length, undeclared, unresolved, found };
}

/* ── THE ADVISORY CENSUS ───────────────────────────────────────────────────────────────────────────
   It names the declared DETECTOR sites that sit in a file this branch changed. File granularity is
   deliberate and stated: a span test would need a brace tokenizer whose own limits would then decide
   whether an author is handed the protocol, and a protocol handed too often costs a read, while one
   handed too rarely is the defect this tool was written for. */
export function census(changedFiles, detectors = DETECTORS) {
  const set = new Set(changedFiles || []);
  const hits = detectors.filter((d) => set.has(d.file));
  return { changedFiles: [...set].sort(), detectorFilesTouched: [...new Set(hits.map((h) => h.file))].sort(), sites: hits.map((h) => ({ file: h.file, name: h.name, why: h.why })) };
}

export function changedFilesAt(base, run = (a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) {
  try {
    const mb = run(['merge-base', base, 'HEAD']).trim();
    if (!mb) return null;
    return run(['diff', '--name-only', mb, 'HEAD'])
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

export function gitShort() {
  try {
    return execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

export function verdictFor(r, commit, opts = {}) {
  const tool = 'tools/detector-change-advisory.mjs';
  const producedBy = { tool, commit: commit || null };
  if (!commit) producedBy.commitReason = 'git rev-parse unavailable in this checkout';
  const evidence = [tool, 'briefs/CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14-BRIEF.md'];
  if (r === null) {
    return Verdict.make({
      gate: 'detector-change-advisory',
      status: 'NOT_RUN',
      scope: 'internal',
      population: { checked: 0, eligible: 0, excluded: 0 },
      criterion: CRITERION,
      result: null,
      evidence,
      reason: opts.notRun || 'the scan could not read the tree, so no definition was examined',
      producedBy,
      at: opts.at
    });
  }
  const bad = r.undeclared.length + r.unresolved.length;
  const eligible = r.definitions + r.unresolved.length;
  const result = {
    definitions: r.definitions,
    declaredDetectors: r.detectors,
    declaredExclusions: r.exclusions,
    undeclared: r.undeclared.length,
    unresolvedDeclarations: r.unresolved.length,
    censusSites: opts.censusSites === undefined ? null : opts.censusSites
  };
  const reason =
    bad === 0
      ? null
      : `${r.undeclared.length} detect-shaped definition(s) sit in neither declared set (${r.undeclared.map((u) => u.file + '#' + u.name).join(', ') || 'none'}) and ${r.unresolved.length} declared site(s) no longer resolve (${r.unresolved.map((u) => u.file + '#' + u.name).join(', ') || 'none'})`;
  return Verdict.make({
    gate: 'detector-change-advisory',
    status: bad === 0 ? 'PASS' : 'FAIL',
    scope: 'internal',
    population: { checked: r.definitions, eligible, excluded: r.unresolved.length },
    criterion: CRITERION,
    result,
    evidence,
    reason,
    producedBy,
    at: opts.at
  });
}

/* ══ SELFTEST ═══════════════════════════════════════════════════════════════════════════════════ */
function selftest() {
  const fails = [];
  let ran = 0;
  const check = (n, c) => {
    ran += 1;
    if (!c) fails.push(n);
  };

  const js = [
    '/* prose: the ring rows are its own beat detections (Wren: 304/304 carry `beat=1`), and */',
    'function detectPeaks(int16, bp, fs) {',
    '  return 1;',
    '}',
    '    detectDesatEvents(spo2, { dropPct: 4 }).forEach(function (e) {',
    '    });',
    '  detectRs(s,fs){',
    '  }',
    '  const detectLater = (x) => x;'
  ].join('\n');
  const f = scanText('plant.js', js);
  const names = f.map((x) => x.name);
  check('the keyword leg finds a `function` definition', names.includes('detectPeaks'));
  check('the method leg finds an identifier-list method (`detectRs(s,fs){`)', names.includes('detectRs'));
  check('the assignment leg finds an arrow definition', names.includes('detectLater'));
  check('CONTROL · a CALL at line start with an object-literal argument is NOT a definition', !names.includes('detectDesatEvents'));
  check('CONTROL · prose inside a block comment is NOT a definition', !names.includes('detections'));
  check('the plant yields exactly the three definitions it declares', f.length === 3);
  check('a hit carries its file and a 1-indexed line', f[0].file === 'plant.js' && f[0].line === 2);

  check(
    'KNOWN LIMIT · a destructured METHOD parameter list has no keyword and a brace, so leg three cannot see it',
    scanText('plant.js', 'detectX({ a, b }) {\n}').length === 0 && scanText('plant.js', 'function detectX({ a, b }) {\n}').length === 1
  );

  const py = scanText('capture-host/plant.py', ['def detector_age_s(now_ms, detector_host_ms):', '    return 0', 'def _detect_delimiter(header: str) -> str:', '    return ","'].join('\n'));
  check(
    'the python leg reads `def`, type hints included',
    py.length === 2 &&
      py
        .map((p) => p.name)
        .sort()
        .join(',') === '_detect_delimiter,detector_age_s'
  );

  const D = [{ file: 'a.js', name: 'detectA', why: 'a detector' }];
  const X = [{ file: 'b.js', name: 'detectB', why: 'format sniffing' }];
  const clean = reconcile(
    [
      { file: 'a.js', line: 1, name: 'detectA' },
      { file: 'b.js', line: 1, name: 'detectB' }
    ],
    D,
    X
  );
  check('CONTROL · a tree whose every definition is declared reconciles to zero on both sides', clean.undeclared.length === 0 && clean.unresolved.length === 0 && clean.definitions === 2);
  const dirty = reconcile(
    [
      { file: 'a.js', line: 1, name: 'detectA' },
      { file: 'c.js', line: 9, name: 'detectC' }
    ],
    D,
    X
  );
  check('an UNDECLARED definition is named with its file', dirty.undeclared.length === 1 && dirty.undeclared[0].file === 'c.js');
  check(
    'an UNRESOLVED declaration is named with its kind, because a pointer that points nowhere reads like one that points',
    dirty.unresolved.length === 1 && dirty.unresolved[0].name === 'detectB' && dirty.unresolved[0].kind === 'exclusion'
  );
  check('a declared EXCLUSION never reads as undeclared', !clean.undeclared.some((u) => u.name === 'detectB'));

  const vPass = verdictFor(clean, '3c0dbdec', { at: '2026-11-13T00:00:00Z' });
  const vFail = verdictFor(dirty, '3c0dbdec', { at: '2026-11-13T00:00:00Z' });
  const vDNR = verdictFor(null, '3c0dbdec', { at: '2026-11-13T00:00:00Z', notRun: 'the base ref could not be read' });
  check('PASS over a clean reconciliation, and it validates', vPass.status === 'PASS' && Verdict.validate(vPass).ok && vPass.reason === null);
  check('FAIL names both counts in its reason', vFail.status === 'FAIL' && /neither declared set/.test(vFail.reason) && vFail.result.undeclared === 1 && vFail.result.unresolvedDeclarations === 1);
  check('NOT_RUN examined nothing and says why', vDNR.status === 'NOT_RUN' && vDNR.population.checked === 0 && /could not be read/.test(vDNR.reason));
  check(
    'all three validate',
    [vPass, vFail, vDNR].every((v) => Verdict.validate(v).ok)
  );
  check(
    'the population arithmetic holds on every one',
    [vPass, vFail, vDNR].every((v) => v.population.checked + v.population.excluded === v.population.eligible)
  );
  check('the criterion is pre-stated and bounded at zero', CRITERION.name === 'undeclared_detector_definitions' && CRITERION.threshold === 0 && CRITERION.direction === 'lte');

  const c1 = census(['oxydex-dsp.js', 'README.md'], DETECTORS);
  check('the census names every declared detector site in a file the diff touches', c1.sites.length === 7 && c1.detectorFilesTouched.join(',') === 'oxydex-dsp.js');
  const c0 = census(['README.md'], DETECTORS);
  check('CONTROL · a diff touching no declared detector file names zero sites', c0.sites.length === 0 && c0.detectorFilesTouched.length === 0);
  check(
    'ADVISORY · the census changes no status, so a touched detector still reads PASS',
    verdictFor(clean, '3c0dbdec', { at: '2026-11-13T00:00:00Z', censusSites: c1.sites.length }).status === 'PASS'
  );
  check(
    'an unreadable base answers null rather than an empty diff',
    changedFilesAt('definitely-not-a-ref-4f2a', () => {
      throw new Error('no such ref');
    }) === null
  );

  check('the protocol is four steps and the second one blinds the arms', PROTOCOL.length === 4 && /BLIND the arms/.test(PROTOCOL[1]));
  check(
    'ANTI-VACUITY · the scan set carries capture-host/*.html, where the one validated detector lives',
    scanSet((d) => (d === '.' ? ['oxydex-dsp.js', 'notes.md'] : ['monitor.html', 'capture.py', 'x.txt'])).join(',') === 'oxydex-dsp.js,capture-host/capture.py,capture-host/monitor.html'
  );
  check(
    'ANTI-VACUITY · the declared sets are non-empty, and every entry carries a reason',
    DETECTORS.length > 0 && EXCLUSIONS.length > 0 && [...DETECTORS, ...EXCLUSIONS].every((d) => d.why && d.why.length > 10)
  );

  if (fails.length) {
    console.log(fails.map((x) => '  ✗ ' + x).join('\n'));
    console.log(`${fails.length} failed of ${ran}`);
    process.exit(1);
  }
  console.log(`all ${ran} selftests passed`);
}

/* ══ CLI ════════════════════════════════════════════════════════════════════════════════════════ */
function scanTree() {
  const found = [];
  for (const rel of scanSet()) {
    let src;
    try {
      src = fs.readFileSync(path.join(REPO, rel), 'utf8');
    } catch {
      continue;
    }
    found.push(...scanText(rel, src));
  }
  return found;
}

function main() {
  if (has('--selftest')) return selftest();
  const base = arg('--base', null);
  if (!has('--verdict-sample')) {
    /* A GATE JUDGES THE CHECKOUT IT WAS RUN FROM, never the one it lives in (row
       2026-11-04-a-verdict-gate-judges-the-checkout-it-lives-in-not-the-one-it-ran-from). Every read
       below runs under REPO, so a run of the shared root's copy from a worktree would reconcile the
       root's declared sets and census the root's diff. Both answers would carry this branch's name. */
    try {
      REPO = judgeRoot(import.meta.url);
    } catch (e) {
      if (!(e instanceof WriteRootRefusal)) throw e;
      console.error(e.message);
      const v = verdictFor(null, gitShort(), { notRun: `this run and tools/detector-change-advisory.mjs sit in different checkouts (${e.reason}), so which tree to reconcile is undecided` });
      console.log(`detector-change-advisory: ⏱ UNEXAMINED the work-unit tree — ${v.reason}`);
      console.log(`\nVERDICT (tepna.verdict/1): ${JSON.stringify(v)}`);
      process.exit(2);
    }
  }
  const found = scanTree();
  const r = reconcile(found);
  let cen = null;
  if (base !== null) {
    const changed = changedFilesAt(base);
    if (changed === null) {
      const v = verdictFor(null, gitShort(), { notRun: `the diff against ${base} could not be read, so no detector site was censused — an unfetched ref, or a clone that does not carry it` });
      console.log(`detector-change-advisory: ⏱ UNEXAMINED ${base} — ${v.reason}`);
      console.log(`\nVERDICT (tepna.verdict/1): ${JSON.stringify(v)}`);
      process.exit(2);
    }
    cen = census(changed);
  }
  const v = verdictFor(r, gitShort(), { censusSites: cen ? cen.sites.length : undefined });
  const checked = Verdict.validate(v);
  if (!checked.ok) {
    console.error(`invalid verdict: ${checked.errors.join('; ')}`);
    process.exit(2);
  }
  if (has('--verdict-sample')) {
    console.log(JSON.stringify(v));
    process.exit(0);
  }
  if (has('--json')) {
    console.log(JSON.stringify({ base: base || null, verdict: v, reconciliation: { ...r, found: undefined }, census: cen, protocol: PROTOCOL }, null, 2));
    process.exit(r.undeclared.length + r.unresolved.length ? 1 : 0);
  }

  console.log(`detector-change-advisory: ${r.definitions} detect-shaped definition(s) · ${r.detectors} declared detector(s) · ${r.exclusions} declared exclusion(s)`);
  if (r.undeclared.length) {
    console.log(
      `\n  UNDECLARED (${r.undeclared.length}) — a detect-shaped definition in neither declared set. Add it to DETECTORS with its reason, or to EXCLUSIONS with the reason it reads no stream:`
    );
    for (const u of r.undeclared) console.log(`    ${u.file}:${u.line}  ${u.name}`);
  }
  if (r.unresolved.length) {
    console.log(`\n  UNRESOLVED (${r.unresolved.length}) — a declared site that no longer resolves. The census names it and it is not there:`);
    for (const u of r.unresolved) console.log(`    ${u.file}#${u.name}  (declared ${u.kind})`);
  }
  if (cen) {
    console.log(`\n  CENSUS against ${base} — ${cen.changedFiles.length} file(s) changed, ${cen.detectorFilesTouched.length} of them carrying a declared detector:`);
    if (!cen.sites.length) console.log('    none. This diff touches no declared detector site.');
    for (const s of cen.sites) console.log(`    ${s.file}#${s.name} — ${s.why}`);
    if (cen.sites.length) {
      console.log(`\n  §7 of briefs/CROSS-DOMAIN-METHODS-FOLLOWUPS-2026-08-14-BRIEF.md applies to a diff that changes what one of those detectors DECIDES. Its protocol:`);
      PROTOCOL.forEach((p, i) => console.log(`    ${i + 1}. ${p}`));
      console.log(
        `\n  ADVISORY. This tool cannot witness a blinded run, so it does not gate on one; a refactor that moves a detector without changing its decisions owes nothing here. Say in the PR body which of the two your diff is.`
      );
    }
  }
  console.log(`\nVERDICT (tepna.verdict/1): ${JSON.stringify(v)}`);
  process.exit(r.undeclared.length + r.unresolved.length ? 1 : 0);
}

if (isCliEntry(import.meta.url)) main();

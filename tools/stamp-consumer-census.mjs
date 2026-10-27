#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/**
 * WHICH FILES READ A 14-DIGIT FILENAME STAMP BY LITERAL DIGITS — re-derived, never read off a row.
 *
 * Row `2026-10-26-a-residue-census-enumeration-has-no-instrument-and-has-drifted-by-two`: a census
 * row froze an enumeration of 17 files, nothing in the tree re-runs its derivation, and the set now
 * reads 15. The row states the remedy as a sentence: a row that names a count owes an instrument
 * that re-derives it, or the count reads as current for as long as anyone scans the ledger. This is
 * that instrument.
 *
 * 🔴 THE PREDICATE IS COMPUTED, NOT SPELLED. The census's own derivation greps for the literal
 * source text `\d{14}` or `[0-9]{14}`, which is ONE spelling of the read. This reader instead finds
 * every run of quantified digit atoms whose widths SUM to 14, joined only by regex grouping or an
 * optional underscore. So `(\d{8})_?(\d{6})` and `(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})` are
 * the same read as `\d{14}`, and re-spelling one cannot leave the population.
 *
 * That difference is the row's own finding, one layer down. At the parent census's commit
 * `9c0955a5`, `tools/ppg-foot-consensus-e1.mjs` held TWO readers: a `{14}` one, and `isSleepNight`'s
 * split-spelled one, which has stood since 2026-08-03. The fix moved the first onto
 * `DexClock.fileStamp` and the file left the census's predicate, while the second stayed unanchored.
 * A DEPARTURE IS NOT A FIX, and a predicate keyed on a spelling cannot tell the two apart.
 *
 * 🔴 THE READING IS NOT RE-DERIVED. What a file DOES with the stamp — converts it to a TIME, uses it
 * as an IDENTIFIER, or only names it in a docstring — is a human reading of the file, and no grep
 * recovers it. The declared set carries it per file, and a file nobody has read yet carries `null`
 * rather than a guess (§∅). An unread file is a SHORTFALL, so this gate cannot pass over the very
 * debt it exists to publish.
 *
 * The separator set is the false-positive control. An ISO datetime regex
 * `\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}` also sums to 14, and `-`, `:`, `[`, ` ` and `T` are not
 * separators here, so it never enters. A filename stamp's pieces are joined by nothing, by `_`, or
 * by an optional `_`.
 *
 *   node tools/stamp-consumer-census.mjs                  # re-derive, compare, emit the verdict
 *   node tools/stamp-consumer-census.mjs --verdict-sample  # the shape, with no repository
 *   node tools/stamp-consumer-census.mjs --selftest        # plants
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry, refuseUnknownArgvOrExit } from './argv-guard.mjs';
import { gitCommitOf, producedByOf } from './corpus-scope-core.mjs';
import { blankComments } from './js-lex.mjs';
import { blankPyComments } from './verdict-adoption.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SELF = 'tools/stamp-consumer-census.mjs';
const DECLARED = 'tools/stamp-consumer-census.json';
const Verdict = createRequire(import.meta.url)(join(REPO, 'verdict.js'));

/* The capture host writes `YYYYMMDDHHMMSS` into a filename, so fourteen is the whole stamp and any
   shorter run is a date or a time alone. */
export const STAMP_DIGITS = 14;
/* One quantified digit atom in regex SOURCE: `\d{8}` or `[0-9]{8}`. */
const ATOM_RE = /(?:\\d|\[0-9\])\{(\d+)\}/g;
/* What may sit BETWEEN two atoms of one run: regex grouping, and an optional underscore. A date
   separator (`-`, `:`, `T`, a space) ends the run, which is what keeps an ISO datetime out of this
   population.
   🔴 AND AN OPTIONAL CLASS OF STAMP SEPARATORS IS PART OF THE STAMP, NOT A DATE SEPARATOR. The capture
   host writes the stamp with and without one underscore, so three readers spell the gap `[_-]?` and a
   rule that ends the run there cannot see them (`cpapdex-dsp.js:85` reaches NEITHER predicate). The
   discriminator is the class CONTENTS, measured over the tree rather than argued: a class holding only
   `_` and `-` is a stamp separator, and every ISO gap in the repository holds `T` or a space. Widening
   past that set would re-admit the 70-odd ISO runs the control above exists to exclude. */
const SEP_RE = /^[)(?_]*$/;
const SEP_CLASS_RE = /^[)(?_]*\[(?:\\?[_-])+\]\??[)(?_]*$/;
const isSeparator = (gap) => SEP_RE.test(gap) || SEP_CLASS_RE.test(gap);
/* The reading vocabulary. A file carries a LIST, because one file can hold two readers: `dex-ingest.js`
   keys a device off the stamp at one site and converts it to an instant at another. `null` in place of
   the list means nobody has read the file yet, which is the §∅ value and never an empty list.
   `accept-test` is the reading the parent census had no word for — the pattern admits a filename and
   the INSTANT comes from a stamp owner, so the regex decides membership and never a time. */
export const READS = ['accept-test', 'docstring', 'identifier', 'time'];
/* Only a `time` reading can be anchored or not: a file that converts the digits itself either routes
   them through an owner that bounds the run and range-validates the components, or it slices them into
   a bare `Date.UTC` / `strptime`. Every other reading computes no instant, so §∅ makes its
   `anchored` `null` rather than a `true` nobody measured. */
const ANCHORABLE = 'time';
const SUFFIX_RE = /\.(js|mjs|py)$/;
/* A test path is excluded, and the count is reported rather than dropped: the census's own
   derivation excluded them too, and a reader must be able to see how many. */
const TEST_PATH_RE = /(^|\/)tests?\/|(^|\/)test_|_test\./;

/* Every run of adjacent quantified digit atoms in one text, with the widths that make it up. The
   PARTS matter and not only the sum: a one-part run is the `{14}` spelling the census greps for, and
   a many-part run is the same read spelled out. */
export function digitRuns(text) {
  const out = [];
  const s = String(text == null ? '' : text);
  let cur = null;
  let lastEnd = -1;
  let m;
  const re = new RegExp(ATOM_RE.source, 'g');
  while ((m = re.exec(s))) {
    const n = +m[1];
    const gap = lastEnd >= 0 ? s.slice(lastEnd, m.index) : null;
    if (cur && gap != null && isSeparator(gap)) {
      cur.sum += n;
      cur.parts.push(n);
    } else {
      cur = { sum: n, parts: [n], index: m.index };
      out.push(cur);
    }
    lastEnd = m.index + m[0].length;
  }
  return out;
}

/* How one file spells the read, or null when it does not carry one. `whole` when any run of width
   14 is a single atom, `split` when every one of them is spelled out. */
export function spellingOf(text) {
  const hits = digitRuns(text).filter((r) => r.sum === STAMP_DIGITS);
  if (!hits.length) return null;
  return hits.some((r) => r.parts.length === 1) ? 'whole' : 'split';
}

/* The line a run sits on, for the row a reader follows. */
export function siteLines(text) {
  const s = String(text == null ? '' : text);
  const out = [];
  for (const r of digitRuns(s).filter((x) => x.sum === STAMP_DIGITS)) {
    out.push({ line: s.slice(0, r.index).split('\n').length, parts: r.parts.join('+') });
  }
  return out;
}

/* The source with its comments blanked, so a comment naming an owner is prose about the read rather
   than the read. Each language gets its own scanner, per `js-lex.mjs`'s standing rule. LIMIT, stated
   because it decides a population: `blankPyComments` leaves a triple-quoted block a STRING, so a
   docstring that spells an owner call with its parenthesis would enter. Nothing in today's tree does —
   every Python owner site this admits is a statement, hand-read 2026-10-27 — and the leg below pins
   the case so a future one is a red rather than a silent member. */
export function bareText(text, isPy) {
  const s = String(text == null ? '' : text);
  return isPy ? blankPyComments(s) : blankComments(s);
}

/* 🔴 THE SECOND PREDICATE — WHICH FILES CALL A STAMP OWNER.
   The spelling predicate above and the repair it certifies point in OPPOSITE directions: a reader is
   repaired by handing the whole basename to an owner and ceasing to slice digits, which is exactly the
   condition under which it stops spelling a 14-digit run. So membership LEAVES on the commit that
   fixes the file, the departure check sees a file that was never declared, and the headline counts the
   files that still spell a stamp rather than the files that read one.
   These are the owners a repair routes to. DECLARED, never discovered: a name here is a function that
   takes a filename or a stamp field and hands back either a bounded, range-validated instant or the
   stamp field itself. `returns` records which, because `anchored` means nothing about a field.
   `lang` keeps a Python file from answering for a JS owner's name and back. */
export const STAMP_OWNERS = [
  { name: 'DexClock.fileStamp', lang: 'js', returns: 'instant', call: /\bDexClock\s*\.\s*fileStamp\s*\(/g },
  { name: 'fileStamp', lang: 'js', returns: 'instant', call: /(?<![.\w])fileStamp\s*\(/g },
  { name: 'stampMk', lang: 'js', returns: 'instant', call: /(?<![\w])_?stampMk\s*\(/g },
  { name: '_mkTMs', lang: 'js', returns: 'instant', call: /(?<![\w])_mkTMs\s*\(/g },
  { name: 'nightqc.floating_stamp_s', lang: 'py', returns: 'instant', call: /(?<![\w])floating_stamp_s\s*\(/g },
  { name: 'writers.file_stamp', lang: 'py', returns: 'field', call: /(?<![\w])file_stamp\s*\(/g },
  { name: 'writers.file_start_stamp', lang: 'py', returns: 'field', call: /(?<![\w])file_start_stamp\s*\(/g }
];

/* A DEFINITION IS NOT A CALL. `def floating_stamp_s(` and `function fileStamp(` are the owner's own
   source, and a census that reads them says the owner consumes itself — the shape that classified
   `corpus-scope.mjs` off its own `export function` line. The control is the token before the name. */
const DEFINE_RE = /(?:function|def)\s+$/;

/* Every owner call site in one file, over comment-blanked source. PURE given the text. */
export function ownerCalls(text, isPy) {
  const bare = bareText(text, isPy);
  const lang = isPy ? 'py' : 'js';
  const out = [];
  for (const o of STAMP_OWNERS) {
    if (o.lang !== lang) continue;
    const re = new RegExp(o.call.source, 'g');
    let m;
    while ((m = re.exec(bare))) {
      const lineStart = bare.lastIndexOf('\n', m.index - 1) + 1;
      if (DEFINE_RE.test(bare.slice(lineStart, m.index))) continue;
      out.push({ owner: o.name, line: bare.slice(0, m.index).split('\n').length });
    }
  }
  return out.sort((a, b) => a.line - b.line || a.owner.localeCompare(b.owner));
}

/* Why a file is in the census: it spells the read, it calls an owner, or both. A file admitted by the
   owner alone has NO spelling, so §∅ makes `spelling` null rather than a third bucket nobody measured. */
export function admissionOf(spelling, owners) {
  if (spelling && owners.length) return 'both';
  if (spelling) return 'spelling';
  return owners.length ? 'owner-call' : null;
}

/* The tracked files this census is over. `git ls-files` is the population: an untracked scratch file
   is not a consumer, and a file the index does not hold cannot be cited by a row. */
export function trackedSources(repo = REPO, runner = gitLsFiles) {
  const all = runner(repo);
  const sources = all.filter((p) => SUFFIX_RE.test(p));
  const excluded = sources.filter((p) => TEST_PATH_RE.test(p));
  return { offered: sources.length, excluded: excluded.length, files: sources.filter((p) => !TEST_PATH_RE.test(p)) };
}

function gitLsFiles(repo) {
  return execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean);
}

/* The measured census: every tracked source outside a test path that spells a 14-digit run OR calls a
   stamp owner, with the spelling, every site and why it was admitted. Reads one file at a time and
   keeps no text, because the tree holds hundreds of sources and a whole-tree slurp is the memory
   rule's own case. */
export function measure({ repo = REPO, runner = gitLsFiles, reader = (p) => readFileSync(join(repo, p), 'utf8') } = {}) {
  const { offered, excluded, files } = trackedSources(repo, runner);
  const found = new Map();
  let unreadable = 0;
  for (const p of files) {
    let text;
    try {
      text = reader(p);
    } catch {
      unreadable++;
      continue;
    }
    const sp = spellingOf(text);
    const owners = ownerCalls(text, p.endsWith('.py'));
    const admittedBy = admissionOf(sp, owners);
    if (admittedBy) found.set(p, { spelling: sp, sites: siteLines(text), owners, admittedBy });
  }
  return { offered, excluded, scanned: files.length, unreadable, found };
}

/* The declared set, as shipped. Separate from the tool so a session that reads a file changes a
   datum rather than code, which is the `residue-citations-baseline.json` precedent. */
export function loadDeclared(path = join(REPO, DECLARED), reader = (p) => readFileSync(p, 'utf8')) {
  const j = JSON.parse(reader(path));
  const files = j && j.files && typeof j.files === 'object' ? j.files : {};
  return { meta: j, files };
}

/* 🔴 A COUNT OVER A POPULATION OF NONE IS NOT A PASS. Three arms refuse before any comparison: an
   empty declared set, an empty measured set, and a tree whose sources this reader could not open.
   Each one would otherwise agree with itself. */
export function censusVerdict({ measured, declared, commit = null, commitReason = null, at = null }) {
  const stamp = at || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const base = {
    gate: 'stamp-consumer-census',
    scope: 'internal',
    criterion: { name: 'files_drifted_or_unread', threshold: 0, unit: 'files', direction: 'lte' },
    evidence: [SELF, DECLARED, 'briefs/RESIDUE.md'],
    producedBy: producedByOf(SELF, commit, commitReason),
    at: stamp
  };
  const m = measured.found;
  const dFiles = declared.files;
  const measuredNames = [...m.keys()].sort();
  const declaredNames = Object.keys(dFiles).sort();
  const entries = measuredNames.filter((p) => !(p in dFiles));
  const departures = declaredNames.filter((p) => !m.has(p));
  const shared = measuredNames.filter((p) => p in dFiles);
  /* A reading is a property of the FILE and travels with the declaration; the spelling is a property
     of today's source and is measured every run. A declared reading outside the vocabulary is a
     malformed datum and refuses, because an unrecognised word would otherwise count as read. */
  const badReads = declaredNames.filter((p) => {
    const r = dFiles[p] && dFiles[p].reads;
    if (r == null) return false;
    return !Array.isArray(r) || r.length === 0 || r.some((w) => !READS.includes(w));
  });
  /* The anchoring datum has the same refusal: a `time` file with no boolean is not read, and a
     non-`time` file carrying one claims a measurement that has no subject. */
  const badAnchor = declaredNames.filter((p) => {
    const d = dFiles[p];
    if (!d || d.reads == null || !Array.isArray(d.reads)) return false;
    const owes = d.reads.includes(ANCHORABLE);
    return owes ? typeof d.anchored !== 'boolean' : d.anchored != null;
  });
  const unread = shared.filter((p) => dFiles[p].reads == null).sort();
  const byReading = {};
  for (const r of READS) byReading[r] = shared.filter((p) => (dFiles[p].reads || []).includes(r)).length;
  const timeFiles = shared.filter((p) => (dFiles[p].reads || []).includes(ANCHORABLE));
  const byAnchor = {
    anchored: timeFiles.filter((p) => dFiles[p].anchored === true).length,
    unanchored: timeFiles.filter((p) => dFiles[p].anchored === false).length
  };
  /* §∅: a file admitted by its owner call alone spells nothing, so it is counted as what it is rather
     than folded into a spelling it does not carry. */
  const bySpelling = { whole: 0, split: 0 };
  for (const p of measuredNames) if (m.get(p).spelling) bySpelling[m.get(p).spelling]++;
  const byAdmission = { spelling: 0, 'owner-call': 0, both: 0 };
  for (const p of measuredNames) byAdmission[m.get(p).admittedBy]++;
  const ownerCallSites = measuredNames.reduce((n, p) => n + (m.get(p).owners || []).length, 0);
  const site = (p) => {
    if (!m.has(p)) return `${p} [absent]`;
    const e = m.get(p);
    const spelled = e.sites.map((s) => `${s.line} (${s.parts})`).join(', ');
    const called = (e.owners || []).map((o) => `${o.line} (${o.owner})`).join(', ');
    return `${p} [${e.spelling || 'no spelling'}; ${e.admittedBy}]` + (spelled ? ` at ${spelled}` : '') + (called ? ` · owner call at ${called}` : '');
  };
  const result = {
    stampDigits: STAMP_DIGITS,
    sourcesOffered: measured.offered,
    sourcesExcludedAsTests: measured.excluded,
    sourcesScanned: measured.scanned,
    sourcesUnreadable: measured.unreadable,
    filesDeclared: declaredNames.length,
    filesMeasured: measuredNames.length,
    bySpelling,
    byAdmission,
    ownerCallSites,
    byReading,
    byAnchor,
    filesUnread: unread.length,
    unreadFiles: unread,
    entries: entries.map(site),
    departures
  };
  if (measured.unreadable)
    return Verdict.make({
      ...base,
      status: 'UNKNOWN',
      population: { checked: 0, eligible: measured.scanned, excluded: measured.scanned },
      result,
      reason: `${measured.unreadable} of ${measured.scanned} tracked source(s) could not be opened, so this run cannot state the population`
    });
  if (badReads.length)
    return Verdict.make({
      ...base,
      status: 'FAIL',
      population: { checked: 0, eligible: declaredNames.length, excluded: declaredNames.length },
      result: { ...result, malformedReads: badReads },
      reason: `${badReads.length} declared file(s) carry a reading outside the vocabulary ${READS.join(' | ')}: ${badReads.join(', ')}`
    });
  if (badAnchor.length)
    return Verdict.make({
      ...base,
      status: 'FAIL',
      population: { checked: 0, eligible: declaredNames.length, excluded: declaredNames.length },
      result: { ...result, malformedAnchored: badAnchor },
      reason: `${badAnchor.length} declared file(s) state \`anchored\` against their reading: a \`${ANCHORABLE}\` file owes a boolean and every other reading owes null — ${badAnchor.join(', ')}`
    });
  /* §🧾: `NOT_RUN` examined nothing, so it carries `result: null` and the counts travel in the
     reason. Shipping the census beside a `NOT_RUN` would read as a measurement this run did not make —
     the two legs below caught exactly that, and they are why every arm validates the whole object. */
  if (!declaredNames.length)
    return Verdict.make({
      ...base,
      status: 'NOT_RUN',
      population: { checked: 0, eligible: 0, excluded: 0 },
      result: null,
      reason: `${DECLARED} declares no file, so there is no census to compare today's ${measuredNames.length} measured file(s) against, over ${measured.scanned} source(s) scanned`
    });
  if (!measuredNames.length)
    return Verdict.make({
      ...base,
      status: 'NOT_RUN',
      population: { checked: 0, eligible: 0, excluded: 0 },
      result: null,
      reason: `no tracked source spells a ${STAMP_DIGITS}-digit run or calls a stamp owner over ${measured.scanned} file(s) scanned, which refutes both predicates before they can judge the ${declaredNames.length} declared file(s)`
    });
  if (entries.length || departures.length)
    return Verdict.make({
      ...base,
      status: 'FAIL',
      population: { checked: measuredNames.length, eligible: measuredNames.length, excluded: 0 },
      result,
      reason:
        `the declared census no longer describes the tree: ${entries.length} file(s) entered and ${departures.length} left` +
        (entries.length ? ` — entered ${result.entries.join('; ')}` : '') +
        (departures.length ? ` — left ${departures.join(', ')}` : '')
    });
  if (unread.length)
    return Verdict.make({
      ...base,
      status: 'SHORTFALL',
      population: { checked: measuredNames.length, eligible: measuredNames.length, excluded: 0 },
      result,
      reason: `the population matches, and ${unread.length} of ${measuredNames.length} file(s) carry no reading of what they DO with the stamp: ${unread.join(', ')}`
    });
  return Verdict.make({
    ...base,
    status: 'PASS',
    population: { checked: measuredNames.length, eligible: measuredNames.length, excluded: 0 },
    result,
    reason: null
  });
}

/* The one sentence a reader needs: how many files read a filename stamp, how each was admitted, and
   what they do with it. The admission split is on the headline BECAUSE it is the row's finding — a
   count of spellings alone reads as a count of readers and is not one. */
export function censusLine(v) {
  const r = v.result || {};
  if (!r.filesMeasured) return '  no tracked source spells a 14-digit filename stamp or calls a stamp owner';
  const a = r.byAnchor || { anchored: 0, unanchored: 0 };
  const ad = r.byAdmission || { spelling: 0, 'owner-call': 0, both: 0 };
  return (
    `  ${r.filesMeasured} file(s) read a ${r.stampDigits}-digit filename stamp · ${r.bySpelling.whole} spell it whole, ${r.bySpelling.split} spell it out · ${r.filesUnread} carry no reading\n` +
    `  admitted: ${ad.spelling} by the spelling alone, ${ad['owner-call']} by an owner call alone, ${ad.both} by both · ${r.ownerCallSites} owner call site(s)\n` +
    `  readings: ${READS.map((w) => `${r.byReading[w]} ${w}`).join(' · ')}\n` +
    `  of the time readers, ${a.anchored} route the instant through a stamp owner and ${a.unanchored} slice the digits themselves`
  );
}

/* One synthetic pair, so `verify:verdict-adoption` reads the shape with no repository. */
function sampleMeasured() {
  return {
    offered: 600,
    excluded: 180,
    scanned: 420,
    unreadable: 0,
    found: new Map([
      ['clock.js', { spelling: 'whole', sites: [{ line: 812, parts: '14' }], owners: [], admittedBy: 'spelling' }],
      ['tools/cpap-corpus.mjs', { spelling: 'split', sites: [{ line: 118, parts: '8+6' }], owners: [{ owner: 'DexClock.fileStamp', line: 129 }], admittedBy: 'both' }],
      ['signal-orchestrate.js', { spelling: null, sites: [], owners: [{ owner: 'DexClock.fileStamp', line: 542 }], admittedBy: 'owner-call' }]
    ])
  };
}
function sampleDeclared() {
  return {
    meta: { schema: 'tepna.stamp-consumer-census/1' },
    files: {
      'clock.js': { reads: ['time'], anchored: true },
      'tools/cpap-corpus.mjs': { reads: ['time'], anchored: false },
      'signal-orchestrate.js': { reads: ['time'], anchored: true }
    }
  };
}
function verdictSample() {
  return censusVerdict({ measured: sampleMeasured(), declared: sampleDeclared(), at: '2026-10-27T00:00:00Z' });
}

function selftest() {
  let fail = 0;
  const PASSED = [];
  const ok = (name, cond, detail) => {
    if (cond) {
      PASSED.push(name);
      console.log(`  ok   ${name}`);
    } else {
      console.log(`  FAIL ${name} — ${detail}`);
      fail++;
    }
  };
  console.log('### THE PREDICATE IS COMPUTED, NOT SPELLED');
  ok('the whole spelling is one atom of width 14', spellingOf('var RE = /_(\\d{14})_/;') === 'whole', JSON.stringify(digitRuns('/_(\\d{14})_/')));
  ok('the bracket class spells the same read', spellingOf('/_([0-9]{14})_/') === 'whole', JSON.stringify(digitRuns('/_([0-9]{14})_/')));
  ok('an 8-then-6 pair folds into one run of 14', spellingOf('/_(\\d{8})_?(\\d{6})_/') === 'split', JSON.stringify(digitRuns('/_(\\d{8})_?(\\d{6})_/')));
  ok(
    'the six-group spelling folds too',
    spellingOf('/_(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})_/') === 'split',
    JSON.stringify(digitRuns('/_(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})_/'))
  );
  /* 🔴 THE CAPTURE HOST WRITES THE STAMP WITH AND WITHOUT ONE UNDERSCORE, so a reader spells the gap
     as an optional class and the run must survive it. Three files in the tree do; one of them,
     `cpapdex-dsp.js`, reached neither predicate before this rule existed. */
  ok(
    'an optional separator class joins the run rather than ending it',
    spellingOf('/(\\d{4})(\\d{2})(\\d{2})[_-]?(\\d{2})(\\d{2})(\\d{2})/') === 'split',
    JSON.stringify(digitRuns('/(\\d{4})(\\d{2})(\\d{2})[_-]?(\\d{2})(\\d{2})(\\d{2})/'))
  );
  ok(
    '…and an escaped dash inside that class reads the same',
    spellingOf('/(\\d{4})(\\d{2})(\\d{2})[_\\-]?(\\d{2})(\\d{2})(\\d{2})/') === 'split',
    JSON.stringify(digitRuns('/(\\d{4})(\\d{2})(\\d{2})[_\\-]?(\\d{2})(\\d{2})(\\d{2})/'))
  );
  ok('…and a required one too, since the brackets and not the quantifier carry the meaning', spellingOf('/(\\d{8})[_-](\\d{6})/') === 'split', JSON.stringify(digitRuns('/(\\d{8})[_-](\\d{6})/')));
  /* 🔴 AND THE CONTROLS THAT KEEP THE WIDENING NARROW. The discriminator is the class CONTENTS: a
     class holding anything but `_` and `-` is a date separator and still ends the run. Without these
     three legs the rule above could admit `[T ]` and pull seventy ISO runs into the population. */
  ok(
    'CONTROL · a class holding the ISO date-time separator still ends the run',
    spellingOf('/(\\d{4})(\\d{2})(\\d{2})[T ](\\d{2})(\\d{2})(\\d{2})/') === null,
    JSON.stringify(digitRuns('/(\\d{4})(\\d{2})(\\d{2})[T ](\\d{2})(\\d{2})(\\d{2})/'))
  );
  ok('CONTROL · a class holding a letter beside a separator ends it too', spellingOf('/(\\d{8})[_t](\\d{6})/') === null, JSON.stringify(digitRuns('/(\\d{8})[_t](\\d{6})/')));
  ok('CONTROL · a digit class is not a separator, however short', spellingOf('/(\\d{8})[0-9]?(\\d{6})/') === null, JSON.stringify(digitRuns('/(\\d{8})[0-9]?(\\d{6})/')));
  ok('CONTROL · and a bare dash outside a class still ends the run', spellingOf('/(\\d{8})-(\\d{6})/') === null, JSON.stringify(digitRuns('/(\\d{8})-(\\d{6})/')));
  /* 🔴 THE CONTROL. An ISO datetime sums to fourteen and is NOT this read. Without this leg the
     separator set could widen to any character and every leg above would still pass. */
  ok(
    'CONTROL · an ISO datetime regex sums to 14 and stays out, because its separators end the run',
    spellingOf('/^\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}:\\d{2}$/') === null,
    JSON.stringify(digitRuns('/^\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}:\\d{2}$/'))
  );
  ok('a date alone carries no stamp', spellingOf('/^\\d{4}-\\d{2}-\\d{2}$/') === null, 'date');
  ok('a time alone carries no stamp', spellingOf('/\\d{2}:\\d{2}:\\d{2}/') === null, 'time');
  ok('a file with no quantified digits carries none', spellingOf('const x = 14;') === null, 'none');
  ok(
    'the site row names the line and the widths',
    JSON.stringify(siteLines('a\nb\n/_(\\d{8})_?(\\d{6})_/')) === JSON.stringify([{ line: 3, parts: '8+6' }]),
    JSON.stringify(siteLines('a\nb\n/_(\\d{8})_?(\\d{6})_/'))
  );

  console.log('\n### THE SECOND PREDICATE — WHICH FILES CALL A STAMP OWNER');
  const oc = (s, py) =>
    ownerCalls(s, !!py)
      .map((o) => `${o.owner}@${o.line}`)
      .join(' ');
  ok('a call to the shared owner is a site', oc('var p = DexClock.fileStamp(name);') === 'DexClock.fileStamp@1', oc('var p = DexClock.fileStamp(name);'));
  ok('a node-local owner is one too', oc('return ING.stampMk(+a, +b);') === 'stampMk@1', oc('return ING.stampMk(+a, +b);'));
  ok('the python owners answer in a python file', oc('t = _nqc.floating_stamp_s(stamp)', true) === 'nightqc.floating_stamp_s@1', oc('t = _nqc.floating_stamp_s(stamp)', true));
  /* 🔴 THE CONTROL THAT MAKES THIS A PREDICATE AND NOT A GREP. Every file that was repaired SAYS SO in
     a comment naming the owner, so a raw text scan would admit the prose and call it a read. */
  ok(
    'CONTROL · a comment naming the owner is prose, not a call',
    oc('// the instant comes from DexClock.fileStamp(name)\nvar x = 1;') === '',
    oc('// the instant comes from DexClock.fileStamp(name)\nvar x = 1;')
  );
  ok('CONTROL · a python comment naming the owner is prose too', oc('# read through floating_stamp_s(stamp)\nx = 1\n', true) === '', oc('# read through floating_stamp_s(stamp)\nx = 1\n', true));
  /* 🔴 A DEFINITION IS NOT A CALL — the shape that once classified a module off its own
     `export function` line. Today this changes no membership, because every owner also calls or
     spells; the legs are here so the rule is a rule and not an accident of the tree. */
  ok('CONTROL · a js definition of the owner is not a call', oc('  function fileStamp(name) {\n    return null;\n  }') === '', oc('  function fileStamp(name) {\n    return null;\n  }'));
  ok('CONTROL · a python definition of the owner is not a call', oc('def floating_stamp_s(stamp):\n    return None\n', true) === '', oc('def floating_stamp_s(stamp):\n    return None\n', true));
  ok(
    '…and the definition line does not hide a real call beneath it',
    oc('def floating_stamp_s(s):\n    return floating_stamp_s(s)\n', true) === 'nightqc.floating_stamp_s@2',
    oc('def floating_stamp_s(s):\n    return floating_stamp_s(s)\n', true)
  );
  ok('CONTROL · a python file does not answer for a js owner name', oc('p = DexClock.fileStamp(name)', true) === '', oc('p = DexClock.fileStamp(name)', true));
  ok('CONTROL · a js file does not answer for a python owner name', oc('const t = floating_stamp_s(stamp);') === '', oc('const t = floating_stamp_s(stamp);'));
  /* ⚠️ THE STATED LIMIT. `blankPyComments` leaves a triple-quoted block a STRING by design, so a
     docstring spelling an owner CALL enters the population. No file in the tree does it today
     (hand-read 2026-10-27); this leg pins the behaviour so a future one is visible rather than silent. */
  ok(
    'LIMIT · a python docstring spelling an owner call is admitted, and this leg is the record of it',
    oc('"""reads floating_stamp_s(stamp)"""\nx = 1\n', true) === 'nightqc.floating_stamp_s@1',
    oc('"""reads floating_stamp_s(stamp)"""\nx = 1\n', true)
  );
  ok(
    'the admission is three-valued, and null when neither predicate fires',
    admissionOf('whole', []) === 'spelling' && admissionOf(null, [{}]) === 'owner-call' && admissionOf('split', [{}]) === 'both' && admissionOf(null, []) === null,
    'admission'
  );

  console.log('\n### 🔴 MEMBERSHIP IS MONOTONE UNDER THE REPAIR — THE ROW ITSELF');
  /* The defect in one pair of fixtures. BEFORE is a reader that slices the digits itself; AFTER is the
     same reader repaired onto the owner. The repair DELETES the spelling, so the spelling predicate
     alone drops the file on the commit that fixes it and the departure check never sees a declared
     name. With the owner predicate the file is in the population both times. */
  const before = 'var m = /_(\\d{8})_?(\\d{6})_/.exec(name);\nreturn Date.UTC(+m[1], 0, 1);\n';
  const after = 'var p = DexClock.fileStamp(name);\nreturn p ? p.tMs : null;\n';
  ok(
    'BEFORE · the unrepaired reader is in the population by its spelling',
    spellingOf(before) === 'split' && admissionOf(spellingOf(before), ownerCalls(before, false)) === 'spelling',
    spellingOf(before)
  );
  ok('🔴 the repair REMOVES the spelling — this is the defect, stated as a measurement', spellingOf(after) === null, JSON.stringify(digitRuns(after)));
  ok('…and the repaired reader stays in the population, on the owner call', admissionOf(spellingOf(after), ownerCalls(after, false)) === 'owner-call', JSON.stringify(ownerCalls(after, false)));
  ok('…and a file that does neither is still out', admissionOf(spellingOf('const x = 14;'), ownerCalls('const x = 14;', false)) === null, 'neither');

  console.log('\n### THE POPULATION IS THE TRACKED TREE, MINUS TEST PATHS, COUNTED');
  const lister = () => ['a.js', 'b.mjs', 'c.py', 'd.md', 'tests/e.js', 'capture-host/tests/f.py', 'g_test.js', 'pkg/test_h.py'];
  const t = trackedSources('/nowhere', lister);
  ok('only js, mjs and py are offered', t.offered === 7, JSON.stringify(t));
  ok('every test path is excluded and counted, never dropped silently', t.excluded === 4 && t.files.length === 3, JSON.stringify(t));

  console.log('\n### EVERY ARM EMITS AN OBJECT THE CONTRACT ACCEPTS');
  /* A leg that reads `.status` alone cannot see an invalid object, so every arm below is validated
     as a WHOLE object by construction (the lesson of unit 92). */
  const arm = (want, measured, declared) => {
    const v = censusVerdict({ measured, declared, at: '2026-10-27T00:00:00Z' });
    const chk = Verdict.validate(v);
    ok(`the ${want} arm emits an object the contract accepts`, v.status === want && chk.ok !== false, JSON.stringify({ status: v.status, chk, reason: v.reason }));
    return v;
  };
  const M = sampleMeasured;
  const D = sampleDeclared;
  arm('PASS', M(), D());
  const unreadDecl = {
    meta: {},
    files: { 'clock.js': { reads: ['time'], anchored: true }, 'tools/cpap-corpus.mjs': { reads: null }, 'signal-orchestrate.js': { reads: ['time'], anchored: true } }
  };
  const sf = arm('SHORTFALL', M(), unreadDecl);
  ok('…and the SHORTFALL names the unread file', /tools\/cpap-corpus\.mjs/.test(sf.reason) && sf.result.filesUnread === 1, sf.reason);
  const entryDecl = { meta: {}, files: { 'clock.js': { reads: ['time'], anchored: true } } };
  const ent = arm('FAIL', M(), entryDecl);
  ok('…and the entry is named with its spelling and site', /tools\/cpap-corpus\.mjs \[split; both\] at 118 \(8\+6\) · owner call at 129 \(DexClock\.fileStamp\)/.test(ent.reason), ent.reason);
  /* 🔴 THE ENTRY A SPELLING-KEYED CENSUS COULD NOT PRINT. An owner-only file has no site to quote, so
     a printer written around the spelling would name it with an empty `at` clause and read as a bug
     in the instrument rather than a file to declare. */
  ok(
    '…and an owner-only entry is named by its OWNER call, with no spelling',
    /signal-orchestrate\.js \[no spelling; owner-call\] · owner call at 542 \(DexClock\.fileStamp\)/.test(ent.reason),
    ent.reason
  );
  ok('…and both entries are counted, not just the one the spelling admits', ent.result.entries.length === 2, JSON.stringify(ent.result.entries));
  const depDecl = { meta: {}, files: { ...D().files, 'tools/gone.mjs': { reads: ['identifier'], anchored: null } } };
  const dep = arm('FAIL', M(), depDecl);
  ok('…and the departure is named', /tools\/gone\.mjs/.test(dep.reason) && dep.result.departures.length === 1, dep.reason);
  const badDecl = {
    meta: {},
    files: { 'clock.js': { reads: ['sometimes'], anchored: true }, 'tools/cpap-corpus.mjs': { reads: ['time'], anchored: false } }
  };
  /* A reading list is never a bare word, however legal that word is: the shape refuses too. */
  const scalarDecl = {
    meta: {},
    files: { 'clock.js': { reads: 'time', anchored: true }, 'tools/cpap-corpus.mjs': { reads: ['time'], anchored: false } }
  };
  /* The anchoring datum, both ways round: a `time` file with no boolean, and a reading with no instant
     carrying one. Each would otherwise pass as read. */
  const noAnchorDecl = {
    meta: {},
    files: { 'clock.js': { reads: ['time'], anchored: null }, 'tools/cpap-corpus.mjs': { reads: ['time'], anchored: false } }
  };
  const extraAnchorDecl = {
    meta: {},
    files: {
      'clock.js': { reads: ['docstring'], anchored: true },
      'tools/cpap-corpus.mjs': { reads: ['time'], anchored: false }
    }
  };
  const bad = arm('FAIL', M(), badDecl);
  ok('…and a reading outside the vocabulary refuses rather than counting as read', /outside the vocabulary/.test(bad.reason), bad.reason);
  const sc = arm('FAIL', M(), scalarDecl);
  ok('…and a bare word in place of the reading LIST refuses too', /outside the vocabulary/.test(sc.reason) && /clock\.js/.test(sc.reason), sc.reason);
  const na = arm('FAIL', M(), noAnchorDecl);
  ok('…and a time reading with no anchoring boolean is not read', /anchored/.test(na.reason) && /clock\.js/.test(na.reason), na.reason);
  const xa = arm('FAIL', M(), extraAnchorDecl);
  ok('…and a reading that computes no instant may not claim one', /anchored/.test(xa.reason) && /clock\.js/.test(xa.reason), xa.reason);
  const nd = arm('NOT_RUN', M(), { meta: {}, files: {} });
  ok('…and a NOT_RUN carries no census, because it measured none', nd.result === null && /declares no file/.test(nd.reason), JSON.stringify({ result: nd.result, reason: nd.reason }));
  const none = arm('NOT_RUN', { offered: 600, excluded: 180, scanned: 420, unreadable: 0, found: new Map() }, D());
  ok('…and an empty measured population never reads PASS', none.status !== 'PASS' && none.population.checked === 0, JSON.stringify(none.population));
  ok('…and it names the scan that refuted the predicate rather than shipping a result', none.result === null && /420 file\(s\) scanned/.test(none.reason), none.reason);
  arm('UNKNOWN', { offered: 600, excluded: 180, scanned: 420, unreadable: 3, found: new Map() }, D());
  ok('the sample validates against the contract', Verdict.validate(verdictSample()).ok !== false, JSON.stringify(Verdict.validate(verdictSample())));

  console.log('\n### THE LIVE CENSUS REPRODUCES, OR THESE LEGS ARE VACUOUS');
  /* 🔴 ANTI-VACUITY. Without this leg every leg above could pass over a predicate that matches
     nothing in the repository, and the declared set could be empty. */
  let live = null;
  let liveErr = null;
  let liveDeclared = [];
  let liveMeasured = null;
  try {
    const ld = loadDeclared();
    liveDeclared = Object.keys(ld.files);
    /* ONE walk, reused by every leg below — the tree is ~1000 files and the harness reaps a greedy
       process under box memory pressure, so re-measuring per leg is not free. */
    liveMeasured = measure();
    live = censusVerdict({ measured: liveMeasured, declared: ld, at: '2026-10-27T00:00:00Z' });
  } catch (e) {
    liveErr = String(e && e.message);
  }
  ok('the shipped declared set and the live derivation are both non-empty', !!live && live.result.filesDeclared > 0 && live.result.filesMeasured > 0, liveErr || JSON.stringify(live && live.result));
  ok(
    '…and the live population carries BOTH spellings, so the computed predicate is load-bearing',
    !!live && live.result.bySpelling.whole > 0 && live.result.bySpelling.split > 0,
    JSON.stringify(live && live.result.bySpelling)
  );
  ok(
    '…and the declared census still describes the tree',
    !!live && live.result.entries.length === 0 && live.result.departures.length === 0,
    JSON.stringify(live && { entries: live.result.entries, departures: live.result.departures })
  );
  /* 🔴 THE INSTRUMENT IS IN ITS OWN POPULATION, and this leg is how that was found: the selftest was
     green while git had not yet tracked the file, and red on the first run after the commit. Excluding it
     would make the one file that decides membership the only file nobody re-derives, so the declaration
     is pinned here. With the census agreeing above, a declared path is a measured path. */
  ok(
    '\u2026and the instrument is inside the census it derives, declared like any other file',
    !!live && liveDeclared.includes(SELF) && live.result.entries.length === 0 && live.result.departures.length === 0,
    SELF + ' declared=' + (liveDeclared.includes(SELF) ? 'yes' : 'no')
  );

  console.log('\n### THE OWNER PREDICATE CARRIES ITS OWN WEIGHT IN THE LIVE TREE');
  const lr = live && live.result;
  /* 🔴 ANTI-VACUITY ON THE SECOND PREDICATE. Every leg above would pass over an owner vocabulary
     that names no function this repository actually calls. These three read the live tree. */
  ok('the owner predicate admits files the spelling predicate cannot see', !!lr && lr.byAdmission['owner-call'] > 0, JSON.stringify(lr && lr.byAdmission));
  ok('…and it also corroborates files the spelling already admits', !!lr && lr.byAdmission.both > 0, JSON.stringify(lr && lr.byAdmission));
  ok(
    '…over more call sites than files, so the sites are counted and not the files twice',
    !!lr && lr.ownerCallSites >= lr.byAdmission['owner-call'] + lr.byAdmission.both,
    JSON.stringify(lr && { sites: lr.ownerCallSites, byAdmission: lr.byAdmission })
  );
  ok(
    'every measured file is admitted by exactly one of the three routes',
    !!lr && lr.byAdmission.spelling + lr.byAdmission['owner-call'] + lr.byAdmission.both === lr.filesMeasured,
    JSON.stringify(lr && { byAdmission: lr.byAdmission, filesMeasured: lr.filesMeasured })
  );
  /* ∅ A file admitted by an owner call alone HAS no spelling. The spelling buckets must not invent
     one for it — a `0`-filled or defaulted bucket here would be the §∅ defect inside the instrument. */
  const ownerOnly = liveMeasured ? [...liveMeasured.found.entries()].filter(([, v]) => v.admittedBy === 'owner-call') : [];
  ok(
    '∅ an owner-admitted file carries no spelling, and none is manufactured for it',
    ownerOnly.length > 0 && ownerOnly.every(([, v]) => v.spelling === null && v.sites.length === 0),
    JSON.stringify(ownerOnly.map(([k, v]) => [k, v.spelling]))
  );
  ok(
    '…and the spelling buckets count only the files that spell it',
    !!lr && lr.bySpelling.whole + lr.bySpelling.split === lr.filesMeasured - lr.byAdmission['owner-call'],
    JSON.stringify(lr && { bySpelling: lr.bySpelling, byAdmission: lr.byAdmission, filesMeasured: lr.filesMeasured })
  );
  /* 🔴 THE ROW, READ OFF THE TREE. The repair the census certifies routes a filename stamp through an
     owner and deletes the digits — so every file admitted by the owner alone should read `time` and
     be anchored. Derived from the declarations, never a frozen list of the four names #4006 moved. */
  const ownerOnlyDecl = (() => {
    try {
      const f = loadDeclared().files;
      return ownerOnly.map(([k]) => [k, f[k]]);
    } catch {
      return [];
    }
  })();
  ok(
    'every file the repair pushed out of the spelling census reads an INSTANT, and says it is anchored',
    ownerOnlyDecl.length > 0 && ownerOnlyDecl.every(([, d]) => d && Array.isArray(d.reads) && d.reads.includes('time') && d.anchored === true),
    JSON.stringify(ownerOnlyDecl)
  );
  /* 🔴 THE INSTRUMENT ADMITS ITSELF ON THE SECOND PREDICATE, AND ITS OWN SELFTEST IS WHY.
     Before these legs existed the file matched no owner call: `STAMP_OWNERS` spells the names with
     `\s*\.` and `\s*\(`, never the literal call, so the vocabulary cannot find the file that declares
     it. The fixtures above then wrote `DexClock.fileStamp(` as literal text, and the census reads a
     string fixture exactly as it reads a call — it has no parser, by design. So this file is admitted
     `both`, and some of its owner sites are test data rather than stamp reads.
     The leg pins the route, so a change of it is visible: a census whose own membership route moves
     without an edit to its declaration is measuring something other than the tree. */
  const selfSrc = liveMeasured && liveMeasured.found.get(SELF);
  ok(
    'the instrument is admitted by BOTH routes, its own selftest fixtures being owner call sites',
    !!selfSrc && selfSrc.admittedBy === 'both' && selfSrc.spelling !== null && selfSrc.owners.length > 0,
    JSON.stringify(selfSrc && { admittedBy: selfSrc.admittedBy, spelling: selfSrc.spelling, owners: selfSrc.owners.length })
  );
  /* …and the limit that follows from it, stated as a measurement rather than left for a reader to
     discover: a file's owner-call count is a count of TEXT, so a file whose only sites are fixtures
     is in the population on evidence that reads no stamp. One file does this today — this one. */
  /* 🔴 THE WIDENING'S LIVE CONTROL. `verdict.js` spells an ISO datetime and reads no filename stamp.
     It is the file the separator rule exists to keep out, and it must stay out of the measured tree
     after the rule widened — a rule proven only on fixtures is proven on fixtures. */
  const isoOnly = ['verdict.js', 'tools/aperiodic-offset.mjs'];
  ok(
    'CONTROL · an ISO-only file is still outside the measured population after the widening',
    !!liveMeasured && isoOnly.every((f) => !liveMeasured.found.has(f)),
    JSON.stringify(isoOnly.filter((f) => liveMeasured && liveMeasured.found.has(f)))
  );
  /* ∅ The unanchored time reader is REPORTED, not rounded away: the headline's two halves sum to the
     time readers, so a file that slices the digits itself cannot hide inside an "all anchored" line. */
  ok(
    '∅ every time reader is counted as anchored or as slicing the digits itself, with no remainder',
    !!lr && !!lr.byAnchor && lr.byAnchor.anchored + lr.byAnchor.unanchored === lr.byReading.time,
    JSON.stringify(lr && { byAnchor: lr.byAnchor, time: lr.byReading && lr.byReading.time })
  );
  /* …and the unanchored half is non-empty, so the leg above is not a sum of a number and a zero.
     One file slices the digits itself today; the headline that once read "14 of 14 anchored" said so
     only because the census could not see it. */
  ok(
    '…and the tree holds at least one of each, so neither half of that sum is empty',
    !!lr && !!lr.byAnchor && lr.byAnchor.anchored > 0 && lr.byAnchor.unanchored > 0,
    JSON.stringify(lr && lr.byAnchor)
  );
  const selfNote = (() => {
    try {
      return String(loadDeclared().files[SELF].note || '');
    } catch {
      return '';
    }
  })();
  ok('…and the declaration a reader meets says so, rather than leaving them to find it', /fixtures, not stamp reads/.test(selfNote), selfNote.slice(-120));

  const ran = PASSED.length + fail;
  console.log(`\n${fail ? `✗ ${fail} of ${ran} FAILED` : `✓ all ${ran} selftests passed · the census re-derives and the spellings are folded`}`);
  return fail ? 1 : 0;
}

const IS_CLI = isCliEntry(import.meta.url);
if (IS_CLI) {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--selftest', '--verdict-sample'], valued: ['--declared'] }, { tool: 'stamp-consumer-census' });
  if (argv.includes('--selftest')) process.exit(selftest());
  /* The sample sits ABOVE the walk: `verify:verdict-adoption` reads it where no repository is. */
  if (argv.includes('--verdict-sample')) {
    console.log(JSON.stringify(verdictSample(), null, 2));
    process.exit(0);
  }
  const declaredPath = argv.indexOf('--declared') >= 0 ? argv[argv.indexOf('--declared') + 1] : join(REPO, DECLARED);
  const { commit, reason: commitReason } = gitCommitOf(REPO);
  const v = censusVerdict({ measured: measure(), declared: loadDeclared(declaredPath), commit, commitReason });
  console.log(censusLine(v));
  console.log(JSON.stringify(v, null, 2));
  process.exit(v.status === 'FAIL' || v.status === 'UNKNOWN' ? 1 : 0);
}

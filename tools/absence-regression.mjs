#!/usr/bin/env node
/*
 * absence-regression.mjs — regression gate for fixed absence-fabrication patterns.
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 *
 * The §∅ drain removed "absent reads as 0/1970" patterns. This gate fails if a
 * PR *adds* new instances of those patterns (diff-based, so main's baseline
 * doesn't need to be zero first).
 *
 * Patterns (each cites its fixing PR):
 *   - `tMs: ... || 0` — stamps 1970 on timeless findings (§2a #3366)
 *   - `x.t0Ms || 0` — an absent recording start reads as 1970-01-01 (§∅)
 *   - `x.tMs || 0`, `x._tMs || 0`, `x.startMs || 0` — the READ position of the same stamp family,
 *     where the key of a sort reads an unplaceable event as 1970 and puts it first (§∅, Clock §6)
 *   - a general `x || 0` on an ADDED line — any absent field published as a measured zero. The
 *     general spelling is DIFF-SCOPED only, and a line declares a legal zero with
 *     `absence-ok: <reason>` (residue 2026-11-15-absence-gates-skip-the-or-zero-spelling)
 *
 * A CITATION IS NOT A SITE: prose that names the fabricated shape, in a comment or inside backticks,
 * is examined and reported apart from the hits. Without that split this gate reds the PR that
 * DOCUMENTS a fix, and five such lines already sit on main (residue
 * 2026-11-15-absence-gates-skip-the-or-zero-spelling).
 *
 * NOTE (Item 3): The second pattern class originally documented here
 * (`|| 0` on a metric accumulator, citing #3359) was incorrect. #3359 fixed
 * implicit null coercion in aggregates (`null + x` → x, `null - x` → -x),
 * not `|| 0` defaults. The `|| 0` instances in *-dsp.js are legitimate
 * default values (e.g. `fs || 0.5`), not absence fabrication. This gate
 * intentionally covers only the tMs pattern; the null-arithmetic class is
 * covered by the DSP unit tests, not by diff-scanning.
 *
 * Usage: node tools/absence-regression.mjs --base <sha>
 * In CI, the workflow passes PR_BASE_SHA. Without --base, checks the worktree
 * against HEAD (useful pre-push).
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCliEntry } from './argv-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));

function verdictOf({ status, scanned, excluded = 0, citations = 0, declared = 0, patternNames = [], hits, base, fullTree, baseline, reason = null }) {
  const v = Verdict.make({
    gate: 'absence-regression',
    status,
    population: { checked: scanned, eligible: scanned + excluded, excluded },
    criterion: fullTree
      ? { name: 'the-whole-tree-backlog-of-absence-fabrications-may-only-fall', threshold: baseline ? baseline.count : 0, unit: 'lines fabricating an absent value', direction: 'lte' }
      : { name: 'no-added-line-fabricates-an-absent-value', threshold: 0, unit: 'added lines matching a fixed pattern', direction: 'eq' },
    result:
      status === 'NOT_RUN' && !fullTree
        ? null
        : {
            scanned,
            citations,
            declared,
            patterns: patternNames,
            violations: hits.map((h) => ({ pattern: h.name, file: h.file ?? null, line: h.line })),
            notScanned: EXCLUDED_PATHS.map((e) => ({ path: e.path, why: e.why })),
            ...(fullTree ? { mode: 'full-tree', baseline: baseline ? baseline.count : null } : {})
          },
    evidence: ['tools/absence-regression.mjs'],
    reason: status === 'PASS' ? null : reason ? reason : status === 'NOT_RUN' ? `0 added lines in ${base}..HEAD — nothing was examined` : `${hits.length} added line(s) fabricate an absent value`,
    producedBy: {
      tool: 'tools/absence-regression.mjs',
      commit: (() => {
        try {
          return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
        } catch {
          return null;
        }
      })()
    },
    at: new Date().toISOString()
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`absence-regression produced an invalid verdict: ${chk.errors.join('; ')}`);
  return v;
}

const PATTERNS = [
  {
    name: 'tms-fabrication',
    // tMs: <expr> || 0  — the fix is tMs: <expr> ?? null, which this shape cannot match
    regex: /tMs:\s*[^,;]*\|\|\s*0/,
    why: 'tMs: x || 0 stamps 1970 on timeless findings — use ?? null (§2a #3366)'
  },
  {
    /* THE t0Ms FAMILY (residue 2026-11-15-absence-regression-misses-the-t0ms-or-zero-family). The tMs
       shape above never matched it, so 35 sites in 16 files sat outside this gate. Measured live on
       CPAP: an absent t0Ms read as 1970-01-01 gave spanDays about 20,700 in an export filename and a
       clockOffsetSec of about 56 years. The lookahead keeps `|| 0.5` and `|| 0x10` out: those are
       ordinary defaults, not an epoch. */
    name: 't0ms-fabrication',
    regex: /t0Ms\)?\s*\|\|\s*0(?![.\w])/,
    why: 'x.t0Ms || 0 turns an absent recording start into 1970-01-01 — use ?? null and refuse downstream (§∅)'
  },
  {
    /* THE READ POSITION OF THE SAME FAMILY (residue 2026-11-15-absence-gates-skip-the-or-zero-spelling).
       The two shapes above read a WRITE (`tMs:`) and the t0Ms name. A sort key spells it the other way
       round, and the tree carries four such lines that no gate could see: `cpapdex-fusion.js`,
       `integrator-dsp.js`, `hrvdex-cross.js` (`_tMs`) and `glucodex-cross.js` (`startMs`). Clock
       Contract §6 lets an export carry `t` alone, so an absent `tMs` is a stamp the consumer rebuilds
       from `startEpochMs`, and the `|| 0` key invents 1970-01-01 instead. Every such event then sorts
       ahead of every stamped one. The lookahead keeps `|| 0.5` out, as an ordinary default is not an
       epoch. The name set is the names this tree uses for a wall-clock stamp, and a general `|| 0`
       rule stays out on purpose: 487 lines spell it, and most are legal defaults, divisors or tallies. */
    name: 'stamp-read-fabrication',
    regex: /(?:^|[^\w$])(?:_?tMs|startMs)\s*\|\|\s*0(?![.\w])/,
    why: 'x.tMs || 0 reads an absent stamp as 1970-01-01, so a t-only event sorts ahead of every stamped one — rebuild it from startEpochMs or refuse (§∅, Clock §6)'
  },
  {
    /* THE GENERAL SPELLING (residue 2026-11-15-absence-gates-skip-the-or-zero-spelling). The three
       shapes above read ONE field family, so `glucose || 0` or `nMag || 0` published an absent value
       as a measured zero and no gate could see it. The row's own evidence rejected a whole-tree rule:
       487 lines spell `|| 0` and most are tallies, divisors or display bounds. Measured through this
       classifier over the 80 first-parent merges of main at be2a0d1bb: 1,499 added lines inside this
       gate's population, 9 citations of the shape, and ONE code line — `ppgdex-app.js`'s
       `(m.nMag || 0).toLocaleString()`, which renders an absent magnetometer count as 0 samples. One
       line in 80 merges is what makes the general spelling affordable DIFF-SCOPED. `general: true`
       therefore carries three consequences, each with its own selftest leg: the pattern stays out of
       `--full-tree`, where it would read as 487 findings against a baseline of 38; it defers to the
       three families, so one site is never counted twice; and a line may declare a legal zero with
       `absence-ok: <reason>`, which the gate COUNTS so that silencing stays visible. */
    name: 'or-zero-fabrication',
    general: true,
    regex: /\|\|\s*0(?![.\w])/,
    why: 'x || 0 publishes an absent value as a measured zero — use ?? null, or declare a legal zero on the line with `absence-ok: <reason>` (§∅)'
  }
];

/* THE RATCHET AND THE DIFF SCAN READ DIFFERENT PATTERN SETS, and the difference is the general
   spelling. Exported so the selftest judges the split rather than trusting it. */
export const patternsFor = (fullTree, patterns = PATTERNS) => (fullTree ? patterns.filter((p) => !p.general) : patterns);

/* ── A CITATION IS NOT A SITE ─────────────────────────────────────────────────────────────────────
   Measured on main at 0f590304c: of the 9 lines carrying the read shape, 4 are code and 5 are prose
   about a fix that already landed. A line-prefix test alone cannot tell them apart, because this
   tree writes a block comment with no `*` on its body lines (`clock.js:1045`, `glucodex-dsp.js:2491`),
   so two of the five look like code. Both of those quote the shape in BACKTICKS, which is how this
   repo names code inside prose, so the backtick span is the discriminator that reads all five.
   It fails CLOSED in both directions that matter: a template literal carrying `${` is a real site,
   and an unterminated span is never a citation. The residual escape is a stamp read behind a `//`
   that sits inside a string literal on the same line; it is skipped and stated, not counted. */
const COMMENT_OPEN = /(?:^|\s)(?:\/\/|\/\*)/;

/* A LINE DECLARES A LEGAL ZERO. `|| 0` is a tally, a divisor guard or a viewport bound often enough
   that a general rule needs a per-line escape, and the house form is a named reason beside the code.
   A bare `absence-ok:` declares nothing: the reason is the point, so the gate requires one. */
export const MARKER = /absence-ok:\s*\S/;

/** Is this match prose about the shape rather than an instance of it? Pure, line-local. */
export function isCitation(line, m) {
  const before = line.slice(0, m.index);
  if (/^\s*\*/.test(line)) return true;
  if (COMMENT_OPEN.test(before)) return true;
  const ticks = (before.match(/`/g) || []).length;
  if (ticks % 2 === 0) return false;
  const open = before.lastIndexOf('`');
  const close = line.indexOf('`', m.index + m[0].length);
  if (close < 0) return false;
  return !line.slice(open, close + 1).includes('${');
}

/* THE PATHS THIS GATE DOES NOT SCAN, DISCLOSED (residue 2026-11-15-gates-share-an-undisclosed-file-exclusion).
   A test plants the fabricated shape on purpose, so `tests/` stays out. The gate COUNTS what it skips
   and the verdict carries that count as `population.excluded`, because a pathspec nobody reads is an
   exclusion in the dark.

   TWO TREES USED TO ENTER NEITHER COUNT (residue 2026-11-19-the-absence-gate-diff-omits-mjs-and-python).
   The diff pathspec read `'*.js'` and `'*.src.html'` alone, so 389 `.mjs` files and every `.py` file
   were neither scanned nor excluded, and no reader of a PASS could see that. The pathspec now names
   both, and each tree gets the answer its language earns.
   `.mjs` IS SCANNED: it is the same language with the same shapes, and the widening found 6 sites in
   `tools/`, each recorded in the backlog ledger.
   `.py` IS EXCLUDED, WITH ITS REASON: `isCitation` below reads JavaScript comment syntax, so it
   cannot tell a `#` comment or a docstring from code, and both Python matches in this tree sit in
   prose. A Python pattern set is its own unit.
   THIS FILE IS EXCLUDED TOO: the selftest plants the shape 13 times and every pattern quotes it in
   its own `why`, so a scan of the gate reported 27 fabrications inside the gate that forbids them. */
export const EXCLUDED_PATHS = [
  { path: 'tests/', why: 'the suite plants the fabricated shape on purpose, as a fixture' },
  { path: 'tools/absence-regression.mjs', why: 'this gate plants the shape in its own selftest and quotes it in every pattern message' },
  {
    path: '*.py',
    match: 'suffix',
    why: 'the classifier reads JavaScript comment syntax, so it cannot tell a Python comment or docstring from code — a Python pattern set is its own unit'
  }
];
/* THE PATHSPEC IS A NAMED CONSTANT so the selftest can read it. The omission this list repairs was a
   literal inside one `git diff` call, and nothing asserted its contents, so the two absent trees cost
   nothing to lose and nothing to notice. A dropped entry here now reds a leg
   (residue 2026-11-19-the-absence-gate-diff-omits-mjs-and-python). */
export const DIFF_PATHSPEC = ["'*.js'", "'*.src.html'", "'*.mjs'", "'*.py'"];

/* A `match: 'suffix'` entry keys on the EXTENSION, because `.py` files sit under `capture-host/`,
   `experiments/` and `tools/`, so no one prefix reaches them. Its `path` stays the human label that
   every print site and the verdict's `notScanned` already read. */
const isExcluded = (file) => EXCLUDED_PATHS.some((e) => (e.match === 'suffix' ? file.endsWith(e.path.slice(1)) : file.startsWith(e.path)));

/**
 * PURE CORE — classify the ADDED lines of a diff. No git, no clock, no fs, so the selftest can plant
 * a violation and a control without a repository.
 *
 * `+++ b/<path>` headers set the current file, so a line under an EXCLUDED path is counted, not
 * scanned. A context line, a removal or a hunk header ends a run of added lines.
 *
 * TWO ESCAPES CLOSED (residue 2026-11-15-absence-regression-classifier-escapes), both proven at runtime:
 *  1. Any `?? null` on the line used to excuse the whole line, so `tMs: a || 0, note: b ?? null` passed,
 *     and so did `tMs: a ?? null || 0`, which still yields 0. The shape cannot match the fix, so the
 *     excuse is gone.
 *  2. A statement split over two added lines (`tMs:` on one, `x || 0` on the next) matched neither line.
 *     Each added line is now also read joined to the NEXT added line of its run. The pair counts only
 *     when neither line matches alone, so one site never counts twice.
 *
 * @param {string[]} diffLines  raw `git diff -U0` lines
 * @returns {{hits: Array<{name: string, line: string, why: string}>, scanned: number, excluded: number}}
 */
export function classifyAdded(diffLines, patterns = PATTERNS) {
  const runs = [];
  let run = null;
  let file = null;
  let excluded = 0;
  for (const l of diffLines || []) {
    if (typeof l !== 'string') {
      run = null;
      continue;
    }
    if (l.startsWith('+++')) {
      file = l.replace(/^\+\+\+ (?:b\/)?/, '');
      run = null;
      continue;
    }
    if (!l.startsWith('+')) {
      run = null;
      continue;
    }
    if (file != null && isExcluded(file)) {
      excluded += 1;
      continue;
    }
    if (!run) {
      run = [];
      runs.push(run);
    }
    /* THE FILE TRAVELS WITH THE LINE. The `+++` header is the only place a diff names it, so a hit
       that drops it leaves the ledger's `files` list to a second scan by hand. */
    run.push({ t: l.slice(1), f: file });
  }
  const hits = [];
  const cited = new Set();
  const declared = new Set();
  for (const p of patterns) {
    /* THE GENERAL PATTERN DEFERS TO THE FAMILIES. It runs last, so a line one of them already named
       sits in `hits`, and reporting it again would count one site twice and hide which rule it broke.
       A pair hit carries both its lines, so each part is keyed on its own. */
    const named = p.general ? new Set(hits.flatMap((h) => h.line.split(' \u23ce ').map((t) => `${h.file}\u0000${t.trim()}`))) : null;
    for (const r of runs) {
      for (let i = 0; i < r.length; i += 1) {
        const m = p.regex.exec(r[i].t);
        if (m) {
          const dup = p.general && named.has(`${r[i].f}\u0000${r[i].t.trim()}`);
          const mark = p.general && MARKER.test(r[i].t);
          if (isCitation(r[i].t, m)) cited.add(r[i].t.trim());
          else if (mark && !dup) declared.add(r[i].t.trim());
          else if (!dup) hits.push({ name: p.name, line: r[i].t.trim(), why: p.why, file: r[i].f });
          continue;
        }
        if (i + 1 < r.length && !p.regex.test(r[i + 1].t)) {
          const joined = `${r[i].t} ${r[i + 1].t.trim()}`;
          const jm = p.regex.exec(joined);
          if (!jm) continue;
          if (isCitation(joined, jm)) cited.add(joined.trim());
          else if (p.general && MARKER.test(joined)) declared.add(joined.trim());
          else if (!(p.general && (named.has(`${r[i].f}\u0000${r[i].t.trim()}`) || named.has(`${r[i].f}\u0000${r[i + 1].t.trim()}`))))
            hits.push({ name: p.name, line: `${r[i].t.trim()} ⏎ ${r[i + 1].t.trim()}`, why: p.why, file: r[i].f });
        }
      }
    }
  }
  return { hits, scanned: runs.reduce((n, r) => n + r.length, 0), excluded, citations: cited.size, declared: declared.size };
}

export function selftest() {
  const fail = [];
  let ran = 0;
  const ok = (c, w) => {
    ran += 1;
    if (!c) fail.push(w);
  };

  // THE PLANTED VIOLATION — the exact shape #3366 fixed: a timeless finding stamped 1970.
  const planted = classifyAdded(['+      tMs: f.stamp || 0,']);
  ok(planted.hits.length === 1 && planted.hits[0].name === 'tms-fabrication', 'a planted `tMs: x || 0` is caught');
  ok(/1970/.test(planted.hits[0]?.why ?? ''), 'the hit carries the reason, not just the line');

  /* THE CONTROL — without it this gate could flag EVERY added line and still look right on the
     plant. Three controls, because three different things could make it fire wrongly. */
  ok(classifyAdded(['+      tMs: f.stamp ?? null,']).hits.length === 0, 'CONTROL: the FIX pattern `?? null` is not a violation');
  ok(classifyAdded(['+      const fs = rec.fs || 0.5;']).hits.length === 0, 'CONTROL: an ordinary `|| 0.5` default is not a tMs fabrication');
  ok(classifyAdded(['-      tMs: f.stamp || 0,']).hits.length === 0, 'CONTROL: a REMOVED line is not an addition — the gate is diff-directional');
  ok(classifyAdded([]).hits.length === 0 && classifyAdded([]).scanned === 0, 'CONTROL: an empty diff yields no hit and reports scanning nothing');
  /* A `+++` header can itself contain a path that matches; it is not code. */
  ok(classifyAdded(['+++ b/tMs: x || 0']).scanned === 0, 'CONTROL: the +++ file header is not scanned as code');

  /* THE t0Ms FAMILY — the live CPAP shape, plus the sort-comparator shape that holds most of the backlog. */
  ok(
    classifyAdded(['+    var clockOffsetSec = ((a.t0Ms || 0) - (b.t0Ms || 0)) / 1000;']).hits.some((h) => h.name === 't0ms-fabrication'),
    'a planted `(a.t0Ms || 0)` is caught'
  );
  ok(classifyAdded(['+    const t0 = t0Ms || 0;']).hits.length === 1, 'a bare `t0Ms || 0` is caught');
  ok(classifyAdded(['+    const t0 = rec.t0Ms ?? null;']).hits.length === 0, 'CONTROL: the t0Ms FIX `?? null` is not a violation');
  ok(classifyAdded(['+    const k = rec.t0Ms || 0.5;', '+    const m = rec.t0Ms || 0x10;']).hits.length === 0, 'CONTROL: `|| 0.5` and `|| 0x10` are ordinary defaults, not an epoch');

  /* ── THE READ POSITION OF THE STAMP FAMILY, the four shapes this tree carries ──────────────────── */
  const read = classifyAdded(['+      return (a.tMs || 0) - (b.tMs || 0);']);
  ok(read.hits.length === 1 && read.hits[0].name === 'stamp-read-fabrication', 'a planted `(a.tMs || 0)` sort key is caught once');
  ok(/1970/.test(read.hits[0]?.why ?? ''), 'the read-position hit carries the reason');
  ok(classifyAdded(['+    const s = [...l].sort((a, b) => (a._tMs || 0) - (b._tMs || 0));']).hits.length === 1, 'the `_tMs` spelling is caught');
  ok(classifyAdded(['+    const s = [...l].sort((a, b) => (a.startMs || 0) - (b.startMs || 0));']).hits.length === 1, 'the `startMs` spelling is caught');
  ok(classifyAdded(['+    const t = ev.tMs || 0;']).hits.length === 1, 'a bare stamp read is caught');
  ok(classifyAdded(['+      tMs: f.stamp || 0,']).hits.length === 1, 'CONTROL: the WRITE position still counts once, and the read shape does not double it');
  ok(classifyAdded(['+    const t = ev.tMs ?? null;']).hits.length === 0, 'CONTROL: the read-position FIX `?? null` is not a violation');
  ok(classifyAdded(['+    const k = rec.tMs || 0.5;']).hits.length === 0, 'CONTROL: `|| 0.5` on a stamp read is a default, not an epoch');
  ok(classifyAdded(['+    const n = row.startMsCount || 0;'], patternsFor(true)).hits.length === 0, 'CONTROL: a longer identifier that merely contains the stamp name is no family hit');
  /* ⚠️ FOUR CONTROLS BELOW AND ABOVE NOW NAME THE FAMILY SET. The general pattern reads a tally, a
     longer identifier and a bare `b || 0` on purpose, so each of these four states what it always
     stated — that the three STAMP families do not fire — and the general block below carries the
     matching leg for the same line under the full set. */
  ok(classifyAdded(['+    const n = row.count || 0;'], patternsFor(true)).hits.length === 0, 'CONTROL: a tally is no stamp — the three stamp families read stamps, not counters');

  /* ── A CITATION IS NOT A SITE ──────────────────────────────────────────────────────────────────────
     Five lines on main name this shape in prose about a fix that already landed. Without the split,
     every one of them is a FAIL on the PR that writes it, and the gate punishes the documentation. */
  const cit = classifyAdded(['+  /* ∅ §6 — the former `(b.tMs || 0)` key read a measurement whose stamp never parsed */']);
  ok(cit.hits.length === 0 && cit.citations === 1, 'a comment quoting the shape is a CITATION, reported and not a hit');
  ok(classifyAdded(['+     their sort on `(a.tMs || 0)` instead, so an event sorted to 1970-01-01 and']).hits.length === 0, 'a block-comment body line with no `*` is read by its backtick span');
  ok(classifyAdded(['+    // `rec.t0Ms || 0` read an absent start as 1970-01-01']).hits.length === 0, 'the t0Ms family reads a citation the same way');
  ok(classifyAdded(['+      const s = `${a.tMs || 0}`;']).hits.length === 1, 'a template literal carrying `${` is a SITE, never a citation');
  ok(classifyAdded(['+      return (a.tMs || 0) - (b.tMs || 0); // the sort key']).hits.length === 1, 'a trailing comment after real code does not excuse it');
  ok(classifyAdded(['+      const q = `(a.tMs || 0);']).hits.length === 1, 'an unterminated backtick span fails closed and still counts');
  ok(classifyAdded(['+      tMs: f.stamp || 0,']).citations === 0, 'CONTROL: a plain site is never reported as a citation');
  ok(classifyAdded(['+    const t = ev.tMs || 0;']).citations === 0, 'CONTROL: a plain read is never reported as a citation');

  /* ── THE HIT NAMES ITS FILE, so the backlog ledger's file list is read from the scan ───────────── */
  const named = classifyAdded(['+++ b/cpapdex-fusion.js', '+      return (a.tMs || 0) - (b.tMs || 0);']);
  ok(named.hits.length === 1 && named.hits[0].file === 'cpapdex-fusion.js', 'a hit carries the file its line came from');
  const noHdr = classifyAdded(['+      tMs: f.stamp || 0,']);
  ok(noHdr.hits.length === 1 && noHdr.hits[0]?.file === null, 'CONTROL: a diff with no +++ header names no file, and says so with null');

  /* THE TWO CLASSIFIER ESCAPES, each planted in the shape the audit proved at runtime. */
  ok(classifyAdded(['+      tMs: f.stamp || 0, note: g ?? null,']).hits.length === 1, 'ESCAPE 1: a `?? null` elsewhere on the line no longer excuses the fabrication');
  ok(classifyAdded(['+      tMs: f.stamp ?? null || 0,']).hits.length === 1, 'ESCAPE 1: `?? null || 0` still yields 0 and is caught');
  const split = classifyAdded(['+      tMs:', '+        f.stamp || 0,']);
  ok(split.hits.length === 1 && /⏎/.test(split.hits[0].line), 'ESCAPE 2: a statement split over two added lines is caught once, and the hit shows both lines');
  ok(classifyAdded(['+      tMs: f.stamp || 0,', '+      other: 1,']).hits.length === 1, 'CONTROL: a site that matches alone is not counted again as a pair');
  ok(
    classifyAdded(['+      tMs:', ' context line', '+        f.stamp || 0,'], patternsFor(true)).hits.length === 0,
    'CONTROL: a context line ends the run, so the families never join lines from two places'
  );
  ok(classifyAdded(['+      tMs: a,', '+        b || 0,'], patternsFor(true)).hits.length === 0, 'CONTROL: a comma between the two lines ends the expression the families read');

  /* THE DISCLOSED EXCLUSION — counted, not silently dropped. */
  const ex = classifyAdded(['+++ b/tests/dex-tests.js', '+      tMs: f.stamp || 0,', '+++ b/oxydex-dsp.js', '+      x: 1,']);
  ok(ex.hits.length === 0 && ex.excluded === 1 && ex.scanned === 1, 'an added line under tests/ is counted as EXCLUDED, not scanned and not lost');
  ok(
    EXCLUDED_PATHS.every((e) => typeof e.why === 'string' && e.why.length > 0),
    'every excluded path carries its reason'
  );

  /* ── THE TWO TREES THE PATHSPEC OMITTED (residue 2026-11-19-the-absence-gate-diff-omits-mjs-and-python).
     An exclusion list cannot declare a tree the diff never carries, so each leg below plants a line
     the old pathspec never produced. Every planted line WOULD hit if the classifier scanned it, so an
     exclusion leg reads the exclusion and not an absent pattern. ── */
  ok(DIFF_PATHSPEC.includes("'*.mjs'"), 'the diff pathspec names `*.mjs`, so the 389-file tools tree reaches the classifier');
  ok(DIFF_PATHSPEC.includes("'*.py'"), 'the diff pathspec names `*.py`, so the Python tree can be COUNTED as excluded');
  ok(
    EXCLUDED_PATHS.some((e) => e.match === 'suffix' && e.path === '*.py'),
    'the Python tree is declared, not silently absent, because the pathspec alone would make it a FAIL in a language this classifier cannot read'
  );
  const mjs = classifyAdded(['+++ b/tools/pr-walker.mjs', '+      updatedAtMs: pr.updatedAtMs || 0,']);
  ok(mjs.hits.length === 1 && mjs.excluded === 0, 'an added line in a `.mjs` tool is SCANNED, not excluded');
  const py = classifyAdded(['+++ b/capture-host/stream.py', '+    stamp = rec.t0Ms || 0']);
  ok(py.hits.length === 0 && py.excluded === 1, 'an added `.py` line is counted as EXCLUDED with its reason, not dropped');
  const selfPlant = classifyAdded(['+++ b/tools/absence-regression.mjs', '+      tMs: f.stamp || 0,']);
  ok(selfPlant.hits.length === 0 && selfPlant.excluded === 1, "a plant in the gate's own file is counted as EXCLUDED, not reported as a fabrication");
  const notPy = classifyAdded(['+++ b/tools/copy.js', '+      tMs: f.stamp || 0,']);
  ok(notPy.hits.length === 1 && notPy.excluded === 0, 'CONTROL: the suffix rule reads the extension, so `copy.js` stays scanned');
  const sibling = classifyAdded(['+++ b/tools/pr-walker.mjs', '+      tMs: f.stamp || 0,']);
  ok(sibling.hits.length === 1, 'CONTROL: the gate excludes its OWN file by exact path, so another tool in the same directory is scanned');

  /* ── THE GENERAL SPELLING (residue 2026-11-15-absence-gates-skip-the-or-zero-spelling) ───────────
     MEASURED BEFORE IT WAS WRITTEN. Over the 80 first-parent merges of main at be2a0d1bb this
     classifier read 1,499 added lines inside the gate's population, and ONE was a code `|| 0`:
     `ppgdex-app.js` renders an absent magnetometer count as `0 samples`. A rule that fires once in 80
     merges is affordable on the diff; the same rule over the whole tree reads 487 lines. */
  const gen = classifyAdded(['+++ b/ppgdex-app.js', '+      ${(m.nMag || 0).toLocaleString()} samples']);
  ok(gen.hits.length === 1 && gen.hits[0].name === 'or-zero-fabrication', 'the live `nMag || 0` render site is caught');
  ok(gen.hits[0]?.file === 'ppgdex-app.js', 'the general hit names its file, as the family hits do');
  ok(classifyAdded(['+    const n = row.count || 0;']).hits.length === 1, 'an undeclared tally is a hit, because a tally and an absence spell the zero the same way');
  ok(classifyAdded(['+    const n = row.startMsCount || 0;']).hits.length === 1, 'the longer identifier the families skip is read by the general pattern');
  ok(classifyAdded(['+      tMs: a,', '+        b || 0,']).hits.length === 1, 'the bare `b || 0` the families skip is read by the general pattern');
  ok(classifyAdded(['+      tMs:', ' context line', '+        f.stamp || 0,']).hits.length === 1, 'and so is the added line after a context break');
  ok(classifyAdded(['+    const n = row.count || 0; // absence-ok: tally — an absent key counted no events']).hits.length === 0, 'CONTROL: a declared legal zero is not a hit');
  ok(classifyAdded(['+    const n = row.count || 0; // absence-ok: tally']).declared === 1, 'and the declaration is COUNTED, so silencing this gate stays visible');
  ok(classifyAdded(['+    const n = row.count || 0; // absence-ok:']).hits.length === 1, 'CONTROL: a declaration with no reason declares nothing');
  ok(classifyAdded(['+      tMs: f.stamp || 0, // absence-ok: tally']).hits.length === 1, 'CONTROL: a declaration never excuses a STAMP family hit');
  ok(classifyAdded(['+      tMs: f.stamp || 0,']).hits.length === 1, 'CONTROL: a stamp write counts ONCE — the general pattern defers to its family');
  ok(classifyAdded(['+      return (a.tMs || 0) - (b.tMs || 0);']).hits.length === 1, 'CONTROL: a stamp read counts once under both patterns');
  ok(classifyAdded(['+      tMs:', '+        f.stamp || 0,']).hits.length === 1, 'CONTROL: a SPLIT stamp site counts once, and not again as a general hit on its second line');
  ok(classifyAdded(['+    const fs = rec.fs || 0.5;']).hits.length === 0, 'CONTROL: `|| 0.5` is a default, not a zero');
  ok(classifyAdded(['+    const m = rec.n || 0x10;']).hits.length === 0, 'CONTROL: `|| 0x10` is a default, not a zero');
  ok(classifyAdded(['+    const n = row.count ?? 0;']).hits.length === 0, 'CONTROL: `?? 0` answers to no-nullish-zero.yml, not to this gate');
  ok(classifyAdded(['+  // `row.count || 0` was the shape that PR removed']).hits.length === 0, 'CONTROL: prose quoting the general shape is a citation');
  ok(
    patternsFor(true).every((p) => !p.general),
    'the ratchet set holds no general pattern'
  );
  ok(patternsFor(false).some((p) => p.general) && patternsFor(true).length === PATTERNS.length - 1, 'the diff set holds it, and the two sets differ by exactly that one pattern');
  ok(classifyAdded(['+    const n = row.count || 0;'], patternsFor(true)).hits.length === 0, 'CONTROL: the ratchet set reads the same tally and does not fire');

  /* ── THE SHRINK-ONLY RATCHET ──────────────────────────────────────────────────────────────────────
     Four states, and the one that matters most is the THIRD: a count that FELL must not quietly pass,
     or the baseline stays at its seeded value forever and the ratchet stops being one. */
  ok(ratchet(5, null).status === 'NOT_RUN', 'no baseline yet ⇒ NOT_RUN, never a pass over an unrecorded number');
  ok(ratchet(6, { count: 5 }).status === 'FAIL', 'a count ABOVE the baseline fails — something was merged unexamined');
  ok(ratchet(4, { count: 5 }).status === 'SHORTFALL', 'a count BELOW the baseline is a SHORTFALL asking for the baseline to be lowered');
  ok(ratchet(5, { count: 5 }).status === 'PASS', 'an unchanged count passes');
  ok(/lower the baseline/.test(ratchet(4, { count: 5 }).reason || ''), '…and says what to do about it');
  ok(ratchet(0, { count: 0 }).status === 'PASS', 'a cleared backlog passes at zero');

  /* ── THE THREE CLAIMS A GREEN CAN CARRY ──────────────────────────────────────────────
     Every leg here passes on the old single `NOT_RUN`, so each is sized against the mutant that
     collapses two statuses back into one. The REFUSAL leg bites hardest: it is the only case where
     exit 0 was a lie. */
  const CR = (o) => classifyRun({ captureWhy: null, rangeFiles: 0, scanned: 0, hitCount: 0, base: 'B', head: 'H', ...o });
  ok(CR({ scanned: 9, hitCount: 2 }).status === 'FAIL', 'a hit is FAIL whatever the range held');
  ok(CR({ scanned: 9 }).status === 'PASS', '9 scanned lines and no hit is a PASS — the only green that is evidence');
  ok(CR({ rangeFiles: 4 }).status === 'NOT_APPLICABLE', 'a change touching 4 files and no scannable line is NOT_APPLICABLE, not NOT_RUN');
  ok(/4 file\(s\)/.test(CR({ rangeFiles: 4 }).reason || ''), '…and the reason names the population it examined');
  ok(CR({}).status === 'NOT_RUN', 'an empty range examined nothing, so it stays NOT_RUN');
  ok(/no file/.test(CR({}).reason || ''), '…and says the population was empty by construction, not that a rule held');
  ok(CR({ captureWhy: 'git refused' }).status === 'NOT_RUN' && CR({ captureWhy: 'git refused' }).couldNotLook === true, 'a refused capture is NOT_RUN and reports that it could not look');
  ok(CR({ rangeFiles: 9 }).couldNotLook === false && CR({}).couldNotLook === false, 'CONTROL: neither a non-binding change nor an empty range claims it could not look');
  ok(CR({ captureWhy: 'git refused', rangeFiles: 7, scanned: 3, hitCount: 5 }).status === 'NOT_RUN', 'the refusal outranks every count, because a refused capture reports 0 of everything');
  ok(exitFor('FAIL', false) === 1, 'FAIL exits 1 — it looked and a rule failed');
  ok(exitFor('NOT_RUN', true) === 2, 'a gate that could not look exits 2, never 0');
  ok(exitFor('NOT_RUN', false) === 0, 'an empty range is not a refusal, so it keeps 0 and a clean tree still passes `npm run check`');
  ok(exitFor('NOT_APPLICABLE', false) === 0 && exitFor('PASS', false) === 0, 'CONTROL: the two legitimate greens exit 0');
  ok(exitFor('FAIL', true) === 1, 'CONTROL: FAIL outranks the refusal code, so a real violation is never reported as unexaminable');

  const line = fail.length ? `absence-regression selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
}

/* THE EMPTY TREE — `git diff <empty>..HEAD` presents every tracked file as added, so this diff-scoped
   scanner becomes a whole-tree one with the SAME classifier. Code merged before a diff gate existed is
   otherwise never examined by it: the backlog is invisible by construction, not by neglect. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
export const BACKLOG_LEDGER = 'audits/FULL-TREE-BACKLOG.json';

/* ⚠️ maxBuffer EXPLICITLY. Node's 1 MiB default killed the first full-tree run of the sibling gate with
   `spawnSync ENOBUFS` on a 5.9 MiB diff — the same defect that made `verify-fixtures` report a passing
   suite as RED this morning. A refused capture is not a clean scan. */
function sh(cmd) {
  try {
    return { ok: true, out: execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).trim(), why: null };
  } catch (e) {
    /* ∅ A REFUSED CAPTURE IS NOT AN EMPTY DIFF. `git diff` without `--exit-code` exits 0 whenever it
       produced a diff, so a non-zero status here is a refusal: an unreachable base, a broken index, an
       ENOBUFS capture. The old branch mapped status 1 to an empty string, which then read as NOT_RUN
       with the reason `0 added lines`, and the gate exited 0 over a scan it never made. */
    const code = e.status == null ? (e.code ? String(e.code) : 'no code') : String(e.status);
    return { ok: false, out: '', why: `the capture was refused — \`${cmd.slice(0, 72)}\` exited ${code}, so no line was examined` };
  }
}

export function readBacklog(file, gate, readFn) {
  try {
    const d = JSON.parse(readFn(file));
    const e = d && d.gates && d.gates[gate];
    return e && typeof e.count === 'number' ? e : null;
  } catch {
    return null;
  }
}

/** Judge a full-tree count against the shrink-only ledger. Pure, so the selftest can plant each case. */
export function ratchet(count, baseline) {
  if (baseline == null) return { status: 'NOT_RUN', reason: `no baseline recorded for this gate yet — seed ${BACKLOG_LEDGER} with the measured count (${count}) and the paths` };
  if (count > baseline.count) return { status: 'FAIL', reason: `full-tree backlog ROSE: ${count} > baseline ${baseline.count}` };
  if (count < baseline.count)
    return { status: 'SHORTFALL', reason: `backlog FELL to ${count} from ${baseline.count} — lower the baseline in ${BACKLOG_LEDGER}; a ratchet that is not tightened stops being one` };
  return { status: 'PASS', reason: null };
}

/**
 * PURE CORE — the status a diff-mode run earns, and whether the gate could look at all.
 *
 * Three populations used to collapse into one `NOT_RUN` that exited 0, so no consumer could tell an
 * empty question from an examined change. §🧾 splits them: `NOT_RUN` examined nothing, and
 * `NOT_APPLICABLE` examined and the rule does not bind. A docs-only diff is the second, and it is the
 * case the check lane meets on nearly every PR.
 *
 * @param {{captureWhy: string|null, rangeFiles: number, scanned: number, hitCount: number, base: string, head: string}} o
 * @returns {{status: string, reason: string|null, couldNotLook: boolean}}
 */
export function classifyRun({ captureWhy, rangeFiles, scanned, hitCount, base, head }) {
  /* The refusal outranks every count, because a refused capture reports 0 of everything. */
  if (captureWhy) return { status: 'NOT_RUN', reason: captureWhy, couldNotLook: true };
  if (hitCount) return { status: 'FAIL', reason: `${hitCount} added line(s) fabricate an absent value`, couldNotLook: false };
  if (scanned) return { status: 'PASS', reason: null, couldNotLook: false };
  if (rangeFiles) return { status: 'NOT_APPLICABLE', reason: `the range ${base}..${head} changed ${rangeFiles} file(s) and the rule reads no added line in them`, couldNotLook: false };
  return { status: 'NOT_RUN', reason: `the range ${base}..${head} changed no file, so the population is empty by construction`, couldNotLook: false };
}

/**
 * PURE — the exit code a status earns. The exit code is the ONLY consumer that acts: `run-check.mjs`
 * reads every step by its code, because its `childVerdict` hook is supplied by no real run. So a
 * status the code cannot carry reaches nobody. §4c: 2 says the gate could not look, 1 that it looked
 * and a rule failed. An empty diff range is not a refusal, so it keeps 0.
 *
 * @param {string} status
 * @param {boolean} couldNotLook
 * @returns {number}
 */
export function exitFor(status, couldNotLook) {
  if (status === 'FAIL') return 1;
  return couldNotLook ? 2 : 0;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    const r = selftest();
    process.stdout.write(`${r.line}\n`);
    for (const f of r.fail) process.stdout.write(`  ✕ ${f}\n`);
    process.exit(r.ok ? 0 : 1);
  }
  const asJson = argv.includes('--json');
  /* --full-tree IS THE RATCHET, AND IT NOW RUNS (residue 2026-11-15-absence-regression-full-tree-ratchet-never-runs).
     The note here once read "never a PR gate", and nothing ran it anywhere, so the backlog count was a
     number nobody read. A scan judged against the shrink-only baseline cannot report an inherited
     backlog as a PR's finding: the inherited count EQUALS the baseline and passes. It fails only when
     the tree holds MORE fabrications than the ledger records, which is a regression whichever diff
     carried it, including one the diff-scoped scan cannot see. `verify:absence-backlog` runs it in
     `npm run check` and in CI. It reads in under a second. */
  const fullTree = argv.includes('--full-tree');
  const baseIdx = process.argv.indexOf('--base');
  const base = fullTree ? EMPTY_TREE : baseIdx >= 0 ? process.argv[baseIdx + 1] : 'HEAD';
  const head = 'HEAD';

  /* No `:!tests/` pathspec: the classifier skips EXCLUDED_PATHS itself, so it can COUNT what it skips.
     The pathspec names `'*.mjs'` and `'*.py'` so that both trees reach that classifier at all. An
     exclusion list cannot declare a tree the diff never carries, and for `.mjs` there was nothing to
     declare: it belongs in the scan (residue 2026-11-19-the-absence-gate-diff-omits-mjs-and-python). */
  const cap = sh(`git diff ${base}..${head} -U0 -- ${DIFF_PATHSPEC.join(' ')}`);
  const diff = cap.out;
  /* THE RANGE, WITH NO PATHSPEC. It separates a change that touches no code from the absence of any
     change, and those two earn different statuses. One `git diff --name-only` is the whole cost. */
  const rangeCap = cap.ok ? sh(`git diff --name-only ${base}..${head}`) : { ok: false, out: '', why: cap.why };
  const rangeFiles = rangeCap.out ? rangeCap.out.split('\n').filter(Boolean).length : 0;
  /* THE PATTERN SET IS THE MODE. The general `|| 0` spelling reads 487 lines of this tree, so the
     shrink-only ratchet would carry a backlog nobody can move; it runs on the DIFF alone. */
  const patterns = patternsFor(fullTree);
  const { hits, scanned, excluded, citations, declared } = classifyAdded(diff.split('\n'), patterns);

  if (fullTree) {
    const baseline = readBacklog(join(ROOT, BACKLOG_LEDGER), 'absence-regression', (f) => readFileSync(f, 'utf-8'));
    /* A refused capture counts zero fabrications, which the ratchet reads as a FALL and prints as a
       SHORTFALL asking for the baseline to be LOWERED. It must never reach the ratchet. */
    const r = cap.ok ? ratchet(hits.length, baseline) : { status: 'NOT_RUN', reason: cap.why };
    const couldNotLook = !cap.ok || r.status === 'NOT_RUN';
    if (asJson) {
      process.stdout.write(
        `${JSON.stringify(verdictOf({ status: r.status, scanned, excluded, citations, declared, patternNames: patterns.map((p) => p.name), hits, base, fullTree: true, baseline, reason: r.reason }), null, 1)}\n`
      );
    } else {
      process.stdout.write(
        `absence-regression --full-tree · ${scanned} line(s) scanned · ${excluded} under ${EXCLUDED_PATHS.map((e) => e.path).join(', ')} not scanned · ${citations} citation(s) of the shape · ${hits.length} fabrication(s)\n`
      );
      for (const h of hits) process.stdout.write(`    ${h.name}: ${h.file ?? '(no file named)'} — ${h.line.slice(0, 96)}\n`);
      const byFile = [...new Set(hits.map((h) => h.file).filter(Boolean))].sort();
      process.stdout.write(`  files: ${byFile.length} — ${byFile.join(' ')}\n`);
      process.stdout.write(`  baseline: ${baseline ? baseline.count : '(none yet)'} → ${r.status}${r.reason ? ` — ${r.reason}` : ''}\n`);
      process.stdout.write(`  patterns: ${patterns.map((p) => p.name).join(' ')} — the general spelling is diff-only, so this ratchet never reads it\n`);
    }
    process.exit(exitFor(r.status, couldNotLook));
  }

  /* THREE CLAIMS, NOT ONE. "No added line broke the rule", "this change holds no line the rule reads"
     and "there was no change" are different claims, and only the first is evidence. `--base HEAD` (the
     pre-push default) is the third. `classifyRun` keeps them apart and names the one that left the
     gate unable to look. */
  const cls = classifyRun({ captureWhy: cap.ok ? null : cap.why, rangeFiles, scanned, hitCount: hits.length, base, head });
  const status = cls.status;
  if (asJson) {
    process.stdout.write(`${JSON.stringify(verdictOf({ status, scanned, excluded, citations, declared, patternNames: patterns.map((p) => p.name), hits, base, reason: cls.reason }), null, 1)}\n`);
  } else {
    for (const p of patterns) {
      const n = hits.filter((h) => h.name === p.name).length;
      if (n) {
        process.stderr.write(`✕ ${p.name}: ${n} new instance(s) — ${p.why}\n`);
        for (const h of hits.filter((x) => x.name === p.name).slice(0, 5)) process.stderr.write(`    ${h.line}\n`);
      } else {
        process.stdout.write(`✓ ${p.name}\n`);
      }
    }
    if (status === 'NOT_RUN' || status === 'NOT_APPLICABLE')
      process.stdout.write(
        `absence-regression: ${status} — ${cls.reason}; 0 added lines in ${base}..${head} outside ${EXCLUDED_PATHS.map((e) => e.path).join(', ')} (${excluded} there, not scanned)\n`
      );
    else if (status === 'FAIL') process.stderr.write('\nabsence-regression: FAIL — new absence-fabrication patterns introduced\n');
    else
      process.stdout.write(
        `absence-regression: ✓ PASS — ${scanned} added line(s) examined, ${excluded} under ${EXCLUDED_PATHS.map((e) => e.path).join(', ')} not scanned, ${citations} naming the shape in prose, no new fabrication pattern\n`
      );
    if (declared) process.stdout.write(`  ${declared} added line(s) declared a legal zero with absence-ok — the gate counts every declaration, so silencing it stays visible\n`);
  }
  process.exit(exitFor(status, cls.couldNotLook));
}

/* THE CLI RUNS ONLY WHEN THIS FILE IS THE ENTRY POINT. The header calls `classifyAdded` a pure core
   "so the selftest can plant a violation and a control without a repository", and until this guard an
   `import` of it ran `main()` and exited before the importer's first line. The idiom is the one
   `tools/argv-reads.mjs` already models, and the predicate is the house one.
   A raw `import.meta.url === pathToFileURL(process.argv[1]).href` is WRONG through a symlink, because
   node resolves the entry and leaves `process.argv[1]` as written, so a tool reached through a linked
   directory reads as imported and exits 0 having done nothing. The suite group "the CLI predicate
   survives a symlink to the tool" refuses that spelling across the whole tools tree, and `isCliEntry`
   answers on both that form and `--preserve-symlinks-main`, which realpath alone gets wrong. */
if (isCliEntry(import.meta.url)) main();

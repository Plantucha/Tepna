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

function verdictOf({ status, scanned, excluded = 0, citations = 0, hits, base, fullTree, baseline, reason = null }) {
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
  }
];

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
   exclusion in the dark. */
export const EXCLUDED_PATHS = [{ path: 'tests/', why: 'the suite plants the fabricated shape on purpose, as a fixture' }];
const isExcluded = (file) => EXCLUDED_PATHS.some((e) => file.startsWith(e.path));

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
  for (const p of patterns) {
    for (const r of runs) {
      for (let i = 0; i < r.length; i += 1) {
        const m = p.regex.exec(r[i].t);
        if (m) {
          if (isCitation(r[i].t, m)) cited.add(r[i].t.trim());
          else hits.push({ name: p.name, line: r[i].t.trim(), why: p.why, file: r[i].f });
          continue;
        }
        if (i + 1 < r.length && !p.regex.test(r[i + 1].t)) {
          const joined = `${r[i].t} ${r[i + 1].t.trim()}`;
          const jm = p.regex.exec(joined);
          if (!jm) continue;
          if (isCitation(joined, jm)) cited.add(joined.trim());
          else hits.push({ name: p.name, line: `${r[i].t.trim()} ⏎ ${r[i + 1].t.trim()}`, why: p.why, file: r[i].f });
        }
      }
    }
  }
  return { hits, scanned: runs.reduce((n, r) => n + r.length, 0), excluded, citations: cited.size };
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
  ok(classifyAdded(['+    const n = row.startMsCount || 0;']).hits.length === 0, 'CONTROL: a longer identifier that merely contains the name is not a hit');
  ok(classifyAdded(['+    const n = row.count || 0;']).hits.length === 0, 'CONTROL: a tally keeps its zero — this gate reads stamps, not counters');

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
  ok(classifyAdded(['+      tMs:', ' context line', '+        f.stamp || 0,']).hits.length === 0, 'CONTROL: a context line ends the run, so lines from two places are never joined');
  ok(classifyAdded(['+      tMs: a,', '+        b || 0,']).hits.length === 0, 'CONTROL: a comma between the two lines ends the expression');

  /* THE DISCLOSED EXCLUSION — counted, not silently dropped. */
  const ex = classifyAdded(['+++ b/tests/dex-tests.js', '+      tMs: f.stamp || 0,', '+++ b/oxydex-dsp.js', '+      x: 1,']);
  ok(ex.hits.length === 0 && ex.excluded === 1 && ex.scanned === 1, 'an added line under tests/ is counted as EXCLUDED, not scanned and not lost');
  ok(
    EXCLUDED_PATHS.every((e) => typeof e.why === 'string' && e.why.length > 0),
    'every excluded path carries its reason'
  );

  /* ── THE SHRINK-ONLY RATCHET ──────────────────────────────────────────────────────────────────────
     Four states, and the one that matters most is the THIRD: a count that FELL must not quietly pass,
     or the baseline stays at its seeded value forever and the ratchet stops being one. */
  ok(ratchet(5, null).status === 'NOT_RUN', 'no baseline yet ⇒ NOT_RUN, never a pass over an unrecorded number');
  ok(ratchet(6, { count: 5 }).status === 'FAIL', 'a count ABOVE the baseline fails — something was merged unexamined');
  ok(ratchet(4, { count: 5 }).status === 'SHORTFALL', 'a count BELOW the baseline is a SHORTFALL asking for the baseline to be lowered');
  ok(ratchet(5, { count: 5 }).status === 'PASS', 'an unchanged count passes');
  ok(/lower the baseline/.test(ratchet(4, { count: 5 }).reason || ''), '…and says what to do about it');
  ok(ratchet(0, { count: 0 }).status === 'PASS', 'a cleared backlog passes at zero');

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
    return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).trim();
  } catch (e) {
    if (e.status === 1) return ''; // no matches
    throw e;
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

  /* No `:!tests/` pathspec: the classifier skips EXCLUDED_PATHS itself, so it can COUNT what it skips. */
  const diff = sh(`git diff ${base}..${head} -U0 -- '*.js' '*.src.html'`);
  const { hits, scanned, excluded, citations } = classifyAdded(diff.split('\n'));

  if (fullTree) {
    const baseline = readBacklog(join(ROOT, BACKLOG_LEDGER), 'absence-regression', (f) => readFileSync(f, 'utf-8'));
    const r = ratchet(hits.length, baseline);
    if (asJson) {
      process.stdout.write(`${JSON.stringify(verdictOf({ status: r.status, scanned, excluded, citations, hits, base, fullTree: true, baseline, reason: r.reason }), null, 1)}\n`);
    } else {
      process.stdout.write(
        `absence-regression --full-tree · ${scanned} line(s) scanned · ${excluded} under ${EXCLUDED_PATHS.map((e) => e.path).join(', ')} not scanned · ${citations} citation(s) of the shape · ${hits.length} fabrication(s)\n`
      );
      for (const h of hits) process.stdout.write(`    ${h.name}: ${h.file ?? '(no file named)'} — ${h.line.slice(0, 96)}\n`);
      const byFile = [...new Set(hits.map((h) => h.file).filter(Boolean))].sort();
      process.stdout.write(`  files: ${byFile.length} — ${byFile.join(' ')}\n`);
      process.stdout.write(`  baseline: ${baseline ? baseline.count : '(none yet)'} → ${r.status}${r.reason ? ` — ${r.reason}` : ''}\n`);
    }
    process.exit(r.status === 'FAIL' ? 1 : 0);
  }

  /* NOT_RUN vs PASS. `--base HEAD` (the pre-push default) diffs nothing, so a green there is a pass
     over an EMPTY population — the examined-nothing shape. It is reported as NOT_RUN rather than
     PASS, because "no added line broke the rule" and "there were no added lines" are different
     claims and only one of them is evidence. */
  const status = scanned === 0 ? 'NOT_RUN' : hits.length ? 'FAIL' : 'PASS';
  if (asJson) {
    process.stdout.write(`${JSON.stringify(verdictOf({ status, scanned, excluded, citations, hits, base }), null, 1)}\n`);
  } else {
    for (const p of PATTERNS) {
      const n = hits.filter((h) => h.name === p.name).length;
      if (n) {
        process.stderr.write(`✕ ${p.name}: ${n} new instance(s) — ${p.why}\n`);
        for (const h of hits.filter((x) => x.name === p.name).slice(0, 5)) process.stderr.write(`    ${h.line}\n`);
      } else {
        process.stdout.write(`✓ ${p.name}\n`);
      }
    }
    if (status === 'NOT_RUN')
      process.stdout.write(
        `absence-regression: NOT_RUN — 0 added lines in ${base}..${head} outside ${EXCLUDED_PATHS.map((e) => e.path).join(', ')} (${excluded} there, not scanned), so nothing was examined\n`
      );
    else if (status === 'FAIL') process.stderr.write('\nabsence-regression: FAIL — new absence-fabrication patterns introduced\n');
    else
      process.stdout.write(
        `absence-regression: ✓ PASS — ${scanned} added line(s) examined, ${excluded} under ${EXCLUDED_PATHS.map((e) => e.path).join(', ')} not scanned, ${citations} naming the shape in prose, no new fabrication pattern\n`
      );
  }
  process.exit(status === 'FAIL' ? 1 : 0);
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

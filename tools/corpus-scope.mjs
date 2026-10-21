#!/usr/bin/env node
// Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
//
// corpus-scope.mjs — count a file pattern across EVERY corpus root, and say which roots were searched.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS: AN ABSENCE MEASURED OVER THE WRONG SCOPE READS EXACTLY LIKE AN ABSENCE MEASURED
// OVER THE RIGHT ONE. Residue `2026-09-05-triage-stamps-searched-the-repo-tree-only`: two triage
// stamps merged to main asserting this machine held "**zero** `_ECG.txt`" and "only **2** `_PPG.txt`".
// Measured under /srv/data/tepna-corpus the same week: **1131 `_ECG.txt`** and **8760 `_PPG.txt`
// (5633 Verity)**. Both had counted only the repo's `uploads/` tree, where the raw corpus never lives
// — the same error twice in one pass, and the second one shipped. It licensed a "blocked on data
// locality" verdict that stopped work on FOUR briefs.
//
// The defect is not "a wrong number". A `0` from the wrong root is indistinguishable, on the page,
// from a `0` from the right one — so the bar is the negation of that: **a count that does not name the
// roots it searched, and does not distinguish "0 files here" from "this root is not on this machine",
// is not a count.** Both halves are printed, always.
//
// ⚠️ THE EXISTING HELPER DOES NOT COVER THIS, and that is worth knowing before reaching for it:
// `corpusSearch()` in tools/regen-goldens-core.mjs resolves $DEX_UPLOADS -> the primary checkout's
// `uploads/` -> this checkout's. Every candidate it has is an `uploads/` tree, which is the exact
// scope the 09-01 stamps searched. It is correct for its job (finding the fixture corpus) and wrong
// for "is there any ECG data on this machine".
//
// Roots come from docs/CORPUS-LOCATIONS.md, parsed, so the doc stays the single source. A row whose
// path is elided (`/run/media/…/Ecg nightly`) or remote (`vigil:/srv/tepna/captures`) is reported as
// NOT COUNTABLE HERE by name — never silently dropped, because a dropped root is how the scope
// narrowed in the first place.
//
// Usage:
//   node tools/corpus-scope.mjs '*_ECG.txt'
//   node tools/corpus-scope.mjs '*Verity*_PPG.txt' --json
//   node tools/corpus-scope.mjs --selftest
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { positionalArgs, refuseUnknownArgvOrExit } from './argv-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
export const DOC = 'docs/CORPUS-LOCATIONS.md';

/* A root that cannot be counted from this machine is NOT a zero (§∅). Three reasons, each named:
     'elided'   the doc writes a placeholder (…) instead of a path — a human-readable row, not a path
     'remote'   `host:/path` — reachable over ssh, not by this process
     'absent'   a real absolute path that is not on this filesystem
   Only 'absent' is a fact about THIS machine; the first two are facts about the row. */
export function classifyRoot(raw) {
  const p = String(raw).trim();
  if (/[…]/.test(p) || /<[^>]+>/.test(p)) return { path: p, countable: false, why: 'elided' };
  if (/^[A-Za-z0-9_.-]+:\//.test(p)) return { path: p, countable: false, why: 'remote' };
  if (!p.startsWith('/')) return { path: p, countable: false, why: 'not-absolute' };
  return { path: p, countable: true, why: null };
}

/** Pull every backticked absolute-looking path that opens a table row out of the doc. PURE. */
export function parseRoots(docText) {
  const out = [];
  for (const line of String(docText).split('\n')) {
    const m = /^\|\s*\*{0,2}`([^`]+)`\*{0,2}\s*\|/.exec(line);
    if (!m) continue;
    const p = m[1].trim();
    // a row whose first cell is a repo file (tools/x.mjs) is documentation, not a corpus root
    if (!/^[/<]|^[A-Za-z0-9_.-]+:\//.test(p)) continue;
    if (out.some((r) => r.path === p)) continue;
    out.push(classifyRoot(p));
  }
  return out;
}

/** Count files matching `pattern` under one root. Returns null — never 0 — when the root is not a
 *  directory here, because "not on this machine" and "empty" are different facts (§∅). */
export function countUnder(root, pattern) {
  try {
    if (!statSync(root).isDirectory()) return null;
  } catch {
    return null;
  }
  try {
    const out = execFileSync('find', ['-L', root, '-name', pattern, '-type', 'f'], { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter(Boolean).length;
  } catch (e) {
    // `find` exits non-zero on an unreadable subtree while still printing what it saw
    const printed = String(e.stdout || '')
      .split('\n')
      .filter(Boolean).length;
    return printed || null;
  }
}

/* ⚠️ THE DOC LISTS THE SAME TREE TWICE, AND SUMMING ROOTS DOUBLE-COUNTS IT. Measured on this tool's
   first real run: `/home/michal/tepna-smoketest/captures` and `/srv/data/tepna-corpus/smoketest-captures/`
   both reported 554 `_ECG.txt` — one is a symlink to the other, and the total read 1761 when the true
   figure is 1207. That is this tool's own failure class one level up: a number whose scope is not
   stated, where the unstated part is that two of the scopes are the same scope. So roots are resolved
   to their real path and a root that IS another, or sits INSIDE another, is reported and NOT summed.
   PURE given the resolver, which is injected so the rule is testable without a filesystem. */
export function dedupeRoots(rows, resolver) {
  const seen = [];
  return rows.map((r) => {
    if (r.count === null) return r;
    let real;
    try {
      real = resolver(r.root);
    } catch {
      real = r.root;
    }
    const same = seen.find((s) => s.real === real);
    if (same) return { ...r, count: r.count, counted: false, why: `alias-of ${same.root}` };
    const inside = seen.find((s) => real.startsWith(s.real.endsWith('/') ? s.real : s.real + '/'));
    if (inside) return { ...r, counted: false, why: `nested-in ${inside.root}` };
    seen.push({ root: r.root, real });
    return { ...r, counted: true };
  });
}

/** The census as ONE tepna.verdict/1 object. `population` is ROOTS: checked = roots counted here,
 *  excluded = roots this machine cannot count (elided · remote · absent), and the equality is what
 *  makes a narrowed scope visible instead of invisible. */
export function censusVerdict(pattern, rows, { commit = null } = {}) {
  const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
  const counted = rows.filter((r) => r.count !== null);
  /* A root that aliases another is COUNTED but not SUMMED — it is still shown, because hiding it
     would make the scope smaller than the doc says it is. */
  const summed = counted.filter((r) => r.counted !== false);
  const total = summed.reduce((a, r) => a + r.count, 0);
  const excluded = rows.length - counted.length;
  let status;
  let reason;
  if (rows.length === 0) {
    status = 'NOT_RUN';
    reason = `${DOC} listed no corpus roots — the doc could not be parsed`;
  } else if (counted.length === 0) {
    status = 'UNDERPOWERED';
    reason = `none of the ${rows.length} documented root(s) is countable from this machine, so this run cannot distinguish absence from unreachability`;
  } else if (total === 0) {
    status = 'PASS';
    reason = null; // a real zero, over a named scope — the only kind worth quoting
  } else {
    status = 'PASS';
    reason = null;
  }
  const v = Verdict.make({
    gate: 'corpus-scope',
    status,
    scope: 'internal',
    population: { checked: counted.length, eligible: rows.length, excluded },
    criterion: { name: 'documented_roots_counted', threshold: rows.length, unit: '', direction: 'eq' },
    result: status === 'NOT_RUN' ? null : { pattern, files: total, summedRoots: summed.length, byRoot: rows },
    evidence: ['tools/corpus-scope.mjs', DOC],
    reason,
    producedBy: { tool: 'tools/corpus-scope.mjs', commit, ...(commit ? {} : { commitReason: 'not read from a git tree' }) }
  });
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`corpus-scope: verdict invalid under verdict.js — ${chk.errors.join(' | ')}`);
  return v;
}

/* ── POPULATION STABILITY — a night can ARRIVE while a measurement runs ─────────────────────────
   A daily job re-syncs the box captures root with mtimes PRESERVED, so an arriving night moves
   `ctime` alone and the directory's own mtime does not move at all. Residue
   `2026-10-20-a-daily-corpus-resync-moves-the-population-mid-measurement`: two legs of one tool
   60 seconds apart read 93 night directories and 97, one night that the first pair refused for
   absent H10 inputs scored for the second, and the added directories carried mtimes preserved from
   weeks earlier. A reader that trusts a listing from minutes ago sees nothing.

   ⚠️ SO THE TEST IS THE NAME SET, NEVER A TIMESTAMP. A time-keyed detector is precisely the one a
   preserving copy defeats, and `maxCtimeMs` below is carried as a DIAGNOSTIC that no branch reads.
   The remedy a measurement owes is the INTERSECTION of the set it started with and the set it ended
   with: one continuous population, with the arrivals named rather than averaged in. */

export const NIGHT_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A stable digest of a night set — the stamp a published number can carry so a later reader can ask
 *  whether it was cut over this population. The sort is inside, so the digest names the SET and two
 *  runs that enumerated the same nights in a different order agree. Without it the stamp answers
 *  "did these names arrive in this order", which is not a question anyone is asking: a caller
 *  holding an unsorted list would get a digest that differs from a stored one over the same set. */
export function digestNights(nights) {
  return createHash('sha256')
    .update([...nights].sort().join('\n'))
    .digest('hex')
    .slice(0, 12);
}

/** Enumerate the night directories under `root`. An unreadable root returns `ok: false` and NEVER an
 *  empty population — an absent root is not a zero (§∅), and a zero here would read as "the corpus
 *  emptied mid-run". */
export function snapshotNights(root, { re = NIGHT_RE, at = null } = {}) {
  const stamp = at || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  let names;
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && re.test(d.name))
      .map((d) => d.name);
  } catch (e) {
    return { ok: false, root, reason: `root not enumerable: ${e.code || e.message}`, n: 0, nights: [], digest: null, maxCtimeMs: null, at: stamp };
  }
  const nights = names.sort();
  let maxCtimeMs = null;
  for (const n of nights) {
    try {
      const ms = statSync(join(root, n)).ctimeMs;
      if (maxCtimeMs === null || ms > maxCtimeMs) maxCtimeMs = ms;
    } catch {
      /* A night that vanishes between the listing and the stat IS a population change, and the name
         set above already carries it. The stat is the diagnostic, so it stays silent. */
    }
  }
  return { ok: true, root, reason: null, n: nights.length, nights, digest: digestNights(nights), maxCtimeMs, at: stamp };
}

/** The intersection of two snapshots, with what arrived and what left named. */
export function intersectSnapshots(before, after) {
  const b = new Set(before.nights || []);
  const a = new Set(after.nights || []);
  const added = (after.nights || []).filter((n) => !b.has(n));
  const removed = (before.nights || []).filter((n) => !a.has(n));
  const nights = (before.nights || []).filter((n) => a.has(n));
  return { nights, n: nights.length, added, removed, stable: added.length === 0 && removed.length === 0, digest: digestNights(nights) };
}

/** The stability of one measurement's population as ONE tepna.verdict/1 object.
 *
 *  `population` is NIGHTS: `eligible` is the UNION the run saw, `checked` the intersection it can
 *  honestly report over, `excluded` what arrived or left. The equality is what makes a moved
 *  population visible instead of invisible.
 *
 *  A move is SHORTFALL rather than FAIL deliberately: the run still describes one continuous
 *  population, the intersection, so this annotates reduced coverage instead of refusing a figure
 *  (owner ruling 2026-09-17, `CLAUDE.md` §∅ — a discontinuity refuses, reduced coverage annotates).
 *  A caller that must not narrow treats SHORTFALL as its own refusal. */
export function populationVerdict(before, after, { commit = null, at = null, tool = 'tools/corpus-scope.mjs', evidence = [] } = {}) {
  const Verdict = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
  const ev = ['tools/corpus-scope.mjs', DOC, ...evidence].filter((e, i, a) => a.indexOf(e) === i);
  const stamp = at || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  let v;
  if (!before.ok || !after.ok) {
    const which = !before.ok && !after.ok ? 'neither snapshot' : !before.ok ? 'the opening snapshot' : 'the closing snapshot';
    v = Verdict.make({
      gate: 'corpus-population',
      status: 'NOT_RUN',
      scope: 'internal',
      population: { checked: 0, eligible: 0, excluded: 0 },
      criterion: { name: 'nights_added_or_removed', threshold: 0, unit: 'nights', direction: 'lte' },
      result: null,
      evidence: ev,
      reason: `${which} could not enumerate the root (${(before.ok ? after : before).reason}), so this run cannot tell a stable population from a moved one`,
      producedBy: { tool, commit, ...(commit ? {} : { commitReason: 'not read from a git tree' }) },
      at: stamp
    });
  } else {
    const d = intersectSnapshots(before, after);
    const names = (xs) => (xs.length > 4 ? `${xs.slice(0, 4).join(', ')} and ${xs.length - 4} more` : xs.join(', '));
    v = Verdict.make({
      gate: 'corpus-population',
      status: d.stable ? 'PASS' : 'SHORTFALL',
      scope: 'internal',
      population: { checked: d.n, eligible: d.n + d.added.length + d.removed.length, excluded: d.added.length + d.removed.length },
      criterion: { name: 'nights_added_or_removed', threshold: 0, unit: 'nights', direction: 'lte' },
      result: { root: before.root, n: d.n, digest: d.digest, added: d.added, removed: d.removed, openedAt: before.at, closedAt: after.at, maxCtimeMs: after.maxCtimeMs },
      evidence: ev,
      reason: d.stable
        ? null
        : `the night population moved during the run: ${d.added.length} arrived (${names(d.added)}), ${d.removed.length} left (${names(d.removed)}) — only the ${d.n}-night intersection is one population`,
      producedBy: { tool, commit, ...(commit ? {} : { commitReason: 'not read from a git tree' }) },
      at: stamp
    });
  }
  const chk = Verdict.validate(v);
  if (!chk.ok) throw new Error(`corpus-scope: verdict invalid under verdict.js — ${chk.errors.join(' | ')}`);
  return v;
}

function gitCommitShort() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

function selftest() {
  let pass = 0;
  let fail = 0;
  const ok = (n, c, d = '') => {
    c ? (pass++, console.log(`  ok   ${n}`)) : (fail++, console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`));
  };

  const doc = [
    '| path | files | what |',
    '|---|---|---|',
    '| `/srv/data/tepna-corpus/uploads/` | 900 | the superset |',
    '| `<primary checkout>/uploads` | 777 | fixture inputs |',
    '| `/run/media/…/Ecg nightly` | 1,980 | the PSL corpus |',
    '| `vigil:/srv/tepna/captures` | 6,827 | the box |',
    '| `tools/cpap-corpus.mjs` | — | a TOOL row, not a root |',
    '| **`/run/media/michal/data/Ecg-nightly-archive/CPAP`** | 192 | a mirror |'
  ].join('\n');
  const roots = parseRoots(doc);
  ok('parses every path row and skips the tool row', roots.length === 5, roots.map((r) => r.path).join(' '));
  ok(
    'a bolded path cell still parses',
    roots.some((r) => r.path.endsWith('Ecg-nightly-archive/CPAP'))
  );
  /* PLANT — the three not-countable shapes are named, not dropped. A dropped root is how the scope
     narrowed in the first place (residue 2026-09-05-triage-stamps-searched-the-repo-tree-only). */
  const why = Object.fromEntries(roots.map((r) => [r.path, r.why]));
  ok('an elided path is NOT countable and says why', why['/run/media/…/Ecg nightly'] === 'elided');
  ok('a remote root is NOT countable and says why', why['vigil:/srv/tepna/captures'] === 'remote');
  ok('a <placeholder> root is NOT countable and says why', why['<primary checkout>/uploads'] === 'elided');
  ok('a real absolute path IS countable', roots.find((r) => r.path === '/srv/data/tepna-corpus/uploads/').countable === true);

  /* PLANT — the whole defect in one assertion: a root that is not here returns null, NEVER 0. */
  ok('an absent root counts null, not 0', countUnder('/nonexistent-corpus-root-xyz', '*_ECG.txt') === null);
  ok('a real directory counts a number', typeof countUnder(ROOT, 'package.json') === 'number');

  /* PLANT — two doc rows naming ONE tree must not be summed twice (measured: 554 + 554 = 1761
     against a true 1207). The resolver is injected, so this is a rule about the rule, not the disk. */
  const aliasRows = [
    { root: '/srv/data/tepna-corpus/smoketest-captures', count: 554, why: null },
    { root: '/home/michal/tepna-smoketest/captures', count: 554, why: null },
    { root: '/srv/data/tepna-corpus/smoketest-captures/sub', count: 7, why: null },
    { root: '/elsewhere', count: 10, why: null }
  ];
  const fake = (x) => (x === '/home/michal/tepna-smoketest/captures' ? '/srv/data/tepna-corpus/smoketest-captures' : x);
  const dd = dedupeRoots(aliasRows, fake);
  ok('a symlinked duplicate root is NOT summed', dd[1].counted === false && /alias-of/.test(dd[1].why), JSON.stringify(dd[1]));
  ok('a root NESTED in another is NOT summed', dd[2].counted === false && /nested-in/.test(dd[2].why), JSON.stringify(dd[2]));
  ok('an unrelated root IS summed', dd[3].counted === true);
  ok('the duplicate is still SHOWN, not dropped', dd.length === 4 && dd[1].count === 554);
  ok('the sum counts each tree once', censusVerdict('*', dd).result.files === 564, String(censusVerdict('*', dd).result.files));

  const V = createRequire(import.meta.url)(join(ROOT, 'verdict.js'));
  const rows = [
    { root: '/a', count: 12, why: null },
    { root: '/b', count: null, why: 'absent' },
    { root: 'vigil:/c', count: null, why: 'remote' }
  ];
  const v = censusVerdict('*_ECG.txt', rows);
  ok('population is an EQUALITY over ROOTS', v.population.checked + v.population.excluded === v.population.eligible && v.population.checked === 1);
  ok('the verdict validates', V.validate(v).ok, V.validate(v).errors.join(' | '));
  ok('the byRoot table travels with the object', v.result.byRoot.length === 3 && v.result.files === 12);
  /* PLANT — every root unreachable is UNDERPOWERED, never a PASS with zero files: that is exactly
     the stamp that shipped, and it must not be emittable as a clean answer. */
  const none = censusVerdict('*_ECG.txt', [
    { root: '/b', count: null, why: 'absent' },
    { root: '/c', count: null, why: 'absent' }
  ]);
  ok('no countable root → UNDERPOWERED, never a zero-file PASS', none.status === 'UNDERPOWERED' && /cannot distinguish absence from unreachability/.test(none.reason), none.status);
  ok('an empty doc → NOT_RUN with result null', censusVerdict('*', []).status === 'NOT_RUN' && censusVerdict('*', []).result === null);

  /* ── POPULATION STABILITY ──────────────────────────────────────────────────────────────────────
     Over REAL directories, because the whole defect lives in what a listing shows and a timestamp
     does not. An old mtime is set on every fixture night and on the root itself: that is the shape
     the preserving resync produces, and a detector that reads a timestamp passes these legs while
     missing the arrival. */
  const tmp = mkdtempSync(join(tmpdir(), 'corpus-pop-'));
  const OLD = new Date('2026-09-23T04:43:00Z');
  const night = (base, n) => {
    const d = join(base, n);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'x_ECG.txt'), 'x');
    utimesSync(join(d, 'x_ECG.txt'), OLD, OLD);
    utimesSync(d, OLD, OLD);
  };
  try {
    const root = join(tmp, 'captures');
    mkdirSync(root, { recursive: true });
    for (const n of ['2026-06-20', '2026-06-21', '2026-06-22']) night(root, n);
    writeFileSync(join(root, 'README.md'), 'not a night');
    utimesSync(root, OLD, OLD);
    const before = snapshotNights(root);
    ok('a night set is enumerated, and a non-dated entry is NOT in the population', before.ok && before.n === 3 && !before.nights.includes('README.md'), JSON.stringify(before.nights));
    const stable = populationVerdict(before, snapshotNights(root));
    ok(
      'an unmoved population → PASS with the equality holding',
      stable.status === 'PASS' && stable.result.n === 3 && stable.population.checked + stable.population.excluded === stable.population.eligible,
      stable.status
    );
    ok('a PASS carries no reason and a stable digest', stable.reason === null && stable.result.digest === before.digest);

    /* PLANT — the arrival, with EVERY timestamp preserved. This is the measured case: a night
       appearing with an mtime weeks old under a root whose own mtime never moves. */
    const rootMtimeBefore = statSync(root).mtimeMs;
    night(root, '2026-06-19');
    utimesSync(root, OLD, OLD);
    const after = snapshotNights(root);
    ok('the root mtime is UNCHANGED across the arrival — a time-keyed detector sees nothing here', statSync(root).mtimeMs === rootMtimeBefore, `${rootMtimeBefore} vs ${statSync(root).mtimeMs}`);
    const moved = populationVerdict(before, after);
    ok('an arrival → SHORTFALL, never a PASS over the bigger set', moved.status === 'SHORTFALL', moved.status);
    ok('the arrival is NAMED in the reason', /2026-06-19/.test(moved.reason) && /1 arrived/.test(moved.reason), moved.reason);
    ok(
      'the figure is scoped to the INTERSECTION, and the union is the eligible',
      moved.population.checked === 3 && moved.population.eligible === 4 && moved.population.excluded === 1,
      JSON.stringify(moved.population)
    );
    ok('the moved verdict validates', V.validate(moved).ok, V.validate(moved).errors.join(' | '));

    /* A departure is the same defect with the sign flipped — a night that leaves also breaks the
       population, and a run that only checked for arrivals would report it as stable. */
    rmSync(join(root, '2026-06-20'), { recursive: true, force: true });
    const gone = populationVerdict(before, snapshotNights(root));
    ok('a departure → SHORTFALL naming it', gone.status === 'SHORTFALL' && /2026-06-20/.test(gone.reason) && /1 left/.test(gone.reason), gone.reason);

    /* An absent root is NOT an empty population (§∅) — a zero here would read as "the corpus
       emptied mid-run", which is the kind of in-band number the rule exists to forbid. */
    const nope = snapshotNights(join(tmp, 'no-such-root'));
    ok('an unreadable root → ok:false with a named reason, never n:0 as a fact', nope.ok === false && nope.n === 0 && /not enumerable/.test(nope.reason));
    const notrun = populationVerdict(nope, nope);
    ok(
      'a verdict over an unreadable root → NOT_RUN with result null',
      notrun.status === 'NOT_RUN' && notrun.result === null && /cannot tell a stable population from a moved one/.test(notrun.reason),
      notrun.status
    );
    ok('the NOT_RUN verdict validates', V.validate(notrun).ok, V.validate(notrun).errors.join(' | '));
    ok('the digest is order-free', digestNights(['b', 'a']) === digestNights(['a', 'b']) && digestNights(['2026-06-20', '2026-06-21']) !== digestNights(['2026-06-20']));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(fail ? `\n${fail} FAILURE(S)` : `\nall ${pass} selftests passed`);
  return fail ? 1 : 0;
}

function main() {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--selftest', '--verdict-sample', '--json'], positional: true }, { tool: 'corpus-scope' });
  if (argv.includes('--selftest')) process.exit(selftest());
  /* The corpus-free sample the adoption gate runs: the measured 2026-09-22 shape — one countable
     tree, one alias of it, one remote root — which is the case the residue is about. */
  if (argv.includes('--verdict-sample')) {
    const rows = dedupeRoots(
      [
        { root: '/srv/data/tepna-corpus/smoketest-captures', count: 554, why: null },
        { root: '/home/michal/tepna-smoketest/captures', count: 554, why: null },
        { root: 'vigil:/srv/tepna/captures', count: null, why: 'remote' }
      ],
      (x) => (x === '/home/michal/tepna-smoketest/captures' ? '/srv/data/tepna-corpus/smoketest-captures' : x)
    );
    console.log(JSON.stringify(censusVerdict('*_ECG.txt', rows, { commit: gitCommitShort() }), null, 2));
    return;
  }
  const pattern = argv.find((a) => !a.startsWith('--'));
  if (!pattern) {
    console.error("usage: node tools/corpus-scope.mjs '<find -name pattern>' [--json]");
    process.exit(2);
  }
  const docPath = join(ROOT, DOC);
  const roots = existsSync(docPath) ? parseRoots(readFileSync(docPath, 'utf8')) : [];
  const rows = roots.map((r) => {
    const count = r.countable ? countUnder(resolve(r.path), pattern) : null;
    return { root: r.path, count, why: r.countable ? (count === null ? 'absent' : null) : r.why };
  });
  const deduped = dedupeRoots(rows, (x) => realpathSync(resolve(x)));
  const v = censusVerdict(pattern, deduped, { commit: gitCommitShort() });
  if (argv.includes('--json')) {
    console.log(JSON.stringify(v, null, 2));
    return;
  }
  console.log(`corpus census · pattern ${pattern} · roots from ${DOC}\n`);
  for (const r of deduped) console.log(`  ${r.count === null ? 'NOT COUNTABLE HERE'.padEnd(12) : String(r.count).padStart(12)}  ${r.root}${r.why ? `   (${r.why})` : ''}`);
  console.log(
    `\n  ${v.result.files} file(s) across ${v.result.summedRoots} DISTINCT tree(s), from ${v.population.eligible} documented root(s): ` +
      `${v.population.excluded} not countable here, ${v.population.checked - v.result.summedRoots} an alias or subtree of another.`
  );
  console.log('  A count that does not name its roots is not a count — quote this scope with the number.');
}

if (process.argv[1]?.endsWith('corpus-scope.mjs')) main();

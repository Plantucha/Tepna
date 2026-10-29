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
//   node tools/corpus-scope.mjs --nights          # the corpus size: directories AND distinct names
//   node tools/corpus-scope.mjs --selftest
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refuseUnknownArgvOrExit, isCliEntry } from './argv-guard.mjs';
import { corpusSearch } from './regen-goldens-core.mjs';
/* ⚠️ THE POPULATION HALF LIVES IN corpus-scope-core.mjs AND IS RE-EXPORTED HERE UNCHANGED, so every
   caller of this module still reads the same names. A tool that wants the probe-safe closure imports
   the core directly; a tool that needs `countUnder` imports this file and accepts `exec`. */
import {
  DOC,
  NIGHT_RE,
  censusVerdict,
  classifyRoot,
  dedupeRoots,
  digestNights,
  expandHome,
  gitCommitOf,
  nightCensusVerdict,
  nightDirsUnder,
  notANight,
  notCovered,
  parseRoots,
  populationVerdict,
  ruleLine,
  snapshotEntries,
  snapshotNights
} from './corpus-scope-core.mjs';
export * from './corpus-scope-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/** The documented uploads row is a `<placeholder>`, so `classifyRoot` marks it `elided` and no
 *  census built from countable roots alone can see it. That tree is the LARGEST one and it is the
 *  tree the repository's own fixture machinery reads, so dropping it silently publishes a corpus
 *  size that omits the corpus (@osprey, board #1766: 249 night-shaped directories over 156 names,
 *  47 of them in no other root, opening the span five weeks earlier).
 *
 *  So the census resolves that one row through `corpusSearch`, the SAME resolver
 *  `verify-fixtures.mjs` uses — `$DEX_UPLOADS`, then the primary checkout, then this one. The row
 *  keeps the doc's elided TEXT as its name, because the resolved path is a home directory and a
 *  published census may not carry one.
 *
 *  ∅ When no candidate exists, the row stays EXCLUDED and says which resolver failed. It never
 *  becomes a zero, because "this machine holds no uploads tree" is not "the corpus holds no night".
 *  PURE given `hit`. */
export function applyElidedUploads(rows, hit) {
  return rows.map((r) => {
    if (r.countable || r.why !== 'elided' || !/uploads\/?$/.test(r.path)) return r;
    if (!hit || !hit.exists) return { ...r, why: 'elided — the repo corpus resolver found no uploads tree on this machine' };
    return { ...r, countable: true, resolvedDir: hit.dir, resolvedBy: hit.label, why: null };
  });
}

/** Every directory NAME under `root`, at any depth — the walker `nightDirsUnder` is given, kept on
 *  this side of the split because it shells out. Returns null, never [], when the root is not a
 *  directory here (§∅).
 *
 *  ⚠️ `-L` IS LOAD-BEARING AND ITS ABSENCE IS SILENT. Three documented roots are symlinks, and a
 *  `find` that starts at one prints nothing and exits 0 — four trees read as empty that way while
 *  #3950 was being measured. It is not an optimisation to drop. */
export function findDirNames(root) {
  try {
    if (!statSync(root).isDirectory()) return null;
  } catch {
    return null;
  }
  try {
    const out = execFileSync('find', ['-L', root, '-type', 'd', '-printf', '%f\n'], { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter(Boolean);
  } catch (e) {
    // `find` exits non-zero on an unreadable subtree while still printing what it saw
    const printed = String(e.stdout || '')
      .split('\n')
      .filter(Boolean);
    return printed.length ? printed : null;
  }
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

/** 🔴 THE ORACLE, NOT THE READER. `gitCommitOf` in the core reads `.git` with `readFileSync` so that
 *  importing it costs a tool nothing. This is the `git rev-parse` version it replaced, kept here
 *  where `exec` is already allowed, SO THE SELFTEST CAN ASSERT THE TWO AGREE. A pure reader of a
 *  format somebody else owns is only worth trusting while something keeps checking it against the
 *  owner. It answers `--short`, so the comparison is a PREFIX test, never equality. */
export function gitCommitOfExec(cwd = ROOT) {
  try {
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out) return { commit: out, reason: null };
    return { commit: null, reason: 'git rev-parse --short HEAD printed nothing for this tool tree' };
  } catch (e) {
    const why = String((e && e.message) || e).split('\n')[0];
    return { commit: null, reason: `git rev-parse --short HEAD failed for this tool tree: ${why}` };
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

  /* PLANT — the elided `<primary checkout>/uploads` row IS the largest tree and the one the fixture
     machinery reads, so a census that drops it silently publishes a corpus size that omits the corpus
     (@osprey, board #1766). The resolver is injected, so these are rules about the rule. */
  const hit = { exists: true, dir: '/some/checkout/uploads', label: 'primary checkout (git --git-common-dir)' };
  const resolved = applyElidedUploads(roots, hit);
  const upRow = resolved.find((r) => r.path === '<primary checkout>/uploads');
  ok('a resolvable uploads placeholder becomes countable', upRow.countable === true && upRow.why === null, JSON.stringify(upRow));
  ok('the walk gets a real directory and the row keeps the doc TEXT as its name', upRow.resolvedDir === hit.dir && upRow.path === '<primary checkout>/uploads');
  ok('the resolution NAMES which candidate answered', upRow.resolvedBy === hit.label);
  /* PLANT — ∅ · no uploads tree here is not zero nights. */
  const unresolved = applyElidedUploads(roots, null).find((r) => r.path === '<primary checkout>/uploads');
  ok('an unresolvable uploads placeholder stays EXCLUDED, never a zero', unresolved.countable !== true && unresolved.resolvedDir === undefined, JSON.stringify(unresolved));
  ok('and it says the resolver is what failed, not the corpus', /resolver found no uploads tree on this machine/.test(unresolved.why), unresolved.why);
  ok(
    'a candidate that does not exist reads the same as none at all',
    applyElidedUploads(roots, { exists: false, dir: '/nope', label: 'x' }).find((r) => r.path === '<primary checkout>/uploads').countable !== true
  );
  /* CONTROL — the rule touches ONE row. An elided root that is not an uploads tree, and every
     countable root, come through byte-identical. */
  ok('CONTROL · a non-uploads elided root is untouched', resolved.find((r) => r.path === '/run/media/…/Ecg nightly').why === 'elided');
  ok(
    'CONTROL · every other row is unchanged',
    JSON.stringify(resolved.filter((r) => r.path !== '<primary checkout>/uploads')) === JSON.stringify(roots.filter((r) => r.path !== '<primary checkout>/uploads'))
  );

  /* PIN — the doc writes a home root as `~/…` and stores no user name (owner ruling 2026-10-28).
     The home is INJECTED here, so the rule holds whatever this machine's home is, and the last two
     assertions pin the default: `expandHome` reads `homedir()` and `classifyRoot` counts the row. */
  /* 🔴 PLANT · the row filter ran BEFORE the expansion and dropped the tilde row whole, so the
     census lost a tree and reported 8 roots as 9 (measured 2026-10-28, this edit's own first run).
     A dropped row is the §∅ shape one level up: a corpus nobody looked at, read as a corpus. */
  ok('a tilde ROW survives the doc filter', parseRoots('| `~/x/captures` | 1 | a tree |\n').length === 1);
  ok('and a repo file in the same column is still documentation, not a root', parseRoots('| `tools/x.mjs` | 1 | a tool |\n').length === 0);
  ok('a tilde root expands against the home it is given', expandHome('~/tepna-smoketest/captures', '/h/u') === '/h/u/tepna-smoketest/captures');
  ok('a bare tilde IS the home directory', expandHome('~', '/h/u') === '/h/u');
  ok('a tilde inside a path is NOT a prefix and never expands', expandHome('/srv/~/x', '/h/u') === '/srv/~/x');
  ok('a `~user` form never expands, so the row reads not-absolute', classifyRoot('~someone/x').why === 'not-absolute');
  ok("the DEFAULT home is this process's own", expandHome('~/x') === join(homedir(), 'x'));
  ok(
    'and a tilde row is countable, with the absolute path every caller reads today',
    JSON.stringify(classifyRoot('~/x')) === JSON.stringify({ path: join(homedir(), 'x'), countable: true, why: null })
  );

  /* PLANT — the whole defect in one assertion: a root that is not here returns null, NEVER 0. */
  ok('an absent root counts null, not 0', countUnder('/nonexistent-corpus-root-xyz', '*_ECG.txt') === null);
  ok('a real directory counts a number', typeof countUnder(ROOT, 'package.json') === 'number');

  /* PLANT — two doc rows naming ONE tree must not be summed twice (measured: 554 + 554 = 1761
     against a true 1207). The resolver is injected, so this is a rule about the rule, not the disk. */
  const aliasRows = [
    { root: '/srv/data/tepna-corpus/smoketest-captures', count: 554, why: null },
    { root: '/mnt/home-alias/tepna-smoketest/captures', count: 554, why: null },
    { root: '/srv/data/tepna-corpus/smoketest-captures/sub', count: 7, why: null },
    { root: '/elsewhere', count: 10, why: null }
  ];
  const fake = (x) => (x === '/mnt/home-alias/tepna-smoketest/captures' ? '/srv/data/tepna-corpus/smoketest-captures' : x);
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

    /* PLANT — A READABLE ROOT THAT OFFERED NOTHING. The two walks agree, so the movement criterion
       is met over a run that examined nothing, and `Verdict.make` refuses that `PASS` at the type
       level: the primitive used to THROW here and kill its caller with a stack trace instead of
       reporting an empty root. Three legs, because the repair must not quietly turn a real
       population into NOT_RUN either. */
    const bare = join(tmp, 'offered-nothing');
    mkdirSync(bare, { recursive: true });
    const nothing = populationVerdict(snapshotNights(bare), snapshotNights(bare));
    ok('an empty but READABLE root → NOT_RUN, never PASS over checked 0, and never a throw', nothing.status === 'NOT_RUN' && nothing.population.checked === 0, nothing.status);
    ok(
      'the empty-root NOT_RUN validates and states what was offered, not what failed',
      V.validate(nothing).ok && /offered no night directory at all/.test(nothing.reason),
      V.validate(nothing).errors.join(' | ') || nothing.reason
    );
    ok(
      'and it reads differently from the unreadable root — nobody looked is not nothing was there',
      /not enumerable/.test(notrun.reason) && !/not enumerable/.test(nothing.reason) && nothing.result === null,
      `${nothing.reason} || ${notrun.reason}`
    );
    /* PLANT — THE OTHER WAY TO OFFER NO NIGHT. The root holds two night-shaped directories and the
       caller's rule refuses both, so `nights` is empty for a reason the first reason would misstate. */
    night(bare, '2025-12-31');
    night(bare, '2025-12-30');
    const refusedAll = populationVerdict(snapshotNights(bare, { re: /^2026-/ }), snapshotNights(bare, { re: /^2026-/ }));
    ok(
      'a rule that refused every night-shaped directory says SO, and names them, rather than claiming the root was empty',
      refusedAll.status === 'NOT_RUN' && /refused every one of them/.test(refusedAll.reason) && /2025-12-30/.test(refusedAll.reason),
      refusedAll.reason
    );
    rmSync(join(bare, '2025-12-31'), { recursive: true, force: true });
    rmSync(join(bare, '2025-12-30'), { recursive: true, force: true });
    night(bare, '2026-07-04');
    ok(
      'CONTROL · one night under that same root → PASS over a population of 1, so the branch binds on emptiness alone',
      populationVerdict(snapshotNights(bare), snapshotNights(bare)).status === 'PASS'
    );
    /* PLANT — THE THIRD WAY TO OFFER NO NIGHT, and the one the DEFAULT rule had no words for. This
       root is keyed on records, so the default rule matches nothing: `nights` is empty for a reason
       neither sentence above states, and before the third bin this root and `offered-nothing` above
       published the same digest under the same words (row
       2026-10-26-a-non-night-root-and-an-empty-root-publish-the-same-population). */
    const recordKeyed = join(tmp, 'record-keyed');
    mkdirSync(recordKeyed, { recursive: true });
    for (const r of ['sub-01', 'sub-02', 'sub-03']) mkdirSync(join(recordKeyed, r), { recursive: true });
    const rk = snapshotNights(recordKeyed);
    ok(
      'a record-keyed root NAMES what the default rule passed over, under the default rule',
      rk.ok === true && rk.n === 0 && rk.ruleIsDefault === true && rk.passedOver.join() === 'sub-01,sub-02,sub-03',
      JSON.stringify(rk.passedOver)
    );
    const vrk = populationVerdict(rk, snapshotNights(recordKeyed), { tool: 'selftest' });
    ok(
      'and its verdict names the three entries instead of publishing an emptied corpus',
      vrk.status === 'NOT_RUN' && /enumerated 3 entries/.test(vrk.reason) && /sub-02/.test(vrk.reason) && V.validate(vrk).ok,
      vrk.reason
    );
    ok(
      'ANTI-FIX CONTROL · the two roots no longer read alike, though the digest alone still cannot tell them apart',
      !/offered no night directory at all/.test(vrk.reason) && /offered no night directory at all/.test(nothing.reason) && rk.digest === digestNights([]),
      `${vrk.reason} || ${nothing.reason}`
    );
    /* The nsrr shape: a record root holds FILES, so a bin built from the directory listing alone
       would have left exactly this root reading as empty. */
    writeFileSync(join(recordKeyed, 'ucddb002.rec'), 'x');
    const rkFile = snapshotNights(recordKeyed);
    ok(
      'a FILE no rule counted is named too, so a record root of files is not an emptied corpus either',
      rkFile.n === 0 && rkFile.passedOver.join() === 'sub-01,sub-02,sub-03,ucddb002.rec',
      JSON.stringify(rkFile.passedOver)
    );
    ok('the digest is order-free', digestNights(['b', 'a']) === digestNights(['a', 'b']) && digestNights(['2026-06-20', '2026-06-21']) !== digestNights(['2026-06-20']));

    /* ── WHAT THE CALLER'S OWN RULE DID ────────────────────────────────────────────────────────
       Residue `2026-10-21-the-reference-validation-night-filter-is-pinned-to-one-year`. A rule is
       applied inside the walk, so before this the snapshot was the narrowed set and the narrowing
       left no trace. The root below holds both hazards at once: a 2027 night a `^2026-` rule
       refuses, and a plain directory a `/./` rule swallows. */
    const ruled = join(tmp, 'ruled');
    mkdirSync(ruled, { recursive: true });
    for (const n of ['2026-06-20', '2026-06-21', '2027-01-04']) night(ruled, n);
    mkdirSync(join(ruled, 'scratch'), { recursive: true });
    writeFileSync(join(ruled, 'NOTES.txt'), 'x');

    const dflt = snapshotNights(ruled);
    ok(
      'the DEFAULT rule says so, and asks neither question',
      dflt.ruleIsDefault === true && dflt.n === 3 && dflt.rejectedNightShaped.length === 0 && dflt.admittedNonNight.length === 0,
      JSON.stringify(dflt.rule)
    );
    ok('a default-rule verdict carries NO rule block — nothing was decided to report', populationVerdict(dflt, snapshotNights(ruled)).result.rule === undefined);

    const narrow = snapshotNights(ruled, { re: /^2026-/ });
    ok('a NARROWER rule still scores its own set', narrow.n === 2 && !narrow.nights.includes('2027-01-04'), JSON.stringify(narrow.nights));
    ok(
      '…and the night it refused is NAMED, not absent',
      narrow.ruleIsDefault === false && narrow.rejectedNightShaped.join() === '2027-01-04' && narrow.admittedNonNight.length === 0,
      JSON.stringify(narrow.rejectedNightShaped)
    );
    const vNarrow = populationVerdict(narrow, snapshotNights(ruled, { re: /^2026-/ }), { tool: 'selftest' });
    ok(
      'the verdict publishes the rule beside the population',
      vNarrow.result.rule === '/^2026-/' && vNarrow.result.ruleRejectedNightShaped.join() === '2027-01-04',
      JSON.stringify(vNarrow.result.rule)
    );
    ok(
      '…and the scored set did NOT move: a declared rule is not a population movement',
      vNarrow.status === 'PASS' && vNarrow.population.checked === 2 && vNarrow.population.excluded === 0,
      `${vNarrow.status} ${JSON.stringify(vNarrow.population)}`
    );
    ok('the narrowed verdict validates', V.validate(vNarrow).ok, V.validate(vNarrow).errors.join(' | '));

    const wide = snapshotNights(ruled, { re: /./ });
    ok(
      'a WIDER rule counts a plain directory as a night, and says which one',
      wide.n === 4 && wide.admittedNonNight.join() === 'scratch' && wide.rejectedNightShaped.length === 0,
      JSON.stringify(wide.admittedNonNight)
    );
    /* THE INVARIANT THE THIRD BIN BUYS: the three name lists PARTITION the listing under every
       rule, so no name can go uncounted the way `scratch` did under the default rule. */
    const partitioned = (snap, all) => {
      const bins = [...snap.nights, ...snap.rejectedNightShaped, ...snap.passedOver].sort();
      return bins.length === all.length && bins.join() === [...all].sort().join();
    };
    const everyDir = ['2026-06-20', '2026-06-21', '2027-01-04', 'scratch', 'NOTES.txt'];
    ok(
      'nights · rejected · passedOver partition the whole listing under the default, a narrower and a wider rule',
      partitioned(dflt, everyDir) && partitioned(narrow, everyDir) && partitioned(wide, everyDir),
      `${JSON.stringify(dflt.passedOver)} ${JSON.stringify(narrow.passedOver)} ${JSON.stringify(wide.passedOver)}`
    );
    const vWide = populationVerdict(wide, snapshotNights(ruled, { re: /./ }), { tool: 'selftest' });
    ok(
      'the verdict names the non-night it swallowed',
      vWide.result.ruleAdmittedNonNight.join() === 'scratch' && /1 non-night name\(s\) counted as nights/.test(vWide.result.ruleNote),
      vWide.result.ruleNote
    );

    /* ∅ — a rule whose effect nobody could measure is `null`, never an empty list. An empty list
       here would read as "the rule rejected nothing", which the failed walk never established. */
    const nopeRuled = snapshotNights(join(tmp, 'no-such-root'), { re: /^2026-/ });
    ok(
      'an unreadable root leaves the rule effect NULL, never [] — and that covers the third bin too',
      nopeRuled.ok === false && nopeRuled.rejectedNightShaped === null && nopeRuled.admittedNonNight === null && nopeRuled.passedOver === null
    );

    /* CONTROL — the real root this residue row was written about. The rule is a no-op here today,
       and that is a MEASUREMENT: the row claimed the corpus already held nights outside 2026. */
    const trio = join(ROOT, 'uploads', 'trio');
    if (existsSync(trio)) {
      const real = snapshotNights(trio, { re: /^2026-/ });
      ok(
        'CONTROL · the ^2026- rule refuses no night under uploads/trio today, over a non-empty root',
        real.ok && real.n > 100 && real.rejectedNightShaped.length === 0 && real.admittedNonNight.length === 0,
        `n=${real.n} rejected=${JSON.stringify(real.rejectedNightShaped)}`
      );
      /* The exact line `tools/tch-reference-validation.mjs` prints. That tool refuses before its
         own walk on any box without the Polar nightly corpus (residue
         `2026-10-21-the-reference-validation-population-path-runs-on-no-box-here`), so this is
         where the rendered string gets pinned. */
      const line = ruleLine(populationVerdict(real, snapshotNights(trio, { re: /^2026-/ }), { tool: 'selftest' }));
      ok(
        'CONTROL · and the printed line says `none` rather than staying silent',
        /^ {2}rule \/\^2026-\/ — night-shaped names it refused: none · non-night names it counted as nights: none$/.test(line),
        JSON.stringify(line)
      );
    }
    /* ── THE REMOVAL NAMER, ONE IMPLEMENTATION FOR BOTH ORACLE SHAPES ──────────────────────────
       Row 2026-10-22-the-removal-namer-is-duplicated-in-two-oracles. The two callers differ in one
       thing only: the ECG pair list has no `ok`, because a pair's existence IS the read, while the
       PPG row list carries the read's own verdict. Both shapes are pinned here, so a widening of the
       question moves one file. */
    const offered = { n: 3, nights: ['2026-07-25', '2026-07-26', 'logs'] };
    ok('the read removed two of three, and the namer NAMES them rather than counting them', notANight(offered, [{ night: '2026-07-25' }]).join(',') === '2026-07-26,logs');
    ok(
      'a row whose own read failed is removed too, never counted as covered',
      notANight(offered, [{ night: '2026-07-25', ok: false }]).length === 3,
      JSON.stringify(notANight(offered, [{ night: '2026-07-25', ok: false }]))
    );
    ok('CONTROL · the same row with ok true is covered, so the two shapes read differently', notANight(offered, [{ night: '2026-07-25', ok: true }]).join(',') === '2026-07-26,logs');
    ok('CONTROL · an offer that enumerated nothing names no removal', notANight({ n: 0, nights: [] }, []).length === 0);
    ok('a covered night the offer never held cannot appear: the difference runs offer minus read', notANight(offered, [{ night: '2099-01-01' }]).length === 3);

    /* ── A POPULATION WHOSE UNIT IS NOT A NIGHT ────────────────────────────────────────────────
       Row 2026-10-21-forty-one-corpus-enumerators-report-no-population. `tools/stage-lab.mjs` walks
       six external PSG archives and none of them holds a night directory, so the night walk over any
       of their roots answers `ok: true, n: 0` — a dataset of records published as empty. The cases
       below pin the three facts a record population needs: the members come from the caller's own
       lister, the criterion and the prose say `records`, and an unreadable root REFUSES rather than
       reporting a population of zero. The night control beside them is what makes the first fact a
       measurement: both calls run over the SAME planted root. */
    const recRoot = join(tmp, 'psg');
    mkdirSync(recRoot, { recursive: true });
    const recFiles = ['ucddb002.rec', 'ucddb003.rec', 'ucddb002_stage.txt'];
    for (const f of recFiles) writeFileSync(join(recRoot, f), 'x');
    const recList = (d) =>
      readdirSync(d)
        .filter((f) => /^ucddb\d+\.rec$/.test(f))
        .map((f) => f.slice(0, -4));
    const recBefore = snapshotEntries(recRoot, { list: recList, unit: 'records' });
    ok('a record snapshot counts what the caller enumerates, sorted', recBefore.ok && recBefore.n === 2 && recBefore.members.join(',') === 'ucddb002,ucddb003', JSON.stringify(recBefore.members));
    ok('and it carries no key named for a unit it does not have', recBefore.nights === undefined && recBefore.unit === 'records', JSON.stringify(Object.keys(recBefore)));
    /* The night walk over a record root still reads `ok` with a population of zero — `nights` must
       not move for a caller who asked for nights — but the zero no longer stands alone: the names it
       passed over ride beside it (row
       2026-10-26-a-non-night-root-and-an-empty-root-publish-the-same-population). */
    const recAsNights = snapshotNights(recRoot);
    ok(
      'the night walk over a record root reads ok with a population of zero, and NAMES what it passed over',
      recAsNights.ok === true && recAsNights.n === 0 && recAsNights.passedOver.join() === [...recFiles].sort().join(),
      JSON.stringify(recAsNights.passedOver)
    );
    ok('and the RECORD snapshot of that same root asks no night question at all', recBefore.passedOver === null && recBefore.rejectedNightShaped === null, JSON.stringify(recBefore.passedOver));
    const recStable = populationVerdict(recBefore, snapshotEntries(recRoot, { list: recList }), { tool: 'selftest' });
    ok(
      'a stable record population passes under a records criterion',
      recStable.status === 'PASS' && recStable.criterion.name === 'records_added_or_removed' && recStable.criterion.unit === 'records',
      JSON.stringify(recStable.criterion)
    );
    ok('and the result says which unit it counted', recStable.result.unit === 'records' && recStable.result.n === 2, JSON.stringify(recStable.result.unit));
    ok(
      'CONTROL · a night population still publishes the key its readers index on',
      populationVerdict(snapshotNights(join(tmp, 'root')), snapshotNights(join(tmp, 'root'))).criterion.name === 'nights_added_or_removed'
    );
    writeFileSync(join(recRoot, 'ucddb004.rec'), 'x');
    const recMoved = populationVerdict(recBefore, snapshotEntries(recRoot, { list: recList }), { tool: 'selftest' });
    ok(
      'an arriving record is SHORTFALL, and the reason says record where it used to say night',
      recMoved.status === 'SHORTFALL' && recMoved.reason.indexOf('the record population moved during the run') === 0 && recMoved.reason.indexOf('only the 2-record intersection') > 0,
      recMoved.reason
    );
    const recGone = snapshotEntries(join(tmp, 'no-such-psg'), { list: recList });
    ok('an unreadable record root refuses and never reports zero records', recGone.ok === false && recGone.n === 0 && /not enumerable/.test(recGone.reason || ''), JSON.stringify(recGone.reason));
    ok(
      'a record root that enumerated nothing is NOT_RUN, and the reason names the record',
      populationVerdict(snapshotEntries(bare, { list: () => [] }), snapshotEntries(bare, { list: () => [] })).reason.indexOf('offered no record at all') > 0
    );
    ok(
      'the removal namer serves both units from one definition',
      notCovered({ members: ['a', 'b'] }, [{ record: 'a' }], { key: 'record' }).join(',') === 'b' && notANight(offered, [{ night: '2026-07-25' }]).join(',') === '2026-07-26,logs'
    );
    ok(
      'a lister is the enumeration, so its absence throws rather than reporting an empty population',
      (() => {
        try {
          snapshotEntries(recRoot, {});
          return false;
        } catch (e) {
          return /IS the enumeration/.test(e.message);
        }
      })()
    );

    /* THE LISTER IS THE RULE, AND THE SNAPSHOT NOW NAMES IT. Row
       2026-10-26-the-entries-walk-drops-the-lister-that-chose-it: `rule: null` dropped the one
       decision an entries caller makes, and `ruleBlock` could not publish it either, so a reader of
       either live verdict could not tell a wide lister from a narrow one. */
    ok('a named lister reaches the snapshot as the rule', recBefore.rule === 'recList', JSON.stringify(recBefore.rule));
    /* 🔴 A PROPERTY KEY IS NOT A LISTER NAME. `{ list: (d) => ... }` infers `list`, so the naive
       read would publish a rule the caller never wrote. Both arms below must read null. */
    const mkAnon = () => (d) => readdirSync(d);
    ok('an inline lister reads null, because its only name is the parameter it was passed as', snapshotEntries(recRoot, { list: (d) => readdirSync(d) }).rule === null);
    ok('and a genuinely nameless lister reads null too, with no sentinel standing in for a name', snapshotEntries(recRoot, { list: mkAnon() }).rule === null);
    const rSnap = snapshotEntries(recRoot, { list: recList });
    const recRule = populationVerdict(rSnap, snapshotEntries(recRoot, { list: recList }), { tool: 'selftest' }).result;
    ok(
      'and the VERDICT publishes that name, with no night list beside it to read as a measurement',
      recRule.rule === 'recList' && recRule.ruleUnit === 'records' && recRule.ruleRejectedNightShaped === undefined && recRule.ruleAdmittedNonNight === undefined,
      JSON.stringify({ rule: recRule.rule, unit: recRule.ruleUnit })
    );
    ok('the note says the night questions do not bind, never that nobody measured them', /do not bind/.test(recRule.ruleNote) && !/never measured/.test(recRule.ruleNote), recRule.ruleNote);
    ok(
      'the one-line form reads the entries shape instead of subscripting a list it never had',
      ruleLine({ result: recRule }) === '  rule recList — the night questions do not bind for a records population',
      ruleLine({ result: recRule })
    );
    ok(
      'a nameless lister says so on that line rather than printing a bare null',
      (() => {
        const a = snapshotEntries(recRoot, { list: mkAnon() });
        const line = ruleLine({ result: populationVerdict(a, snapshotEntries(recRoot, { list: mkAnon() }), { tool: 'selftest' }).result });
        return /ANONYMOUS LISTER/.test(line) && !/null/.test(line);
      })()
    );
    ok(
      'CONTROL · a NIGHT verdict under a narrowed rule keeps both night lists and carries no unit',
      (() => {
        /* TWO WAYS THIS CONTROL READ AS COVERED BEFORE IT COULD FIRE. A root with no night-shaped
           directory makes the verdict NOT_RUN with `result: null`, and the shared root above gains
           directories from earlier legs, so an exact list could never be pinned to it. So plant one. */
        const nr = join(tmp, 'rule-control');
        mkdirSync(join(nr, '2026-07-25'), { recursive: true });
        mkdirSync(join(nr, '2026-07-26'), { recursive: true });
        const narrow = { re: /^2026-07-25$/ };
        const w = populationVerdict(snapshotNights(nr, narrow), snapshotNights(nr, narrow), { tool: 'selftest' }).result;
        return w !== null && w.ruleUnit === undefined && Array.isArray(w.ruleAdmittedNonNight) && Array.isArray(w.ruleRejectedNightShaped) && w.ruleRejectedNightShaped.join() === '2026-07-26';
      })()
    );

    /* A NIGHT-RULE ANSWER OVER A POPULATION THAT HAS NO NIGHT RULE. Row
       2026-10-26-the-entries-walk-asserts-a-night-rule-answer-it-never-computed: both entries arms
       wrote `ruleIsDefault: true`, which claims a comparison against `NIGHT_RE` that nobody ran for
       a listing not keyed on dates. §∅ reaches the verdict layer, so the field reads `null` and the
       reader can tell a night answer from no night answer at all. */
    ok('an entries snapshot gives no night-rule answer rather than asserting the default one', rSnap.ruleIsDefault === null && rSnap.ruleIsDefault !== true, JSON.stringify(rSnap.ruleIsDefault));
    ok(
      'and its refusal arm says the same, because a walk that never ran compared nothing either',
      recGone.ok === false && recGone.ruleIsDefault === null,
      JSON.stringify({ ok: recGone.ok, ruleIsDefault: recGone.ruleIsDefault })
    );
    /* THE TWO ∅ FIELDS IN ONE LITERAL HAVE TO AGREE. `passedOver` already read null for exactly this
       reason two lines below, and the disagreement is what made `true` legible as a measurement. */
    ok(
      'the two absent-by-construction fields of an entries snapshot agree with each other',
      rSnap.ruleIsDefault === null && rSnap.passedOver === null && rSnap.rejectedNightShaped === null && rSnap.admittedNonNight === null
    );
    /* THE DISCRIMINATOR IS STILL `unit`, so dropping the night answer costs the verdict nothing. A
       branch that had read the night field would have gone silent on this very change. */
    ok(
      'the verdict still publishes the lister, so the entries branch never read the night field',
      recRule.rule === 'recList' && recRule.ruleUnit === 'records',
      JSON.stringify({ rule: recRule.rule, unit: recRule.ruleUnit })
    );
    ok(
      'CONTROL · a NIGHT snapshot still ANSWERS the question, both ways, so null is not a blanket',
      (() => {
        const nr2 = join(tmp, 'rule-default-control');
        mkdirSync(join(nr2, '2026-07-25'), { recursive: true });
        const d = snapshotNights(nr2);
        const n = snapshotNights(nr2, { re: /^2026-07-25$/ });
        return d.ruleIsDefault === true && n.ruleIsDefault === false;
      })()
    );

    /* THE CODE IDENTITY, AND THE REASON FOR ITS ABSENCE. A reason that names a cause the run cannot
       have had is worse than no reason, so the CONTROL below must be able to fire: a directory that
       is genuinely outside a git tree has to produce a null commit WITH a reason that names the
       failure. Without that leg the honest-reason guard is unfireable and reads as covered. */
    const snap = snapshotNights(join(tmp, 'root'));
    const live = populationVerdict(snap, snap, { tool: 'tools/corpus-scope.mjs' });
    ok(
      'a caller that names no commit gets the tool tree own commit, and NO reason is invented for it',
      /^[0-9a-f]{7,40}$/.test(String(live.producedBy.commit)) && live.producedBy.commitReason === undefined,
      JSON.stringify(live.producedBy)
    );
    const stated = populationVerdict(snap, snap, { tool: 'tools/corpus-scope.mjs', commit: 'deadbee' });
    ok('an explicitly stated commit wins over the lookup', stated.producedBy.commit === 'deadbee' && stated.producedBy.commitReason === undefined);
    const disclaimed = populationVerdict(snap, snap, { tool: 'tools/corpus-scope.mjs', commitReason: 'a fabricated sample claims no code identity' });
    ok(
      'a caller that disclaims code identity keeps its OWN reason verbatim',
      disclaimed.producedBy.commit === null && disclaimed.producedBy.commitReason === 'a fabricated sample claims no code identity'
    );
    const outside = gitCommitOf('/');
    ok(
      'CONTROL · outside a git tree the commit is null AND the reason names the failure, never a borrowed sentence',
      outside.commit === null && typeof outside.reason === 'string' && /no \.git exists/.test(outside.reason),
      JSON.stringify(outside)
    );
    ok('CONTROL · inside the tool tree the same reader answers a commit and no reason', /^[0-9a-f]{40}$/.test(String(gitCommitOf().commit)) && gitCommitOf().reason === null);

    /* 🔴 THE PURE READER IS CHECKED AGAINST THE OWNER OF THE FORMAT IT READS. `gitCommitOf` parses
       `.git` by hand so that importing this module's population half costs a caller no `exec`
       closure. That trade is only honest while something keeps proving the hand parse agrees with
       git itself, so every leg below compares it to `gitCommitOfExec`, which runs `git rev-parse`.
       The oracle answers `--short`, so agreement is a PREFIX test and never equality — and the
       prefix is asserted in that direction, because a null on either side would pass a loose one. */
    const agrees = (dir, why) => {
      const pure = gitCommitOf(dir);
      const oracle = gitCommitOfExec(dir);
      ok(
        `ORACLE · ${why}`,
        typeof oracle.commit === 'string' && oracle.commit.length >= 7 && typeof pure.commit === 'string' && pure.commit.length === 40 && pure.commit.startsWith(oracle.commit),
        JSON.stringify({ pure: pure.commit, oracle: oracle.commit, pureReason: pure.reason, oracleReason: oracle.reason })
      );
      return pure.commit;
    };
    agrees(ROOT, 'the hand-parsed sha agrees with git rev-parse in the tree this suite runs in');

    /* A worktree is the case the hand parse can get wrong on its own: its `.git` is a FILE naming a
       gitdir, that gitdir holds its own HEAD, and the branch ref it names lives in the COMMON dir.
       Built here with real git rather than mocked, because a mock of a layout is a mock of my own
       reading of it. The repo is thrown away with the rest of `tmp`. */
    const gitq = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const repo = join(tmp, 'oracle-repo');
    mkdirSync(repo, { recursive: true });
    gitq(repo, ['init', '--initial-branch=main', '-q']);
    gitq(repo, ['-c', 'user.email=selftest@example.invalid', '-c', 'user.name=selftest', 'commit', '-q', '--allow-empty', '-m', 'root']);
    const repoSha = agrees(repo, 'a plain checkout with a loose branch ref reads the same sha both ways');
    const wt = join(tmp, 'oracle-wt');
    gitq(repo, ['worktree', 'add', '-q', '-b', 'side', wt]);
    const wtSha = agrees(wt, 'a WORKTREE, whose .git is a file and whose branch ref lives in the common dir, reads the same sha both ways');
    ok('CONTROL · the worktree and its parent checkout are the same commit here, so the leg above compared a real sha', repoSha === wtSha && typeof wtSha === 'string');
    gitq(repo, ['pack-refs', '--all']);
    agrees(repo, 'the same checkout still reads after pack-refs moves the branch out of refs/heads into packed-refs');
    agrees(wt, 'and the worktree still reads it, because the pure reader looks in the common dir packed-refs too');

    /* REFUSE A LAYOUT THIS READER DOES NOT KNOW, BY NAME. git grew a `reftable` ref store; a reader
       that cannot see one must say so rather than return a null that reads like "no commit". */
    const rt = join(tmp, 'oracle-reftable');
    mkdirSync(join(rt, 'fake-gitdir', 'reftable'), { recursive: true });
    writeFileSync(join(rt, '.git'), `gitdir: ${join(rt, 'fake-gitdir')}\n`);
    const rtRead = gitCommitOf(rt);
    ok('an unreadable HEAD beside a reftable store refuses by NAMING the store, not with a bare null', rtRead.commit === null && /reftable/.test(String(rtRead.reason)), JSON.stringify(rtRead));
    const junk = join(tmp, 'oracle-junk');
    mkdirSync(join(junk, 'jg'), { recursive: true });
    writeFileSync(join(junk, '.git'), 'this is not a gitdir line\n');
    const junkRead = gitCommitOf(junk);
    ok(
      'a .git file that is not a gitdir line refuses with a reason naming what it held',
      junkRead.commit === null && typeof junkRead.reason === 'string' && junkRead.reason.length > 0,
      JSON.stringify(junkRead)
    );
    const headless = join(tmp, 'oracle-headless');
    mkdirSync(join(headless, '.git'), { recursive: true });
    writeFileSync(join(headless, '.git', 'HEAD'), 'ref: refs/heads/nowhere\n');
    const headlessRead = gitCommitOf(headless);
    ok(
      'a HEAD naming a ref that resolves to nothing refuses by naming the ref, never by inventing a sha',
      headlessRead.commit === null && /refs\/heads\/nowhere/.test(String(headlessRead.reason)),
      JSON.stringify(headlessRead)
    );
    const refused = populationVerdict(snapshotNights(join(tmp, 'absent-root')), snapshotNights(join(tmp, 'absent-root')), { tool: 'tools/corpus-scope.mjs' });
    ok(
      'the NOT_RUN leg carries the same resolved identity, so a refusal is still attributable',
      refused.status === 'NOT_RUN' && /^[0-9a-f]{7,40}$/.test(String(refused.producedBy.commit)),
      JSON.stringify(refused.producedBy)
    );

    /* ── THE NIGHT CENSUS ─────────────────────────────────────────────────────────────────────
       The walk is recursive and the verdict states that, because the figure this replaces counted
       directories over two scopes and a reader took it for a night count. */
    const mkLister = (xs) => () => xs;
    ok(
      'the census walk counts DIRECTORIES and NAMES separately, so a repeated name cannot inflate the name count',
      (() => {
        const w = nightDirsUnder('/x', { lister: mkLister(['2026-06-10', '2026-06-10', '2026-06-11', 'notes']) });
        return w.ok && w.directories === 3 && w.names.join() === '2026-06-10,2026-06-11';
      })()
    );
    ok(
      '∅ · a root this machine cannot walk reads null, never 0 — "nobody looked" is not "the corpus holds none"',
      (() => {
        const w = nightDirsUnder('/x', { lister: mkLister(null) });
        return w.ok === false && w.directories === null && w.names === null && /not walkable/.test(w.reason);
      })()
    );
    ok(
      'the core primitive refuses to walk a filesystem itself, which is what keeps `exec` out of every scorer closure',
      (() => {
        try {
          nightDirsUnder('/x', {});
          return false;
        } catch (e) {
          return e instanceof TypeError && /lister is required/.test(e.message);
        }
      })()
    );
    ok(
      '🔴 PLANT · the nested tree a ONE-LEVEL walk reads as empty is exactly what this census exists to count',
      (() => {
        /* The measured shape of `uploads/`: no night directory at the top, 180 one level down. The
           old figure came from walks that disagreed on depth and said so nowhere. */
        const nest = join(tmp, 'night-census-nested');
        mkdirSync(join(nest, 'trio', '2026-06-10'), { recursive: true });
        mkdirSync(join(nest, 'trio', '2026-06-11'), { recursive: true });
        mkdirSync(join(nest, 'other', '2026-06-11'), { recursive: true });
        const flat = snapshotNights(nest);
        const deep = nightDirsUnder(nest, { lister: findDirNames });
        return flat.ok && flat.n === 0 && deep.ok && deep.directories === 3 && deep.names.length === 2;
      })()
    );
    ok(
      'an alias is shown and NOT summed, so the scope stays as wide as the doc says it is',
      (() => {
        const rows = dedupeRoots(
          [
            { root: '/a', count: 10, directories: 10, names: ['2026-06-10'], why: null },
            { root: '/b', count: 10, directories: 10, names: ['2026-06-10'], why: null }
          ],
          (x) => (x === '/b' ? '/a' : x)
        );
        const v = nightCensusVerdict(rows, { commit: null, commitReason: 'selftest' });
        return v.result.directories === 10 && v.result.summedRoots === 1 && v.population.checked === 2 && v.population.excluded === 0;
      })()
    );
    ok(
      'an unwalkable root is EXCLUDED rather than summed as a zero, and checked + excluded = eligible',
      (() => {
        const v = nightCensusVerdict(
          [
            { root: '/a', directories: 4, names: ['2026-06-10', '2026-06-11'], why: null },
            { root: 'vigil:/x', directories: null, names: null, why: 'remote' }
          ],
          { commit: null, commitReason: 'selftest' }
        );
        return v.status === 'PASS' && v.result.directories === 4 && v.result.distinctNames === 2 && v.population.checked + v.population.excluded === v.population.eligible;
      })()
    );
    ok(
      'no walkable root at all is UNDERPOWERED with a reason, never a PASS over nothing',
      (() => {
        const v = nightCensusVerdict([{ root: 'vigil:/x', directories: null, names: null, why: 'remote' }], { commit: null, commitReason: 'selftest' });
        return v.status === 'UNDERPOWERED' && v.population.checked === 0 && /unreachable one/.test(v.reason);
      })()
    );
    ok(
      'an unparsed doc is NOT_RUN with a null result, so an empty census cannot read as an empty corpus',
      (() => {
        const v = nightCensusVerdict([], { commit: null, commitReason: 'selftest' });
        return v.status === 'NOT_RUN' && v.result === null && v.population.eligible === 0;
      })()
    );
    ok(
      'the verdict publishes its DEPTH and its RULE beside the number, which is the half the 327 figure never carried',
      (() => {
        const v = nightCensusVerdict([{ root: '/a', directories: 1, names: ['2026-06-10'], why: null }], { commit: null, commitReason: 'selftest' });
        return v.result.depth === 'recursive' && v.result.rule === String(NIGHT_RE) && v.result.earliest === '2026-06-10' && v.result.latest === '2026-06-10';
      })()
    );
    /* ROW 2026-10-29-every-committed-population-verdict-carries-the-walked-root-absolute — the
       publish boundary, pinned in both directions. `home` is a parameter, so these legs name a home
       directory that is not this machine's and read no environment. */
    const homeRoot = join(tmp, 'home-corpus');
    mkdirSync(join(homeRoot, '2026-01-01'), { recursive: true });
    const hs = snapshotNights(homeRoot);
    const hv = populationVerdict(hs, snapshotNights(homeRoot), { tool: 'selftest', home: tmp, evidence: [join(homeRoot, 'note.json')] });
    ok('the published root collapses at the publish boundary', hv.result.root === '~/home-corpus', hv.result.root);
    ok("a caller's own evidence entry collapses with it", hv.evidence.includes('~/home-corpus/note.json'), hv.evidence.join(' '));
    ok('ANTI-FIX CONTROL · the SNAPSHOT keeps the absolute root, because tools/seqnet-eval.mjs:53 joins it onto a filename and reads that file', hs.root === homeRoot, hs.root);
    const homeEmpty = join(tmp, 'home-empty');
    mkdirSync(homeEmpty, { recursive: true });
    const ev0 = populationVerdict(snapshotNights(homeEmpty), snapshotNights(homeEmpty), { tool: 'selftest', home: tmp });
    ok('the NOT_RUN prose names the collapsed root and never the home prefix', /~\/home-empty/.test(ev0.reason) && !ev0.reason.includes(tmp), ev0.reason);
    ok('CONTROL · a root outside the home directory publishes verbatim', populationVerdict(hs, snapshotNights(homeRoot), { tool: 'selftest', home: join(tmp, 'elsewhere') }).result.root === homeRoot);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(fail ? `\n${fail} FAILURE(S)` : `\nall ${pass} selftests passed`);
  return fail ? 1 : 0;
}

function main() {
  const argv = process.argv.slice(2);
  refuseUnknownArgvOrExit(argv, { boolean: ['--selftest', '--verdict-sample', '--json', '--nights'], positional: true }, { tool: 'corpus-scope' });
  if (argv.includes('--selftest')) process.exit(selftest());
  /* The corpus-free sample the adoption gate runs: the measured 2026-09-22 shape — one countable
     tree, one alias of it, one remote root — which is the case the residue is about. */
  if (argv.includes('--verdict-sample')) {
    const rows = dedupeRoots(
      [
        { root: '/srv/data/tepna-corpus/smoketest-captures', count: 554, why: null },
        { root: '/mnt/home-alias/tepna-smoketest/captures', count: 554, why: null },
        { root: 'vigil:/srv/tepna/captures', count: null, why: 'remote' }
      ],
      (x) => (x === '/mnt/home-alias/tepna-smoketest/captures' ? '/srv/data/tepna-corpus/smoketest-captures' : x)
    );
    console.log(JSON.stringify(censusVerdict('*_ECG.txt', rows), null, 2));
    return;
  }
  /* THE NIGHT CENSUS — the corpus size, in the two units the 327 figure conflated. It walks
     RECURSIVELY and says so, because the nights nest and a one-level count of the same roots reads
     25 names short (row 2026-10-26-the-327-night-shaped-figure-counts-directories-over-two-scopes).
     It scores nothing and feeds no scorer: `snapshotNights` keeps its one-level contract, which is
     what the eleven PAT and TCH tools take their population from. */
  if (argv.includes('--nights')) {
    const docP = join(ROOT, DOC);
    const parsed = existsSync(docP) ? parseRoots(readFileSync(docP, 'utf8')) : [];
    const up = corpusSearch(ROOT);
    const rts = applyElidedUploads(
      parsed,
      up.candidates.find((c) => c.chosen && c.exists)
    );
    const walked = rts.map((r) => {
      const dir = r.resolvedDir || r.path;
      const w = r.countable ? nightDirsUnder(resolve(dir), { lister: findDirNames }) : null;
      return {
        root: r.path,
        directories: w ? w.directories : null,
        names: w ? w.names : null,
        why: r.countable ? (w && w.ok ? null : 'absent') : r.why,
        ...(r.resolvedBy ? { resolvedBy: r.resolvedBy } : {})
      };
    });
    /* The alias rule needs the REAL path, which for the resolved row is not its printed name. */
    const realOf = new Map(rts.filter((r) => r.resolvedDir).map((r) => [r.path, r.resolvedDir]));
    /* dedupeRoots keys on `count`, so the alias rule reads the unit this census actually summed. */
    const dd = dedupeRoots(
      walked.map((w) => ({ ...w, count: w.directories })),
      (x) => {
        try {
          return realpathSync(resolve(realOf.get(x) || x));
        } catch {
          return x;
        }
      }
    ).map(({ count, ...w }) => w);
    const { commit, reason: commitReason } = gitCommitOf(ROOT);
    const nv = nightCensusVerdict(dd, { commit, commitReason });
    if (argv.includes('--json')) {
      console.log(JSON.stringify(nv, null, 2));
      return;
    }
    console.log(`corpus night census · rule ${String(NIGHT_RE)} · recursive · roots from ${DOC}\n`);
    for (const r of dd) {
      const cell = r.directories === null ? 'NOT WALKABLE HERE'.padEnd(18) : `${String(r.directories).padStart(6)} dir / ${String((r.names || []).length).padStart(4)} name`;
      const via = r.resolvedBy ? `   (resolved by ${r.resolvedBy})` : '';
      console.log(`  ${cell}  ${r.root}${via}${r.why ? `   (${r.why})` : ''}${r.counted === false ? '   NOT SUMMED' : ''}`);
    }
    if (nv.result === null) {
      console.log(`\n  ${nv.status} — ${nv.reason}`);
      return;
    }
    const R = nv.result;
    console.log(
      `\n  ${R.directories} night-shaped DIRECTORY(ies) over ${R.distinctNames} DISTINCT NAME(s), across ${R.summedRoots} distinct tree(s), ` +
        `from ${nv.population.eligible} documented root(s): ${nv.population.excluded} not walkable here, ${nv.population.checked - R.summedRoots} an alias or subtree of another.`
    );
    console.log(`  Dated ${R.earliest} to ${R.latest}.`);
    console.log('  A DIRECTORY IS NOT A NIGHT AND A NAME IS NOT AN ELIGIBLE NIGHT — eligibility needs the streams inside the directory.');
    console.log('  A count that does not name its roots and its depth is not a count — quote this scope with the number.');
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
  const v = censusVerdict(pattern, deduped);
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

if (isCliEntry(import.meta.url)) main();

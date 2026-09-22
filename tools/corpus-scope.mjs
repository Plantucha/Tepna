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
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

  console.log(fail ? `\n${fail} FAILURE(S)` : `\nall ${pass} selftests passed`);
  return fail ? 1 : 0;
}

function main() {
  const argv = process.argv.slice(2);
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

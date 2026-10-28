#!/usr/bin/env node
/*
 * tools/pin-coverage.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * HOW MUCH OF THE CORPUS IS IN-BAND BLANKING? — the denominator behind `nPinSpanIntervals`.
 *
 * WHY IT EXISTS. `pinnedSpans` has detected O2Ring in-band blanking since #2317 and the export has
 * REPORTED it as `quality.pinnedCoverage`, but nothing consumed it: every rMSSD/SD1/LF:HF was
 * computed as though the blanked samples were signal. The fix (exclude a pinned span like a gap) is
 * owner-ruled (P5, 2026-09-12), and that ruling asked for "one PR with a corpus measurement". This is
 * that measurement, promoted out of a scratch script so the figure it produces can be re-derived —
 * a published number whose producer has vanished is the 255th uncheckable number
 * (`PUBLISHED-NUMBER-DECAY-SWEEP-2026-09-03`: at most 5 of 259 tables are attributable to a tool).
 *
 * 🔴 THE DENOMINATOR IS THE WHOLE POINT, AND GETTING IT WRONG IS WHY THIS TOOL EXISTS IN THIS SHAPE.
 * `nPinSpanIntervals` and `nGapSpanIntervals` are counted over EVERY INPUT interval; the export's
 * series is the KEPT subset. Dividing one by the other mixes two populations and, measured while
 * writing this, produced a per-file "800 %" — the only reason the mismatch was caught before it
 * reached a changeset. `analyze` now publishes `nInputIntervals` and this tool divides by THAT.
 * A share whose numerator and denominator come from different populations is not a rate.
 *
 * WHAT IT REPORTS, per tree: files found · analysed · threw; files carrying >= 1 pinned interval;
 * pinned intervals over INPUT intervals; and the per-file distribution among affected files
 * (median · p90 · max). The throw count is reported rather than swallowed because the two capture
 * trees differ by two orders of magnitude in it (1 vs 198), and a silently-dropped file is an
 * absence that would read as a clean night.
 *
 * MEMORY (standing rule, 2026-09-15: never exceed 8 GB). One file is read, analysed, reduced to
 * SCALARS, and dropped; nothing accumulates across the loop but running totals and one array of
 * per-file percentages. The vm realm carrying `clock.js` + `kernel-constants.js` + the two DSPs is
 * built ONCE and reused, because that is the expensive fixed cost. Measured on the 665-file tree:
 * 0.70 GB resident, flat.
 *
 * 🔴 IT WALKS SEVERAL ROOTS, AND TWO OF THEM CAN BE ONE ROOT. `--dir a --dir b` reported each tree
 * separately and said nothing about the pair, so a reader who added the two blocks double-counted an
 * alias. Measured one rung out by `corpus-scope.mjs`: a smoketest tree under a home directory and
 * `/srv/data/tepna-corpus/smoketest-captures/` both reported 554 `_ECG.txt`, one a symlink to the
 * other, and the total read 1761 where the true figure is 1207. Roots now resolve to their real path
 * through `dedupeRoots`, and a root that IS another or sits INSIDE one is NAMED and not analysed
 * twice — the second read would publish the same bytes under a second name.
 *
 * 🔴 AND `--resume` LOST THE THROW COUNT THE HEADER ABOVE PROMISES. A file that threw entered `done`
 * with no row, so a resumed run found it done, pushed nothing, and counted nothing: measured on a
 * synthetic two-file tree, `threw 2` became `threw 0` over the identical tree, and `found 2 ·
 * analysed 0 · threw 0` reconciles to nothing while claiming to. On the 665-file tree that is 198
 * throws reading as a clean corpus. A throw now writes a row of its own (`threw: true`, both counts
 * `null`, so `reduce` still skips it), the checkpoint carries `v: 2`, and a `v: 1` checkpoint's done
 * files are reported as an UNKNOWN bucket by name rather than as zero throws (§∅).
 *
 * NOT IMPLEMENTED, declared per the tool-build standard §2.11:
 *   · §2.6/§2.8 PARALLELISM — none. This is single-process by choice: the per-file cost is ~1 s and
 *     the realm setup dominates a short run, so a pool would buy little and cost the shared box
 *     memory it cannot spare (see the 8 GB rule). Re-measure before adding one.
 *   · §2.9 GENERIC — explicitly SINGLE-PURPOSE. It answers one question about one detector.
 *
 * USAGE
 *   node tools/pin-coverage.mjs --dir <captures>            # one tree
 *   node tools/pin-coverage.mjs --dir <a> --dir <b>         # several, reported separately
 *   node tools/pin-coverage.mjs --dir <d> --resume          # continue from the checkpoint
 *   node tools/pin-coverage.mjs --dir <d> --limit 25        # bounded sample, size STATED in output
 *   node tools/pin-coverage.mjs --selftest                  # pure core, no corpus, no git
 *   node tools/pin-coverage.mjs --verdict-sample            # the population object alone, no corpus
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { refuseUnknownArgvOrExit, isCliEntry } from './argv-guard.mjs';
import { NIGHT_RE, dedupeRoots, gitCommitOf, populationVerdict, ruleLine, snapshotEntries } from './corpus-scope-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CKPT = join(ROOT, '.cache', 'pin-coverage-checkpoint.json');
const argv = process.argv.slice(2);
/* Refuse a token nobody reads BEFORE anything is read — and note WHICH helper reads what, because this
   tool is why the survey's extractor had to learn that arity is the HELPER's property: `many('--dir')`
   is a bare call that nevertheless consumes the next token, so a table built from call shape put the
   tool's one required argument in the boolean bucket and would have refused its path. */
/* `process.argv` BELONGS TO WHOEVER IS RUNNING. At module scope this refusal reads the IMPORTER's
   arguments, so an import of anything in this file judged flags it never passed (residue
   `2026-10-20-four-argv-adopters-refuse-at-module-scope-and-export`). The guard runs for the CLI only. */
const IS_CLI = isCliEntry(import.meta.url);
if (IS_CLI) refuseUnknownArgvOrExit(argv, { valued: ['--dir', '--limit'], boolean: ['--resume', '--selftest', '--verdict-sample'] }, { tool: 'pin-coverage' });
const flag = (n) => argv.includes(n);
const many = (n) => argv.reduce((a, v, i) => (v === n && argv[i + 1] ? a.concat(argv[i + 1]) : a), []);
const one = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const O2RING_PPG = /_PPG\.txt$/i;
const O2RING_VENDOR = /o2ring|wellue/i;
const PPG_UNIT = 'O2Ring PPG files';

/* THE LISTER IS THE POPULATION RULE, AND IT CARRIES A NAME ON PURPOSE. `snapshotEntries` publishes
   `rule: null` for an inline arrow, which would state that nobody chose the rule this run applied.
   The unit is a FILE, not a night: the question is how much of the corpus is blanked, and the
   denominator is `_PPG.txt` files under the night directories, not the directories themselves.
   🔴 IT MUST NOT SWALLOW AN UNREADABLE ROOT. The per-night `catch` below is deliberate, but the
   root's own `readdirSync` runs OUTSIDE it, so a root nobody can open makes the snapshot report
   `ok: false` with the reason instead of publishing `n: 0` — a measurement of zero over a directory
   nothing read (§∅). Members are RELATIVE, so two roots holding the same night names are comparable
   and the digest names the SET rather than the path it was reached by. */
export function listO2RingPpg(root) {
  const out = [];
  for (const n of readdirSync(root).filter((x) => NIGHT_RE.test(x))) {
    try {
      for (const f of readdirSync(join(root, n))) if (O2RING_PPG.test(f) && O2RING_VENDOR.test(f)) out.push(join(n, f));
    } catch {
      /* an unreadable night directory is named by `unreadableNightsUnder` below, never silently dropped */
    }
  }
  return out;
}

/* THE NIGHT DIRECTORIES THE LISTER COULD NOT OPEN. The `catch` above keeps one bad directory from
   killing a tree, and before this the files inside it were absent from `found` with nothing saying
   so — an absence that reads as a night with no O2Ring capture. A count names nothing to chase, so
   this returns the NAMES. */
export function unreadableNightsUnder(root) {
  const bad = [];
  let names;
  try {
    names = readdirSync(root).filter((x) => NIGHT_RE.test(x));
  } catch {
    return null; // the ROOT is unreadable, which the snapshot states — not this function's claim to make
  }
  for (const n of names) {
    try {
      readdirSync(join(root, n));
    } catch (e) {
      bad.push(`${n} (${e.code || e.message})`);
    }
  }
  return bad;
}

/* ── THE SUMMATION RULE IS OVER FILES, NOT OVER PATHS ───────────────────────────────────────────
   `dedupeRoots` in `corpus-scope-core.mjs` is the census answer to "which documented roots may be
   summed", and it keys on the real path: a root that IS another is an alias, a root INSIDE another
   is already counted. 🔴 THE SECOND HALF OF THAT RULE DOES NOT TRANSFER HERE, because it assumes a
   RECURSIVE enumeration — `nightDirsUnder`'s own header says its walk is recursive. This tool's walk
   is ONE level: files under `<root>/<night>/`. So `--dir /x/captures --dir /x` would mark the first
   nested-in the second and skip it, while `/x`'s one-level walk never reaches `/x/captures/<night>/`
   at all, and the files would leave the population with nothing saying so.
   So the rule is stated over the FILE SET, which is sound under either walk: each root's members are
   resolved to real paths, a file already counted under an earlier root is NAMED as shared, and a
   root is read only for the files no earlier root claimed. An alias then falls out as the case where
   nothing is left, and a deeply nested root is read in full because its files are genuinely new.
   PURE — the resolver is injected, so no filesystem. */
export function dedupeMembers(roots, resolver = (x) => x) {
  const claimed = new Map();
  return roots.map((r) => {
    if (!r.members) return { ...r, read: [], shared: [], sharedWith: null, counted: false };
    const read = [];
    const shared = [];
    let sharedWith = null;
    for (const m of r.members) {
      let real;
      try {
        real = resolver(m);
      } catch {
        real = m; // a dangling link is its own path: unresolvable is not "the same as something else"
      }
      const owner = claimed.get(real);
      if (owner) {
        shared.push(m);
        if (!sharedWith) sharedWith = owner;
      } else {
        claimed.set(real, r.root);
        read.push(m);
      }
    }
    return { ...r, read, shared, sharedWith, counted: read.length > 0 };
  });
}

/* ── pure core: the reduction, so the selftest can exercise it without a corpus ──────────────────
   Everything that can be wrong about a RATE lives here — the denominator choice, the empty case,
   the quantiles — and none of it needs a file. */
export function reduce(rows) {
  let analysed = 0,
    withPin = 0,
    totPin = 0,
    totIn = 0;
  const share = [];
  for (const r of rows) {
    if (r == null || r.nInputIntervals == null || r.nPinSpanIntervals == null) continue;
    analysed++;
    totPin += r.nPinSpanIntervals;
    totIn += r.nInputIntervals;
    if (r.nPinSpanIntervals > 0 && r.nInputIntervals > 0) {
      withPin++;
      share.push((100 * r.nPinSpanIntervals) / r.nInputIntervals);
    }
  }
  share.sort((a, b) => a - b);
  const q = (p) => (share.length ? share[Math.min(share.length - 1, Math.floor(p * share.length))] : null);
  return {
    analysed,
    withPin,
    filePct: analysed ? (100 * withPin) / analysed : null,
    totPin,
    totIn,
    /* null, never 0, when nothing was measured — a rate over an empty denominator is not "no
       blanking", it is no measurement (§∅). */
    intervalPct: totIn ? (100 * totPin) / totIn : null,
    median: q(0.5),
    p90: q(0.9),
    max: share.length ? share[share.length - 1] : null
  };
}

/* THE THREE NUMBERS MUST RECONCILE, AND SAYING SO IS THE POINT. `found` is the offer this run took,
   and every file in it must land in exactly one bin: analysed, threw, inherited-unknown, or left
   under the cap. The resumed run that reported `found 2 · analysed 0 · threw 0` broke that identity
   and nothing noticed, so the identity is now computed and printed. PURE — no file, no checkpoint. */
export function accountFiles({ found, analysed, threw, unknown, capped, shared = 0 }) {
  const binned = analysed + threw + unknown + capped + shared;
  return { found, analysed, threw, unknown, capped, shared, binned, unaccounted: found - binned, ok: found === binned };
}

/* THE CHECKPOINT FORMAT IS VERSIONED, because a `v: 1` file cannot answer the throw question: it
   recorded a thrown file in `done` and nowhere else. Reading one is still right — re-analysing a
   665-file tree costs ~11 minutes — but its done-with-no-row files are UNKNOWN, never zero throws. */
export const CKPT_VERSION = 2;

function loadCkpt() {
  try {
    const j = JSON.parse(readFileSync(CKPT, 'utf8'));
    /* `v` rides along for the caller, which reports a v1 file's unknowns rather than refusing it. */
    return j && typeof j === 'object' && Array.isArray(j.done) ? j : null;
  } catch {
    return null; // an unreadable checkpoint is discarded, never half-trusted
  }
}
function saveCkpt(o) {
  try {
    mkdirSync(dirname(CKPT), { recursive: true });
    writeFileSync(CKPT, JSON.stringify({ v: CKPT_VERSION, ...o }));
  } catch {
    /* a checkpoint that cannot be written must not kill a run that is otherwise fine */
  }
}

if (flag('--selftest')) {
  let fail = 0;
  let ran = 0;
  const A = (m, c) => {
    ran += 1;
    if (!c) {
      console.error('SELFTEST FAIL:', m);
      fail++;
    }
  };
  /* THE DENOMINATOR BUG, planted. If `reduce` ever divides by a kept-interval count again, this is
     the assertion that reds: 8 pinned of 100 INPUT is 8 %, and no input can exceed 100 %. */
  const r = reduce([
    { nPinSpanIntervals: 8, nInputIntervals: 100 },
    { nPinSpanIntervals: 0, nInputIntervals: 100 }
  ]);
  A('interval share uses the INPUT denominator', Math.abs(r.intervalPct - 4) < 1e-9);
  A('per-file share is over that file only', Math.abs(r.max - 8) < 1e-9);
  A('a file with no pinned interval is analysed but not "affected"', r.analysed === 2 && r.withPin === 1);
  A('no per-file share can exceed 100 %', r.max <= 100);
  /* EMPTY IS NULL, NOT ZERO — the §∅ rule the whole change is about, applied to its own report. */
  const e = reduce([]);
  A('an empty corpus reports null, never 0 %', e.intervalPct === null && e.filePct === null && e.median === null);
  /* A row missing either half is NOT counted — a half-measured file must not dilute the rate. */
  const p = reduce([{ nPinSpanIntervals: 5 }, { nInputIntervals: 50 }, { nPinSpanIntervals: 5, nInputIntervals: 50 }]);
  A('a row missing either field is skipped entirely', p.analysed === 1 && p.totIn === 50);
  /* Quantiles on a single affected file must not invent a spread. */
  const s = reduce([{ nPinSpanIntervals: 1, nInputIntervals: 4 }]);
  A('one affected file: median = p90 = max', s.median === 25 && s.p90 === 25 && s.max === 25);
  /* A THROWN FILE IS A ROW, AND `reduce` MUST STILL SKIP IT. If a throw row ever starts counting as
     analysed, the rate gains a file it never measured. */
  const wt = reduce([
    { nPinSpanIntervals: 2, nInputIntervals: 100 },
    { f: 'x', nPinSpanIntervals: null, nInputIntervals: null, threw: true }
  ]);
  A('a throw row is skipped by the rate', wt.analysed === 1 && wt.totIn === 100);
  /* THE RESUMED-RUN DEFECT, planted. The identity is what the resumed run broke: 2 found, 0
     analysed, 0 threw reconciled to nothing and claimed to reconcile. */
  A('the bins must account for every offered file', accountFiles({ found: 2, analysed: 0, threw: 2, unknown: 0, capped: 0 }).ok);
  const lost = accountFiles({ found: 2, analysed: 0, threw: 0, unknown: 0, capped: 0 });
  A('a lost throw count is reported as unaccounted, not as a clean tree', !lost.ok && lost.unaccounted === 2);
  A('an inherited unknown is accounted for', accountFiles({ found: 198, analysed: 0, threw: 0, unknown: 198, capped: 0 }).ok);
  A('the cap is a bin of its own', accountFiles({ found: 100, analysed: 25, threw: 0, unknown: 0, capped: 75 }).ok);
  A('a file counted under an earlier root is a bin of its own', accountFiles({ found: 10, analysed: 4, threw: 0, unknown: 0, capped: 0, shared: 6 }).ok);
  /* THE FILE-SET SUMMATION RULE, and the case the PATH rule gets wrong. */
  const real = (m) => m.replace('/alias/', '/t1/');
  const dm = dedupeMembers(
    [
      { root: '/t1', members: ['/t1/n1/a_PPG.txt', '/t1/n2/b_PPG.txt'] },
      { root: '/alias', members: ['/alias/n1/a_PPG.txt', '/alias/n2/b_PPG.txt'] },
      { root: '/x/captures', members: ['/x/captures/n3/c_PPG.txt'] },
      { root: '/half', members: ['/t1/n1/a_PPG.txt', '/half/n9/z_PPG.txt'] },
      { root: '/gone', members: null }
    ],
    real
  );
  A('an aliased root contributes nothing and names the root that holds its files', !dm[1].counted && dm[1].shared.length === 2 && dm[1].sharedWith === '/t1');
  A('a root nested under another by PATH is still read when its files are new', dm[2].counted && dm[2].read.length === 1);
  A('a partly overlapping root is read for its own files only', dm[3].counted && dm[3].read.length === 1 && dm[3].shared.length === 1);
  A('an unreadable root contributes nothing and claims no overlap', !dm[4].counted && dm[4].shared.length === 0 && dm[4].sharedWith === null);
  A('every file is read exactly once', dm.reduce((a, r) => a + r.read.length, 0) === 4);
  /* THE SUMMATION RULE. Two roots that resolve to one real path must not both be summed, which is
     the measured 1761-vs-1207 defect one rung out. The resolver is injected, so no filesystem. */
  const resolver = (r) => ({ '/a': '/real', '/b': '/real', '/c': '/real/inner', '/d': '/other' })[r] || r;
  const deduped = dedupeRoots(
    [
      { root: '/a', count: 554 },
      { root: '/b', count: 554 },
      { root: '/c', count: 9 },
      { root: '/d', count: 100 }
    ],
    resolver
  );
  A('an aliased root is reported and not summed', deduped[1].counted === false && /alias-of/.test(deduped[1].why));
  A('a nested root is reported and not summed', deduped[2].counted === false && /nested-in/.test(deduped[2].why));
  A('an unrelated root is still summed', deduped[0].counted === true && deduped[3].counted === true);
  A('the summed total is the true figure, never the sum of every block', deduped.filter((r) => r.counted !== false).reduce((a, r) => a + r.count, 0) === 654);
  const ck = { done: ['a'], rows: [] };
  saveCkpt(ck);
  A('checkpoint round-trips', (loadCkpt() || {}).done?.[0] === 'a');
  A('a saved checkpoint declares its version', loadCkpt().v === CKPT_VERSION);
  writeFileSync(CKPT, 'not json');
  A('an unreadable checkpoint is discarded, never half-trusted', loadCkpt() === null);
  console.log(fail ? `SELFTEST FAIL (${fail})` : `SELFTEST PASS (${ran}/${ran})`);
  process.exit(fail ? 1 : 0);
}

/* THE SAMPLE TOUCHES NO CORPUS, because the adoption check parses stdout as JSON on every box. The
   lister is INJECTED here, so `snapshotEntries` runs for real and no filesystem is read — a
   hand-built snapshot literal would let the two drift. */
export function verdictSample() {
  const at = '2026-10-28T00:00:00Z';
  const members = ['2026-06-11/O2Ring_PPG.txt', '2026-06-12/O2Ring_PPG.txt', '2026-06-13/O2Ring_PPG.txt'];
  /* A NAMED LISTER, so the sample's `rule` says what produced it instead of reading `ANONYMOUS
     LISTER` — and it is NOT called `listO2RingPpg`, because this sample read no corpus and must not
     publish the production rule's name. */
  function sampleMembers() {
    return members;
  }
  const sample = (root) => snapshotEntries(root, { list: sampleMembers, unit: PPG_UNIT, at });
  const snap = sample('<captures>');
  return populationVerdict(snap, snap, { tool: 'tools/pin-coverage.mjs', at, evidence: ['tools/pin-coverage.mjs', 'tools/corpus-scope-core.mjs'] });
}

if (flag('--verdict-sample')) {
  console.log(JSON.stringify(verdictSample()));
  process.exit(0);
}

const dirs = many('--dir');
if (!dirs.length) {
  console.error('need --dir <captures>  (or --selftest)');
  process.exit(4);
}
const LIMIT = Number(one('--limit', '0')) || 0;
const RESUME = flag('--resume');

const DexBuild = createRequire(import.meta.url)(join(ROOT, 'tools', 'build-core.js'));
const sb = {};
sb.window = sb;
sb.self = sb;
sb.globalThis = sb;
sb.console = { log() {}, warn() {}, error() {} };
sb.setTimeout = setTimeout;
sb.clearTimeout = clearTimeout;
sb.__DEX_NAMESPACED__ = true;
const ctx = vm.createContext(sb);
for (const f of ['clock.js', 'kernel-constants.js', 'ecgdex-dsp.js', 'ppgdex-dsp.js']) vm.runInContext(DexBuild.classicify(readFileSync(join(ROOT, f), 'utf8')), ctx, { filename: f });
const P = ctx.PPGDSP;
/* TIER, printed per §2.7: there is one path and no fallback, so say so rather than leave a reader
   wondering which arm ran. */
console.log(`pin-coverage: tier=in-process vm realm (no pool; single-purpose — see header §2.11)`);

const prior = RESUME ? loadCkpt() : null;
const done = new Set(prior?.done || []);
const rows = prior?.rows || [];
/* A v1 CHECKPOINT CANNOT SAY WHICH OF ITS DONE FILES THREW, so its done set is carried and the
   unknowns are counted per root below. Reading it is still right; calling them zero throws is not. */
const PRIOR_V = prior ? prior.v || 1 : null;
if (prior) console.log(`resuming: ${done.size} file(s) already done (checkpoint v${PRIOR_V})`);
/* 🔴 STAMP THE CODE THAT RAN, NOT THE CODE AT THE END OF THE RUN. A 665-file tree takes long enough
   for a commit to land in this worktree, and Node loaded this module at the start. */
const commitOf = gitCommitOf(ROOT);

/* ── THE OFFER, TAKEN BEFORE ANY ANALYSIS AND DEDUPED ACROSS ROOTS ──────────────────────────────
   One snapshot per root, then the summation rule, then the reads. Taking every opening snapshot
   first is what makes the dedupe possible at all: the alias is a fact about the pair of roots, and
   analysing the first before looking at the second would spend an hour to learn it twice. */
const opening = dirs.map((d) => ({ dir: d, snap: snapshotEntries(d, { list: listO2RingPpg, unit: PPG_UNIT }) }));
/* The PATH rule is still worth printing — it names WHY two roots overlap — but the READ decision is
   the file-set rule above it, so the two are computed separately and both are reported. */
const pathRows = dedupeRoots(
  opening.map(({ dir, snap }) => ({ root: dir, count: snap.ok ? snap.n : null, why: snap.ok ? null : snap.reason })),
  realpathSync
);
const rootRows = dedupeMembers(
  opening.map(({ dir, snap }, i) => ({
    root: dir,
    members: snap.ok ? snap.members.map((m) => join(dir, m)) : null,
    reason: snap.reason,
    pathWhy: pathRows[i].why || null
  })),
  realpathSync
);
console.log('\nroots offered:');
for (const r of rootRows) {
  const mark = r.members === null ? '✗' : r.counted ? '·' : '⊘';
  const n = r.members === null ? 'NOT READABLE' : `${r.members.length} file(s)`;
  const over = r.shared.length ? ` — ${r.shared.length} already counted under ${r.sharedWith}${r.pathWhy ? ` (${r.pathWhy})` : ''}` : r.pathWhy ? ` — ${r.pathWhy}` : '';
  console.log(`  ${mark} ${r.root}: ${n}${r.members === null ? ` — ${r.reason}` : over}`);
}
const summed = rootRows.filter((r) => r.counted);
console.log(
  `  summed ${summed.reduce((a, r) => a + r.read.length, 0)} file(s) over ${summed.length} of ${rootRows.length} root(s) — a file already counted under an earlier root is NAMED and not read twice`
);
/* ∅ NO READABLE ROOT IS NOT A ZERO. Every root refusing is indistinguishable from an empty corpus
   unless the run says which happened, so it refuses by exit code as well as in words. */
if (!summed.length) {
  console.error('refused: no offered root is readable from this machine, so this run cannot tell an empty corpus from an unreachable one');
  process.exit(2);
}

for (const { dir: d, snap } of opening) {
  const rr = rootRows.find((r) => r.root === d);
  if (rr.members === null) {
    console.log(`\n== ${d} ==\n  refused: ${rr.reason}`);
    continue;
  }
  if (!rr.counted) {
    const why = rr.shared.length ? `every one of its ${rr.shared.length} file(s) is already counted under ${rr.sharedWith}` : 'it offered no O2Ring _PPG.txt at all';
    console.log(`\n== ${d} ==\n  not read: ${why}${rr.pathWhy ? ` (${rr.pathWhy})` : ''}`);
    continue;
  }
  /* The files THIS root contributes, which is its offer minus whatever an earlier root already
     counted. A partial overlap reads in full here and the shared half is named above. */
  const contributed = rr.read.length;
  let files = rr.read;
  if (LIMIT) files = files.slice(0, LIMIT);
  let seen = 0,
    unknown = 0;
  const mine = [];
  for (const f of files) {
    seen++;
    if (done.has(f)) {
      const r = rows.find((x) => x.f === f);
      if (r) mine.push(r);
      /* A DONE FILE WITH NO ROW IS NOT AN ANALYSED FILE AND NOT A CLEAN ONE. Under v2 a throw
         carries its own row, so this bin can only hold a v1 checkpoint's thrown files. */ else unknown++;
      continue;
    }
    try {
      const a = P.analyze(P.parsePPG(readFileSync(f, 'utf8')), () => {});
      const row = { f, nPinSpanIntervals: a?.nPinSpanIntervals ?? null, nInputIntervals: a?.nInputIntervals ?? null };
      mine.push(row);
      rows.push(row);
    } catch {
      /* THE THROW IS A ROW, so a resumed run can still count it. Both counts are `null`, which is
         what keeps `reduce` from ever treating it as a measured file. */
      const row = { f, nPinSpanIntervals: null, nInputIntervals: null, threw: true };
      mine.push(row);
      rows.push(row);
    }
    done.add(f);
    /* HEARTBEAT (§2.4): a REAL running value, not a placeholder — the pinned total so far, so a
       partial run already answers the question rather than only reporting a position. */
    if (seen % 25 === 0) {
      const r = reduce(mine);
      process.stderr.write(`  …${seen}/${files.length}  affected ${r.withPin}  pinned ${r.totPin}/${r.totIn}\n`);
      saveCkpt({ done: [...done], rows });
    }
  }
  saveCkpt({ done: [...done], rows });
  const r = reduce(mine);
  const threw = mine.filter((x) => x.threw).length;
  const pc = (v) => (v == null ? 'n/a (nothing measured)' : v.toFixed(v < 10 ? 3 : 2) + ' %');
  console.log(`\n== ${d} ==`);
  /* `threw 0` BESIDE AN INHERITED-UNKNOWN BUCKET READS AS A CLEAN TREE, which is the very reading
     this unit is about, so the headline carries the unknown too rather than leaving it to the bins. */
  console.log(
    `  O2Ring _PPG.txt read ${files.length} of ${snap.n} offered${LIMIT ? ` (LIMIT ${LIMIT} — sample, not the corpus)` : ''} · analysed ${r.analysed} · threw ${threw}${unknown ? ` · throw-state UNKNOWN for ${unknown}` : ''}`
  );
  console.log(`  files with >=1 pinned interval: ${r.withPin} (${pc(r.filePct)})`);
  console.log(`  pinned ${r.totPin} of ${r.totIn} INPUT intervals (${pc(r.intervalPct)})`);
  if (r.withPin) console.log(`  per-file share among affected: median ${r.median.toFixed(2)} % · p90 ${r.p90.toFixed(2)} % · max ${r.max.toFixed(2)} %`);
  /* ── THE POPULATION THIS BLOCK'S FIGURES WERE TAKEN OVER ──────────────────────────────────────
     THE SET MAY HAVE MOVED WHILE THIS RAN, and the closing walk is what says so. A daily job
     re-tiers the corpus, so a long run can open over one file set and close over another, and
     without the second walk a figure that moved because a capture arrived is indistinguishable
     from one that moved because a file changed. */
  const population = populationVerdict(snap, snapshotEntries(d, { list: listO2RingPpg, unit: PPG_UNIT }), {
    commit: commitOf.commit,
    commitReason: commitOf.reason,
    tool: 'tools/pin-coverage.mjs',
    evidence: ['tools/pin-coverage.mjs', 'tools/corpus-scope-core.mjs']
  });
  /* `found` IS THE ROOT'S WHOLE OFFER, not the set it contributed, so the shared half is a bin and
     not an absence. The identity then holds over the number the population object publishes. */
  const acct = accountFiles({ found: snap.n, analysed: r.analysed, threw, unknown, capped: contributed - files.length, shared: rr.shared.length });
  console.log(
    `  population: ${population.population.checked} offered ${snap.unit} the run can report over, of ${population.population.eligible} it saw · movement ${population.status}${population.reason ? ` — ${population.reason}` : ''}`
  );
  const rl = ruleLine(population);
  if (rl) console.log(rl);
  console.log(
    `  bins: analysed ${acct.analysed} · threw ${acct.threw} · inherited-unknown ${acct.unknown} · left under the cap ${acct.capped} · counted under an earlier root ${acct.shared} = ${acct.binned} of ${acct.found} offered` +
      (acct.ok ? '' : ` · ⚠ ${acct.unaccounted} UNACCOUNTED — this block's rate is over a set it cannot name`)
  );
  if (acct.unknown) console.log(`  the ${acct.unknown} inherited file(s) come from a v${PRIOR_V} checkpoint that records no throw, so whether they threw is UNKNOWN, not zero`);
  const badNights = unreadableNightsUnder(d);
  if (badNights && badNights.length) console.log(`  ${badNights.length} night director${badNights.length === 1 ? 'y' : 'ies'} this process cannot open, by name: ${badNights.slice(0, 8).join(' · ')}`);
  /* The object beside the prose, per §🧾 — the prose explains, this is the API. */
  console.log('POPULATION ' + JSON.stringify(population));
}

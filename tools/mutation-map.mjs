/*
 * tools/mutation-map.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * WHERE THE COVERAGE MAP LIVES, AND WHETHER IT STILL DESCRIBES THIS CODE.
 *
 * `tools/per-group-coverage.mjs` builds a line→groups map so `mutate.mjs` runs 3 groups per mutant
 * instead of 300 (MUTATION-PROGRAM-FOLLOWUPS §6 calls that the one optimisation worth building
 * before more tests; it estimates 10–100×). Two things were wrong with how that map was handled,
 * both measured 2026-08-17, and they fail in OPPOSITE directions.
 *
 * 1 · IT NEVER REACHED THE SWEEPS. The map is an UNTRACKED build artefact written to
 *     `<root>/.mutation-sweeps/per-group.json`. Every sweep in this repo runs from a private
 *     worktree (CLAUDE.md §👥.1), and a worktree is a fresh tree: untracked files do not come
 *     with it. So a 1.76 MB map sat in the main checkout since 2026-08-14 while every sweep
 *     silently took the slow path — ecgdex 290 min, oxydex 193 min, both unselected.
 *     `mutate.mjs` treats an absent map as "no selection" and falls back to the tag filter, which
 *     is CORRECT and is exactly why nobody noticed: it fails safe into slow, never into wrong.
 *     Fix: resolve the map from the git COMMON directory, which every worktree of a repo shares,
 *     so one map serves all of them. The legacy path is still read, so nothing breaks.
 *
 * 2 · IT CARRIED NO IDENTITY. The written record was `{ generated: null, … }` — no hashes, no
 *     commit, no timestamp that was ever set. A map is a function of LINE NUMBERS, and line
 *     numbers move for reasons as trivial as a comment: PR #1422 inserted 16 comment lines into
 *     `oxydex-dsp.js` and shifted every line below 1023. A map that is merely ABSENT costs time.
 *     A map that is PRESENT AND STALE selects the wrong groups — and a mutant run against groups
 *     that do not execute its line SURVIVES. That is the one direction that manufactures
 *     findings, and it would arrive disguised as a spectacular speedup.
 *
 * So identity is per-FILE, not per-map: a map covering eight DSPs must not be thrown away because
 * one of them moved. Selection is refused for the files that drifted and kept for the rest.
 *
 * FAILS CLOSED EVERYWHERE. Unreadable map, missing identity, unhashable source, file absent from
 * the map — every one returns "do not select", and the caller falls back to the tag filter. An
 * unstamped map (every map built before this module) is refused for the same reason a journal
 * without a stamp is: it may be perfectly good, and there is no way to tell.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAP_BASENAME = 'per-group.json';

/** Short content hash — the same 16-hex projection the sweep-state stamp uses. */
export const sha16 = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

/*
 * Candidate locations for a shared cache file, most-preferred first.
 *
 * ⚠️ THE MAP IS ONE INSTANCE OF A STRUCTURAL TRAP, NOT THE WHOLE OF IT.
 *
 * Measured 2026-08-17: **ten** tools read from `.mutation-sweeps/` — `mutation-worklist.mjs` (the
 * work queue), `survivor-witness.mjs`, `assertion-strength.mjs`, `witness-baseline.mjs`,
 * `per-group-coverage.mjs`, `stmt-delete.mjs`, `extreme-mutate.mjs`, `doc-search.mjs` and both
 * halves of this suite. That directory is **gitignored**, and CLAUDE.md §👥.1 instructs every
 * session to work in a private worktree — which is a fresh tree that ignored files do not follow.
 *
 * So the trap is not "somebody forgot to commit a file". It is that ANY tool here which caches to a
 * repo-relative ignored path is guaranteed to find nothing in the checkout where the work actually
 * happens, and to fail quietly, because an empty cache is indistinguishable from a cold start.
 *
 * `sharedStatePath` is the general fix and the other nine can adopt it unchanged: the git COMMON
 * directory resolves to the SAME place from the main checkout and from every linked worktree, so
 * one copy serves all of them. The in-tree path is kept as a fallback so existing caches keep
 * working and nothing has to be migrated in a hurry.
 */
export function sharedStatePath(root, name) {
  const out = [];
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
    if (common) out.push(join(common.startsWith('/') ? common : join(root, common), 'tepna-mutation', name));
  } catch {
    /* not a git checkout ⇒ no shared location; the in-tree path below still works */
  }
  out.push(join(root, '.mutation-sweeps', name));
  return out;
}

export function mapCandidates(root) {
  return sharedStatePath(root, MAP_BASENAME);
}

/**
 * READ resolution over the candidates: first that exists, else the SHARED location — so a fresh
 * worktree reads the state every other checkout wrote, and a tool that then writes creates it in
 * the place all of them will find. The in-tree `.mutation-sweeps/` survives purely as legacy READ
 * fallback for state written before the migration (MUTATION-SUITE-FOLLOWUPS §1).
 */
export function resolveStatePath(root, name, existsFn = existsSync) {
  const c = sharedStatePath(root, name);
  for (const p of c) if (existsFn(p)) return p;
  return c[0];
}

/**
 * Directory-level candidates, for the tools that scan a sweeps DIRECTORY rather than opening one
 * named file (`mutation-worklist`, `survivor-witness`, `witness-baseline`). Same order and the same
 * argument as above: shared first, in-tree as legacy fallback.
 */
export function stateDirs(root) {
  return sharedStatePath(root, '.').map((p) => dirname(join(p, 'x')));
}

/** First state DIRECTORY that exists, else the shared one (created by whoever writes first). */
export function resolveStateDir(root, existsFn = existsSync) {
  const c = stateDirs(root);
  for (const p of c) if (existsFn(p)) return p;
  return c[0];
}

/**
 * UNION scan for the directory-readers (`survivor-witness`, `witness-baseline`): every `*.json`
 * across BOTH candidate dirs, shared copy winning a basename tie. During the §1 transition the state
 * is genuinely split — old sweeps in-tree, new state shared — and picking ONE dir at either grain
 * mis-reads the world: the first draft of this migration chose first-existing-DIR and eight present
 * sweeps read as a lost queue, because the shared dir existed for other reasons.
 */
export function stateJsonFiles(root, { existsFn = existsSync, readdirFn = readdirSync } = {}) {
  const seen = new Map();
  for (const dir of stateDirs(root)) {
    if (!existsFn(dir)) continue;
    let names = [];
    try {
      names = readdirFn(dir);
    } catch {
      continue; // an unreadable dir contributes nothing, and the OTHER candidate still scans
    }
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      if (!seen.has(n)) seen.set(n, join(dir, n)); // shared-first order ⇒ shared wins ties
    }
  }
  return [...seen.entries()].map(([name, path]) => ({ name, path }));
}

/** First candidate that exists, or null. */
export function resolveMapPath(root, existsFn = existsSync) {
  for (const p of mapCandidates(root)) if (existsFn(p)) return p;
  return null;
}

/**
 * The identity a map was built under: a content hash per mapped source file, plus the suite.
 *
 * `tests/dex-tests.js` is included because the map's values are GROUP INDICES. Insert a group and
 * every later index shifts, so a map read against a changed suite can select group 41 believing it
 * is group 40 — a mis-selection that no per-file source hash would catch.
 */
export function buildIdentity(root, files, readFn = readFileSync) {
  const sources = {};
  for (const f of files) {
    try {
      sources[f] = sha16(readFn(join(root, f), 'utf8'));
    } catch {
      /* a file we cannot read cannot be stamped, so it simply is not claimed */
    }
  }
  let tests = null;
  try {
    tests = sha16(readFn(join(root, 'tests/dex-tests.js'), 'utf8'));
  } catch {
    /* no suite ⇒ no claim; verifyFor then refuses everything, which is the fail-closed answer */
  }
  /* ── THE RUNNER ENUMERATES THE GROUPS, SO IT IS PART OF THE IDENTITY ──────────────────────────
     The map's values are group INDICES, and those indices come from `tests/run-tests.mjs --list` —
     not from `dex-tests.js` directly. So a change to the ENUMERATING PROGRAM (an added filter, a
     reordering, a skip rule) can shift every index while the suite file itself is untouched, and a
     stamp hashing only the suite would report "unchanged" and let the map mis-select. That is
     exactly the failure this stamp exists to prevent, with a hole in it.
     Found by a peer session asking whether their edit to `run-tests.mjs`'s `readSources` affected
     this. It did not — adding a source entry adds no group — but the question exposed the gap, and
     "this particular change was harmless" is not the same as "this input cannot matter". */
  let runner = null;
  try {
    runner = sha16(readFn(join(root, 'tests/run-tests.mjs'), 'utf8'));
  } catch {
    /* unreadable runner ⇒ unclaimed ⇒ refused, the same fail-closed answer */
  }
  return { sources, tests, runner };
}

/**
 * May this map be used to select groups for `file`? Returns `{ ok, reason }` — never a bare bool,
 * because a refusal the reader cannot explain is a refusal they will disable.
 */
export function verifyFor(map, file, now) {
  if (!map || typeof map !== 'object') return { ok: false, reason: 'no map' };
  if (!Array.isArray(map.groups) || !map.groups.length) return { ok: false, reason: 'map has no groups' };
  const id = map.identity;
  /* Every map built before this module has no identity. It may be perfectly good; there is no way
     to tell, and "no way to tell" is not a licence. */
  if (!id || !id.sources) return { ok: false, reason: 'map carries no identity stamp (built before stamping, or truncated)' };
  if (!now || !now.tests) return { ok: false, reason: 'cannot hash tests/dex-tests.js to compare' };
  if (id.tests !== now.tests) return { ok: false, reason: 'tests/dex-tests.js changed since the map was built — group INDICES may have shifted' };
  /* An older map carries no `runner` field. Absent is not "matches" — it is unattributable, and the
     entire point of the stamp is that unattributable never passes. */
  if (!now.runner || id.runner !== now.runner) return { ok: false, reason: 'tests/run-tests.mjs changed (or the map predates runner stamping) — it enumerates the group INDICES the map is keyed on' };
  const want = now.sources && now.sources[file];
  if (!want) return { ok: false, reason: 'cannot hash ' + file + ' to compare' };
  if (!(file in id.sources)) return { ok: false, reason: file + ' is not in the map' };
  if (id.sources[file] !== want) return { ok: false, reason: file + ' changed since the map was built — its line numbers have moved' };
  return { ok: true, reason: 'map identity matches for ' + file };
}

// ── selftest ───────────────────────────────────────────────────────────────────────────────────
function selftest() {
  let fail = 0;
  let ran = 0;
  const ck = (n, got, want) => {
    ran++;
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log((ok ? '  ✓ ' : '  ✕ ') + n + (ok ? '' : '  got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)));
    if (!ok) fail++;
  };
  const G = [{ index: 0, files: {} }];
  const now = { sources: { 'a.js': 'AAA', 'b.js': 'BBB' }, tests: 'TTT', runner: 'RRR' };
  const good = { groups: G, identity: { sources: { 'a.js': 'AAA', 'b.js': 'BBB' }, tests: 'TTT', runner: 'RRR' } };

  console.log('verifyFor — a stale map fabricates SURVIVED, so every doubt refuses');
  ck('a matching stamp permits selection', verifyFor(good, 'a.js', now).ok, true);
  ck('a moved SOURCE refuses that file', verifyFor({ ...good, identity: { sources: { 'a.js': 'OLD', 'b.js': 'BBB' }, tests: 'TTT', runner: 'RRR' } }, 'a.js', now).ok, false);
  /* Per-file, not per-map: one moved DSP must not cost selection on the other seven. */
  ck('…and ONLY that file — the others keep selection', verifyFor({ ...good, identity: { sources: { 'a.js': 'OLD', 'b.js': 'BBB' }, tests: 'TTT', runner: 'RRR' } }, 'b.js', now).ok, true);
  /* The map's values are group INDICES; inserting a group shifts them all, and no per-file source
     hash can see that. This is the assertion that justifies hashing the suite at all. */
  ck('a moved SUITE refuses everything — group indices shift', verifyFor({ ...good, identity: { sources: { 'a.js': 'AAA' }, tests: 'OLD', runner: 'RRR' } }, 'a.js', now).ok, false);
  ck(
    '…saying why',
    verifyFor({ ...good, identity: { sources: { 'a.js': 'AAA' }, tests: 'OLD', runner: 'RRR' } }, 'a.js', now).reason,
    'tests/dex-tests.js changed since the map was built — group INDICES may have shifted'
  );
  /* Every map built before stamping existed has no identity. It may be perfectly good; there is no
     way to tell, and "no way to tell" is not a licence to use it. */
  ck('an UNSTAMPED map is refused', verifyFor({ groups: G }, 'a.js', now).ok, false);
  /* THE RUNNER ENUMERATES THE GROUPS. `tests/run-tests.mjs --list` produces the indices the map is
     keyed on, so a change there can shift every index while dex-tests.js is untouched — invisible to
     a stamp that hashes only the suite. */
  ck('a changed RUNNER refuses — it produces the indices', verifyFor({ ...good, identity: { ...good.identity, runner: 'OLD' } }, 'a.js', now).ok, false);
  ck('…saying that it enumerates the indices', /enumerates the group INDICES/.test(verifyFor({ ...good, identity: { ...good.identity, runner: 'OLD' } }, 'a.js', now).reason), true);
  /* A map built before runner stamping has no such field. Absent is not "matches". */
  ck('a map predating runner stamping is refused', verifyFor({ groups: G, identity: { sources: { 'a.js': 'AAA' }, tests: 'TTT' } }, 'a.js', now).ok, false);
  ck('an unhashable current runner is refused', verifyFor(good, 'a.js', { sources: { 'a.js': 'AAA' }, tests: 'TTT', runner: null }).ok, false);
  ck('a file absent from the map is refused', verifyFor(good, 'zz.js', { sources: { 'zz.js': 'Z' }, tests: 'TTT', runner: 'RRR' }).ok, false);
  ck('an unhashable current source is refused', verifyFor(good, 'a.js', { sources: {}, tests: 'TTT', runner: 'RRR' }).ok, false);
  ck('an unhashable current suite is refused', verifyFor(good, 'a.js', { sources: { 'a.js': 'AAA' }, tests: null, runner: 'RRR' }).ok, false);
  ck('an empty map is refused', verifyFor({ groups: [], identity: good.identity }, 'a.js', now).ok, false);
  ck('a null map is refused', verifyFor(null, 'a.js', now).ok, false);

  console.log('\nbuildIdentity — hashes what it can, claims nothing it cannot read');
  const rd = (p) => {
    if (String(p).endsWith('gone.js')) throw new Error('ENOENT');
    return 'contents of ' + p;
  };
  const id = buildIdentity('/r', ['ok.js', 'gone.js'], rd);
  ck('a readable file is stamped', typeof id.sources['ok.js'], 'string');
  ck('an unreadable file is simply not claimed', 'gone.js' in id.sources, false);
  ck('identical content hashes identically', buildIdentity('/r', ['ok.js'], rd).sources['ok.js'], id.sources['ok.js']);

  console.log('\nresolveStatePath / stateDirs — the §1 migration contract, shared-first everywhere');
  /* THE ORDER IS THE CONTRACT (MUTATION-SUITE-FOLLOWUPS §1): the shared location is tried FIRST, so
     every worktree converges on one copy; the in-tree path survives only as legacy READ fallback. */
  ck('resolveStatePath tries the SHARED location first', /tepna-mutation\/w\.json$/.test(resolveStatePath(process.cwd(), 'w.json', () => true)), true);
  ck('…falls back to the in-tree path when only it exists', /\.mutation-sweeps\/w\.json$/.test(resolveStatePath(process.cwd(), 'w.json', (p) => /\.mutation-sweeps/.test(p))), true);
  ck('…and when NOTHING exists resolves to the SHARED one, so first write lands where all read', /tepna-mutation\/w\.json$/.test(resolveStatePath(process.cwd(), 'w.json', () => false)), true);
  ck('stateDirs orders shared before in-tree', /tepna-mutation$/.test(stateDirs(process.cwd())[0]) && /\.mutation-sweeps$/.test(stateDirs(process.cwd())[1]), true);
  const sjf = stateJsonFiles(process.cwd(), { existsFn: () => true, readdirFn: (d) => (/tepna-mutation/.test(d) ? ['a.json', 'b.txt'] : ['a.json', 'c.json']) });
  ck('stateJsonFiles UNIONS both dirs — a split state is read whole, not one side', sjf.map((f) => f.name).sort().join(','), 'a.json,c.json');
  ck('…the SHARED copy wins a basename tie', /tepna-mutation/.test(sjf.find((f) => f.name === 'a.json').path), true);
  ck('…non-json entries never leak through', sjf.some((f) => f.name === 'b.txt'), false);
  ck('…an unreadable dir contributes nothing while the other still scans', stateJsonFiles(process.cwd(), { existsFn: () => true, readdirFn: (d) => { if (/tepna-mutation/.test(d)) throw new Error('EACCES'); return ['x.json']; } }).length, 1);
  ck('resolveStateDir falls back to an existing in-tree dir', /\.mutation-sweeps$/.test(resolveStateDir(process.cwd(), (p) => /\.mutation-sweeps$/.test(p))), true);

  console.log('\nresolveMapPath — the git COMMON dir, so every worktree sees one map');
  ck('prefers the first existing candidate', resolveMapPath('/r', (p) => p.endsWith('.mutation-sweeps/per-group.json')).endsWith('.mutation-sweeps/per-group.json'), true);
  ck(
    'none present ⇒ null, never a guessed path',
    resolveMapPath('/r', () => false),
    null
  );
  ck('the shared location is tried FIRST', /tepna-mutation/.test(mapCandidates(process.cwd())[0]), true);
  /* Ten tools cache to the gitignored .mutation-sweeps/, and §👥.1 puts every session in a worktree
     that ignored files do not follow. The general resolver is what the other nine can adopt. */
  ck('sharedStatePath is general, not map-specific', /tepna-mutation\/worklist\.json$/.test(sharedStatePath(process.cwd(), 'worklist.json')[0]), true);
  ck('…and always offers the legacy in-tree path as a fallback', /\.mutation-sweeps\/worklist\.json$/.test(sharedStatePath(process.cwd(), 'worklist.json')[1]), true);
  ck('mapCandidates is now just one caller of it', mapCandidates(process.cwd())[0], sharedStatePath(process.cwd(), MAP_BASENAME)[0]);

  /* `all N selftests passed` is the form tools/selftest-all.mjs parses for a COUNT; a bare
     'all green' is recognised but countless, and a count is what makes a silent drop from 30
     assertions to 3 visible in CI. */
  console.log(fail ? '\nselftest: ' + fail + ' FAILED' : '\nselftest: all ' + ran + ' selftests passed');
  return fail ? 1 : 0;
}

/* ONLY WHEN INVOKED AS A PROGRAM. A bare `argv.includes('--selftest')` here made this module ACT ON
   IMPORT: `node tools/mutation-suite.mjs --selftest` imports this file, the condition was true in
   the importer's argv, and THIS selftest ran and called process.exit — so the suite's own
   assertions never executed and the run reported "all green" for tests that had not been reached.
   A check that examined nothing and reported cleanly; mutation-crawl.mjs documents the same trap. */
const INVOKED_DIRECTLY = (() => {
  try {
    return !!process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();
if (INVOKED_DIRECTLY && process.argv.includes('--selftest')) process.exit(selftest());

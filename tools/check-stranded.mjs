#!/usr/bin/env node
/*
 * tools/check-stranded.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * DID YOUR WORK ACTUALLY REACH `main`? — the stranded-commit detector.
 *
 * A squash merge collapses a PR's diff AS OF MERGE TIME. Anything pushed to the branch afterwards
 * stays on the branch ref and is never on `main`. Nothing goes red: `git log origin/main..HEAD` still
 * lists the commits, the branch pushes fine, `gh pr view` says MERGED, and the work is gone.
 *
 * Measured 2026-08-11: #1163 squash-merged carrying NINE files while its branch was FIFTEEN commits
 * ahead. Twelve commits — killcheck, the work list, the whole extreme-mutation tool, the resumable
 * sweep — had never reached `main`. It surfaced only because an unrelated cherry-pick reported `DU`
 * on files that had just been written.
 *
 * ── WHY NOT THE TWO OBVIOUS CHECKS ───────────────────────────────────────────────────────────
 * BOTH FAIL HERE, in opposite directions, and each looks authoritative:
 *
 * · `git cherry origin/main <branch>` compares PATCH-IDs. A squash merge collapses N commits into
 *   one, so NO individual patch-id survives — it marks every commit `+` (missing upstream) even for a
 *   PR that merged perfectly. 100 % false positives on the exact workflow this repo uses.
 *
 * · COMPARING TIMESTAMPS — branch head date vs the PR's `mergedAt` — is a proxy for the question, and
 *   a fragile one. A sibling session wrote exactly that check tonight and compared `git log %cI`
 *   (local, EDT) against `gh pr view --json mergedAt` (UTC): a uniform −4 h offset on every row, so
 *   all six PRs printed "ok". It was the RIGHT ANSWER FROM A BROKEN COMPARISON — a push landing up to
 *   four hours after a merge would have read clean. That variant is nastier than the usual
 *   false-green, because nothing looks wrong.
 *
 * ── WHAT THIS DOES INSTEAD: COMPARE CONTENT, THREE WAYS ──────────────────────────────────────
 * Squash-safe and clock-free. For every path the branch touched relative to its merge-base:
 *
 *     base   = merge-base(origin/main, branch)      what the branch started from
 *     branch = the branch tip                        what you wrote
 *     main   = origin/main                           what actually shipped
 *
 *   main ≡ branch          →  LANDED     the content is on main, however it got there
 *   main ≡ base ≠ branch   →  STRANDED   main never saw your change. This is the bug.
 *   all three differ       →  DIVERGED   main has a THIRD version — someone else edited it, or you
 *                                        landed part of it. Needs eyes; not automatically a failure.
 *
 * The middle case is the only one that fires on the failure, and it cannot fire on a healthy squash
 * merge: if the PR merged your change, main's blob equals the branch's.
 *
 * ⚠️ DIVERGED IS NOT A PASS. It is "I cannot tell", and this tool says so rather than picking. A tool
 * that resolved it by guessing would be the third instrument in this file's list of ones that answer
 * a question they never asked.
 *
 * USAGE
 *   node tools/check-stranded.mjs                     # current branch vs origin/main
 *   node tools/check-stranded.mjs --branch claude/foo
 *   node tools/check-stranded.mjs --json
 *   node tools/check-stranded.mjs --selftest
 *
 * Exit 0 = nothing stranded · 1 = stranded paths found · 2 = could not determine.
 * ══════════════════════════════════════════════════════════════════════════════════════════ */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d;
};
const IS_MAIN = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/* THE WHOLE DECISION, as a pure function of three blob identities. Pure because this is the part that
   must be pinned: every wrong version of this check was wrong in the comparison, not in the plumbing.
   A missing file is `null` — a path the branch ADDED has no base blob, and a path it DELETED has no
   branch blob, and both are ordinary cases rather than errors. */
export function classifyPath({ base, main, branch }) {
  if (main === branch) return 'landed';
  /* main still holds exactly what the branch started from, and the branch moved away from it. Nothing
     of this change reached main — including the case where the branch ADDED the file (base === null)
     and main still does not have it. */
  if (main === base) return 'stranded';
  return 'diverged';
}

/* ── RESOLVING `DIVERGED`, because it is the verdict that gets skimmed ────────────────────────
   A sibling session ran this algorithm over six merged PRs: DIVERGED was the MAJORITY of non-trivial
   rows — 5 of 6 branches had one — and every instance was benign, a later PR having touched the same
   file. `polar_pmd.py`, `webmon.py`, `DOCS-INDEX.md` are exactly the files several sessions touch in
   one night. A verdict that is usually benign and occasionally not is the shape nobody reads.

   So: ask whether the branch's OWN added lines are present in main's current blob. Present ⇒ the
   change landed and main merely moved on around it. Absent ⇒ the divergence is hiding a real loss.

   PRESENCE IN THE CURRENT BLOB, not `git log -S`. A history search would answer "main saw this line
   once", which stays true after a later commit removed it — the wrong question by one word.

   Distinctive lines only. A `+}` or a blank matches everywhere and would resolve every row to LANDED,
   which is the failure mode that matters here: this refinement can only ever turn a loud verdict
   quiet, so its bar has to be high. Fewer than two usable lines ⇒ it declines and DIVERGED stands. */
export function distinctiveAdded(diffText, min = 24) {
  return String(diffText || '')
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1).trim())
    .filter((l) => l.length >= min && /[A-Za-z]/.test(l))
    .filter((l, i, a) => a.indexOf(l) === i);
}

export function refineDiverged(lines, mainText) {
  if (!lines || lines.length < 2) return { verdict: 'diverged', reason: 'too few distinctive lines to probe' };
  const src = String(mainText || '');
  const absent = lines.filter((l) => !src.includes(l));
  if (absent.length === 0) return { verdict: 'landed-with-evidence', reason: `all ${lines.length} added lines present on main` };
  if (absent.length === lines.length) return { verdict: 'stranded', reason: `none of ${lines.length} added lines are on main` };
  return { verdict: 'diverged', reason: `${absent.length}/${lines.length} added lines missing from main`, absent: absent.slice(0, 3) };
}

/* Seconds between a push and the merge that was supposed to carry it. Kept as a DIAGNOSTIC beside the
   content verdict, never as the verdict — see the header. Both inputs are forced to epoch seconds
   before subtraction, because the one thing known to go wrong here is comparing a local-time string
   to a UTC one and getting a uniform offset that reads as clean. */
export function pushedAfterMergeSec(headEpochSec, mergedAtISO) {
  const h = Number(headEpochSec);
  const m = Math.floor(Date.parse(mergedAtISO) / 1000);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h - m;
}

const git = (args, d = null) => {
  try {
    /* stderr IGNORED, deliberately. `rev-parse <rev>:<path>` prints a `fatal:` line for a path that
       is absent at that rev, and absence is a NORMAL state here — a path the branch added, or one
       main never received. Leaking those makes a clean run look like a catastrophe. */
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) {
    return d;
  }
};
/* `git rev-parse <rev>:<path>` prints the BLOB id, or fails when the path is absent at that rev.
   Absence is a real state here, not an error — hence the null. */
const blob = (rev, path) => git(['rev-parse', `${rev}:${path}`], null);

/* WHICH REF DOES `--pr <N>` INSPECT? Pure, because this is the decision the whole mode exists to
   make and it must be pinned: **the OID, never the branch name.** A merged branch is reaped by
   `delete_branch_on_merge`, so the name is gone while the head commit remains retrievable — the
   failure this replaces was a lookup keyed on a name that no longer exists, not a closed window and
   not an unfetchable commit. A future refactor that "simplifies" this back to `headRefName` would
   restore the exact bug with every test still green, which is why the assertion is on the CHOICE
   rather than on the output. */
export function prRefChoice(pr) {
  if (!pr || typeof pr.headRefOid !== 'string' || !/^[0-9a-f]{7,40}$/.test(pr.headRefOid)) return { refuse: 'PR has no usable headRefOid' };
  return {
    ref: pr.headRefOid,
    label: '#' + pr.number + ' (' + (pr.headRefName || '<branch deleted>') + ' @ ' + pr.headRefOid.slice(0, 9) + ')',
    usedName: false
  };
}

if (IS_MAIN && has('--selftest')) {
  let pass = 0,
    fail = 0;
  const eq = (n, a, e) => {
    if (String(a) === String(e)) {
      pass++;
      console.log('  ✓ ' + n);
    } else {
      fail++;
      console.log('  ✗ ' + n + '  — got ' + a + ' · want ' + e);
    }
  };

  eq('main has the branch content — landed', classifyPath({ base: 'A', main: 'B', branch: 'B' }), 'landed');
  eq('main still holds the base and the branch moved — STRANDED', classifyPath({ base: 'A', main: 'A', branch: 'B' }), 'stranded');
  eq('a file the branch ADDED that main does not have — STRANDED', classifyPath({ base: null, main: null, branch: 'B' }), 'stranded');
  eq('a file the branch DELETED that main still has — STRANDED', classifyPath({ base: 'A', main: 'A', branch: null }), 'stranded');
  eq('three different blobs — DIVERGED, not a pass', classifyPath({ base: 'A', main: 'C', branch: 'B' }), 'diverged');
  eq('…and diverged is never reported as landed', classifyPath({ base: 'A', main: 'C', branch: 'B' }) === 'landed', false);
  eq('an untouched file reads landed, not stranded', classifyPath({ base: 'A', main: 'A', branch: 'A' }), 'landed');
  /* The healthy squash merge, which the patch-id check gets WRONG: the branch's commits have no
     upstream equivalents, but every blob matches. Content sees it; `git cherry` cannot. */
  eq('a squash-merged PR reads landed on every path', ['x', 'y', 'z'].map((b) => classifyPath({ base: 'A', main: b, branch: b })).join(','), 'landed,landed,landed');

  /* The timezone bug, pinned so it cannot come back. Same instant, two spellings. */
  const MERGED = '2026-08-11T20:22:11Z';
  const AT_MERGE = Math.floor(Date.parse(MERGED) / 1000);
  eq('a push at the merge instant is 0 s, not ±14400', pushedAfterMergeSec(AT_MERGE, MERGED), 0);
  eq('a push 30 min AFTER the merge is positive', pushedAfterMergeSec(AT_MERGE + 1800, MERGED), 1800);
  eq('a push 30 min BEFORE is negative', pushedAfterMergeSec(AT_MERGE - 1800, MERGED), -1800);
  /* A 4 h offset is EXACTLY the magnitude of the EDT/UTC mistake, and it must not be silently
     absorbed: a push 2 h after a merge has to read positive, not "clean". */
  eq('a push 2 h after a merge is NOT absorbed by a 4 h timezone slip', pushedAfterMergeSec(AT_MERGE + 7200, MERGED) > 0, true);
  eq('a non-date returns null rather than NaN-compares as safe', pushedAfterMergeSec(AT_MERGE, 'not a date'), null);
  eq('a non-numeric head returns null', pushedAfterMergeSec('nope', MERGED), null);

  /* ── THE DIVERGED PROBE ───────────────────────────────────────────────────────────────────── */
  const DIFF = ['+++ b/x.js', '+  const distinctiveIdentifierOne = 1;', '+}', '+', '+  const distinctiveIdentifierTwo = 2;', '-  gone();'].join('\n');
  eq('only distinctive ADDED lines are probed', distinctiveAdded(DIFF).join('|'), 'const distinctiveIdentifierOne = 1;|const distinctiveIdentifierTwo = 2;');
  eq(
    '…the +++ header is not a code line',
    distinctiveAdded(DIFF).some((l) => l.includes('+++')),
    false
  );
  eq('…and a bare `+}` is excluded — it would match everywhere and resolve every row to LANDED', distinctiveAdded(DIFF).includes('}'), false);
  eq(
    'removed lines are not added lines',
    distinctiveAdded(DIFF).some((l) => l.includes('gone')),
    false
  );

  const L = distinctiveAdded(DIFF);
  eq('every added line present on main — resolves to landed WITH EVIDENCE', refineDiverged(L, L.join('\n')).verdict, 'landed-with-evidence');
  eq('none present — the divergence was hiding a real loss', refineDiverged(L, 'unrelated content').verdict, 'stranded');
  eq('some present — stays DIVERGED rather than being resolved either way', refineDiverged(L, L[0]).verdict, 'diverged');
  eq('…and names what is missing', refineDiverged(L, L[0]).absent.length, 1);
  /* The refinement can only ever turn a LOUD verdict quiet, so it must decline when it cannot see
     enough. One line is not a sample. */
  eq('fewer than two distinctive lines — DECLINES, diverged stands', refineDiverged(['x'], 'x').verdict, 'diverged');
  eq('no lines at all — declines rather than declaring landed', refineDiverged([], 'anything').verdict, 'diverged');

  /* THE DELETED-BRANCH CASE — the only case `--pr` exists for, and the one the pre-existing tests
     structurally could not reach because every one of them addressed a branch by NAME. */
  {
    var gone = prRefChoice({ number: 2102, headRefOid: '363a09271312c83fe2e2bc65e3dbbb4b935173f3', headRefName: null });
    eq('a reaped branch resolves to its head OID', gone.ref, '363a09271312c83fe2e2bc65e3dbbb4b935173f3');
    eq('the ref is the OID, never the branch name', gone.usedName, false);
    eq('the label says the branch is gone rather than printing null', /<branch deleted>/.test(gone.label), true);
    var live = prRefChoice({ number: 7, headRefOid: 'abc1234def5', headRefName: 'claude/x' });
    eq('a live branch still resolves by OID — one path, not two', live.ref, 'abc1234def5');
    eq('the label keeps the branch name when there is one', /claude\/x/.test(live.label), true);
    eq('no usable OID REFUSES rather than falling back to the name', !!prRefChoice({ number: 1, headRefOid: null }).refuse, true);
    eq('a missing payload refuses', !!prRefChoice(null).refuse, true);
  }

  console.log('\n' + (fail ? `✗ ${fail} failed, ${pass} passed` : `✓ all ${pass} selftests passed`));
  process.exit(fail ? 1 : 0);
}

if (IS_MAIN && !has('--selftest')) {
  /* ── `--pr <N>`: ask by NUMBER, resolve by OID ────────────────────────────────────────────────
     `delete_branch_on_merge` is true repo-wide, so the branch this tool wants to inspect is usually
     GONE by the time anyone runs it — and every path below addressed it by NAME, so the check was
     unavailable for exactly the merges it exists to audit.

     ⚠️ The cause is none of the three things it looks like. It is **not a closed window** (nothing
     expires), **not an unfetchable commit** (the head SHA is still retrievable long after the branch
     is reaped), and not a permissions problem. It is **a lookup keyed on a name that no longer
     exists** — `gh pr view <branch>` cannot resolve a deleted ref, so `state` came back UNKNOWN and
     the tool correctly declined on its own terms.

     `gh pr view` already accepts a PR NUMBER, so this is one invocation rather than a new
     integration: the same call that answers `state`/`mergedAt` also yields `headRefOid`, which is
     fetched by SHA and used everywhere a branch ref was. A deleted branch is unreachable by NAME,
     not by OID. */
  const prNum = opt('--pr', null);
  let branch = null;
  let prState = null,
    prMergedAt = null,
    prLabel = null;
  if (prNum != null) {
    if (!/^\d+$/.test(String(prNum))) {
      console.error('✗ --pr takes a PR NUMBER, got: ' + prNum);
      process.exit(2);
    }
    let j = null;
    try {
      j = JSON.parse(
        execFileSync('gh', ['pr', 'view', String(prNum), '--json', 'state,mergedAt,headRefOid,headRefName'], {
          encoding: 'utf8'
        })
      );
    } catch (_) {
      console.error(`✗ could not read PR #${prNum} from gh — is it a real PR, and is gh authenticated?`);
      process.exit(2);
    }
    prState = j.state;
    prMergedAt = j.mergedAt;
    /* Fetch the head by SHA. This is the step that makes a reaped branch inspectable, so a failure
       here is a REFUSAL naming what it wanted, never a silent fallback to the branch name — falling
       back would re-introduce the exact name lookup this mode exists to replace. */
    git(['fetch', '-q', 'origin', j.headRefOid]);
    if (!git(['cat-file', '-t', j.headRefOid], null)) {
      console.error(`✗ PR #${prNum}: head ${String(j.headRefOid).slice(0, 12)} is not retrievable from origin — cannot inspect it.`);
      process.exit(2);
    }
    const choice = prRefChoice({ ...j, number: prNum });
    if (choice.refuse) {
      console.error(`✗ PR #${prNum}: ${choice.refuse}`);
      process.exit(2);
    }
    branch = choice.ref;
    prLabel = choice.label;
  } else {
    branch = opt('--branch', git(['rev-parse', '--abbrev-ref', 'HEAD'], null));
  }
  if (!branch || branch === 'HEAD') {
    console.error('✗ cannot determine the branch — pass --branch <name> or --pr <N>.');
    process.exit(2);
  }
  /* ⚠️ THE QUESTION ONLY MEANS ANYTHING FOR A MERGED PR. An in-flight branch legitimately holds
     content that is not on main — that is what a branch IS. Reporting it as "stranded" would fire on
     every healthy PR in the repo, and a gate that is red by default gets switched off, taking the
     real finding with it (the same argument that kept a coverage threshold out of #1163). So the
     merge state is a PRECONDITION, checked first, and an unmerged branch is reported as
     not-applicable rather than as a pass — those are different answers. */
  let state = prState,
    mergedAt = prMergedAt;
  if (prNum == null) {
    try {
      const j = JSON.parse(execFileSync('gh', ['pr', 'view', branch, '--json', 'state,mergedAt'], { encoding: 'utf8' }));
      state = j.state;
      mergedAt = j.mergedAt;
    } catch (_) {
      /* no PR, or no gh — handled below */
    }
  }
  const shown = prLabel || branch;
  if (state !== 'MERGED') {
    console.log(`\n▸ ${shown}: PR state ${state || 'UNKNOWN'} — nothing to check.`);
    console.log('  Content missing from main is EXPECTED on an unmerged branch. This tool answers');
    console.log('  "did the merge carry everything", which only has an answer after a merge.');
    process.exit(0);
  }
  git(['fetch', '-q', 'origin', 'main']);
  const base = git(['merge-base', 'origin/main', branch], null);
  if (!base) {
    console.error('✗ no merge-base between origin/main and ' + branch + ' — refusing to guess.');
    process.exit(2);
  }

  const paths = (git(['diff', '--name-only', base, branch], '') || '').split('\n').filter(Boolean);
  const rows = paths.map((p) => ({
    path: p,
    verdict: classifyPath({ base: blob(base, p), main: blob('origin/main', p), branch: blob(branch, p) })
  }));
  for (const r of rows) {
    if (r.verdict !== 'diverged') continue;
    const lines = distinctiveAdded(git(['diff', base, branch, '--', r.path], ''));
    const ref = refineDiverged(lines, git(['show', `origin/main:${r.path}`], ''));
    r.verdict = ref.verdict;
    r.reason = ref.reason;
    if (ref.absent) r.absent = ref.absent;
  }
  const stranded = rows.filter((r) => r.verdict === 'stranded');
  const landedEv = rows.filter((r) => r.verdict === 'landed-with-evidence');
  const diverged = rows.filter((r) => r.verdict === 'diverged');

  /* THE DIAGNOSTIC, printed beside the verdict and never as it. A positive value means the branch was
     pushed after its PR merged, which is the MECHANISM of the failure — but it is not the failure,
     and the two disagree in both directions: a post-merge push that changed nothing is harmless, and
     a pre-merge push can still be excluded if the PR merged an older SHA. Reported so the content
     verdict has a plausible cause attached; the content verdict stands on its own. */
  const delta = pushedAfterMergeSec(git(['log', '-1', '--format=%ct', branch], null), mergedAt);

  if (has('--json')) {
    console.log(JSON.stringify({ branch, base, mergedAt, pushedAfterMergeSec: delta, paths: paths.length, stranded, diverged, landedWithEvidence: landedEv }, null, 2));
  } else {
    console.log(`\n▸ ${branch} vs origin/main · ${paths.length} path(s) touched since ${base.slice(0, 9)}`);
    if (delta != null) {
      const mins = Math.round(delta / 60);
      console.log(`  head was pushed ${mins >= 0 ? mins + ' min AFTER' : -mins + ' min before'} the merge at ${mergedAt}` + (delta > 0 ? '  ← the mechanism' : ''));
    }
    if (stranded.length) {
      console.log(`\n  ✗ ${stranded.length} STRANDED — origin/main still holds the merge-base version:`);
      for (const r of stranded) console.log('      ' + r.path);
      console.log('\n  These are on the branch and NOT on main. If the PR is already merged, they are');
      console.log('  invisible: nothing is red, the branch pushes, and gh reports MERGED. Recover with');
      console.log('    git worktree add ../wt-<task> -b claude/<task> origin/main');
      console.log('    git cherry-pick <the stranded commits, in order>');
    }
    if (landedEv.length) {
      console.log(`\n  ✓ ${landedEv.length} was DIVERGED, resolved by probe — main holds a later version that still contains this branch's lines:`);
      for (const r of landedEv) console.log('      ' + r.path + '  (' + r.reason + ')');
    }
    if (diverged.length) {
      console.log(`\n  ? ${diverged.length} DIVERGED — main holds a THIRD version. Not a verdict; look:`);
      for (const r of diverged) console.log('      ' + r.path + '  — ' + (r.reason || '') + (r.absent ? '\n          missing: ' + r.absent.join(' | ') : ''));
    }
    if (!stranded.length && !diverged.length) console.log('  ✓ every touched path is on main');
  }
  process.exit(stranded.length ? 1 : 0);
}

#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * ────────────────────────────────────────────────────────────────────────
 * commit-shape.mjs — the AGENT-NEUTRAL half of the shared-tree guards.
 *
 * WHY THIS EXISTS. `CLAUDE.md` calls the shared-tree rules "hook-enforced". Measured
 * 2026-08-15, that is true of ONE client: the guards are `PreToolUse` hooks resolved
 * through `$CLAUDE_PROJECT_DIR` in `.claude/settings.json`, `.git/hooks/` holds samples
 * only, and `core.hooksPath` is unset. A second coding agent, a human at a terminal, or
 * the web UI inherits none of them — and a guard on `main` protects nobody in a checkout
 * that has not pulled it (#1324: the shared root was 92 commits behind).
 *
 * A git `pre-commit` hook is NOT the fix and was already declined
 * (CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS §5): "a hook must be installed ... so the
 * common state is a hook that exists in-repo and runs for nobody."
 *
 * THE DECOMPOSITION. Prevention cannot be made agent-neutral — it is agent-coupled (in
 * the operator's tool loop) or install-coupled (per clone), and a sandbox protects the
 * machine from the agent, not the tree from a bad `git add`. DETECTION can be, because it
 * reads a property of the resulting COMMIT and CI already applies to whoever opened the PR.
 *
 * WHAT IT DETECTS. The 2026-08-03 corruption (CLAUDE.md §👥.2b): a hand ref-move desynced
 * a checked-out tree, every file a later merge ADDED then read as `deleted`, and a blanket
 * `git add -A` staged 47 phantom deletions — 25 of them pending changesets. Committing it
 * would have removed ~25 changesets, live briefs and 6 tools from `main`.
 *
 * Two features separate that from a legitimate release, and this is MEASURED over the full
 * history rather than argued (see the `commit-shape` group in tests/dex-tests.js):
 *
 *      of 32 commits deleting a changeset —
 *        30 releases  : 0 deletions outside changes/  AND  3/3 ledger files co-modified
 *         2 flagged   : one `Revert`, one `rescue:` snapshot (the latter IS this failure)
 *
 * Zero false positives on releases. A release deletes ONLY changesets and ALWAYS bumps the
 * version; the accident did neither.
 *
 * ⚠️ WHY THE EXEMPTIONS ARE BY SUBJECT AND NOT BY SHAPE. `Revert` and `rescue:` commits are
 * shape-identical to the corruption — that is the point of a rescue snapshot. They are
 * distinguished by declared provenance, which is exactly how §👥.2 says to preserve someone
 * else's work. Widening the SHAPE rule to admit them would re-admit the accident.
 *
 * ⚠️ VALIDATE ANY CHANGE HERE AGAINST tools/release.mjs. The previous outcome guard proposed
 * for this area WOULD HAVE BLOCKED EVERY RELEASE, and that was found only by testing it
 * against the release tool. The releases are the adversarial cases, not the corruption.
 *
 * USAGE
 *   node tools/commit-shape.mjs                 # scan full history, exit 1 on any flag
 *   node tools/commit-shape.mjs --range A..B    # scan a range (CI uses the PR's commits)
 *   node tools/commit-shape.mjs --json          # ONE tepna.verdict/1 object (VERDICT-CONTRACT §1) — the API
 *
 * VERDICT (wave 2 adopter): `--json` prints one `tepna.verdict/1` object and nothing else on stdout.
 * PASS = every changeset-deleting commit in range is a release or a declared exemption; FAIL names the
 * flagged shas; NOT_RUN on a shallow clone (history not present — a scan that sees nothing must not
 * report green). The scan's own rows ride in `result` so a reader loses nothing over the old shape.
 * ════════════════════════════════════════════════════════════════════════ */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const Verdict = createRequire(import.meta.url)(join(dirname(fileURLToPath(import.meta.url)), '..', 'verdict.js'));

/** Build + validate the verdict object; an invalid one is a producer bug and throws rather than prints. */
export function verdictOf({ status, rows, flagged, reason }) {
  const commit = (() => {
    try {
      return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  })();
  const scanned = rows ? rows.length : 0;
  const rootRows = arguments[0].rootRows || [];
  const rootFlagged = arguments[0].rootFlagged || [];
  const v = Verdict.make({
    gate: 'commit-shape',
    status,
    population: { checked: status === 'NOT_RUN' ? 0 : scanned, eligible: scanned, excluded: status === 'NOT_RUN' ? scanned : 0 },
    criterion: { name: 'no-commit-carries-an-undeclared-corruption-shape', threshold: 0, unit: 'flagged commits', direction: 'eq' },
    result:
      status === 'NOT_RUN'
        ? null
        : {
            scanned,
            releases: rows.filter((r) => r.verdict === 'release').length,
            exempt: rows.filter((r) => r.verdict === 'exempt').length,
            flagged: (flagged || []).map((f) => ({ sha: f.sha, reason: f.reason })),
            /* THE SECOND DETECTOR'S OWN POPULATION, stated rather than implied. A PASS here must be a
               pass over a counted set: `rootScanned: 0` with a green status would be the examined-
               nothing shape the shallow-clone refusal exists to prevent, so main() refuses on it. */
            rootZeroByte: {
              scanned: rootRows.length,
              clean: rootRows.filter((r) => r.verdict === 'clean').length,
              notApplicable: rootRows.filter((r) => r.verdict === 'not-applicable').length,
              baseline: rootRows.filter((r) => r.verdict === 'baseline').length,
              exempt: rootRows.filter((r) => r.verdict === 'exempt').length,
              flagged: rootFlagged.map((f) => ({ sha: f.sha, reason: f.reason, files: f.emptyRootAdds }))
            }
          },
    evidence: ['tools/commit-shape.mjs', 'changes/', 'suite.manifest.json', 'CHANGELOG.md', 'RELEASE-MANIFEST.json'],
    reason: reason === undefined ? null : reason,
    producedBy: commit ? { tool: 'tools/commit-shape.mjs', commit } : { tool: 'tools/commit-shape.mjs', commit: null, commitReason: 'git rev-parse unavailable' }
  });
  const check = Verdict.validate(v);
  if (!check.ok) throw new Error(`commit-shape produced an invalid verdict: ${check.errors.join('; ')}`);
  return v;
}

/** The three files a release always co-modifies. Absent together ⇒ no version was cut. */
export const LEDGER = ['suite.manifest.json', 'CHANGELOG.md', 'RELEASE-MANIFEST.json'];

/**
 * The THREE commits already in history that add a 0-byte root file. Measured 2026-10-06 over the whole
 * population (79 commits add a top-level file; these 3 flag, 76 are clean). They cannot be unmade, so
 * `--all` would red main forever without this list — the ratchet idiom: declared, dated, and it only
 * ever shrinks. A NEW sha is never added here to silence it; the file is deleted and the shape fixed.
 *
 * Each entry says WHAT was added, because the cause differs and the second one was missed for 12 days.
 */
export const KNOWN_ROOT_ZERO_BYTE = {
  // Spaced-path split of `Data Unifier.html`. Both halves landed; #2892 removed only `Data`, so the
  // 0-byte `Unifier.html` sat on origin/main from 2026-09-24 until this PR — invisible to docs-ledger
  // check9, whose root equality admits any runtime `*.html` regardless of size.
  d0e67d0cb67d07eb5ed3da4fdf30484ebbd86ab2: 'Data, Unifier.html — #2854, spaced path',
  /* NOT LISTED, deliberately: 6a2bf810 ("Data — provenance re-cut"). It is a commit on #3359's BRANCH,
     and #3359 landed as a SQUASH, so that sha is NOT an ancestor of main — its `Data` was deleted inside
     the same PR and main's history never carried it. Listing it made this tool's own selftest red in CI
     and green locally, because a fetched branch leaves the object in a working checkout while a fresh
     clone has only main's history. A squash merge breaks ancestry: the merged PR state survives, the sha
     does not. The selftest now asserts REACHABILITY, not resolvability, so that asymmetry fails here. */
  // A DIFFERENT cause: a stray npm/node redirect, not a spaced path. Logged nowhere before this gate.
  '69f5230926bbab4c50a1a70b3d5a92883c83123c': 'node, tepna@0.0.0 — stray redirect'
};

/** Declared-provenance prefixes. See the warning above: these are NOT shape exemptions. */
export const EXEMPT_PREFIXES = ['Revert ', 'Revert"', 'rescue:'];

/**
 * Pure core. Classifies ONE commit from its subject and name-status file list.
 *
 * @param {{subject: string, files: Array<{status: string, path: string}>}} commit
 * @returns {{verdict: string, reason: string, outsideDeletions: number, ledgerTouched: number}}
 *
 * verdict is one of:
 *   'not-applicable' — deletes no changeset; this guard has nothing to say
 *   'release'        — deletes only changesets AND bumps the version
 *   'exempt'         — flagged by shape, but carries declared provenance
 *   'FLAGGED'        — the corruption shape, undeclared
 */
export function classify(commit) {
  const files = commit?.files ?? [];
  const subject = commit?.subject ?? '';

  const deletesChangeset = files.some((f) => f.status.startsWith('D') && f.path.startsWith('changes/'));
  if (!deletesChangeset) {
    return { verdict: 'not-applicable', reason: 'deletes no changeset', outsideDeletions: 0, ledgerTouched: 0 };
  }

  const outsideDeletions = files.filter((f) => f.status.startsWith('D') && !f.path.startsWith('changes/')).length;
  const touched = new Set(files.map((f) => f.path));
  const ledgerTouched = LEDGER.filter((p) => touched.has(p)).length;

  // A release deletes ONLY changesets and ALWAYS bumps the version. Both, not either:
  // the accident satisfied neither, and requiring both is what gives 0 false positives.
  if (outsideDeletions === 0 && ledgerTouched === LEDGER.length) {
    return { verdict: 'release', reason: 'changesets only, version bumped', outsideDeletions, ledgerTouched };
  }

  if (EXEMPT_PREFIXES.some((p) => subject.startsWith(p))) {
    return {
      verdict: 'exempt',
      reason: `declared provenance: ${subject.slice(0, 24)}`,
      outsideDeletions,
      ledgerTouched
    };
  }

  const why = [];
  if (outsideDeletions > 0) why.push(`${outsideDeletions} deletion(s) outside changes/`);
  if (ledgerTouched < LEDGER.length) why.push(`ledger ${ledgerTouched}/${LEDGER.length} — no version bump`);
  return { verdict: 'FLAGGED', reason: why.join('; '), outsideDeletions, ledgerTouched };
}

/**
 * Pure core #2 — the SPACED-PATH TRAP. Classifies ONE commit for a 0-byte file added at the repo ROOT.
 *
 * WHY A SIZE+LOCATION PROPERTY AND NOT A NAME PATTERN. An unquoted shell path with a space splits:
 * `> Data Unifier.html`, or `git add Data Unifier.html`, or a `for f in $(…)` loop over bundle names,
 * each yields a 0-byte root file named `Data` beside a modified `Data Unifier.html`. The residue row
 * 2026-09-22-repo-root-has-no-file-set-gate states the lesson from the first instance: a DENYLIST fails
 * open here, "because a 0-byte file with no extension matches no bad pattern". So this keys on two
 * properties the trap cannot avoid — zero bytes, and no directory separator.
 *
 * WHAT THIS ADDS OVER `docs-ledger` check9, which already pins the root as an equality over named
 * classes and DOES red on a tracked `Data` (measured 2026-10-06: staged or committed, the group goes
 * 87/88). check9 judges the TREE STATE, so it is silent about a commit that adds the file and a later
 * commit in the same PR that removes it — the history keeps the cause, the tree shows nothing. This
 * judges the COMMIT, so the shape is refused where it is introduced rather than where it is noticed.
 *
 * @param {{subject: string, files: Array<{status: string, path: string, size: (number|null)}>}} commit
 * @returns {{verdict: string, reason: string, rootAdds: number, emptyRootAdds: Array<string>}}
 *
 * verdict is one of:
 *   'not-applicable' — the commit adds no top-level file; this guard has nothing to say
 *   'clean'          — it adds top-level files and every one carries bytes
 *   'exempt'         — flagged by shape, but carries declared provenance
 *   'FLAGGED'        — a 0-byte file was added at the repo root, undeclared
 */
export function classifyRootAdd(commit) {
  const files = commit?.files ?? [];
  const subject = commit?.subject ?? '';

  // A top-level path has no separator. `A` covers plain adds; `git show -m` can emit `A\t…` only.
  const rootAdds = files.filter((f) => f.status.startsWith('A') && !f.path.includes('/'));
  if (rootAdds.length === 0) {
    return { verdict: 'not-applicable', reason: 'adds no top-level file', rootAdds: 0, emptyRootAdds: [] };
  }

  /* `size === null` means the I/O layer could not read the blob (a dangling or rewritten object).
     It is NOT treated as zero: a detector that cannot measure must not convict — §∅, absence is not
     a value. Such a commit reads 'clean' here and the unreadable path is named in the reason. */
  const unreadable = rootAdds.filter((f) => f.size == null).map((f) => f.path);
  const empty = rootAdds.filter((f) => f.size === 0).map((f) => f.path);

  if (empty.length === 0) {
    return {
      verdict: 'clean',
      reason: `${rootAdds.length} top-level add(s), all non-empty${unreadable.length ? `; ${unreadable.length} unreadable: ${unreadable.join(', ')}` : ''}`,
      rootAdds: rootAdds.length,
      emptyRootAdds: []
    };
  }

  if (EXEMPT_PREFIXES.some((p) => subject.startsWith(p))) {
    return {
      verdict: 'exempt',
      reason: `declared provenance: ${subject.slice(0, 24)}`,
      rootAdds: rootAdds.length,
      emptyRootAdds: empty
    };
  }

  return {
    verdict: 'FLAGGED',
    reason: `${empty.length} zero-byte file(s) added at the repo root: ${empty.join(', ')} — an unquoted path with a space splits into one`,
    rootAdds: rootAdds.length,
    emptyRootAdds: empty
  };
}

/* ── everything below is I/O; the core above is pure and is what the suite drives ── */

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Read one commit into the shape `classify` expects. */
export function readCommit(sha) {
  const subject = git(['log', '-1', '--format=%s', sha]).trim();
  const out = git(['show', '--name-status', '--format=', '-m', '--first-parent', sha]);
  const files = [];
  for (const line of out.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const path = parts[parts.length - 1];
    /* SIZE only for top-level adds — the only files `classifyRootAdd` can convict, and a blob read per
       file over all history would be the expensive way to learn nothing. `null` on an unreadable blob,
       never 0: a detector that cannot measure must not convict (§∅). */
    let size = null;
    if (parts[0].startsWith('A') && !path.includes('/')) {
      try {
        size = Number(git(['cat-file', '-s', `${sha}:${path}`]).trim());
      } catch {
        size = null;
      }
    }
    files.push({ status: parts[0], path, size });
  }
  return { sha, subject, files };
}

/**
 * Properties, run with `node tools/commit-shape.mjs --selftest`. Pure except for the baseline-resolve
 * leg, which needs git — and that leg exists because during this tool's own construction two of the
 * three baseline SHAs were written from their short forms and were WRONG. A fabricated sha matches no
 * commit, so the entry silently excuses nothing and the gate reds on a commit the list was meant to
 * cover. An unresolvable baseline entry is therefore a hard failure, not a warning.
 */
export function selftest() {
  const fail = [];
  let ran = 0;
  /* COUNTED, not stated — a literal total drifts the moment a leg is added (absence-ledger's idiom). */
  const ok = (cond, what) => {
    ran += 1;
    if (!cond) fail.push(what);
  };
  const A = (path, size) => ({ status: 'A', path, size });
  const M = (path) => ({ status: 'M', path, size: null });

  // 1 · THE PLANT. The real shape: an unquoted `Data Unifier.html` splits, so a 0-byte `Data` is added
  //     at the root beside the modified bundle. This is 6a2bf810 and d0e67d0c in miniature.
  const planted = classifyRootAdd({ subject: 'chore(provenance): re-cut the pin', files: [A('Data', 0), M('Data Unifier.html')] });
  ok(planted.verdict === 'FLAGGED', 'a 0-byte root add is FLAGGED');
  ok(planted.emptyRootAdds.join(',') === 'Data', 'the flagged reason names the file');

  // 2 · CONTROL — a NON-EMPTY file added at the root is ordinary and must stay green. Without this leg
  //     the detector could refuse every root add and still look correct on the plant.
  ok(classifyRootAdd({ subject: 'docs: add a root entry doc', files: [A('ORIENTATION.md', 4096)] }).verdict === 'clean', 'a non-empty root add is clean');

  // 3 · CONTROL — a 0-byte file inside a DIRECTORY is legitimate (an __init__.py-style placeholder) and
  //     must not be touched. The guard is about the ROOT; a subdirectory is none of its business.
  ok(classifyRootAdd({ subject: 'feat: package marker', files: [A('capture-host/pkg/__init__.py', 0)] }).verdict === 'not-applicable', 'a 0-byte file in a subdirectory is not-applicable');

  // 4 · BOTH AT ONCE: the subdirectory placeholder must not mask a root offender in the same commit.
  const mixed = classifyRootAdd({ subject: 'chore: sync', files: [A('capture-host/pkg/__init__.py', 0), A('Data', 0)] });
  ok(mixed.verdict === 'FLAGGED' && mixed.emptyRootAdds.length === 1, 'a subdirectory 0-byte does not mask a root one');

  // 5 · DECLARED PROVENANCE downgrades, exactly as the first detector's does.
  ok(classifyRootAdd({ subject: 'Revert "chore: sync"', files: [A('Data', 0)] }).verdict === 'exempt', 'declared provenance is exempt');

  // 6 · AN UNREADABLE BLOB IS NOT A CONVICTION (§∅). `size: null` means the size could not be measured;
  //     treating it as 0 would convict on absence.
  const unknown = classifyRootAdd({ subject: 'chore: whatever', files: [A('Mystery', null)] });
  ok(unknown.verdict === 'clean', 'an unreadable size does not convict');
  ok(/unreadable/.test(unknown.reason), 'and the unreadable path is named in the reason');

  /* 7 · EVERY BASELINE ENTRY IS AN ANCESTOR OF HEAD — REACHABILITY, not resolvability.
   *     `rev-parse --verify` was the first version of this leg and it was too weak: it passes for a sha
   *     that exists only as a fetched BRANCH object, which is exactly what a squash-merged PR leaves in
   *     a working checkout and never puts in main. That made the tool green here and RED in CI (#3361,
   *     2026-10-06, sha 6a2bf810). `merge-base --is-ancestor` asks the question that actually matters:
   *     is this commit part of the history the scan will walk? A branch-only sha now fails locally the
   *     same way it fails in a fresh clone. */
  for (const sha of Object.keys(KNOWN_ROOT_ZERO_BYTE)) {
    let reachable = false;
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { stdio: 'ignore' });
      reachable = true;
    } catch {
      reachable = false;
    }
    ok(reachable, `baseline sha ${sha.slice(0, 8)} is an ancestor of HEAD (not branch-only)`);
  }

  // 8 · THE BASELINE IS KEYED BY COMMIT, NOT BY PATH — so an old entry can never excuse a new offender.
  //     `Data` appears in two baseline reasons; a path-keyed list would have waved through 6a2bf810's
  //     successor silently.
  ok(
    Object.keys(KNOWN_ROOT_ZERO_BYTE).every((k) => /^[0-9a-f]{40}$/.test(k)),
    'every baseline key is a full 40-char sha, never a path'
  );

  /* The summary line `selftest-all.mjs` parses — `all <N> selftests passed`, with N COUNTED. A new tool
     may not join UNPARSEABLE_RATCHET, and the count is that script's whole added value: a suite
     silently shrinking from 12 assertions to 3 is visible only here, since CI reads PASS either way. */
  const line = fail.length ? `commit-shape selftest · ${fail.length} of ${ran} FAILED` : `all ${ran} selftests passed`;
  return { ok: fail.length === 0, ran, fail, line };
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
  const i = argv.indexOf('--range');
  const range = i >= 0 && argv[i + 1] ? argv[i + 1] : null;

  // Only commits that delete a changeset can fail, so ask git for exactly those.
  const args = ['log', '--diff-filter=D', '--format=%H'];
  if (range) args.push(range);
  else args.push('--all');
  args.push('--', 'changes/');
  // FAIL CLOSED ON A SHALLOW CLONE. actions/checkout@v4 defaults to depth 1, and on a
  // shallow clone this scan finds nothing and exits 0 — a detector that reports success
  // about history it never had. That is the precise failure this guard exists to catch, so
  // it must refuse rather than pass. CI sets fetch-depth: 0.
  if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    process.stderr.write('commit-shape: REFUSING — shallow clone, history not present.\n');
    process.stderr.write('  A scan of a shallow clone reports 0 flagged because it sees 0 commits.\n');
    process.stderr.write('  Set `fetch-depth: 0` on actions/checkout, or unshallow locally.\n');
    if (asJson) process.stdout.write(`${JSON.stringify(verdictOf({ status: 'NOT_RUN', rows: [], reason: 'shallow clone — history not present, so the scan examined no commit' }), null, 1)}\n`);
    process.exit(2);
  }

  const shas = git(args).split('\n').filter(Boolean);

  // THE SECOND POPULATION: commits that ADD a top-level file. The exclude pathspec below drops every
  // path containing a separator, which is what makes this exact rather than a whole-history blob scan —
  // 79 commits over all of history, so the per-file blob read in readCommit stays cheap. Same
  // --range/--all scoping as the first detector. (A block comment cannot hold that pathspec: it
  // contains the sequence that ends one.)
  const rootArgs = ['log', '--diff-filter=A', '--format=%H'];
  /* HEAD, NOT `--all` — and this differs from the first detector above on purpose. `--all` walks every
     fetched branch, so a working checkout scans commits a fresh clone has never seen: #3361 flagged a
     branch-only sha locally that CI could not even resolve. Scoping to HEAD makes the two agree, and a
     stray on someone else's branch is still caught — by that branch's own CI run, where it belongs. */
  if (range) rootArgs.push(range);
  else rootArgs.push('HEAD');
  rootArgs.push('--', '.', ':(exclude)*/*');
  const rootShas = git(rootArgs).split('\n').filter(Boolean);
  const rootRows = rootShas.map((sha) => {
    const r = { ...classifyRootAdd(readCommit(sha)), sha: sha.slice(0, 8) };
    /* A DECLARED HISTORICAL ENTRY DOWNGRADES, IT NEVER HIDES: the row still prints, with its reason, as
       `baseline`. Keyed by COMMIT, so an old entry can never excuse a NEW 0-byte add. */
    if (r.verdict === 'FLAGGED' && Object.hasOwn(KNOWN_ROOT_ZERO_BYTE, sha)) {
      return { ...r, verdict: 'baseline', reason: `declared historical: ${KNOWN_ROOT_ZERO_BYTE[sha]}` };
    }
    return r;
  });
  const rootFlagged = rootRows.filter((r) => r.verdict === 'FLAGGED');
  /* EXAMINED-NOTHING REFUSAL, the same reasoning as the shallow-clone guard above: this repo's history
     contains 79 such commits, so a scan returning none means the pathspec or the range stopped matching,
     not that the repo became clean. A detector must not report success about a population of zero. */
  if (!range && rootShas.length === 0) {
    process.stderr.write('commit-shape: REFUSING — 0 commits add a top-level file, which cannot be true for this repo.\n');
    process.stderr.write('  The root-add pathspec examined nothing; fix the query rather than trust the green.\n');
    if (asJson)
      process.stdout.write(`${JSON.stringify(verdictOf({ status: 'NOT_RUN', rows: [], rootRows: [], reason: 'root-add scan matched no commit — the population cannot be zero' }), null, 1)}\n`);
    process.exit(2);
  }

  const rows = shas.map((s) => ({ ...classify(readCommit(s)), sha: s.slice(0, 8) }));
  const flagged = rows.filter((r) => r.verdict === 'FLAGGED');
  const releases = rows.filter((r) => r.verdict === 'release');
  const exempt = rows.filter((r) => r.verdict === 'exempt');

  if (asJson) {
    // the object IS the verdict; the old {scanned, flagged, releases, exempt} fields ride in `result`
    const reasons = [];
    if (flagged.length) reasons.push(`${flagged.length} commit(s) delete a changeset outside a release: ${flagged.map((f) => f.sha).join(', ')}`);
    if (rootFlagged.length) reasons.push(`${rootFlagged.length} commit(s) add a 0-byte file at the repo root: ${rootFlagged.map((f) => `${f.sha} (${f.emptyRootAdds.join(', ')})`).join('; ')}`);
    const v = verdictOf({
      status: flagged.length || rootFlagged.length ? 'FAIL' : 'PASS',
      rows,
      flagged,
      rootRows,
      rootFlagged,
      reason: reasons.length ? reasons.join(' · ') : null
    });
    process.stdout.write(`${JSON.stringify(v, null, 1)}\n`);
  } else {
    process.stdout.write(`commit-shape · ${rows.length} commit(s) deleting a changeset\n`);
    process.stdout.write(`  releases (changesets only + version bumped) : ${releases.length}\n`);
    process.stdout.write(`  exempt   (declared Revert / rescue:)        : ${exempt.length}\n`);
    process.stdout.write(`  FLAGGED                                     : ${flagged.length}\n`);
    for (const f of flagged) {
      /* NAME THE CONTAINING REF. The scan is `--all`, so a flagged commit on ONE session's branch
         reds EVERY session's CI — and it presents as "your PR failed static", with the culprit in
         nobody's diff (measured 2026-08-26: f754e509 on a doc branch redded two unrelated PRs, and
         each owner's first instinct was to hunt their own changes). One printed ref name converts
         that whole misdiagnosis into routing: delete the named branch, not your diff. */
      let where = '';
      try {
        const refs = git(['for-each-ref', '--contains', f.sha, '--format=%(refname:short)'])
          .split('\n')
          .filter(Boolean)
          .filter((r) => r !== 'origin/HEAD');
        where = refs.length ? `  [in: ${refs.slice(0, 3).join(', ')}${refs.length > 3 ? ` +${refs.length - 3}` : ''}]` : '  [in: no live ref — reflog only]';
      } catch {
        where = '';
      }
      process.stdout.write(`    ${f.sha}  ${f.reason}${where}\n`);
    }
    if (!flagged.length) process.stdout.write('  ✓ no commit carries the blanket-add / ref-move shape\n');
    process.stdout.write(`commit-shape · ${rootRows.length} commit(s) adding a top-level file\n`);
    process.stdout.write(`  clean (every top-level add carries bytes)   : ${rootRows.filter((r) => r.verdict === 'clean').length}\n`);
    process.stdout.write(`  declared historical baseline               : ${rootRows.filter((r) => r.verdict === 'baseline').length}\n`);
    process.stdout.write(`  FLAGGED (0-byte add at the repo root)      : ${rootFlagged.length}\n`);
    for (const f of rootRows.filter((r) => r.verdict === 'baseline')) process.stdout.write(`    - ${f.sha}  ${f.reason}\n`);
    for (const f of rootFlagged) process.stdout.write(`    ${f.sha}  ${f.reason}\n`);
    if (!rootFlagged.length) process.stdout.write('  ✓ no commit adds a 0-byte file at the repo root\n');
  }
  process.exit(flagged.length || rootFlagged.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

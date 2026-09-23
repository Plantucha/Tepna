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
  const v = Verdict.make({
    gate: 'commit-shape',
    status,
    population: { checked: status === 'NOT_RUN' ? 0 : scanned, eligible: scanned, excluded: status === 'NOT_RUN' ? scanned : 0 },
    criterion: { name: 'every-changeset-deleting-commit-is-a-release-or-declared-exempt', threshold: 0, unit: 'flagged commits', direction: 'eq' },
    result:
      status === 'NOT_RUN'
        ? null
        : {
            scanned,
            releases: rows.filter((r) => r.verdict === 'release').length,
            exempt: rows.filter((r) => r.verdict === 'exempt').length,
            flagged: (flagged || []).map((f) => ({ sha: f.sha, reason: f.reason }))
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
    files.push({ status: parts[0], path: parts[parts.length - 1] });
  }
  return { sha, subject, files };
}

function main() {
  const argv = process.argv.slice(2);
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

  const rows = shas.map((s) => ({ ...classify(readCommit(s)), sha: s.slice(0, 8) }));
  const flagged = rows.filter((r) => r.verdict === 'FLAGGED');
  const releases = rows.filter((r) => r.verdict === 'release');
  const exempt = rows.filter((r) => r.verdict === 'exempt');

  if (asJson) {
    // the object IS the verdict; the old {scanned, flagged, releases, exempt} fields ride in `result`
    const v = verdictOf({
      status: flagged.length ? 'FAIL' : 'PASS',
      rows,
      flagged,
      reason: flagged.length ? `${flagged.length} commit(s) delete a changeset outside a release: ${flagged.map((f) => f.sha).join(', ')}` : null
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
  }
  process.exit(flagged.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

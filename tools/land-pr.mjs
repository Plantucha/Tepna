#!/usr/bin/env node
/*
 * tools/land-pr.mjs — Tepna
 * Copyright 2026 Michal Planicka
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE at the
 * project root, or http://www.apache.org/licenses/LICENSE-2.0
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * LAND A PR WITHOUT HAND-POLLING — and without any of the four traps that make hand-polling lie.
 *
 * THE RACE THIS EXISTS FOR (measured 2026-08-09). `main` moves a median 7.2 min between merges
 * (min 1.2, max 120; only 8 of 19 recent gaps were >= 12 min), CI is ~10-12 min over 7 required
 * checks, and the `protect-main` ruleset sets `required_status_checks.strict = true` — the branch
 * must be up to date AT MERGE TIME, and GitHub's auto-merge does NOT update it for you. So a PR has
 * to hold "all checks green" and "main stood still" in the same instant, a window open well under
 * half the time. Every session therefore hand-writes a polling loop, and the loops keep being wrong
 * in the same four ways CLAUDE.md §👥.4/4b already catalogues:
 *
 *   1. `until ! pgrep -f "<cmd>"` waits on ITSELF (§4). This owns its own loop and matches nothing.
 *   2. Reading a verdict off `| tail -N` (§4b). This AGGREGATES buckets and never truncates.
 *   3. Treating BEHIND as failure, or BLOCKED as fatal — they need opposite responses.
 *   4. Spinning forever on a REQUIRED context that will never arrive (a skipped matrix job reports
 *      an unexpanded literal name, so the required check is never reported at all). Detected here
 *      and reported as `stuck`, rather than burning the timeout.
 *
 * THE DECISION IS A PURE FUNCTION. `decide()` takes a snapshot and returns an action; everything
 * that touches the network is in `main()`. That is what makes it gateable — `tests/dex-tests.js`
 * group `land-pr` drives the state machine with no `gh` and no clock, the same shape as
 * `rebase-safe.mjs`'s exported `classify`.
 *
 *   node tools/land-pr.mjs 1095
 *   node tools/land-pr.mjs 1095 --timeout-min 60 --interval-s 45
 *   node tools/land-pr.mjs 1095 --dry-run          # print the decision each tick, act on nothing
 *
 * ⚠️ THIS DOES NOT REPLACE WORKING FEWER RACES. The cadence lever is bigger than the polling lever:
 * one work-unit shipped as five PRs pays this cost five times. See CLAUDE.md §👥.5 — land one PR per
 * work-unit, run the full gate ONCE, and push before writing the prose so CI runs underneath it.
 * This tool removes the busywork of the race; it does not make entering five of them a good idea.
 */
import { execFileSync } from 'node:child_process';

/* ── the pure core ──────────────────────────────────────────────────────────────────────────────
   `snap` is { state, mergeState, buckets, required, reported }:
     state       'OPEN' | 'MERGED' | 'CLOSED'
     mergeState  'CLEAN' | 'BEHIND' | 'BLOCKED' | 'DIRTY' | 'UNKNOWN' | 'UNSTABLE'
     buckets     { pass, pending, fail, skipping, cancel } — COUNTS, aggregated, never a tail
     required    [context]  — from the ruleset; [] when it could not be read
     reported    [name]     — every check run that exists on the PR, whatever its state

   Returns { action, why } where action is one of:
     'done'   merged — stop, success           'fail'   a check failed — stop, do not retry
     'closed' closed unmerged — stop           'stuck'  a required context will never arrive
     (an UNREADABLE snapshot — API error — is 'wait', never 'stuck': see decide())
     'update' branch is behind — update it     'wait'   checks still running — keep waiting
     'merge'  green and current — merge now
   ──────────────────────────────────────────────────────────────────────────────────────────── */
export function decide(snap) {
  const b = snap.buckets || {};
  const pending = (b.pending || 0) + (b.cancel === undefined ? 0 : 0);
  const failed = b.fail || 0;

  if (snap.state === 'MERGED') return { action: 'done', why: 'already merged' };
  if (snap.state === 'CLOSED') return { action: 'closed', why: 'PR was closed without merging' };

  /* FAILURE BEATS EVERYTHING ELSE — WHEN IT CAN BLOCK. A failing REQUIRED check with a BEHIND
     branch is still a failure, and updating the branch would re-run CI and hide it behind a fresh
     pending, so it is checked first.

     ⚠️ BUT AN ADVISORY RED IS NOT A FAILURE, and treating it as one strands a PR that was mergeable
     the whole time. Measured on #1285: `mutation (diff-scoped)` failed, this tool printed
     `fail: 1 check(s) failed` and exited 1, and GitHub's auto-merge landed the PR minutes later
     without help. The operator is then sent to "fix" a PR that needed nothing.

     This is the SAME ASYMMETRY the pending branch already carries: a pending non-required check must
     not cause a wait, and a failing non-required check must not cause a stop. Both were wrong for
     the same reason — the tool was reasoning about check STATE without asking whether the check can
     block the merge. `mutation` is advisory by design (§👥 and mutation.yml's `continue-on-error`)
     precisely so a survivor cannot force someone to delete a `# pragma: no cover` to go green.

     FAIL-CLOSED: if the ruleset could not be read, `required` is empty and EVERY failure is treated
     as blocking. An unreadable ruleset must not silently downgrade a real red to advisory — that is
     the direction that merges broken code. */
  if (failed > 0) {
    const rf = snap.requiredFailed;
    if (rf == null) return { action: 'fail', why: `${failed} check(s) failed; required set unknown so all treated as blocking` };
    if (rf > 0) return { action: 'fail', why: `required check(s) failed: ${(snap.failedNames || []).join(', ') || rf}` };
    /* ADVISORY-ONLY RED: fall through and keep landing. Deliberately no logging here — `decide` is
       PURE, which is what makes it gate-backable, and the caller's per-poll line already prints the
       bucket counts, so `fail:1` remains visible beside the action it did not cause. */
  }

  /* A REQUIRED CONTEXT THAT WAS NEVER REPORTED. Distinct from "pending": pending means a check run
     exists and is running; this means no run exists at all, which is what a skipped matrix job
     produces (it reports the unexpanded literal name, so `test (py3.12)` never arrives). Waiting
     cannot fix it — the tool must say so instead of burning 45 minutes proving it. Only conclusive
     once nothing is pending, because a run that has not started yet is also absent. */
  /* ⚠️ AN UNREADABLE SNAPSHOT IS NOT AN EMPTY ONE, and conflating them produces this tool's most
     severe verdict for its most transient cause. Measured 2026-08-12 on #1183: a
     `net/http: TLS handshake timeout` from the GraphQL API made `gh pr checks` throw, the snapshot
     fell back to an empty list, and `stuck: required check never reported: test, no-network,
     typecheck, biome, …` was printed for a PR that was green and merged four minutes later on a
     re-run. `stuck` means WAITING CANNOT HELP; waiting was exactly the right response.

     So a snapshot that could not be read is `wait`, checked BEFORE the missing-context rule. The
     asymmetry is deliberate: a spurious `wait` costs one more poll, a spurious `stuck` abandons a
     landable PR. Same family as everything else in this toolchain — an absence being read as
     evidence when it was really a failed measurement. */
  if (snap.readable === false) return { action: 'wait', why: 'could not read checks (API error) — an unreadable snapshot is not an empty one' };

  if (pending === 0 && (snap.required || []).length) {
    const seen = new Set(snap.reported || []);
    const missing = snap.required.filter((r) => !seen.has(r));
    if (missing.length) return { action: 'stuck', why: `required check never reported: ${missing.join(', ')}` };
  }

  /* BEHIND is the common case and is NOT an error — it is the race. Update and let CI re-run.
     Deliberately checked BEFORE `pending`: a branch can be behind while checks are still green from
     the previous head, and updating early starts the new CI sooner, which is the whole point. */
  if (snap.mergeState === 'BEHIND') return { action: 'update', why: 'branch is behind main' };

  if (snap.mergeState === 'DIRTY') return { action: 'fail', why: 'merge conflict — rebase by hand (see CLAUDE.md §👥.2c)' };

  /* AN ADVISORY PENDING CHECK CANNOT HOLD A GREEN PR. Measured across #1259 and #1269: both timed
     out here at 45 minutes with `mutation (diff-scoped)` running, both were mergeable throughout,
     and #1259 merged INSTANTLY once auto-merge was armed with that check still pending. ~90 minutes
     spent proving a check could not block. `pending` counted every context; the required set was
     already read for the missing-context rule and simply was not consulted here.

     FAIL-CLOSED: if we could not work out how many PENDING checks are required, wait. A spurious
     wait costs one poll; a spurious merge lands past a check that could have blocked. */
  let advisoryNote = '';
  if (pending > 0) {
    const rp = snap.requiredPending;
    if (rp == null) return { action: 'wait', why: `${pending} check(s) still running (required set unknown — waiting is the safe direction)` };
    if (rp > 0) return { action: 'wait', why: `${rp} required check(s) still running` };
    /* Advisory only. Say so in the verdict rather than merging past it silently — a tool that
       quietly outruns an advisory check makes the already-unnoticed advisory red worse. */
    advisoryNote = ` (${pending} advisory check(s) still in flight)`;
  }

  /* UNKNOWN is GitHub still computing mergeability — transient, and NOT a reason to merge or fail.
     Observed on #1095: `mergeable=UNKNOWN` for minutes while every check was green. */
  if (snap.mergeState === 'UNKNOWN') return { action: 'wait', why: 'GitHub still computing mergeability' };

  /* ⚠️ EVERY REQUIRED CONTEXT MUST HAVE REPORTED — which is a DIFFERENT question from "no PENDING
     check is required", and on this repo the two come apart constantly.

     The missing-context rule above is gated behind `pending === 0`, so **one advisory pending check
     switches it off** and this function reaches the merge branch having verified only that nothing
     *pending* is required. It never asks whether the required contexts exist at all.

     Measured 2026-08-16 across #1355, #1361 and #1364 — three of four runs, same shape each time:

         15:02:39  pending:2 pass:19 skipping:1  → wait (1 required check(s) still running)
         15:03:40  pass:20 pending:1 skipping:1  → merge (green and up to date (1 advisory …))
         Command failed: gh pr merge 1355 --squash
         X the base branch policy prohibits the merge

     Each then EXITED, leaving the PR with nothing holding it current — worse than never running the
     tool, because the operator believes it is being tended. On the same PRs `test`, `test (py3.12)`,
     `test (py3.13)` and `browser-gates` had not reported at all (`browser-gates` existed only as
     `relevance (browser-gates)`, a different name), and the advisory `mutation` context masked it.

     This is the header's own #1183 lesson with the sign flipped: there, an absence was read as
     evidence of failure; here, an absence is read as satisfaction. Both are a missing measurement
     being treated as a result.

     FAIL-CLOSED, consistent with the two branches above: an unread ruleset leaves `required` empty
     and this rule simply does not fire, which is the pre-existing behaviour — it can only ever add
     waits, never merges. */
  if ((snap.required || []).length) {
    const seenNow = new Set(snap.reported || []);
    const absent = snap.required.filter((r) => !seenNow.has(r));
    if (absent.length) return { action: 'wait', why: `required check(s) have not reported yet: ${absent.join(', ')}` };
  }

  return { action: 'merge', why: 'green and up to date' + advisoryNote };
}

/* ── I/O ────────────────────────────────────────────────────────────────────────────────────── */
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

function snapshot(pr) {
  const view = JSON.parse(gh(['pr', 'view', String(pr), '--json', 'state,mergeStateStatus']));
  let checks = [];
  let readable = true;
  try {
    checks = JSON.parse(gh(['pr', 'checks', String(pr), '--json', 'name,bucket']));
  } catch (e) {
    /* `gh pr checks` exits non-zero when any check is failing — that is a VERDICT, not an error, and
       throwing it away would turn a red PR into an unreadable one. But a THROW here also covers the
       network dying, and those two must not produce the same snapshot: see the `readable` guard in
       `decide()`. If stdout parsed, the non-zero exit was the verdict and the snapshot is readable;
       if it did not, we know nothing and must say so rather than reporting zero checks. */
    checks = [];
    readable = false;
  }
  const req = requiredContexts() || [];
  const reqSet = new Set(req);
  const buckets = {};
  for (const c of checks) buckets[c.bucket] = (buckets[c.bucket] || 0) + 1;
  return {
    state: view.state,
    mergeState: view.mergeStateStatus,
    buckets,
    readable,
    reported: checks.map((c) => c.name),
    /* WHICH checks failed, not just how many. `buckets` is a count, and a count cannot answer
       "is this failure blocking?" — the question the fail branch has to ask. */
    failedNames: checks.filter((c) => c.bucket === 'fail').map((c) => c.name),
    /* HOW MANY of the pending/failing checks can actually BLOCK. `buckets` is a count over ALL
       contexts and cannot answer that — which is why the tool waited on advisory checks for 90
       minutes and stopped on advisory reds. `null` when the ruleset could not be read, so `decide`
       can tell "none are required" from "we do not know" and fail closed on the second. */
    requiredPending: req.length ? checks.filter((c) => c.bucket === 'pending' && reqSet.has(c.name)).length : null,
    requiredFailed: req.length ? checks.filter((c) => c.bucket === 'fail' && reqSet.has(c.name)).length : null,
    required: req
  };
}

let _req = null;
function requiredContexts() {
  if (_req) return _req;
  try {
    const repo = JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
    const rules = JSON.parse(gh(['api', `repos/${repo}/rules/branches/main`]));
    const rule = rules.find((r) => r.type === 'required_status_checks');
    _req = rule ? rule.parameters.required_status_checks.map((c) => c.context) : [];
  } catch {
    _req = []; // FAILS OPEN on purpose: unknown requirements must not manufacture a `stuck` verdict.
  }
  return _req;
}

async function main() {
  const argv = process.argv.slice(2);
  const pr = argv.find((a) => /^\d+$/.test(a));
  if (!pr) {
    console.error('usage: node tools/land-pr.mjs <PR#> [--timeout-min N] [--interval-s N] [--dry-run]');
    process.exit(2);
  }
  const num = (k, d) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] ? +argv[i + 1] : d;
  };
  const DRY = argv.includes('--dry-run');
  const deadline = Date.now() + num('--timeout-min', 45) * 60_000;
  const interval = num('--interval-s', 60) * 1000;

  console.log(`▸ landing #${pr}${DRY ? ' (dry run)' : ''}`);
  for (;;) {
    const snap = snapshot(pr);
    const { action, why } = decide(snap);
    const counts = Object.entries(snap.buckets)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
    console.log(`  ${new Date().toISOString().slice(11, 19)}  ${snap.state}/${snap.mergeState}  ${counts || 'no checks'}  → ${action} (${why})`);

    if (action === 'done') return console.log('✓ merged');
    if (action === 'fail' || action === 'closed' || action === 'stuck') {
      console.error(`✗ ${action}: ${why}`);
      process.exit(1);
    }
    if (!DRY) {
      if (action === 'update') {
        try {
          gh(['pr', 'update-branch', String(pr)]);
        } catch (e) {
          console.log(`     update-branch declined (${String(e.message).split('\n')[0].slice(0, 80)})`);
        }
      } else if (action === 'merge') {
        gh(['pr', 'merge', String(pr), '--squash']);
        console.log('✓ merged');
        return;
      }
    }
    if (Date.now() >= deadline) {
      console.error(`✗ timeout after ${num('--timeout-min', 45)} min — still ${snap.mergeState}`);
      process.exit(3);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

/* Same guard `rebase-safe.mjs` uses so the module can be imported by the test lane without running.
   ⚠️ That tool's guard is `endsWith('rebase-safe.mjs')`, which makes it a SILENT NO-OP under any
   other filename — measured when `npm run rebase` shelled out to a renamed copy and exited 0 having
   done nothing. Compare the resolved path instead, so a rename breaks loudly rather than quietly. */
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => {
    console.error(String(e.message || e));
    process.exit(1);
  });
}

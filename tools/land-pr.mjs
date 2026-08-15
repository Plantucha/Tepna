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

  /* FAILURE BEATS EVERYTHING ELSE. A failing check with a BEHIND branch is still a failure, and
     updating the branch would re-run CI and hide it behind a fresh pending. Check this first. */
  if (failed > 0) return { action: 'fail', why: `${failed} check(s) failed` };

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

  /* ⚠️ WAIT ONLY ON CHECKS THAT CAN ACTUALLY BLOCK THE MERGE.
     `pending` counts EVERY context, and most of them cannot hold a PR: `mutation (diff-scoped)` is
     advisory by design and is not in the ruleset's required set. Measured 2026-08-14 across #1259 and
     #1269 — both timed out here at 45 minutes with `still UNSTABLE` while that one check ran, and both
     were mergeable the whole time. #1259 merged INSTANTLY the moment auto-merge was armed, with 22
     passing and that same check still pending. ~90 minutes spent proving a check could not block.

     The required set is already read from the ruleset for the missing-context rule above; this simply
     uses it. When it could not be read, `requiredPending` falls back to the total — an unknown set must
     not license merging past a check that might be required, which is the same fail-safe asymmetry the
     `readable` guard states: a spurious wait costs one poll, a spurious merge cannot be undone. */
  const requiredPending = snap.requiredPending === undefined ? pending : snap.requiredPending;
  if (requiredPending > 0) return { action: 'wait', why: `${requiredPending} required check(s) still running` };

  /* UNKNOWN is GitHub still computing mergeability — transient, and NOT a reason to merge or fail.
     Observed on #1095: `mergeable=UNKNOWN` for minutes while every check was green. */
  if (snap.mergeState === 'UNKNOWN') return { action: 'wait', why: 'GitHub still computing mergeability' };

  /* Name the advisory checks still in flight. Merging past them is correct — they cannot block — but
     doing it SILENTLY is the other half of the same defect: the mutation gate's red already merges
     unnoticed today, and a tool that quietly outruns it makes that worse rather than better. */
  const advisory = pending - requiredPending;
  return advisory > 0 ? { action: 'merge', why: `green and up to date — ${advisory} advisory check(s) still pending, not required` } : { action: 'merge', why: 'green and up to date' };
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
  const buckets = {};
  for (const c of checks) buckets[c.bucket] = (buckets[c.bucket] || 0) + 1;
  /* PENDING, RESTRICTED TO CONTEXTS THAT CAN BLOCK THE MERGE. `undefined` when the required set could
     not be read, so `decide()` falls back to the total rather than merging past an unknown — an
     unreadable ruleset must not become permission. A required context is matched by exact name, the
     same string the ruleset stores and `gh pr checks` reports. */
  const req = requiredContexts();
  const requiredPending = req.length ? checks.filter((c) => c.bucket === 'pending' && req.includes(c.name)).length : undefined;
  return {
    requiredPending,
    state: view.state,
    mergeState: view.mergeStateStatus,
    buckets,
    readable,
    reported: checks.map((c) => c.name),
    required: requiredContexts()
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

#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright 2026 Michal Planicka
// SPDX-License-Identifier: Apache-2.0
/*
 * queue-doctor — drain a PR queue that CANNOT drain itself, and NAME the state that no view reports.
 *
 * THE FAILURE THIS EXISTS FOR (measured 2026-08-16, four sessions, one full day).
 * `protect-main` sets `strict_required_status_checks_policy: true`, so a branch must be up to date
 * at merge time. **GitHub's auto-merge does not update a branch.** It waits for the merge to become
 * possible; with `strict: true` a BEHIND branch never becomes possible on its own. So the policy four
 * sessions independently converged on — arm `--auto`, stop chasing BEHIND — is a DEADLOCK.
 *
 * 14 PRs sat all day. Every one was OPEN, 0 pending, 0 blocking failures, auto-merge armed. No failing
 * check, no conflict, nothing to fix. The only symptom was that nothing moved, and **"nothing moved" is
 * not a state any dashboard reports** — which is why it survived a day of four sessions looking at it.
 *
 * TWO LESSONS, one layer apart, both the same shape:
 *     armed    ≠ landing   — something must UPDATE the branch
 *     unblocked ≠ landing  — something must TRIGGER re-evaluation
 * A passive mechanism waiting on an event that never arrives presents as a healthy queue.
 *
 * WHY A TIMER AND NOT A TOOL YOU RUN. The failure happens precisely when nobody is running anything.
 * `land-pr` is per-PR and dies with its process (measured: three of four runs exited silently on a
 * merge refusal, leaving the PRs unattended). A timer fires whether or not any session is alive.
 *
 * WHY IT NEVER MERGES. It only ever calls `gh pr update-branch`. The new head makes CI run, the checks
 * report, and THAT is the event armed auto-merge is waiting for — the mechanism by which #1362 and
 * #1368 actually landed. Least privilege: a queue drainer that cannot merge cannot merge the wrong
 * thing.
 *
 * WHY EXACTLY ONE PR PER RUN. Under `strict: true`, the moment any PR merges every other open PR goes
 * BEHIND. Updating two at once therefore guarantees one wasted CI run. Serialisation is not caution
 * here, it is the only non-wasteful order — it is what a merge queue would do, and this repo cannot
 * have one (merge queue is an ORGANISATION-repository feature; Tepna is user-owned — verified
 * 2026-08-16, and the earlier claim that this was a cost tradeoff was wrong).
 *
 *   node tools/queue-doctor.mjs              # report, then update at most one PR
 *   node tools/queue-doctor.mjs --dry-run    # report only, change nothing
 *   node tools/queue-doctor.mjs --report     # report only, exit 1 if anything is stuck (for a timer)
 *
 * Exit: 0 acted or nothing to do · 1 --report found stuck, RED, CANCELLED or DIRTY PRs · 2 REFUSED (could not read state).
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isCliEntry } from './argv-guard.mjs';

/* Minutes a PR must have been BEHIND-and-green before the doctor touches it. Not noise tolerance —
   it is the window in which the PR's OWNER might be mid-rebase locally. Acting sooner would race a
   human; acting later just lengthens the deadlock. */
export const IDLE_MIN = 20;

/* Minutes after which a stuck PR OUTRANKS the serialisation wait below. Strictly greater than
   IDLE_MIN, because it answers a different question: IDLE_MIN asks "might the owner still be
   mid-rebase?", this asks "has serialising demonstrably stopped working?".

   PRE-STATED FROM THE CI CYCLE, not from the outcome: the worst-case required-check cycle here is
   ~15 min (CLAUDE.md §5), so a PR still stuck after 30 min has waited TWO full cycles. Whatever the
   doctor was serialising behind either merged (and this PR should have been picked up next) or did
   not (so the wait was never going to pay). Either way the premise has failed. */
export const STARVED_MIN = 30;

/* Minutes a workflow run may sit `queued` holding ZERO jobs before this tool calls it unclaimable.

   🔴 A QUEUED RUN AND AN UNCLAIMABLE RUN READ IDENTICALLY IN EVERY VIEW. GitHub creates the
   workflow-run record first and EXPANDS it into jobs second. When the second step never happens the
   record stays `queued` for ever: no runner can claim a run that holds no job, nothing times it out,
   and `gh pr checks` prints the same word it prints for a run about to start. Measured 2026-11-11 on
   three branches at once — 31 runs created between 20:22:39Z and 20:41:24Z, each answering
   `total_count: 0` for its jobs and still `queued` two hours later, while runs created LATER on other
   branches expanded and completed. Two more have sat `queued` since 2026-08-19. The remedy is a new
   head, and one empty commit per branch cleared all three.

   PRE-STATED FROM THE EXPANSION MECHANISM, never from those ages: expansion follows creation by
   seconds — the ten fresh runs of the recovery push expanded inside one poll — so a run still
   jobless after 10 minutes has missed that step by two orders of magnitude. The bound also sits
   below one required-check cycle (~15 min, CLAUDE.md §5), so the call arrives before a session
   would otherwise start waiting on the queue. */
export const UNEXPANDED_MIN = 10;

/* Hours a run may sit `queued` before it is unclaimable WHATEVER its job count.

   ⚠ A SECOND SHAPE, with a different cause and a different remedy. The zero-job runs above never
   expanded; these expanded and then nobody took the jobs. Measured 2026-11-11: run 32216407085
   (`CodeQL`) has held 3 queued jobs and run 32211238445 (`stale-file`) 1, both created
   2026-08-19 — three months queued. A push cannot clear either, because neither head belongs to an
   open PR, so only a cancel removes them from the pool.

   PRE-STATED FROM GITHUB'S OWN LIMIT, not from those ages: GitHub documents a 24-hour job queue
   limit, after which it cancels the job itself. A run still `queued` past the window in which the
   platform promises to cancel it is broken by the platform's own rule, so the bound is theirs. */
export const STALE_QUEUED_H = 24;

/* 🔴 DIRTY ON GITHUB IS TWO STATES, AND GITHUB SHOWS THEM AS ONE (residue
   2026-09-22-residue-dirty-carries-no-signal). `.gitattributes` sets `briefs/RESIDUE.md merge=residue`,
   and GitHub computes mergeability without custom drivers. So two branches that each append a row read
   DIRTY there while git merges them cleanly here, and a genuinely conflicted PR reads the same. Every
   DIRTY used to say "needs a human rebase": the wrong remedy for the display case (a rebase replays
   rows against a moving ledger) and no help for the real one, because it named no path.

   The discriminator is the real merge, run locally WITH this clone's merge drivers:
       git merge-tree --write-tree --name-only <head> <base>   # exit 0 clean · exit 1 conflict + paths
   Measured 2026-10-20 on #3749's DIRTY head 7a8b60dbc: exit 0 with the driver installed, and exit 1
   naming `briefs/RESIDUE.md` under `-c merge.residue.driver=false`.
   ⚠️ NOT the 3-argument `merge-tree … | grep -c '<<<<<<<'` form the row first named: on #2900 it
   printed 0 markers for a branch whose real merge conflicted.
   A clone WITHOUT the driver falls back to the 3-way merge, which conflicts on the ledger, so a missing
   driver errs toward `dirty`, the safe direction. Anything but a parsed exit 0 or exit 1 is `dirty`
   with the old remedy: an unreadable probe is not a clean merge. */
const TREE_OID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** Parse `git merge-tree --write-tree --name-only` output: line 1 is the tree, then on a conflict the
    conflicted paths up to the first blank line. Returns `{ exit, paths }`, or null when it is not that. */
export function parseMergeTree(stdout, exit) {
  const lines = String(stdout || '').split('\n');
  if (!TREE_OID.test(lines[0])) return null;
  if (exit === 0) return { exit: 0, paths: [] };
  if (exit !== 1) return null;
  const paths = [];
  for (const ln of lines.slice(1)) {
    if (ln === '') break;
    paths.push(ln);
  }
  return paths.length ? { exit: 1, paths } : null;
}

/** Classify a DIRTY PR from its local merge probe (`parseMergeTree`'s result, or null). */
export function dirtyVerdict(probe) {
  if (probe && probe.exit === 0) {
    return { k: 'dirty-display', why: "DIRTY on GitHub only: the local merge with this clone's drivers is clean — `git merge origin/main`, then one push (no rebase, no force)" };
  }
  if (probe && probe.exit === 1 && Array.isArray(probe.paths) && probe.paths.length) {
    return { k: 'dirty', why: `merge conflict in ${probe.paths.join(', ')} — resolve by hand` };
  }
  return { k: 'dirty', why: 'merge conflict — needs a human rebase' };
}

/* ── PURE CORE ───────────────────────────────────────────────────────────────────────────────────
   Separated so the decisions are gate-backed without `gh`, a network or a clock — the same shape as
   land-pr's `decide()`, for the same reason: this tool acts on other sessions' work unattended. */

/* 🔴 A REQUIRED CONTEXT CAN HOLD TWO CHECK RUNS, AND THE ROLLUP SHOWS ONLY THE LATER ONE.
   Measured on #3871, 2026-10-21: the `tests` workflow fired TWICE on one sha at the same instant,
   21:04:22Z, because the push and the PR creation arrived seconds apart. Concurrency cancelled one
   run; its six shards went `cancelled` and its aggregator job `test` ended `failure`. So the head
   carried two check runs named `test` — a failure at 21:06:11Z and a success at 21:10:59Z.
   `gh pr checks` reported 26 pass, 2 skipping, 0 fail, 0 cancel, and GitHub refused the merge
   anyway. Kodiak said why in its own check run: `🛑 cannot merge (failing required status checks:
   {'test'})`. Every rung above reads the rollup, so the PR classified `stuck-unarmed` and the
   report told a human to arm auto-merge, which under Kodiak adds nothing (CLAUDE.md §5).
   The remedy is a re-run of the CANCELLED DUPLICATE, so the state must name that run's id. */

/** The workflow-run id inside a check run's URL, or null. The rerun verb takes the RUN, not the job. */
export function runIdFromUrl(u) {
  const m = /\/actions\/runs\/(\d+)(?:\/|$)/.exec(String(u || ''));
  return m ? m[1] : null;
}

/* A conclusion that satisfies a required context. `neutral` is here because a skipped matrix job and
   a deliberately-neutral gate both report it, and GitHub treats neither as a failure. A null
   conclusion is a run still in flight: the pending rung owns it, so it is neither OK nor stale. */
const RUN_OK = new Set(['success', 'skipped', 'neutral']);

/**
 * Required contexts whose head carries a non-success check run that the rollup hides.
 *
 * Pure. `runs` is `[{ name, conclusion, runId }]`, every check run on the head. A name with ONE run
 * is what the rollup already shows, so it is not this rung's business; a name with no satisfying run
 * belongs to `failing` or `cancelled` above. What is left is DISAGREEMENT under one name, which no
 * `gh pr` view reports.
 */
export function staleRequiredRuns(required, runs) {
  if (!Array.isArray(runs) || !Array.isArray(required)) return [];
  const req = new Set(required);
  const byName = new Map();
  for (const r of runs) {
    if (!r || !req.has(r.name)) continue;
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(r);
  }
  const out = [];
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    if (!list.some((r) => RUN_OK.has(r.conclusion))) continue;
    for (const r of list) {
      if (r.conclusion != null && !RUN_OK.has(r.conclusion)) out.push({ name, conclusion: r.conclusion, runId: r.runId || null });
    }
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : String(a.runId) < String(b.runId) ? -1 : 1));
}

/**
 * The runs on a head that can never report. Pure.
 *
 * `runs` is `[{ runId, name, status, jobs, createdAtMs }]`, where `jobs` is that run's own job
 * `total_count` and `null` means the probe did not read.
 *
 * ∅ A RUN WHOSE JOB COUNT DID NOT READ IS NOT NAMED, and that is the OPPOSITE fail-closed
 * direction from the required set above. An unreadable required set must not let a red look
 * advisory, because the harm there is merging broken code. Here the state carries a push as its
 * remedy, so inventing one spends a commit and a whole CI cycle on a queue that was working.
 * Silence costs a wait; noise costs a round trip. Only a READ zero counts.
 */
export function unexpandedRuns(runs, nowMs) {
  if (!Array.isArray(runs)) return [];
  const out = [];
  for (const r of runs) {
    if (!r || r.status !== 'queued' || r.jobs !== 0) continue;
    if (!Number.isFinite(r.createdAtMs)) continue;
    const ageMin = (nowMs - r.createdAtMs) / 60000;
    if (!(ageMin >= UNEXPANDED_MIN)) continue;
    out.push({ runId: r.runId == null ? null : String(r.runId), name: r.name || null, branch: r.headBranch || null, ageMin });
  }
  return out.sort((a, b) => b.ageMin - a.ageMin);
}

/**
 * Every queued run that cannot start, each with the REASON that decides its remedy. Pure.
 *
 * `no-jobs` never expanded, so a new head replaces it. `past-queue-limit` expanded and was never
 * claimed, so only a cancel removes it. A run that is both is reported as `no-jobs`, the narrower
 * and more actionable reading — but only while its head is live, which the caller knows and this
 * function does not.
 */
export function unclaimableRuns(runs, nowMs) {
  const dead = unexpandedRuns(runs, nowMs);
  const seen = new Set(dead.map((d) => String(d.runId)));
  const out = dead.map((d) => ({ ...d, reason: 'no-jobs' }));
  for (const r of Array.isArray(runs) ? runs : []) {
    if (!r || r.status !== 'queued' || seen.has(String(r.runId))) continue;
    if (!Number.isFinite(r.createdAtMs)) continue;
    const ageMin = (nowMs - r.createdAtMs) / 60000;
    if (!(ageMin >= STALE_QUEUED_H * 60)) continue;
    out.push({ runId: String(r.runId), name: r.name || null, branch: r.headBranch || null, ageMin, reason: 'past-queue-limit' });
  }
  return out.sort((a, b) => b.ageMin - a.ageMin);
}

/**
 * The queued pool, split into the runs a runner can still take and the runs it cannot. Pure.
 *
 * 🔴 CLAUDE.md §5 TELLS EVERY SESSION TO COLLECT WHEN `pend` REACHES 0, AND ONE UNCLAIMABLE
 * RUN HOLDS `pend` ABOVE 0 FOR EVER. Measured 2026-11-11: 33 of the repo's queued runs held no job,
 * two of them since 2026-08-19, so that criterion was unsatisfiable on every day in between and the
 * number a reader wants is the one below — the runs that can still start.
 */
export function poolPend(runs, nowMs) {
  const dead = unclaimableRuns(runs, nowMs);
  const deadIds = new Set(dead.map((d) => String(d.runId)));
  const queued = (Array.isArray(runs) ? runs : []).filter((r) => r && r.status === 'queued');
  return { queued: queued.length, pend: queued.filter((r) => !deadIds.has(String(r.runId))).length, unexpanded: dead };
}

/** Classify ONE pr snapshot. `required` is the ruleset's required contexts; `null` means unreadable. */
export function classify(pr, required, nowMs, opts = {}) {
  if (pr.state !== 'OPEN') return { k: 'gone', why: `state=${pr.state}` };
  if (pr.isDraft) return { k: 'skip', why: 'draft' };

  /* FAIL CLOSED. An unreadable required set must not let a real red look advisory — that is the
     direction that updates (and so ultimately merges) broken code. */
  if (required == null) return { k: 'unknown', why: 'required set unreadable — refusing to classify' };
  const req = new Set(required);
  const names = pr.checks || [];
  const failing = names.filter((c) => c.bucket === 'fail' && req.has(c.name)).map((c) => c.name);
  const pending = names.filter((c) => c.bucket === 'pending' && req.has(c.name)).map((c) => c.name);

  if (failing.length) return { k: 'failing', why: `required check(s) failed: ${failing.join(', ')}` };
  /* 🔴 A CANCELLED REQUIRED CHECK IS TERMINAL, AND IT USED TO READ AS GREEN. `gh pr checks` puts it
     in bucket `cancel`, which is neither `fail` nor `pending`, and the context did report, so it is
     not absent either: every test above fell through and the PR classified `ready`. Nothing re-runs
     a cancelled run, so the context never becomes a success and the merge bot waits on it forever.
     Measured on #3688, 2026-10-19: `biome` and `typecheck` cancelled by the supersede-on-push group
     of a base-merge update, with seven other workflows green on the same head. A hand re-run of the
     two runs cleared it. It ranks below `failing` because a red is a code question and a
     cancellation is a queue question. */
  const cancelled = names.filter((c) => c.bucket === 'cancel' && req.has(c.name)).map((c) => c.name);
  if (cancelled.length) return { k: 'cancelled', why: `required check(s) cancelled: ${cancelled.join(', ')} — terminal, so nothing re-runs them (\`gh run rerun <run-id>\`)` };
  /* A REQUIRED CONTEXT THAT NEVER REPORTED is not pending and not passing — it is absent, and absent
     reads identically to satisfied if you only count buckets. Same hole that let land-pr merge past
     four unreported contexts; stated here rather than inherited, because this tool counts too. */
  const seen = new Set(names.map((c) => c.name));
  const absent = required.filter((c) => !seen.has(c));
  /* 🔴 AN UNARMED PR MID-CI CANNOT MERGE, SO IT CANNOT RE-BEHIND ANYONE — it must not serialise.
     The whole premise of the wait below is "this one is about to merge and re-BEHIND everything
     else, so a second update is guaranteed waste". Nothing merges an unarmed PR: `stuck-unarmed`
     already says so a few lines down ("updating cannot land it"), and the same fact makes it a
     harmless neighbour rather than a blocker.
     Measured on this timer's own journal, 2026-08-23: #1687 was deliberately held UNARMED for a
     coordination window, and blocked three consecutive runs — 17:51, 18:01, 18:11 — each
     `wait: #1687 is mid-CI … serialising`, with zero chance of merging in any of them. Holding a PR
     unarmed is a normal, correct thing to do here; it should not stop the queue draining around it. */
  /* 🔴 WHY A CONTEXT HAS NOT REPORTED, which neither rung below could say. Both of them read a
     bucket count and prescribe from it — wait, or push a new head — and an unclaimable run on this
     head changes the answer: it will never report, so no wait helps, and on a CURRENT head not even
     `update-branch` does. It ranks above both because it is a cause and they are symptoms. */
  const dead = unexpandedRuns(pr.headRuns || [], nowMs);
  if (dead.length && (pending.length || absent.length)) {
    const named = dead
      .slice(0, 3)
      .map((d) => `${d.name || 'run'} ${d.runId} ${d.ageMin.toFixed(0)}m`)
      .join(', ');
    const held = [pending.length ? `${pending.length} reading pending` : null, absent.length ? `never reported: ${absent.join(', ')}` : null].filter(Boolean).join('; ');
    return {
      k: 'unexpanded',
      why: `${dead.length} run(s) on this head sit queued holding ZERO jobs (${named}) — unclaimable, so the remedy is a NEW HEAD (one empty commit), never a wait · ${held}`,
      idleMin: pr.updatedAtMs ? (nowMs - pr.updatedAtMs) / 60000 : 0,
      behind: pr.mergeState === 'BEHIND',
      armed: !!pr.autoMerge,
      unexpanded: dead
    };
  }
  if (pending.length) {
    if (!pr.autoMerge) return { k: 'running-unarmed', why: `${pending.length} required check(s) running, but UNARMED — cannot merge, so cannot block` };
    return { k: 'running', why: `${pending.length} required check(s) running` };
  }
  /* 🔴 ABSENT IS NOT PENDING, AND COLLAPSING THEM DEADLOCKED THE QUEUE. Both used to return
     `running`, so both blocked the picker below — but they need OPPOSITE responses. A pending check
     will resolve; an absent one may never report at all, and CLAUDE.md §5 says so about this tool's
     sibling: "a required context that was never reported at all (stop — a skipped matrix job reports
     an unexpanded literal name, so waiting cannot fix it)".
     Measured from this timer's own journal, last 6 h: 22 runs blocked on genuinely-pending checks and
     **10 blocked on `awaiting: test`** — a context that had not reported. Those ten were waiting for
     something that could not arrive, while the PR needing the update was the very one being waited
     on: classified `running`, so it blocked everything AND was excluded from `cands`, which only
     takes `stuck-behind`. Simultaneously the blocker and unfixable.
     An update is the actual remedy — it pushes a new head, which is what makes checks report. So an
     awaiting PR no longer blocks, and if it is BEHIND and armed it becomes a candidate. */
  if (absent.length) {
    const idleMinA = pr.updatedAtMs ? (nowMs - pr.updatedAtMs) / 60000 : 0;
    return {
      k: 'awaiting',
      why: `awaiting: ${absent.join(', ')} — never reported, so waiting cannot fix it`,
      idleMin: idleMinA,
      behind: pr.mergeState === 'BEHIND',
      armed: !!pr.autoMerge
    };
  }
  if (pr.mergeState === 'DIRTY') return dirtyVerdict(pr.mergeProbe);

  /* The hidden wedge, above every green flavour because arming or updating cannot clear it. It sits
     BELOW `failing`, `cancelled` and the pending rungs by construction: each of those reads the
     rollup, and this one only has anything to say when the rollup reads satisfied. */
  const stale = staleRequiredRuns(required, pr.checkRuns);
  if (stale.length) {
    const named = stale.map((r) => `${r.name} (${r.conclusion}${r.runId ? `, run ${r.runId}` : ''})`).join(', ');
    const reruns = stale.map((r) => r.runId).filter(Boolean);
    const bot = pr.botSays ? ` · merge bot says: "${pr.botSays}"` : '';
    return {
      k: 'wedged',
      why: `required context(s) hold a stale non-success run the rollup hides: ${named} — ${reruns.length ? `\`gh run rerun ${reruns.join(' ')}\`` : 'nothing names a run to re-run'}${bot}`
    };
  }

  /* Green. Everything below is a flavour of STUCK — the state with no name. */
  const idleMin = pr.updatedAtMs ? (nowMs - pr.updatedAtMs) / 60000 : 0;
  if (pr.mergeState === 'BEHIND') {
    /* 🔴 UNARMED IS THE NORMAL STATE OF EVERY PR IN KODIAK'S QUEUE, so "arm auto-merge" names neither
       a defect nor a remedy. `.kodiak.toml` sets `require_automerge_label = false`, and Kodiak updates
       the FRONT of its serial queue as part of merging it, so a green BEHIND PR behind a mid-CI one is
       serialising, not stalling (CLAUDE.md §5). Measured twice: #2865 and #2866 read GREEN AND STUCK
       while Kodiak had merged #2863 ninety seconds earlier, and #4475 read the same on 2026-11-06
       while the walker logged it `ready green, behind main` with `actions: none` behind two older PRs.
       The header above calls arming under `strict` a DEADLOCK — so this rung printed the one remedy
       this same file argues against, and `--report` exited 1 over a healthy queue.
       The flag is the CALLER's measurement (config + merge-bot liveness), never a guess here: only an
       explicit `true` reclassifies, so an unread probe keeps the pre-Kodiak verdict. */
    if (!pr.autoMerge) {
      if (opts.kodiakOwnsDrain === true) {
        return { k: 'serialising', why: "green + BEHIND + unarmed — Kodiak updates the front of its serial queue in turn, so unarmed is that queue's normal state", idleMin };
      }
      return { k: 'stuck-unarmed', why: 'green + BEHIND but auto-merge NOT armed — updating cannot land it', idleMin };
    }
    return { k: 'stuck-behind', why: `green + BEHIND + armed, idle ${idleMin.toFixed(0)}m`, idleMin };
  }
  if (pr.mergeState === 'UNKNOWN') return { k: 'computing', why: 'GitHub still computing mergeability' };
  if (!pr.autoMerge) return { k: 'stuck-unarmed', why: 'green and mergeable but auto-merge NOT armed', idleMin };
  return { k: 'ready', why: 'green and current — auto-merge should take it' };
}

/**
 * What the report must NAME. `stuck` is the green-and-cannot-merge set; `failing` is a PR whose REQUIRED
 * checks are red. classify() has always returned `failing`, but the report printed only `stuck`, so a red
 * (abandoned) PR read as "no PR is green-and-stuck" and `--report` exited 0 over it — a red PR looked like
 * an idle queue. `cancelled` is a PR whose REQUIRED check was cancelled: terminal, so it waits forever.
 * `dirty` holds both DIRTY kinds: neither merges until a human merges `main` in, and the `why` says which.
 * `wedged` is a PR whose required context holds a stale non-success run the rollup hides: no arming
 * and no update clears it, only a re-run of the duplicate.
 * `unexpanded` is a PR whose head carries a run that cannot start: it reads pending or awaiting in
 * every view, and the only remedy is a new head.
 * `--report` is clean only when ALL SIX are empty.
 * `serialising` is deliberately in NONE of them: a green BEHIND unarmed PR inside Kodiak's queue is
 * the queue working, so naming it as attention is how this tool told four sessions to arm a mechanism
 * that adds nothing. The report still PRINTS it, under its own heading, as information.
 */
export function attention(classified) {
  return {
    stuck: classified.filter((c) => c.k === 'stuck-behind' || c.k === 'stuck-unarmed'),
    failing: classified.filter((c) => c.k === 'failing'),
    cancelled: classified.filter((c) => c.k === 'cancelled'),
    wedged: classified.filter((c) => c.k === 'wedged'),
    dirty: classified.filter((c) => c.k === 'dirty' || c.k === 'dirty-display'),
    unexpanded: classified.filter((c) => c.k === 'unexpanded')
  };
}

/**
 * Does `.kodiak.toml` declare a queue where UNARMED is the normal state? Pure, so the rule is
 * gate-backed. `require_automerge_label = false` IS that declaration: every non-draft PR without a
 * blocking label is in Kodiak's queue whether a human armed it or not. A commented-out line declares
 * nothing.
 * @param {unknown} tomlText
 * @returns {boolean}
 */
export function kodiakConfigSaysUnarmed(tomlText) {
  if (typeof tomlText !== 'string') return false;
  return /^[^#\n]*require_automerge_label\s*=\s*false\b/m.test(tomlText);
}

/**
 * The red LEDGER: who is red, since when, and what is NEW this run.
 *
 * The journal names a red PR on every run, and that is the defect: a line repeated every ten minutes
 * is wallpaper, and a journal is read by nobody. Measured 2026-10-12: #3477 and #3481 sat red for an
 * hour under this timer, and the owner found them first ("some auto system should warn you"). A wake
 * needs an EVENT — the first run on which a PR turned red, or turned green again — and a reader needs
 * a FILE. Pure: the previous ledger, this run's failing set, the stamp and the required contexts give
 * the next ledger and the fresh lines. A run with no change appends nothing, so a `tail -F` on the log
 * wakes exactly once per change.
 */
export function redLedger(prev, failing, atIso, required) {
  const before = new Map((prev && Array.isArray(prev.red) ? prev.red : []).map((r) => [r.number, r]));
  const req = Array.isArray(required) ? new Set(required) : null;
  const red = failing.map((c) => {
    const fails = (c.pr.checks || []).filter((k) => k.bucket === 'fail' && (!req || req.has(k.name)));
    const checks = fails.map((k) => k.name).sort();
    const link = fails.map((k) => k.link).find(Boolean) || null;
    const old = before.get(c.pr.number);
    const same = old && old.checks.join(',') === checks.join(',');
    return { number: c.pr.number, title: String(c.pr.title || '').slice(0, 52), checks, link, firstSeen: same ? old.firstSeen : atIso };
  });
  const lines = [];
  for (const r of red) {
    if (r.firstSeen === atIso) lines.push(`${atIso}  RED   #${r.number}  ${r.checks.join(',')}  ${r.title}${r.link ? `  ${r.link}` : ''}`);
  }
  const now = new Set(red.map((r) => r.number));
  for (const n of before.keys()) if (!now.has(n)) lines.push(`${atIso}  CLEAR #${n}`);
  return { ledger: { schema: 'tepna.red-ledger/1', at: atIso, red }, lines };
}

/**
 * Choose AT MOST ONE pr to update.
 * Returns { action:'update', pr } · { action:'wait', why } · { action:'none', why }.
 */
export function pick(classified) {
  if (classified.some((c) => c.k === 'unknown')) {
    return { action: 'wait', why: 'state unreadable for at least one PR — refusing to guess' };
  }
  /* SERIALISE. If any PR has required checks in flight it is about to merge and re-BEHIND everything
     else, so a second update now is guaranteed waste. Note this gates on REQUIRED checks only: an
     advisory CodeQL run must not block the queue forever — the advisory/required distinction that
     broke land-pr twice in one day.

     🔴 BUT SERIALISING UNCONDITIONALLY IS A LIVELOCK, AND IT RAN ALL DAY ON 2026-08-23. The premise
     above — "it is about to merge" — holds for ONE PR finishing CI. It does not hold for a queue
     several sessions are pushing to, because a fresh push is itself mid-CI, so there is ALWAYS one
     running and the doctor never reaches the picker below. Measured from its own journal, every ten
     minutes for hours:

         15:41  ⚠ GREEN AND STUCK: #1680 green + BEHIND + armed, idle 34m
         15:41  wait: #1681 is mid-CI — serialising
         15:50  ⚠ GREEN AND STUCK: #1681 idle 25m, #1680 idle 43m
         15:50  wait: #1682 is mid-CI — serialising
         16:01  ⚠ GREEN AND STUCK: #1680 idle 54m
         16:01  wait: #1682 is mid-CI — serialising

     It DETECTED the stuck PRs correctly on every run and acted on none of them; the whole day's
     queue was hand-drained instead. The detector was never the defect — the gate in front of it was.

     ⚠️ The obvious narrower fix does NOT work, and it was tried first: "only serialise behind a PR
     that is not itself BEHIND", on the reasoning that a BEHIND PR cannot merge so cannot re-BEHIND
     anyone. True, and useless here — a PR is mid-CI precisely because it was just pushed, so it is
     usually CURRENT at that moment. The blocker is a STREAM of legitimately-current pushes, not a
     stalled one.

     So the escape is time, and it is the one thing that distinguishes "waiting is working" from
     "waiting has failed": a PR starved past STARVED_MIN has outlasted two full CI cycles. Against
     the log above it fires at 15:41 on #1680 (idle 34m) — the first run where the queue had
     demonstrably stopped draining on its own. */
  const busy = classified.find((c) => c.k === 'running');
  if (busy) {
    const starved = classified.filter((c) => c.k === 'stuck-behind' && c.idleMin >= STARVED_MIN);
    if (!starved.length) return { action: 'wait', why: `#${busy.pr.number} is mid-CI (${busy.why}) — serialising` };
  }

  /* An AWAITING PR that is BEHIND and armed is updatable, and updating is the remedy: a new head is
     what makes an unreported context report. It ranks below `stuck-behind` only because that state is
     unambiguous; both are drained oldest-first by the sort below. */
  /* An UNEXPANDED PR that is BEHIND and armed is updatable for the same reason an awaiting one is,
     and here the new head is the ONLY remedy there is. A CURRENT one is not a candidate: this tool
     only ever calls `update-branch`, and that verb has nothing to push on a head already current —
     the report names it instead, because least privilege is why the tool cannot commit. */
  const cands = classified.filter(
    (c) =>
      (c.k === 'stuck-behind' && c.idleMin >= IDLE_MIN) ||
      (c.k === 'awaiting' && c.behind && c.armed && c.idleMin >= IDLE_MIN) ||
      (c.k === 'unexpanded' && c.behind && c.armed && c.idleMin >= IDLE_MIN)
  );
  if (!cands.length) {
    const young = classified.filter((c) => c.k === 'stuck-behind');
    if (young.length) return { action: 'none', why: `${young.length} stuck but all idle < ${IDLE_MIN}m — leaving room for their owners` };
    return { action: 'none', why: 'nothing stuck' };
  }
  /* OLDEST FIRST. Any order drains the queue; oldest-first bounds the worst-case wait per PR instead
     of letting one unlucky branch starve behind a stream of newer ones. */
  cands.sort((a, b) => b.idleMin - a.idleMin);
  return { action: 'update', pr: cands[0].pr, why: cands[0].why };
}

/* ── I/O ─────────────────────────────────────────────────────────────────────────────────────────
   Everything below talks to `gh`. Nothing below makes a decision. */

const gh = (a) => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const git = (a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * Is Kodiak the merger HERE — measured, not assumed? `.kodiak.toml` is INERT until the owner installs
 * the App, so the config alone proves nothing and the last merge names the merger.
 * ∅: a probe that did not read returns `null`, never `false` — `false` would read as "a human merges
 * here", which is the claim this function exists to stop guessing.
 * @returns {boolean|null}
 */
function kodiakOwnsDrain() {
  let cfg = null;
  try {
    cfg = readFileSync(join(git(['rev-parse', '--show-toplevel']).trim(), '.kodiak.toml'), 'utf8');
  } catch {
    return false;
  }
  if (!kodiakConfigSaysUnarmed(cfg)) return false;
  try {
    const rows = JSON.parse(gh(['pr', 'list', '--state', 'merged', '--limit', '1', '--json', 'mergedBy']));
    const login = Array.isArray(rows) && rows[0] && rows[0].mergedBy ? rows[0].mergedBy.login : null;
    if (typeof login !== 'string' || login === '') return null;
    return /kodiak/i.test(login);
  } catch {
    return null;
  }
}

/* The probe behind dirtyVerdict(). It fetches the base branch and the PR head first, so the merge
   reads what GitHub reads and not a stale remote-tracking ref, and it pins the head to the OID `gh`
   reported. Any failure returns null, which classifies `dirty` with the old remedy. */
export function probeMerge(number, headOid, baseRef, run = git) {
  try {
    run(['fetch', '-q', '--no-write-fetch-head', 'origin', baseRef, `pull/${number}/head`]);
    const base = run(['rev-parse', '--verify', `refs/remotes/origin/${baseRef}^{commit}`]).trim();
    run(['cat-file', '-e', `${headOid}^{commit}`]);
    let out = '';
    let exit = 0;
    try {
      out = run(['merge-tree', '--write-tree', '--name-only', headOid, base]);
    } catch (e) {
      exit = e.status;
      out = String(e.stdout || '');
    }
    return parseMergeTree(out, exit);
  } catch {
    return null;
  }
}

function requiredContexts() {
  try {
    const repo = JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
    const rules = JSON.parse(gh(['api', `repos/${repo}/rules/branches/main`]));
    const r = rules.find((x) => x.type === 'required_status_checks');
    const list = r ? r.parameters.required_status_checks.map((c) => c.context) : [];
    return list.length ? list : null; // an EMPTY required set is indistinguishable from a failed read
  } catch {
    return null;
  }
}

/* THE CHECK RUNS ON ONE HEAD, which is the only place a hidden duplicate is visible, plus what the
   merge bot says about the same head. `gh pr checks` collapses the runs sharing a name; this does
   not. Returns null when the payload could not be read WHOLE — a truncated page under-reports the
   duplicates, and an under-report here reads exactly like a clean head. */
function headCheckRuns(repo, sha) {
  if (!repo || !sha) return null;
  try {
    const j = JSON.parse(gh(['api', `repos/${repo}/commits/${sha}/check-runs?per_page=100`]));
    const arr = Array.isArray(j.check_runs) ? j.check_runs : null;
    if (!arr) return null;
    if (typeof j.total_count === 'number' && j.total_count > arr.length) return null;
    const runs = arr.map((c) => ({ name: c.name, conclusion: c.conclusion, runId: runIdFromUrl(c.html_url || c.details_url) }));
    /* The bot's own sentence. It named the failing context in ONE query on #3871, where no `gh pr`
       field did, so the report quotes it rather than paraphrasing a cause. */
    const bot = arr.find((c) => /kodiak/i.test(String(c.name || '')));
    const botSays = bot && bot.output && bot.output.title ? String(bot.output.title).slice(0, 120) : null;
    return { runs, botSays };
  } catch {
    return null;
  }
}

/* THE QUEUED POOL, repo-wide, with a job count on every run old enough for the count to mean
   anything. One list call covers the repo, because the pool is a property of the repo and not of a
   PR — a jobless run OUTLIVES the PR whose push created it, and two of the ones measured on
   2026-11-11 belong to branches merged in August. The job probe is bounded to the suspects: a
   healthy queue therefore costs exactly one API call, and only a run past UNEXPANDED_MIN costs a
   second. Returns null when the pool could not be read — an unread pool must read as "not
   examined", never as "nothing unclaimable". */
function queuedRuns(repo, nowMs) {
  if (!repo) return null;
  let arr;
  try {
    const j = JSON.parse(gh(['api', `repos/${repo}/actions/runs?status=queued&per_page=100`]));
    arr = Array.isArray(j.workflow_runs) ? j.workflow_runs : null;
  } catch {
    return null;
  }
  if (!arr) return null;
  const out = arr.map((r) => ({
    runId: String(r.id),
    name: r.name || null,
    status: 'queued',
    headSha: r.head_sha || null,
    headBranch: r.head_branch || null,
    createdAtMs: Date.parse(r.created_at),
    jobs: null
  }));
  for (const r of out) {
    if (!Number.isFinite(r.createdAtMs) || (nowMs - r.createdAtMs) / 60000 < UNEXPANDED_MIN) continue;
    try {
      const n = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${r.runId}/jobs`])).total_count;
      r.jobs = typeof n === 'number' ? n : null;
    } catch {
      r.jobs = null;
    }
  }
  return out;
}

function snapshotAll() {
  const prs = JSON.parse(gh(['pr', 'list', '--limit', '100', '--json', 'number,state,isDraft,mergeStateStatus,autoMergeRequest,updatedAt,title,headRefOid,baseRefName']));
  let repo = null;
  try {
    repo = JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
  } catch {
    repo = null;
  }
  const pool = queuedRuns(repo, Date.now());
  const byHead = new Map();
  for (const r of pool || []) {
    if (!r.headSha) continue;
    if (!byHead.has(r.headSha)) byHead.set(r.headSha, []);
    byHead.get(r.headSha).push(r);
  }
  const snaps = prs.map((p) => {
    let checks = [];
    let readable = true;
    try {
      checks = JSON.parse(gh(['pr', 'checks', String(p.number), '--json', 'name,bucket,link']));
    } catch (e) {
      /* `gh pr checks` exits non-zero when a check is FAILING — a verdict, not an error. But a throw
         also covers the network dying, and those must not produce the same snapshot. Distinguish by
         whether any JSON came back at all. */
      const m = String(e.stdout || '');
      if (m.trim().startsWith('[')) {
        try {
          checks = JSON.parse(m);
        } catch {
          readable = false;
        }
      } else readable = false;
    }
    const cr = p.state === 'OPEN' && !p.isDraft ? headCheckRuns(repo, p.headRefOid) : { runs: [], botSays: null };
    return {
      number: p.number,
      title: p.title,
      state: p.state,
      isDraft: p.isDraft,
      mergeState: p.mergeStateStatus,
      autoMerge: p.autoMergeRequest != null,
      updatedAtMs: Date.parse(p.updatedAt),
      checks,
      readable,
      checkRuns: cr ? cr.runs : null,
      botSays: cr ? cr.botSays : null,
      runsReadable: cr != null,
      mergeProbe: p.mergeStateStatus === 'DIRTY' && !p.isDraft ? probeMerge(p.number, p.headRefOid, p.baseRefName) : null,
      headRuns: byHead.get(p.headRefOid) || []
    };
  });
  return { prs: snaps, pool };
}

/* WHERE THE WAKE LIVES. `red-prs.json` is the current set for a reader (the board); `red-prs.log`
   gains a line only when a PR turns red or clears, so a watcher on it wakes once per change. The
   directory follows the timer's user, never the checkout: the timer runs from a copy. */
export function redLedgerDir() {
  return process.env.TEPNA_STATE_DIR || join(homedir(), '.local/state/tepna/queue-doctor');
}

function writeRedLedger(failing, required, now) {
  const dir = redLedgerDir();
  let prev = null;
  try {
    prev = JSON.parse(readFileSync(join(dir, 'red-prs.json'), 'utf8'));
  } catch {
    prev = null;
  }
  const { ledger, lines } = redLedger(prev, failing, new Date(now).toISOString(), required);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'red-prs.json'), `${JSON.stringify(ledger, null, 1)}\n`);
    if (lines.length) appendFileSync(join(dir, 'red-prs.log'), `${lines.join('\n')}\n`);
  } catch (e) {
    console.log(`    red ledger not written under ${dir}: ${String(e.message).split('\n')[0].slice(0, 80)}`);
  }
  return lines;
}

function main() {
  const argv = process.argv.slice(2);
  const DRY = argv.includes('--dry-run');
  const REPORT = argv.includes('--report');

  const required = requiredContexts();
  if (required == null) {
    console.error('queue-doctor: REFUSING — could not read the required-check set. Not reporting "0 stuck" about state never examined.');
    process.exit(2);
  }

  let prs;
  let pool = null;
  try {
    const snap = snapshotAll();
    prs = snap.prs;
    pool = snap.pool;
  } catch (e) {
    console.error(`queue-doctor: REFUSING — could not list PRs: ${String(e.message).split('\n')[0]}`);
    process.exit(2);
  }
  const unreadable = prs.filter((p) => !p.readable);
  const now = Date.now();
  const kodiak = kodiakOwnsDrain();
  const classified = prs.filter((p) => p.readable).map((p) => ({ pr: p, ...classify(p, required, now, { kodiakOwnsDrain: kodiak }) }));

  const { stuck, failing, cancelled, wedged, dirty, unexpanded } = attention(classified);
  const stamp = new Date(now).toISOString().slice(11, 19);

  /* SAY THE THING NO VIEW SAYS. This line is the whole point of the tool: a PR that is green, armed
     and permanently unmergeable appears healthy in every GitHub summary. */
  if (stuck.length) {
    console.log(`${stamp}  ⚠ GREEN AND STUCK: ${stuck.length} PR(s) — green, no blocking failures, and cannot merge without help`);
    for (const c of stuck) console.log(`    #${c.pr.number}  ${c.why}  — ${c.pr.title.slice(0, 52)}`);
  } else {
    console.log(`${stamp}  no PR is green-and-stuck (${classified.length} open)`);
  }

  /* SERIALISING IS INFORMATION, NOT ATTENTION. It prints so the queue's shape stays visible, and it
     sits outside `attention()` so `--report` does not exit 1 over Kodiak doing its job. */
  const serialising = classified.filter((c) => c.k === 'serialising');
  if (serialising.length) {
    console.log(`${stamp}  ↻ SERIALISING: ${serialising.length} PR(s) green + BEHIND + unarmed while Kodiak drains its queue — information, not attention`);
    for (const c of serialising) console.log(`    #${c.pr.number}  ${c.why}  — ${c.pr.title.slice(0, 52)}`);
  }
  /* A RED PR IS NOT AN IDLE QUEUE. classify() says so (`failing`); the report must too. */
  if (failing.length) {
    console.log(`${stamp}  ✗ RED: ${failing.length} PR(s) with a failing REQUIRED check — updating cannot land them`);
    for (const c of failing) console.log(`    #${c.pr.number}  ${c.why}  — ${c.pr.title.slice(0, 52)}`);
  }
  /* A CANCELLED REQUIRED CHECK LOOKS NEARLY GREEN in every rollup, and nothing re-runs it. */
  if (cancelled.length) {
    console.log(`${stamp}  ⊘ CANCELLED: ${cancelled.length} PR(s) with a cancelled REQUIRED check — no merge until someone re-runs it`);
    for (const c of cancelled) console.log(`    #${c.pr.number}  ${c.why}  — ${c.pr.title.slice(0, 52)}`);
  }
  /* A WEDGE IS INVISIBLE IN EVERY ROLLUP, and the remedy is a re-run of the run that examined
     nothing — never an arm and never an update. */
  if (wedged.length) {
    console.log(`${stamp}  ⧗ WEDGED: ${wedged.length} PR(s) whose rollup reads green while a stale run holds a required context`);
    for (const c of wedged) console.log(`    #${c.pr.number}  ${c.why}  — ${c.pr.title.slice(0, 52)}`);
  }
  /* DIRTY IS NAMED WITH ITS REMEDY. The local merge probe tells GitHub's display artifact from a real
     conflict, and the `why` carries the remedy for each. */
  if (dirty.length) {
    console.log(`${stamp}  ⇄ DIRTY: ${dirty.length} PR(s) — neither kind merges until someone merges main in`);
    for (const c of dirty) console.log(`    #${c.pr.number}  ${c.why}  — ${c.pr.title.slice(0, 52)}`);
  }
  /* A RUN THAT CANNOT START IS NOT A QUEUE POSITION, and the fleet read it as one for two hours on
     2026-11-11. The remedy is a push, so it is named per PR with the run ids that prove it. */
  if (unexpanded.length) {
    console.log(`${stamp}  ⧖ UNCLAIMABLE: ${unexpanded.length} PR(s) whose head carries a queued run holding no job — no wait can clear it`);
    for (const c of unexpanded) console.log(`    #${c.pr.number}  ${c.why}  — ${c.pr.title.slice(0, 52)}`);
  }
  /* THE POOL, AND THE NUMBER §5 ACTUALLY WANTS. `pend` there is the collect criterion, and a jobless
     run holds the raw count above 0 for ever — including runs on branches that merged in August, which
     belong to no open PR and so appear nowhere above. */
  if (pool == null) {
    console.log('    queued-run pool unreadable — the unclaimable-run rung examined NOTHING on any head');
  } else {
    const pp = poolPend(pool, now);
    if (pp.unexpanded.length) {
      const byBranch = new Map();
      for (const d of pp.unexpanded) byBranch.set(d.branch || '(unknown)', (byBranch.get(d.branch || '(unknown)') || 0) + 1);
      for (const d of pp.unexpanded.filter((x) => x.reason === 'past-queue-limit').slice(0, 5)) {
        console.log(`    run ${d.runId}  ${d.name || 'run'}  ${(d.ageMin / 60).toFixed(0)}h queued on ${d.branch || '(unknown)'} — expanded, never claimed`);
      }
      const where = [...byBranch.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([b, n]) => `${b} ×${n}`)
        .join(', ');
      const nj = pp.unexpanded.filter((d) => d.reason === 'no-jobs').length;
      const pq = pp.unexpanded.length - nj;
      console.log(
        `${stamp}  ⧖ POOL: ${pp.unexpanded.length} of ${pp.queued} queued run(s) cannot start (${nj} hold no job, ${pq} past the 24 h queue limit) — pend is ${pp.pend}, not ${pp.queued} (CLAUDE.md §5 collects on pend)`
      );
      console.log(`    oldest ${(pp.unexpanded[0].ageMin / 60).toFixed(1)}h · ${where}`);
      if (nj) console.log('    → a jobless run never starts and never expires: one empty commit replaces the ones on a LIVE head, and the rest stay pool noise no push can reach');
      if (pq) console.log(`    → the ${pq} past the queue limit expanded and were never claimed, so no push reaches them: \`gh run cancel <id>\` is the only remedy, and the ids are above`);
    }
  }
  const fresh = writeRedLedger(failing, required, now);
  for (const l of fresh) console.log(`    ${l.includes('  RED ') ? 'NEW this run' : 'cleared'}: ${l.slice(22)}`);
  for (const p of unreadable) console.log(`    #${p.number}  checks unreadable — NOT counted either way`);
  /* ABSTENTION IS VISIBLE. A head whose check runs did not come back whole cannot be examined for a
     hidden duplicate, and silence there would read as "no wedge". */
  for (const p of prs) {
    if (p.readable && p.state === 'OPEN' && !p.isDraft && !p.runsReadable) console.log(`    #${p.number}  check RUNS unreadable — the wedge rung examined nothing on this head`);
  }

  const unarmed = stuck.filter((c) => c.k === 'stuck-unarmed');
  if (unarmed.length) {
    /* THE REMEDY FOLLOWS THE MERGER. Under a live Kodiak, arming adds nothing (CLAUDE.md §5) and the
       question is the bot's queue; with no bot, arming is the pre-Kodiak path this tool was built for;
       with the probe unread, the tool says it could not look rather than picking one. */
    if (kodiak === true) {
      console.log(
        `    → ${unarmed.length} green and unarmed while the merge bot is LIVE: Kodiak merges unarmed PRs, so arming adds nothing — read its queue instead (\`gh pr list --state merged --limit 1 --json mergedBy\`).`
      );
    } else if (kodiak === null) {
      console.log(
        `    → ${unarmed.length} unarmed, and the merge-bot probe did NOT read: if Kodiak is installed, arming adds nothing (CLAUDE.md §5) — probe it with \`gh pr list --state merged --limit 1 --json mergedBy\`.`
      );
    } else {
      console.log(`    → ${unarmed.length} need a human: arm auto-merge (\`gh pr merge <N> --auto --squash\`); updating cannot land them.`);
    }
  }

  if (REPORT) process.exit(stuck.length || failing.length || cancelled.length || wedged.length || dirty.length || unexpanded.length ? 1 : 0);

  const d = pick(classified);
  if (d.action !== 'update') {
    console.log(`${stamp}  ${d.action}: ${d.why}`);
    return;
  }
  if (DRY) {
    console.log(`${stamp}  WOULD update #${d.pr.number} (${d.why})`);
    return;
  }
  try {
    gh(['pr', 'update-branch', String(d.pr.number)]);
    console.log(`${stamp}  ✓ updated #${d.pr.number} — CI will re-run; armed auto-merge takes it from there`);
  } catch (e) {
    console.log(`${stamp}  update declined for #${d.pr.number}: ${String(e.message).split('\n')[0].slice(0, 90)}`);
  }
}

/* Compare the resolved path, not a suffix: a suffix guard makes the module a SILENT NO-OP under any
   other filename, which is how a renamed copy once exited 0 having done nothing. */
if (isCliEntry(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(2);
  }
}

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
 * Exit: 0 acted or nothing to do · 1 --report found stuck PRs · 2 REFUSED (could not read state).
 */

import { execFileSync } from 'node:child_process';

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

/* ── PURE CORE ───────────────────────────────────────────────────────────────────────────────────
   Separated so the decisions are gate-backed without `gh`, a network or a clock — the same shape as
   land-pr's `decide()`, for the same reason: this tool acts on other sessions' work unattended. */

/** Classify ONE pr snapshot. `required` is the ruleset's required contexts; `null` means unreadable. */
export function classify(pr, required, nowMs) {
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
  if (pr.mergeState === 'DIRTY') return { k: 'dirty', why: 'merge conflict — needs a human rebase' };

  /* Green. Everything below is a flavour of STUCK — the state with no name. */
  const idleMin = pr.updatedAtMs ? (nowMs - pr.updatedAtMs) / 60000 : 0;
  if (pr.mergeState === 'BEHIND') {
    if (!pr.autoMerge) return { k: 'stuck-unarmed', why: 'green + BEHIND but auto-merge NOT armed — updating cannot land it', idleMin };
    return { k: 'stuck-behind', why: `green + BEHIND + armed, idle ${idleMin.toFixed(0)}m`, idleMin };
  }
  if (pr.mergeState === 'UNKNOWN') return { k: 'computing', why: 'GitHub still computing mergeability' };
  if (!pr.autoMerge) return { k: 'stuck-unarmed', why: 'green and mergeable but auto-merge NOT armed', idleMin };
  return { k: 'ready', why: 'green and current — auto-merge should take it' };
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
  const cands = classified.filter((c) => (c.k === 'stuck-behind' && c.idleMin >= IDLE_MIN) || (c.k === 'awaiting' && c.behind && c.armed && c.idleMin >= IDLE_MIN));
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

function snapshotAll() {
  const prs = JSON.parse(gh(['pr', 'list', '--limit', '100', '--json', 'number,state,isDraft,mergeStateStatus,autoMergeRequest,updatedAt,title']));
  return prs.map((p) => {
    let checks = [];
    let readable = true;
    try {
      checks = JSON.parse(gh(['pr', 'checks', String(p.number), '--json', 'name,bucket']));
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
    return {
      number: p.number,
      title: p.title,
      state: p.state,
      isDraft: p.isDraft,
      mergeState: p.mergeStateStatus,
      autoMerge: p.autoMergeRequest != null,
      updatedAtMs: Date.parse(p.updatedAt),
      checks,
      readable
    };
  });
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
  try {
    prs = snapshotAll();
  } catch (e) {
    console.error(`queue-doctor: REFUSING — could not list PRs: ${String(e.message).split('\n')[0]}`);
    process.exit(2);
  }
  const unreadable = prs.filter((p) => !p.readable);
  const now = Date.now();
  const classified = prs.filter((p) => p.readable).map((p) => ({ pr: p, ...classify(p, required, now) }));

  const stuck = classified.filter((c) => c.k === 'stuck-behind' || c.k === 'stuck-unarmed');
  const stamp = new Date(now).toISOString().slice(11, 19);

  /* SAY THE THING NO VIEW SAYS. This line is the whole point of the tool: a PR that is green, armed
     and permanently unmergeable appears healthy in every GitHub summary. */
  if (stuck.length) {
    console.log(`${stamp}  ⚠ GREEN AND STUCK: ${stuck.length} PR(s) — green, no blocking failures, and cannot merge without help`);
    for (const c of stuck) console.log(`    #${c.pr.number}  ${c.why}  — ${c.pr.title.slice(0, 52)}`);
  } else {
    console.log(`${stamp}  no PR is green-and-stuck (${classified.length} open)`);
  }
  for (const p of unreadable) console.log(`    #${p.number}  checks unreadable — NOT counted either way`);

  const unarmed = stuck.filter((c) => c.k === 'stuck-unarmed');
  if (unarmed.length) {
    console.log(`    → ${unarmed.length} need a human: arm auto-merge (\`gh pr merge <N> --auto --squash\`); updating cannot land them.`);
  }

  if (REPORT) process.exit(stuck.length ? 1 : 0);

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
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main();
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(2);
  }
}

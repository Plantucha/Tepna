<!--
  DELIVERY-PROCESS-OVERHAUL-2026-08-18-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS — 2026-09-02 (§1 §3 §4 executed in the founding PR; §2 §5 §6 owner-gated. ⚠ **§2's RAW FACTS, no bar applied — CORRECTED 2026-09-02.** ~~§2's ratified cadence is being BREACHED ~3×~~ was **my error, and it propagated.** §2 is headed **OWNER-GATED** and states its rule as ***"Proposed:** fold at ≥25 pending changesets or weekly"* — so calling it *ratified* upgraded a proposal, and the multiplier was then derived from the upgrade. **A header claim that outran its source**, in the governance layer, written by the session that spent that day cataloguing exactly that shape; a peer repeated the multiplier back within the hour. The count was also quoted with no window, the same defect as a ppm without its span — it read **78** when first measured and **89** hours later. **The facts, for the owner to apply their own bar to:** **89** pending changesets excluding README (`git ls-tree -r origin/main -- changes/`, measured 2026-09-02 evening); last release **v2.9.0** on **2026-08-30**; §2's PROPOSED trigger is *"≥25 pending or weekly"*, so the count clause is over and the time clause is not. Cutting v2.10.0 is not a session's call — §📦 forbids hand-picking a version and it sits in the owner's decision queue. **The consequence that outranks the count:** `CHANGELOG.md` is tool-owned and corrections land as NEW entries, so a deferred fold holds a verified-false CHANGELOG line live and greppable until someone cuts a release) · **Created:** 2026-08-18

# Delivery-process overhaul — the friction, measured, and what removes it

> Owner-commissioned 2026-08-18 after a session that paid every cost below in one night. Everything here
> is a number somebody measured, not an intuition; the failures that produced each rule are cited so a
> future session can re-derive *why* before relaxing anything.

## The problem, priced

`strict:true` + 17 required checks + N parallel sessions. One night, four sessions:

| friction | measured |
|---|---|
| jobs in flight before anyone acted | 11 PRs × 17 checks = **187** |
| pool at saturation | 130 queued · 4 running · ~1 job retired/min · hours to clear |
| CI laps to land ONE unchanged doc PR | **4** (~68 job-runs re-proving identical content) |
| superseded `tests` run after branch update | executed **43 min past its SHA being replaced**, to `success`, against a dead tree |
| workflows lacking `cancel-in-progress` at the time | **8 of 11** — an update was purely ADDITIVE load |
| release debt | **220 pending changesets** against canonical v2.5.0 |
| orphaned worktrees | **329** registered, 0 prunable, ~55–60 GB, volume at 90 % |
| shared-root staleness | 250+ commits behind, permanently (sync guard correctly refuses over 180 dirty paths) → **6 confident wrong answers in one afternoon across two sessions** |

## §1 · Guarded `cancel-in-progress` on the 5 remaining PR-triggered workflows — EXECUTED here

`tests` `types` `format` `no-network` `codeql` now carry the exact house pattern `capture-host-ci.yml`
already had: `group: <name>-${{ github.ref }}`, `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`.
PR-only deliberately — cancelling on `main` leaves a cancelled required check with no successor.
`ci-timing`/`coverage` are schedule-only (nothing to guard); `browser-gates`/`mutation`/`stale-file`
already cancelled. **Verified live in the founding PR:** a second push while the first run was in flight,
then `gh run list` showing the superseded runs `cancelled` — the exact scenario that burned 43 min.

## §2 · Release fold cadence — OWNER-GATED, and the largest single debt

220 changesets is work cadence fully decoupled from release cadence. The machinery is fine
(`tools/release.mjs` computes the version once from a green tree and refuses while corpus-backed
fixtures are unverified); nobody runs it. **Proposed: fold at ≥25 pending changesets or weekly,
whichever first, run attended on the box holding the corpus.** Not automated deliberately — the tool's
refusal conditions (red tree, unverified fixtures) need a human deciding *regenerate vs investigate*,
and an unattended fold that hits one would either die silently or be pressured into `--force` culture.

## §3 · WIP cap ≤ 4 open PRs repo-wide — EXECUTED (CLAUDE.md §👥.5b)

> ### ▶ AMENDMENT PROPOSED 2026-08-18 — the cap assumes WIP is DRAINABLE by its holder
>
> Measured within hours of shipping it: the queue sat at 5–6 open with **four belonging to a session
> whose `update-branch` is denied by its permission classifier**. Those PRs are green, `BEHIND`, and
> cannot be merged by their author at all — so under a literal reading the cap froze *two* sessions'
> finished work indefinitely, while the PRs causing the freeze were the ones contributing **no**
> contention: a PR that structurally cannot merge is not racing for the merge window and re-runs no CI.
>
> **Proposed wording:** the cap counts PRs their holder *can* act on. A PR blocked by a permission or
> tooling condition outside the holder's control is **parked**, not work-in-progress, and is excluded
> from the count while it stays that way — with the state named out loud so "parked" cannot become a
> way to hold an unlimited queue. Raised by Brief runner from inside the block; recorded here rather
> than edited into `CLAUDE.md`, because the constitution is the owner's.


The 187-job pile-up was **legitimate work units, just too many at once** — the flattering explanation
("our collection discipline caused it") was measured false: collections were ~68 jobs against 131 queued.
The cap is §5's "one PR per work-unit" made checkable across sessions. A finished unit waits for a slot.

## §4 · Worktree lifecycle — EXECUTED (`tools/wt-done.mjs`)

Verifies the branch's PR is **MERGED via `gh`** (never `git branch --merged` — squash-merge strands
branches) and the tree is **clean**, then `git worktree remove` with NO `--force` so git's guard stays
the last line. `--list` prints every worktree with a verdict and its DENOMINATOR. Refusals are a pure
exported core (`verdict()`), self-tested (6 legs) including the anti-vacuity direction.

## §5 · Merge queue — OWNER-GATED, and the ground is already prepared

§👥.5 rejected a queue in 2026-08 when the problem was one session splitting a fix into five PRs —
correct then. 2026-08-18 measured a different problem: the race is structural at N>1 sessions (4 laps,
zero content change). Meanwhile **7 workflows already carry `merge_group:` triggers**, wired before the
queue deliberately (BRIEF-COLLISION-RESIDUAL-GAP-2026-08-09 §4) because the reverse order is an outage.
So the decision is genuinely open, not settled: flipping the ruleset is ~minutes of owner action, CI
runs once per queue entry on the predicted merge state, and §5b's collection rules become largely
unnecessary knowledge. **Blocked on: owner yes/no.** If no: the fallback is a landing train
(`land-pr.mjs` over a list, collecting k+1 only after k merges).

## §6 · Drain the shared root once — OWNER-GATED, destructive-adjacent

The root's 180 dirty paths make the sync guard's refusal *permanent*, so the checkout is stale without
bound and produced six confident wrong answers in one afternoon. The fix is one attended pass: rescue
snapshot (the §👥.2 temp-index recipe — preserves every byte on a branch), tar the untracked set as a
second copy, then restore the tree and let the existing 15-min timer work. **Owner-gated because step 3
destroys working-tree state that may be another session's only copy** — the snapshot makes it safe in
fact, but the *authorization* to step on possibly-live work is the owner's to give, per §👥.2's own rule.

## §7 · Acting on ANOTHER SESSION's PR — base-merge freely, arm never (2026-08-21)

Parallel sessions routinely find each other's PRs stuck. The line below was converged on independently
by two sessions and then tested by a near-miss; it was written nowhere, so it is written here.

| action on someone else's PR | permitted | why |
|---|---|---|
| `gh pr update-branch` on a **green-and-stuck** PR | **yes, no ask** | queue mechanics — adds none of your content, is exactly what the `queue-doctor` timer does repo-wide, and under `strict: true` the deadlock **never** self-resolves, so waiting for the owner's round-trip is pure loss |
| `gh pr merge --auto` | **no** | not content, but it decides **when their work lands**. That is the owner's call |
| pushing commits, editing files, amending, force-pushing | **no** | branch content is owner-only |

**Two near-misses tested it, and the second one falsified the first's heuristic** (2026-08-22).
Both cases: a session ran a mutating command with the wrong PR number — its own was N+1. Both
disclosed. Both did not tidy. Both were right. The reasoning has two parts, and it took the second
case to disentangle them.

**Part one: check whether the command CHANGED STATE.** GitHub records nothing for enabling auto-merge
on a PR that already has it, so a stray `gh pr merge <N> --auto` on an already-armed PR **returned
success and did nothing**. Disarming would then have been the *only* real action either party took —
a strictly *larger* intervention than the thing it was correcting. Read the timeline: `gh api
repos/<o>/<r>/issues/<N>/timeline` distinguishes *"I changed their state"* from *"my command was a
no-op"*, and those need opposite responses (leave it, or tell the owner).

**Part two — and this is where the first draft was wrong.** The first draft used a shape rule to
identify the no-op:

> `auto_squash_enabled` at PR-create-time + 1 s ⇒ the owner's own create-and-arm chain, so you did nothing.

The heuristic is **unsound in both directions**, and the second case demonstrated it. The delta
measures how fast the *owner's* create-and-arm CHAIN ran — a property of their tooling and the
network, not of whether anyone else acted. A chain with a slower step, a retry, or a `land-pr`
handoff sits at +3–5 s just as innocently. And it fails the other way too: if a PR is NOT armed at
create and a stray command arms it hours later, that lands at PR-time+N seconds — correctly flagged
by the delta rule, but only because the delta is huge. Shrink the gap (a stray arm 3 s after someone
else creates a PR) and the rule silently clears a **real** intrusion.

**The reliable discriminator is different — it is the event timestamp against YOUR OWN
wall-clock time when you ran the mutating command.** That is the only quantity that distinguishes
*"they armed it"* from *"I armed it"*, and it is always directly available to you: you know when you
ran the thing.

```
auto_squash_enabled ≈ PR-creation time                        → owner's chain; you were a no-op
auto_squash_enabled ≈ the wall-clock when YOU ran the command → you did the arm; it was NOT a no-op
```

The **count** still does load-bearing work underneath: GitHub records nothing for arming an
already-armed PR, so *exactly one* event on the timeline means **at most one arm actually took
effect**. That is what makes the "no-op" verdict verifiable at all.

**A second axis, discovered on the same day and stated because the first draft treated all mutating
commands alike.** `gh pr merge --auto` on an already-armed PR is a **flag set** — GitHub's
server-side handler rejects it or records it as a no-op, so it *structurally* cannot act. `land-pr
<N>` is a genuinely different beast: it is a **state-dependent actor** that base-merges when the PR
is `BEHIND` and squash-merges when it is green. Its blast radius depends on the PR's state at the
moment the command runs, and it lands the owner's work if that state happens to be green.

| shape | example | blast radius on a wrong PR number |
|---|---|---|
| **flag set / idempotent** | `gh pr merge <N> --auto`, `gh pr enable-auto-merge` | none — server rejects or records a no-op |
| **state-dependent actor** | `node tools/land-pr.mjs <N>`, `gh pr merge <N> --squash` (no `--auto`) | merges when state permits — a green stranger's PR lands |

**So the read-back-the-number rule matters MORE for the actor family than for the idempotent one,
and the check-what-actually-happened rule applies to both.** A rule that treats them the same is
over-cautious for the flag and under-cautious for the lander.

**Two rules fall out, restated with the corrections:**

1. **Read back the PR number before running any actor-family command.** Actor-family and
   idempotent-family take the same argument shape, so a fat-finger silently retargets a *different
   session's* work. The cost of the mistake diverges hugely: on `gh pr merge --auto` it is nothing;
   on `land-pr <N>` it lands their work early.
2. **When you discover you may have touched someone else's branch, DISCLOSE AND STOP — do not tidy.**
   The instinct to undo is an instinct to take a *second* unilateral action on a branch you have
   already established is not yours. Check the timeline first; report the finding regardless. If the
   first action was a no-op, the second (disarming, re-updating, whatever) would be the only real
   action either party took.


## Done when

- [x] §1 five workflows guarded + verified live (founding PR)
- [x] §3 cap written into CLAUDE.md §5b
- [x] §4 `wt-done.mjs` shipped with selftest
- [x] §2 first fold EXECUTED — v2.5.0 → **v2.6.0** (#1467, 221 changesets folded, tag `v2.6.0` pushed on the merge commit); cadence: ≥25 pending or weekly, attended
- [x] §5 **CLOSED — declined by availability (owner-ratified 2026-08-23).** GitHub merge queue requires an organization-owned repository; Tepna is user-owned (`owner.type: User`, `isInOrganization: false`, API rejects a `merge_queue` rule outright — all three verified 2026-08-16, CLAUDE.md §👥.5/5b). The question was never economic. The 7 `merge_group` triggers stay wired at zero cost — they fire only if a queue ever exists, and removing them would recreate the BRIEF-COLLISION-RESIDUAL-GAP §4 outage risk if ownership ever changes. Re-open ONLY on a repository-ownership change, not on throughput arguments.
- [x] §6 root DRAINED — 180 paths rescue-snapshotted (byte-verified) + tar; all three peer sessions confirmed nothing live (one nested-worktree branch judged superseded by its owner); porcelain 0, and the sync timer's FIRST REAL TICK is in the journal: `main fast-forwarded 1 commit(s): 4c42cab7 -> 3b5b93fe` on both checkouts

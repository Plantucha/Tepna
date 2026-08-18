<!--
  DELIVERY-PROCESS-OVERHAUL-2026-08-18-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS — 2026-08-18 (§1 §3 §4 executed in the founding PR; §2 §5 §6 are owner-gated) · **Created:** 2026-08-18

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

## Done when

- [x] §1 five workflows guarded + verified live (founding PR)
- [x] §3 cap written into CLAUDE.md §5b
- [x] §4 `wt-done.mjs` shipped with selftest
- [x] §2 first fold EXECUTED — v2.5.0 → **v2.6.0** (#1467, 221 changesets folded, tag `v2.6.0` pushed on the merge commit); cadence: ≥25 pending or weekly, attended
- [ ] §5 owner decision **still pending** (the one open item) — 7 workflows are `merge_group`-wired, the flip is minutes of ruleset work when the yes comes
- [x] §6 root DRAINED — 180 paths rescue-snapshotted (byte-verified) + tar; all three peer sessions confirmed nothing live (one nested-worktree branch judged superseded by its owner); porcelain 0, and the sync timer's FIRST REAL TICK is in the journal: `main fast-forwarded 1 commit(s): 4c42cab7 -> 3b5b93fe` on both checkouts

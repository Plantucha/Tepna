---
bump: patch
type: changed
brief: DELIVERY-PROCESS-OVERHAUL-2026-08-18-BRIEF.md
---

Delivery-process overhaul, Tier 0+: the three fixes a saturated night proved out, shipped together as
one work-unit (per the very cadence rule they encode).

§1 GUARDED CANCEL-IN-PROGRESS on the 5 remaining PR-triggered workflows (`tests` `types` `format`
`no-network` `codeql`), copying `capture-host-ci.yml`'s exact house pattern — PR-only, so main's history
never carries a cancelled required check with no successor. MEASURED cause: 8 of 11 workflows had no
guard, so a branch update was purely ADDITIVE load; a superseded 6-shard `tests` run executed 43 minutes
past its SHA being replaced, to `success`, against a dead tree, during the exact congestion everyone was
trying to relieve. Verified LIVE in this PR: pushed twice, watched the superseded runs flip `cancelled`.

§3 WIP CAP ≤4 open PRs repo-wide + the three-clause collection rule + per-workflow wedge base-rates, as
CLAUDE.md §👥.5b. Each clause bought by a failure: 187 jobs in flight from 11 legitimate PRs; a cancelled
required check reading pend=0 (count CONCLUSIONS, never pendings); a `tests` run called wedged against
dissimilar siblings that passed at 3h04m.

§4 `tools/wt-done.mjs` — the worktree removal that gets skipped because the merge feels like the end of
the work-unit. Verifies MERGED via gh (a squash merge strands the branch, so git's local merged-branch
view lies) and a clean tree, then removes with NO force flag. Pure `verdict()` core, 6-leg selftest.
Cause: 329 registered worktrees, 0 prunable, ~55-60 GB at 90 % disk.

Owner-gated, deliberately NOT here: the release fold (220 pending changesets — needs an attended run on
the corpus box), the merge queue (7 workflows already `merge_group`-wired; flipping the ruleset is the
owner's call and §👥.5's rejection deserves an explicit overturn, not a quiet one), and the shared-root
drain (destroys tree state that may be another session's only copy; snapshot makes it safe in fact, the
authorization is the owner's per §👥.2's own rule).

CI-only + docs + one new tool. No bundle, no DSP, no provenance movement.

---
bump: patch
type: fixed
---

`land-pr.mjs` waited on checks that cannot block a merge, and it cost **~90 minutes** on 2026-08-14.

Both #1259 and #1269 timed out at 45 minutes with `still UNSTABLE` / `EXIT=1` while
`mutation (diff-scoped)` was merely **pending**. That context is advisory by design and is not in the
`protect-main` ruleset's required set, so both PRs were mergeable throughout — #1259 merged *instantly*
the moment auto-merge was armed, with 22 passing and that same check still pending.

The tool already reads the required set from the ruleset; it uses it for the missing-context rule and
simply did not use it when counting `pending`. Now `snapshot()` computes `requiredPending` by exact
context name, and `decide()` waits only on that.

**⚠️ An unreadable required set must not become permission.** When the ruleset cannot be read,
`requiredPending` is `undefined` and the fallback is the total pending count — the same asymmetry the
`readable` guard already states: a spurious wait costs one more poll, a spurious merge cannot be undone.
Removing that fallback reds 4 assertions.

**Merging past an advisory check is now said out loud.** `merge` reports `N advisory check(s) still
pending, not required`. Doing it silently is the other half of the same defect: the mutation gate's red
already merges unnoticed, and a tool that quietly outruns it makes that worse rather than better.

Five assertions added to the `land-pr` group (17 → 22), each verified by re-applying the mutant it
exists to kill: fallback removed → 4 red, reverted to waiting on all pending → 2 red, advisory no longer
named → 1 red.

From `CAPTURE-HOST-UNWIRED-MACHINERY-FOLLOWUPS-2026-08-15-BRIEF.md` §3.

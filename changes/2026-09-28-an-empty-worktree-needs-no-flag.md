---
bump: patch
type: fixed
brief: none
---

**A worktree that holds nothing is removed by `wt-done <path>` with no flag, and a refusal now names the
state it measured.**

⚠️ **This is a naming defect, not a missing capability.** `pushedFor` has handled the empty case since
2026-09-26 (Heron, `wt-qcstall-hrn`) — its own comment says *"a branch with NO commits of its own … has
nothing to land and nothing to prove … holds for a branch that was never pushed"*. But the flag is named
for the **weaker** of its two cases, and the refusal hinted `--pushed` at *every* PR-less tree. On
2026-09-28 that hint sent a session and its coordinator to remove an empty worktree **by hand** — five
verification commands and an escalation — because the branch had never been pushed, so the hint read as
"not your case". Measured on a throwaway tree in exactly that state:

```
wt-done <path>            ✕ REFUSE: no PR found — cannot prove the work landed (… --pushed)
wt-done --pushed <path>   ✓ removed (no PR; every commit is on origin/main (no commits of its own) …)
```

One flag would have done it. **A hint that excludes the case it solves is worse than no hint.**

**The two cases are not the same trade, so they are now labelled.** `empty` loses *nothing* — there are no
commits, so a removal cannot be the last copy of anything — and needs no flag. `contained` trades a tree
for a copy on origin, which is a judgement, and stays opt-in behind `--pushed`. `pushedFor` remains the
**one** decision path: the no-flag route is a caller of it (`landless`), never a twin, so the two can
never disagree about what was measured.

Refusals now quote their measurement — `(1 commit(s) ahead of origin/main; branch is not on origin)` — and
offer `--pushed` **only to a branch that is actually on origin**, which is the hint that misfired.

**A second, smaller instance of the same fault, caught in this change's own first draft:** `commitsAhead`
was computed only inside the success branch, so the commonest refusal (a local branch with commits, never
pushed) printed no state at all — the uninformative message this change exists to remove, reintroduced one
level down. It is now measured on every path before any decision. Found by running it, not by reading it.

`--selftest` 40 → 52 assertions: the empty case with no flag, dirty and in-use still refusing over it,
`contained` still requiring the flag, and one per wording branch — that a refusal names its commit count
and remote-ref state, that it offers the flag when it can help, and that it **withholds** the flag when it
cannot.

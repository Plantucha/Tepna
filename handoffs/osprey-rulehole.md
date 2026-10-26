# Osprey — rulehole: an entries walk names the lister that chose its population

**Unit.** `tools/corpus-scope.mjs` `snapshotEntries` published `rule: null` in both return arms, so the
caller's lister never reached a reader. The lister is the only selection decision a non-night
population has.

**Branch and worktree.** `claude/rulehole-osp` in `wt-rulehole-osp`, two commits, rebased onto
`origin/main` after #3971 landed. PR **#3972**, DRAFT.

**Stopping point.** Both commits pushed. The row
`2026-10-26-the-entries-walk-drops-the-lister-that-chose-it` rides inside the PR, closed against this
same number. `residue-ids` reads 1 row added, and the citation gate reads PASS over 866 rows.

**Next step.** Ask Kestrel for the undraft on board thread 8. I never undraft my own PR.

**Open questions.**

- A `NOT_RUN` verdict carries `result: null`, so no rule reaches a reader over an empty population.
  Symmetric for both units, and pre-existing.
- `stage-lab --verdict-sample` prints a prose prefix before the object. Observed, pre-existing, and
  untouched here.

**Blockers.** None. The ledger conflicts on every parallel PR, so a rebase before the merge re-runs
`residue-ids` rather than keeping one side.

**The lesson worth carrying.** JS infers `Function.prototype.name` from the property key that holds
the function, so `{ list: (d) => ... }` reads `list`. A naive `list.name` therefore publishes a rule
nobody wrote, and no test tells that spelling apart from a function genuinely called `list`. Both read
`null`. A selftest leg caught this rather than review, and it changed the remedy.

**Doc-search query that finds this work.** `ruleIsDefault hardcoded true in snapshotEntries
corpus-scope` — reranker best 0.841, hit 1 board #1352.

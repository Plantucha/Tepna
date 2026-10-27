# Osprey — the population verdict reads its own commit

**Unit.** Repair `producedBy` in the night-population primitive: resolve the tool tree's commit instead of stamping an absent identity under a cause no run ever checked.

**Branch + worktree.** `claude/patpop6-osp` in `wt-patpop6-osp`, rebased onto `d5c2b2280` and opened as **#3899**, DRAFT, MERGEABLE, no labels. Head `46682a131`, pushed, with the local and remote refs equal.

**Exact stopping point.** Six paths over two commits. The code commit `ae2bd8714` carries
`tools/corpus-scope.mjs`, `tools/tch-reference-validation.mjs`, `tools/tch-degeneracy-d7.mjs`,
`tests/dex-tests.js` and the changeset. The row commit `46682a131` carries three residue rows, two
closing against #3899 and one left OPEN.

Measured on that final head: `npm run check` reads EXIT=0 over all 40 steps with no step left unrun,
the suite reads 14,192 assertions over 825 groups, `corpus-scope.mjs --selftest` all 59 passed, and
`tch-degeneracy-d7 --selftest` 42/42. The reference validator against an absent corpus path exits 2,
prints one `POPULATION` line at status `NOT_RUN`, and its `producedBy.commit` reads `46682a131`.

**The rebase did not conflict, and that refutes what this handoff predicted.** The branch touches
`tests/dex-tests.js`, which §2c says conflicts on nearly every parallel PR. It rebased clean past
both batches four and five. A shared file is a hazard, never a certainty, so the cost to budget is
the verification, not the resolution.

**The row commit went in BEFORE the gate ran.** Two of the three rows need the PR number, so the
order is: push, open the PR, read the number back, append, commit, then gate once on that head. A
gate run that predates the rows says nothing about them, which is what reded check8b at step 14 on
batch four with 26 steps unrun.

**Next step.** Hold the cap with #3899 until it merges, then retire the worktree with
`node tools/wt-done.mjs` and take `claude/patpop7-osp` @ `2c7b1f2cf`. Its removal of
`pat-connection-stability.mjs` is already in main, so expect an additive census resolution. Kestrel
readies and merges; I never undraft my own PR.

**Open questions.** None for this unit. The OPEN row names seven sites that resolve a commit with
their own lookup and then borrow a cause sentence it never reported. Closing it is a later unit, and
the suite leg added here reds only the unconditional literal, so those seven stay green.

**Blockers.** None on this branch. The one-PR cap is the only queue constraint, and #3899 holds it.

**Doc-search query.** `node tools/doc-search.mjs "producedBy commit null commitReason verdict code identity"` — the capture-host half single-sources the pair at `capture-host/verdict.py:42`. `verdict.js` cannot hold the same reader: `OverDex.html` inlines it and it imports no `child_process`.

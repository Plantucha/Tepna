# Unit nightcount — the 327 figure counts directories, not nights

**Unit.** Correct the 327 clause in row `2026-10-26-the-corpus-night-rule-is-pinned-to-one-calendar-year`.

**Branch and worktree.** `claude/nightcount-osp` @ `1c9d65e64` in `wt-nightcount-osp`, base `b17268f14`. One commit, RESIDUE-only, up as #3950 (DRAFT).

**Exact stopping point.** The row sits appended at the end of `briefs/RESIDUE.md`. `residue-ids --base origin/main` reads 1 row added, none mutated. The `DOCS-LEDGER-GATE` group passes 102 assertions. The full `npm run check` runs detached.

**Next step.** Read the gate verdict from the detached log, comment it on #3950, then ask Kestrel for the undraft.

**Figures, all at `b17268f14`.** The checkout's `uploads/` tree: 249 night-shaped directories over 156 names, its `trio` subtree holding 147. The NAS export's `uploads/` tree: 180 over 109 names, a strict subset by name. The smoketest tree: 102 over 102, counted once by `dedupeRoots`. Union 174 names, dated 2026-05-03 to 2026-10-25.

**Rows still owed.** The `:1051` correction, the `snapshotEntries` rule hole, the tautological-denominator shape, and the refusal-account trade. Each needs a re-measurement at the ref first.

**Open questions.** The year question inside the corrected row needs an owner ruling, and no bird should take it alone. Widening the rule re-scores every published PAT and TCH figure.

**Blockers.** Every PR appends to the ledger, so a second RESIDUE-touching PR conflicts. One in flight at a time.

**The doc-search query.** `node tools/doc-search.mjs "a corpus census publishes three hundred twenty seven night directories"` → board #1347 item 7 holds the reconciliation.

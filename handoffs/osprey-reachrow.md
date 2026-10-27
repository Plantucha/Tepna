# Unit reachrow — the probe-reach headline, re-measured

**Unit.** Correct the figures in `2026-10-21-the-probe-reaches-four-of-forty-abstaining-tools`, which #3937 and #3834 moved under it.

**Branch and worktree.** `claude/reachrow-osp` @ `7b3467ee8` in `wt-reachrow-osp`, base `482e39264`. Two commits, RESIDUE-only, up as #3948 (DRAFT).

**Exact stopping point.** The row sits appended at the end of `briefs/RESIDUE.md` over two commits: the append, then the re-measurement at the rebased base. `residue-ids --base origin/main` reads 1 row added, none colliding, none mutated. The `DOCS-LEDGER-GATE` group passes 102 assertions.

**Next step.** Read the `npm run check` verdict from the detached log, then ask Kestrel for the undraft. I never undraft my own PR.

**Rows still owed.** The `:1051` correction, the `snapshotEntries` rule hole, the tautological-denominator shape, the 327 directory-versus-night correction, and the refusal-account trade. Each needs a re-measurement at the ref before it lands.

**Open questions.** The owner's sandbox decision on the original row stands. My recommendation sits at board #1332 and does not move.

**Blockers.** Every PR appends to the ledger, so two RESIDUE-touching PRs conflict. One in flight at a time.

**The doc-search query.** `node tools/doc-search.mjs "how many abstaining argv tools can the probe actually reach"` → board #1330, #1332, #1337 and `tools/argv-survey.mjs`.

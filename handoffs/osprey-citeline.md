# Osprey — unit `citeline`

**Unit.** Two residue rows about citation drift in the ledger. Up as #3952, DRAFT.

**Branch and worktree.** `claude/citeline-osp` @ `81737774e` in `~/wt-citeline-osp`, base `35e0f4b4e`. One file moved, no code.

**Exact stopping point.** I pushed the branch and opened #3952 as a draft. Board finding #1411 holds the claim and the contention note. The full gate runs detached and its log sits in the scratchpad under `citeline/check.log`.

**Next step.** Read the gate verdict and comment it on #3952. Then wait for #3951 to land, rebase with `node tools/rebase-safe.mjs` inside the worktree, and ask Kestrel for the undraft.

**The measurement.** Row one corrects the evidence cell of `2026-10-25-six-tools-print-a-verdict-projection-under-the-schema-label`, whose closure stays sound. Three of its six cited lines name no printer at commit `0d8483222`, and the six files hold seven projection sites. Row two reports that `tools/residue-cite-drift.mjs` prints `unanchored` as a bare count, 32 of 457 at `origin/main`. It names all 291 `moved` and all 17 absent-file citations.

**Open questions.** None for the owner.

**Blockers.** #3951 is the other RESIDUE-only PR and reads DIRTY. Both PRs touch only `briefs/RESIDUE.md`, so whichever lands second needs a rebase.

**Doc-search query.** `a residue row's evidence cites a selftest line as the shipped code site`.

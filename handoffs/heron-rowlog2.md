# Heron handoff: unit 73, the RESIDUE drain the one-PR cap had held

**1. Unit.** Four measured rows reach `briefs/RESIDUE.md`, and the heredoc asymmetry row takes its answer. The rows come from unit 72 (hook liveness), unit 66 (the two guards) and unit 32 (the literal defaults).

**2. Branch and worktree.** `claude/rowlog2-hrn` at `2e47475a0` in `~/wt-rowlog2-hrn`, rebased onto `f6d3ef790`. Two commits, both ledger-only, five cells in all.

**3. Exact stopping point.** **#3966 is up as DRAFT** and reported at board #1469. Checks read 9 COMPLETED, 10 IN_PROGRESS, 2 QUEUED and 0 failing when I posted. Gates on the final state: `residue-ids.mjs` reads 4 rows added, none colliding, none mutated, at exit 0. `verify:residue-citations` reads PASS over 1,384 citations at exit 0. The `docs · docs-ledger` group passes all 102 assertions at exit 0.

**4. Next step.** Kestrel undrafts #3966, asked at board #1469. Then retire the worktree with `wt-done.mjs` and release claim #1435, since the row it holds reads `answered #3966` once the PR lands. The next unit is unit 59's sibling work, or any unclaimed capture-lane row. Every row in my lane that I measured this tick waits on the owner or on the box.

**5. Open questions.** The decision at board #1437 stays open: widen `looks_like_write`'s verb list, or invert it to a read allowlist and accept more denials. Row 2 of this PR is the measured cost of leaving it. Kestrel owes `2026-10-20-pletha-position-exists-at-frame-resolution-only` an `answered` pointer, and I could not verify which ref answers `2026-10-26-the-stale-ledger-guard-denies-no-cure`, so I left it OPEN.

**6. Blockers.** The one-PR cap again, until #3966 merges. The root still runs four behind hook scripts, and only the author of its uncommitted `tests/dex-tests.js` lines can clear that.

**7. The doc-search query.** `a residue only PR logging new rows and closing cells for guard and hook findings` scores 0.844 and names `memory/heron-state-2026-10-18-spool-and-window.md:185-206` first, which lists the two gates a ledger-only diff owes.

## Three things worth not re-deriving

**A correcting row I was about to write already sat in the ledger, closed.** Row `2026-10-20-the-0x03-header-read-ran-on-an-uncommitted-probe-copy` names all four artefacts that still called the ring's 0x03 header unexamined, including the row I meant to correct. My own state file told me to write that row. Grep the ledger for the artefact you are about to correct before writing a row about it.

**The ledger gate reads HEAD, so it examined nothing before my commit.** `residue-ids.mjs` printed `ok — 0 row(s) added, none colliding, none mutated` with four new rows sitting uncommitted in the tree, and `4 row(s) added` one commit later. The reassuring half of that line is the same either way. Run a ledger gate after the commit. The count is the verdict, never the word.

**The classifier denied the probe re-run, and a byte diff carried the measurement instead.** My unit-66 probe clears both hatches, so auto mode refused it. I proved the two extracted hook copies byte-identical to `origin/main` at `b9214bca5`. The row dates its measurement to the 06:30Z run, which is the honest basis. A code read of the five interpreter patterns corroborates all four arms.

# Magpie — unit `brdstale`

**1. Unit.** My claimed row `2026-10-27-the-board-renders-from-a-checkout-nobody-advances`, OPEN at the ref. Claim #1795.

**2. Branch and worktree.** `claude/brdstale-mg` in `wt-brdstale-mg`, cut from `origin/main` at `bea25b756`.

**3. What the row leaves in the repo.** Advancing the shared checkout is a deploy, so it stays the owner's. The repo part is to make that deploy safe and one copy-paste long.

`tools/board.mjs` now compares each renderer file in the tree it would load from. An import loads from the renderer's own tree; a shelled tool loads from the checkout the board reports on. One root for both reads the wrong tree the moment anyone repoints the unit.

**4. Exact stopping point.** The code, the service documentation, two ledger rows and the changeset all sit on the branch.

**5. Measurements.** I ran the real generator twice, once with the roots split and once with one root.

- Split: 3 of 4 files drifted, 1 in the renderer's own tree and 2 in the reported checkout.
- One root: 1 of 5 drifted, which is my own uncommitted copy of `board.mjs`.
- The reported checkout sits 224 commits behind the ref.
- Both runs name 2 derived names that resolve to no file, from the reader's own comment and plant.

**6. Next step.** Run the full gate and push. The PR opens as a DRAFT, and the ask goes to Kestrel on thread 8. I never undraft my own PR.

**7. Open questions.** Which tree should run a shelled tool after a repoint? A tool run from the pinned clone reports on that clone, not on the tree the fleet works in. The new row states the question and takes no side.

**8. The doc-search query.** `node tools/doc-search.mjs --read "the board renders from a checkout nobody advances"` finds the row, PR #4007 and this unit.

Fleet-Session: Magpie

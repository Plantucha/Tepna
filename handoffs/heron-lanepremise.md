# Unit 47 — the lane premise audit

**1. Unit.** I audited every open `capture-host`-sourced row in `briefs/RESIDUE.md` for a premise the tree has since answered.

**2. Branch and worktree.** None. The unit is measurement only, and it touched no file in the repo.

**3. Exact stopping point.** Board finding #1308 carries the whole table. The ref was `385a273bd`, and the population was 17 open rows. Not one of the 17 is unexamined.

**4. Next step.** Lift one row, `2026-10-26-examining-a-row-adds-an-open-row-instead-of-closing-one`, source `briefs/RESIDUE.md`. It waits for a free slot. PR #3932 is my one open PR, and a RESIDUE-only PR runs one at a time.

**5. Open questions.** Five of the 17 need an owner decision. They are the 176 Hz Verity trial, the heap probe's box write, the `run_oxyii` refactor, the cryptography floor and the mutant stop. Two need an `answered #3783` call from Kestrel. One needs the one-line word-list edit I sized at unit 16.

**6. Blockers.** The PR cap is one per bird, so the new row cannot travel until #3932 merges. On merge, run `node tools/wt-done.mjs ~/wt-rowlift-hrn`.

**7. The doc-search query.** `node tools/doc-search.mjs --read "a residue row's remedy already landed under a PR that never cites the row"` scores 0.892 and returns `memory/check-the-tree-before-asking-the-owner.md`, which holds the rule this unit applied at scale.

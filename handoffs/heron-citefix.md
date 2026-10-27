# Heron · unit 75 · the thirteen batch labels stop posing as residue keys

**Unit.** Close the row that found thirteen cited keys with no row, by taking the
branch the row itself offers: the citations stop calling a batch label a residue
key.

**Branch and worktree.** `claude/citefix-hrn` in `~/wt-citefix-hrn`,
base `6cde3f16c`, PR **#3971** (DRAFT). Head `105c467f7` after two commits: the
31 citation sites and the baseline shrink, then the two ledger rows.

**Exact stopping point.** `npm run check` ran over the final tree. Before it,
these gates passed: `verify:residue-citations` at 23 dangling and 23 declared,
`residue-cite-drift.mjs` at exit 0, the suite group at 31 of 31, and
`capture-host/check.sh` at exit 0 with 100 per cent coverage.

**Next step.** Fill the two gate lines in the PR body, add the two closing
lines for the rows, update the body, and push. Then ask Kestrel to undraft.

**Open questions.** None for this unit. The broader row for 18 dangling
citations stays OPEN, and its other 5 keys name real defects that each still owe
a row.

**Blockers.** `capture-host/check.sh` refuses inside a worktree, because a fresh
worktree carries no virtual environment. The script prints the remedy itself:
pass `PYTHON=~/Tepna/capture-host/.venv/bin/python`. My first run
read as exit 0 through the harness and `EXIT=2` in the sentinel.

**The doc-search query.** `a mutation equivalence brief pointer cites a residue
key that has no row` finds board #1249 and the memory file whose title says a
commit message is the only place that checks a cited key.

## Two things worth not re-deriving

**A suite leg can forbid the payment its own ratchet demands.** The citation
baseline's note says the declared debt may only shrink. The leg that proved the
baseline was not empty asserted at least 30 declared keys, That number was the
population on the day I wrote the leg. Paying 13 of 36 reds it. A floor set to a
measurement ages exactly like a frozen residue cell.

**A class in a vocabulary invites the thing the row forbids.** `batch-label`
existed to declare a cited key that names no defect. Removing the class removes
the escape, so a future batch label reds as an undeclared citation.

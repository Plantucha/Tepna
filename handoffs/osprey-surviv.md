# osprey-surviv — the exit classifier

**Unit.** Residue row `2026-10-20-the-js-gate-survivor-set-does-not-reproduce-across-runs`, source
`tools/mutate.mjs`. Take the row's third candidate mechanism, the timeout path.

**Branch and worktree.** `claude/surviv-osp` in `wt-surviv-osp`, base `c39ab4a64`, opened as a draft
in #4001 at `970959c16`. The full gate passed all 41 steps with the sentinel reading `EXIT=0`.

**What the unit did.** One exported `verdictFromExit` replaces the two disagreeing copies of the exit
rule in `runSuite` and `runSuiteAsync`. A SIGTERM or SIGKILL reads INVALID with reason `timeout`. A
spawn that produced no child reads `no-exit`. A crash signal keeps the output rule and reads `crash`.
Sixteen selftest legs, two of them pinning node's own exit shape, and three plants each red by name.

**The finding that matters more than the fix.** The defect is real and it is not what the row reports.
Instrumented over one real full suite on this box, 830 groups in 479.7 s, `tests/run-tests.mjs` wrote
its first stdout byte and its first assertion mark at 479.52 s. The 806 stderr progress chunks from
6.4 s onward carry no mark. So the misclassification window is 147 ms of a 480 s run, and a kill
outside it already read INVALID. The row keeps its other two candidates and stays OPEN.

**Next step.** The two live candidates, in cost order. State shared between the three hard-linked
worker trees is the cheap one: hard-link the trees, write to one, and read the others. A flaky
assertion in the covering group is the expensive one, and the owner has forbidden repeated mutation
legs as an instrument, so it needs a suite-level repeat over the covering group alone.

**Open questions.** Whether a verdict of `timeout` should hold a merge or stay out of the denominator
only. Today it leaves the denominator and nothing counts it.

**Blockers.** None for the next step.

**Doc-search query.** `node tools/doc-search.mjs "mutation survivor set does not reproduce across runs timeout classifier"`

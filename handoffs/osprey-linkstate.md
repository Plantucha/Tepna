# Osprey · unit `linkstate`

**Unit.** The mutation gate now vets its worker baseline inside the tree the mutants run in, so a
group red for the absent `.git` stops counting as a kill.

**Branch + worktree.** `claude/linkstate-osp` @ `46258e103`, base `f2a4cb45b` (#4001), in a
`wt-linkstate-osp` worktree beside the primary checkout. Draft PR #4003.

**Exact stopping point.** `tools/mutate.mjs` carries `envRedFrom` and `subtractEnvRed` as exported pure
functions, `runSuiteOutput` beside `runSuite`, `let ENV_RED` plus the subtraction at the head of
`classify`, and the worker-baseline pass after the §3d block. 17 new selftest legs, 214 green.
Five plants each red by name. `pr-compliance` all 9 checks PASS in preflight. The full gate runs
detached against the final state, sentinel `LS_EXIT=` in the session scratchpad.

**Next step.** Read the gate sentinel. On `LS_EXIT=0`, post it under board ask #1651 so Kestrel can
undraft #4003. On any other value, read the step that reds — never the tail.

**Open questions.** Residue row `2026-10-20-the-js-gate-survivor-set-does-not-reproduce-across-runs`
stays OPEN, and I still hold its claim (#1638). Two of its three candidates are now dead: the
harness-kill misclassification (#4001, a 147 ms window of a 480 s run) and write-through from a
worker (0 of 3252 hard-linked files changed). The third candidate is the only one left, and nothing
here measures it.

**Blockers.** This defect reaches no CI job: no workflow passes `mutate.mjs --full`, and
`mutate.mjs:1551` refuses an untagged file with a message that prescribes the flag. So an operator
triggers it, and no gate regresses if the fix goes away — which is why the two wiring legs are text
legs over the source.

**Doc-search query that found the prior work.**
`mutation worker tree baseline differs from the caller tree git absent` → the Python side met this
class first: `mutate_diff.py` runs in a scratch that is no git worktree, times its clean run there,
and REFUSED with `no budget: the clean run did not pass`.

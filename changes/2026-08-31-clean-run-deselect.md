<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The mutation baseline ran a different selection than the mutants, so `capture.py` could never be measured at all.

`deselect_args()` was wired into the generated `[tool.mutmut]` config — so MUTANT runs honoured the
per-test deselections — and **not** into `clean_run_seconds`, the baseline that times the selection and
gates everything after it.

The two deselected tests ask **git about the tree they are running in**, and mutmut's scratch is a COPY,
not a repo. They therefore failed in the baseline, `clean_ok` came back `False`, and every glob died
with `no budget: the clean run did not pass, so its duration measures nothing`. `mutate_diff` then
REFUSED — correctly, since it could not see — and the PR check went red.

**That red looked like a mutation finding and was a harness gap.** It is why #1954 and #1959 both merged
with `mutation (diff-scoped)` failing, and why re-running against current main failed the same way: the
message says "the gate could not measure", not "survivors exist", and nothing in `capture.py` was ever
at fault.

Reproduced by `git archive origin/main | tar -x` into a non-git directory: exactly **2 failed, 5537
passed**, both failures already entries in `DESELECTED_TESTS`. With the args applied, the same two files
give **42 passed, 2 deselected**.

The baseline must run the same selection the mutants will, or it is timing a different thing than the
one it licenses. Pinned by a test anchored on the FUNCTION via `ast` rather than a substring —
`deselect_args` also appears at the config site and in the imports, so `in src` would pass while the
baseline still ignored it.

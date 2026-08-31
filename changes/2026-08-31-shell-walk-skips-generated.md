<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
The shell-surface tests walked mutmut's generated tree, which is why `capture.py` could never be mutation-tested.

`tools/mutate.py` copies capture-host into a scratch `work/` dir and mutmut writes `work/mutants/` — a
full second copy of the source, including all 24 shell scripts. `_all_scripts()` excluded `.venv`,
`__pycache__` and `/tests`, but not that. **Measured in a real scratch: the walk saw 48 scripts where
the source tree has 24.**

**The symptom is not a shellcheck finding, and that is what made it hard to place.** The copies are
clean, so `--severity=style` still exits 0 over all 48 — verified. What breaks is
`test_the_shell_inventory_is_complete`:

    unclassified shell script(s): ['mutants/check.sh', 'mutants/deploy/archive-pull.sh', …]

24 scripts that are real, clean, and simply not in `COVERED`/`UNTESTED` because they are copies.

That one failure blocks the whole capture-host mutation gate: the baseline clean run cannot pass, so
every mutant reports `no budget: the clean run did not pass`, and `mutate_diff` REFUSES. It is the
reason `capture.py` has never produced a survivor list — on #1954, on #1959, or on any re-run since.

One helper feeds **six** call sites (SPDX header, `bash -n`, shellcheck, suppression proofs, inventory),
so all six inherited the blind spot and one exclusion closes all six.

Matched as a **path segment**, not a substring, so a legitimate directory whose name merely contains
"mutants" is unaffected. Verified inside a real scratch tree: 48 → 24 scripts, and the previously
failing file goes to 18 passed.

<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
`mutate.py`'s verdict fields were being truncated away on the one module that needed them most.

The run record was printed as a flat `json.dumps(...)[:1600]`. On `capture.py`, whose plan lists 95 test
files, those 1600 characters were spent on the test list — so `rc`, `elapsed_sec` and `timed_out` were
cut off entirely. Those are exactly the fields the runbook's §1 tells you to check, and without them a
signal-killed run (`rc: -15` with `timed_out: false`) or an outright failure is indistinguishable from a
clean one. Measured 2026-08-03: an `rc` guard reported `FAILED rc=` on a run that had in fact succeeded.

Verdict fields now print first, in their own object, never truncated; the bulky plan follows and only
its tail can be cut.

Also: the runbook's §1 table listed four ways a run fails while looking fine. It now lists **six** — the
false 100 % (an empty `mutmut results` divided into a rate, caused by the scratch-reuse bug fixed in
#754) and this truncation. Both were discovered during the 2026-08-03 passes and both were written up
only in commit messages, which is where knowledge goes to die. §1 is the section that saves hours, and
it now carries the two-guard snippet that makes the 100 % case impossible to report by accident.

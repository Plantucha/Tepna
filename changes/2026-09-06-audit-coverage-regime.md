<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: VIGIL-BLUETOOTH-ADVERSARIAL-AUDIT-2026-09-05-BRIEF.md
---
**The nightly air audit would have failed every night on a hardware limit, and named a crash that
never happened.** Caught by running it against a real 900 s chunk from the box BEFORE the timer was
installed: `AIR AUDIT: FAILED — the sniffer died 457 s early`, at coverage 0.49, on a capture that had
run its whole window.

Both halves were wrong. **The verdict:** this hardware produces 0.41–0.51 coverage (the extcap pegs a
core and runs at ~0.4x real time), so gating a full-window run at `WINDOW_MIN_FRACTION` reds nightly on
a known limit — the fastest way to teach an operator to skip the line. The check exists to catch a
capture that did not RUN; it must not red on one that ran and could not keep up. A capture that ENDED
EARLY is still judged at 0.8 (F2's defect, and the reason the check exists); a capture that RAN its
window is judged against a new `COVERAGE_FLOOR` of 0.25, below which the window is too thin for any
verdict to rest on. Between the two the audit passes and the coverage line carries the shortfall.

**The wording:** `_parse_argv` defaulted `ran_full` to `False`, so an invocation that said nothing
asserted "it exited early". That is the absent-vs-zero rule broken in the very function that exists to
attribute causes honestly — and, worse, the assertion added a day earlier to kill a mutant had pinned
the wrong default in place. The default is now `None` (unknown, and the sentence says so),
`--exited-early` states the other half explicitly, and `tepna-sniff.sh` passes exactly one of the two
from `timeout`'s exit code.

Verified against the real chunk both ways: as the unit runs it, `AIR AUDIT: OK` with `coverage 0.49`
stated; by hand with no flag, FAILED with no cause claimed. Four plants — remove the floor, red the
fell-behind regime, restore the `False` default, drop the floor to 0.05 — each red named tests.

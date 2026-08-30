<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [capture-host]
brief: none
---
A single runaway mutant could hang the whole audit, because the only bound was per MODULE.

`tools/mutate.py` derives a per-module cap from the module's own clean run (300x, floor 1800 s). That
is the wrong unit for this failure: a module budget cannot tell "24 mutants each taking their share"
from "23 done and 1 looping forever", so the run wedges with the cap nowhere near hit.

Measured on `capture.x_clock_watchdog__mutmut_*`: one worker at **29:26 CPU out of 29:27 wall**, its 23
siblings at zero, no writes to the scratch tree for five minutes. capture.py's derived cap was
**243370 s — 67.6 hours**, so nothing was going to stop it. Mutating a sleep or a timeout inside a
watchdog loop is an ordinary way to produce a mutant that never returns; this is not an exotic case.

**mutmut already solves this, and the driver simply never set the knob** — so the fix is one config
line, not a second mechanism. mutmut bounds each mutant at
`(estimated_time_of_tests + timeout_constant) * timeout_multiplier` and enforces it with SIGXCPU, where
the estimate is per-MUTANT: the summed duration of the tests covering that function. The default
multiplier of 15 is generous once many tests cover one function — the spinning mutant above needed a
covering-test sum of only ~116 s to buy itself half an hour.

`timeout_multiplier = 3.0` now goes into the generated `[tool.mutmut]` table. It stays proportional to
each mutant's own measured cost rather than a flat number, so a legitimately slow mutant is unaffected
while a runaway is bounded at minutes. A mutant that DOES exceed it is recorded `timeout` — that is
*unmeasured*, never *killed*, so a tighter bound cannot manufacture a pass.

Pinned by a test, because it is one line in a format string and that is exactly the kind of line a
refactor drops with nothing noticing.

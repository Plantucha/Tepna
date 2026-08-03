<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: none
---
`run_polar`'s sample-write dispatch is asserted by CONTENT, not by "a file appeared" — and it is the weakest surface in capture-host.

First measurement of `capture.run_polar`: **1 241 mutants, 641 surviving — 44 % killed**, the lowest in
the tree. It is also the function that records a night, so a wrong answer is silent by construction: the
file exists, the row count looks right, and the numbers in it are wrong.

The sharpest cluster is the six-way `meas` dispatch. Every argument of
`wr.write_ecg(smp.phone, smp.sensor_ns, smp.t_ms, v[0])` could be nulled undetected, because the tests
asserted that a FILE APPEARED and that rows were COUNTED — never what was in a row. Nulling `smp.t_ms`
loses the relative-ms column ECGDex infers sample rate from, which is the ~10 % HR bug `test_writers`
exists for.

Writing the test corrected my own understanding: **PMD stamps a FRAME, not a sample.** The frame's ns
lands on its LAST sample and earlier ones are back-computed across the rate, so the first row is
*before* the frame stamp. The test pins that shape rather than the flat equality I first assumed.

Also pinned: every sample in a frame is written (three, not one — dropping two is a plausible row count
and a third of a night), the live-bus push carries values and a rate, and the bond guards — `if
needs_pmd` (bonding a third-party HR strap cost "an 18-SECOND GLOBAL CAPTURE PAUSE and a phantom link
that then tripped the watchdog") and `ensure_bonded(addr, ADAPTER)`, where one mutant passes the
adapter as the address.

14 killed, 0 regressions. **627 survivors remain and this is not close to done** — see the commit for
the split and what a real pass would need.

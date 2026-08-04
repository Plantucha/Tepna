<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [capture-host]
brief: CAPTURE-HOST-SUBPROCESS-SURFACE-FOLLOWUPS-2026-08-04-BRIEF.md
---

capture-host: eight mutation passes — 112 mutants, every kill confirmed by ID, zero regressions. Five
of the modules had never been measured, and they proved cheaper than the ones already worked:
`clockcfg` alone returned 40 from six tests. Plus `tools/mutate.py` now reports while it runs and says
when it stopped, after four defects in the reporting itself — including a counter that read 2463
mutants for a 1231-mutant module.

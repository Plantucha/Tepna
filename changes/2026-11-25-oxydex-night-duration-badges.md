<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
brief: BADGE-COVERAGE-AUDIT-BRIEF.md
nodes: [OxyDex]
---

The two OxyDex night durations now carry an evidence badge. The night-row header and the
night-detail hero each print a recording span, and neither stated a grade. The node registry
already graded `duration` as `measured`, so the disc reads the grade the registry holds and
invents none. The em dash of an unknown span carries no disc. The hero reads `!= null` and no
longer tests the span for truthiness, so a night of 0 minutes keeps its chip as a measured zero.

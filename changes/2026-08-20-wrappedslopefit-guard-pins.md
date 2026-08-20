<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [Integrator]
brief: MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md
---
The fix the 2026-08-20 sweep-stall post-mortem (§7) asked for, as a test: _wrappedSlopeFit's guard
is the only thing between junk input and a ~1600-step ppm grid search over every row, and its
surviving guard mutants sent all 22 sweep workers into corpus-sized searches on inputs the guard
exists to reject — slow-but-bounded individually (~17 s per call, measured), collapsed collectively
under pool contention. A guard mutant must die in MILLISECONDS in a near-zero-priced group so
--bail ends its lap before the expensive legs run. This group is that: null/3-blocks/rrMs-0/
rrMs-NaN each refuse (null, never a search or a throw), four blocks are ALREADY enough (the floor
is < 4, not <= 4), and a planted 50 ppm drift is recovered exactly at concentration 1 — a
known-answer pin on the fit itself, not just its refusals. All five guard-mutant variants
(negate, both ||→&&, both comparison shifts) verified killed by direct re-application.

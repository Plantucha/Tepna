<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: MUTATION-SUITE-FOLLOWUPS-2026-08-17-BRIEF.md
---
Close §7.2 with the probe that settled it — the guard mutants were never the expensive thing, `_wrappedSlopeFit` costs ~17 s on night-sized rows whether mutated or not, and the fix is test-placement economics rather than the watchdog.

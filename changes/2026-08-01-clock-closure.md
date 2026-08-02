<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [Integrator, suite]
brief: CLOCK-CLOSURE-THREE-SOURCE-2026-08-01-BRIEF.md
---
Check a pairwise clock fit against itself: three sources must close to zero, and on six real nights they never do.

fitClockClosure runs every pair through fitClockDrift and reports each triple's closure error, which is
identically zero for consistent measurements — so a non-zero value proves one pairwise fit is wrong with
no reference clock. Measured on H10 RR + Verity PPI + O2Ring PPI across six nights: closure ranges -6 to
+101 ppm and is never zero, and on 2026-07-28 it misses by 58 ppm even though all three legs clear their
own chance controls, so per-leg confidence is necessary but not sufficient. Also records the method's
boundary, found by a planted control that refused to fire: a clock stepped mid-night is measured
faithfully by both its pairs and cancels, so closure catches a bad FIT and never a bad CLOCK.

<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [MotionDex]
brief: MUTATION-PROGRAM-2026-08-09-BRIEF.md
---
Bootstrap MotionDex inferAccUnit — the fifth zero-kill function, killed by testing the bounds rather than the bands.

31 survivors, no kills. Internal, but reachable through the exported `parseSensorXYZ`, which publishes
its verdict as `_unit` — so no export was needed, only a test.

The unit is inferred from the median vector magnitude against three gravity-like bands, and EVERY
BOUND IS EXCLUSIVE ON BOTH SIDES:

    300 < med < 3000  ⇒ 'mg'     (≈1000)
    0.3 < med < 3     ⇒ 'g'      (≈1)
      3 < med < 30    ⇒ 'm/s2'   (≈9.81)

Anything else is null: the function refuses rather than picking the nearest band. That refusal is the
safety property — mistaking g for mg is a 1000× error in every downstream metric, and this node's
whole ACC pipeline hangs off it.

MEASURED: every boundary value returns null, so each separates `>` from `>=`. Verified by re-applying
real survivors, 6 of 9 sampled now die:

  rows.length <= 8         KILLED     med >= 300 && med < 3000    KILLED
  rows || rows.length < 8  KILLED     med > 300 && med <= 3000    KILLED
  mags.length <= 8         KILLED     isFinite(med) || med <= 0   KILLED

A test using only 1000 / 1 / 9.81 exercises NONE of the six comparisons — it confirms the three bands
exist and says nothing about where they end. 3 is the sharpest case: it is the g band's open top and
the m/s² band's open bottom simultaneously, so the real code declines a magnitude that sits between
two answers, and both a `>=` and a `<=` mutant would supply one.

19 assertions: the three centres, all five bounds exactly, six just-inside values proving the bands
are not simply empty, three not-gravity-like refusals, and the ≥8-row floor from both sides.

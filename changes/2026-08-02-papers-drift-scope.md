<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: []
brief: CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md
---
Two papers carry notes from the drift investigation.

**`wearable-clock-drift.html` — a scope qualification, not a reinstatement of v1.** v2 bounds the inter-device rate at a median **1.46 ppm** and argues the ~1.15 s per-night excursion is *one RR interval — beat slip, not clock wander*. On its own corpus (20 phone-captured sessions) that stands, and the beat-slip mechanism was independently rediscovered as a coincidence comb one RR apart.

But six **vigil-host** nights behave differently. After refitting per 5-min block and unwrapping the one-RR slips, four of six fit a straight line at **R² 0.92–0.99** with agreeing half-slopes, at **89–216 ppm**. A random walk of beat slips does not do that. The two nights that don't fit (R² 0.11, 0.46) are exactly the two that fail three-source closure, which holds at **−2.2 and −7.0 ppm** on the others — three independently-unwrapped pairwise fits do not close to 2 ppm by accident.

This does **not** reinstate v1: its 47.7 ppm came from the beat-slip artifact v2 correctly identified, and its causal account is still wrong. It says the rate bound is **a property of the capture path, not of the devices**, and the conclusion should carry that scope. Unresolved: the two corpora differ in host, stamping and re-sync at once, so this cannot attribute the ramp to a device oscillator rather than the host's timestamping — that needs a capture-side measurement.

**`null-calibration.html` — a companion failure mode.** That paper characterises an instrument *structurally incapable* of a positive, with a known-answer control as the remedy. On 2026-08-01 three sessions produced the same wrong null with that remedy in place and passing: each ran an honest chance control, each correctly reported beating chance, and the measurement was still meaningless because it fitted one constant offset to a drifting pair.

**The known-answer passed because it was planted under the model's own assumption** — a constant 137 ms offset, recovered to 99.94 ms. It took planting a *drifting* pair to expose the defect. The checklist addition: **plant your known-answer under a model you are not assuming.**

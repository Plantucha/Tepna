<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator, docs]
brief: CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md
---
Record that fitClockDrift does not phase-unwrap, so its ppm figures are not quotable without closure.

A parallel session showed the per-block offset is a PHASE on a coincidence comb one RR wide: as the
true offset drifts past a tooth the argmax falls back exactly one RR, so a raw slope measures the
sawtooth. Confirmed directly — 3 whole-RR jumps across 87 blocks on 2026-07-27, where the drift reads
45.9 ppm un-unwrapped against 97.2 unwrapped. A naive per-pair unwrap was implemented and measured to
be WORSE (three-source closure degraded from 101/101/58 ppm to -266/209/-202) because one wrong
multiple on a weakly-locking pair propagates through the cumulative sum, so it is reverted and the
limitation documented in the function. The correspondence result (89% vs a 21% chance control) is
unaffected; the drift MAGNITUDES in WEARABLE-DRIFT-FIT and CLOCK-CLOSURE-THREE-SOURCE are corrected
as not-closing.

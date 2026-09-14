<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator]
brief: RESIDUE.md
---

The Integrator's cross-node beat check reported an OFFSET and never a RATE, so a constant inter-node
offset and one that WALKS were the same value to it at every instant — it could not see the drift it
reads as guarding against. `fitClockDrift` computed the rate all along and the seam discarded it. The
rate now crosses with the fields that make it judgeable rather than merely quotable: the phase-aware
`wrappedConcentration` (the producer's own contract is that its ppm is not evidence alone, since it
may carry whole-RR sawtooth), `maxDriftPpm` so "no drift" is distinguishable from "drift beyond my
reach", and `spanMin` because the Clock Contract forbids quoting a ppm without its span. The refusal
arm carries the same keys as null, so the shape does not change with the outcome.

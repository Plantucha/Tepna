<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [Integrator]
brief: DEEP-AUDIT-V-2026-08-04-BRIEF.md
---
screenTriplet documents three outcomes and _tchHat implemented two: it branched on `scr.drop`, so all four refusals that set `drop: null` — including the AMBIGUOUS "N nodes mutually decorrelate, cannot identify the reliable pair" — fell through and published a confident per-sensor sigma card, ranking pure noise as the quietest sensor and handing it the largest inverse-variance fusion weight. The block now branches on the verdict and degrades to the pairwise consensus with a stated reason.

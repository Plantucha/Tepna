<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [analysis]
brief: none
---
A new analysis page, **PAT — classic vs fused**, shows one night's pulse-arrival-time statistics for all
three sites (chest→finger, chest→ankle, finger→ankle) and the three-cornered hat over them computed twice:
unweighted, and with each coupled beat weighted by how much both of its sensors were trusted at that
second. The classic column is `pat-feasibility-worker.js`'s own output — the page runs that worker
unchanged, so "matches PAT Feasibility" holds by construction rather than by a parity assertion, and no
statistic is copied. The fused column is the same solver with a weight: `AnalysisStats.legWeights` /
`fusedLeg` weight each pair by `c_R × c_foot` (the product — `min` cannot tell one marginal end from two,
`mean` lets a good end mask a bad one) and `threeHat` gained optional per-leg weight arrays, so there is
still exactly one hat solver. Weighting runs inside the worker on the full accepted set, never on the
~4000-point decimation `pack()` applies, and it acts after `coupledPAT`'s own ±90 ms / 30 s-median filter
rather than instead of it. Absences stay visible: a corner that published no per-second confidence is shown
UNWEIGHTED and labelled, a pair unweighable at either end is excluded rather than weighted 1, all-zero
weights refuse instead of returning 0, and the coverage card states what share of accepted pairs could be
weighted at all. The delta card states where the two columns can differ and where they cannot — a median is
robust to a small contaminated share, so a near-zero Δ median is not evidence that weighting does nothing;
the weighting acts on the spread and on the per-window medians the hat is built from. Registered in the
analysis builder and in all four of the monitor's night-derived maps plus the server-side eligibility
table, whose requirement names the ring's RAW pleth because that is the file the finger corner reads.

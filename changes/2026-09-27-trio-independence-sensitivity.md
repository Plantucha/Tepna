<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [analysis]
brief: none
---
`sensor-trio-night` gains an **independence-sensitivity row** computed from the night on screen: for each
pair of corners, the error correlation at which a corner of this night's hat collapses to zero
(`AnalysisStats.tchRhoCrit`), the nearest such collapse with its margin, how fast that corner's σ̂ moves per
0.01 of ρ, and the precision to which ρ would have to be known to pin that σ̂ to ±0.1 bpm. The three
pairwise difference variances the row needs were already computed inside `sensor-trio-worker.js` and thrown
away; they now ship additively as `pairVars`.

The row is deliberately narrow about what it answers. The direct answer to "how much of the σ decomposition
survives correlated-error assumptions" is the pooled reference run already on the page (37 nights, FAIL:
the classic hat under-reads the Verity 0.41 against a true 0.73 bpm because the optical errors correlate at
ρ ≈ 0.32); this row answers the adjacent per-night question, and says so beside it rather than displacing
it. It never prints "independent ✓" — a negative variance requires ρ > σ₀_A/σ₀_B, so a positive solve is not
evidence of uncorrelated errors at any n — and it states no band around the collapse point, because
sensitivity to ρ rises smoothly to it with no regime to threshold on. **This night's own ρ is REFUSED with a
named reason**, never defaulted to 0, since assuming independence is the assumption under test; the pooled
0.32 appears only as a labelled external figure. On the classic hat's own σ̂ medians (0.967 · 0.413 · 1.456 —
hat values, not the reference-measured 0.806 · 0.728 · 1.713), the nearest collapse is H10 · O2Ring at
ρ ≈ 0.105 and the corner it annihilates is the Verity — the same corner the reference found under-read,
reached from the night alone. The hat's own σ̂ is the right input, since ρ_crit is a property of that solve;
each pair's collapse point is pinned above the reference's measured ρ (hv −0.011 · ho 0.012 · vo 0.318),
which is why three positive σ̂ come back on nights the reference says are wrong.

Also: `sensor-trio-worker.js` no longer carries a private copy of the three-cornered-hat solver. It was
byte-equivalent to `AnalysisStats.threeCorneredHat` and gated by nothing (the `tch-parity` gate scans the
power tool only), so it now delegates, refusing loudly if the kernel is absent rather than falling back.

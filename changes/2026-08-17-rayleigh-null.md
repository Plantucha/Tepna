<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [suite]
brief: INTERDISCIPLINARY-LITERATURE-2026-08-16-BRIEF.md
---

The Rayleigh null for the suite's phase concentration - INTERDISCIPLINARY-LITERATURE §13h.1 built.

The "phase concentration" computed in `_wrappedSlopeFit` (integrator-dsp.js) IS the mean resultant
length of circular statistics, rebuilt under a local name. The field's payoff is the significance test
the ad-hoc statistic stopped short of: the Rayleigh test answers "at this n, is this concentration
distinguishable from a uniform phase?" - exactly JOINT-UNWRAP §5's falsifier ("is there a phase to
regress"), which was answered with a threshold read by eye (0.15-0.38 called noise, 0.79 called lock).

`tools/circular-stats.mjs`: rayleighP(n, rBar) (Zar's approximation, the one CircStat's circ_rtest
ships - Berens 2009, 10.18637/jss.v031.i10) and meanResultantLength, the latter gate-pinned against
the DSP-style inline computation so the exported statistic and `concentration` cannot drift apart.
Wired into `tools/integrator-block-precision.mjs`, which now prints "Rayleigh p<0.01 on k/n" beside
the concentration it already reported.

THE DEMONSTRATION THE EYEBALLED THRESHOLD COULD NOT CARRY: the same rBar = 0.3 is uniform-plausible at
n = 10 blocks (p ~ 0.42) and decisive at n = 100 (p ~ 1e-4). Whether "0.15-0.38 is noise" is a correct
judgement DEPENDS ON THE BLOCK COUNT, and only the test carries that dependence.

Gated by `tools · circular-stats` (13 assertions, Node lane): both exact limits asserted as identities
(rBar=0 => p=1 exactly; rBar=1 => p<1e-70), monotonicity in n and rBar, refusals on n<2 / rBar>1 /
non-finite, uniform-vs-concentrated MINSTD angle sets separated, and the inline-computation pin.

Scope stated rather than smuggled: the p assumes independence and adjacent blocks share physiology, so
it is mildly anticonservative - a diagnostic beside the statistic (the slopeSE posture), not a gate.
`integrator-dsp.js`'s own `wrappedConcentration` is deliberately untouched: adding a p there is a
compute-closure change that re-verifies the Integrator golden, so it rides the next behavioural
re-bundle - the same economics as tau0Uniformity's arrival-lane wiring.

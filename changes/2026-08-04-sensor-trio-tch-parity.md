---
bump: patch
type: added
nodes: []
brief: SENSOR-TRIO-NIGHTS-PAPER-BRIEF.md
---

Binds the sensor-trio power tool to the gated three-cornered-hat kernel, and ticks six definition-of-done
boxes that had been verified in the tree but left unchecked, so the list read as six items of unstarted
work while the brief header said the opposite.

Verifying them turned up one real divergence. The brief asked for the tool to be built "reusing the TCH
kernel"; it is not. `sensor-trio-power-analysis.js` carries its own `threeCorneredHat`, and the bundle
inlines only its own JS and GPU worker, so the simulation behind the paper's sample-size curves -- its
entire deliverable -- ran on a second implementation that no gate touched, even though integrator-tch.js
exports both `threeCorneredHat` and `classic`.

The two are algebraically identical today, checked character for character, so this is not a bug report.
It is two copies of one rule with nothing that fails when they diverge. They are now bound numerically
rather than by source scan: the tool's own function is extracted from source and executed, then compared
against the kernel on five planted triples including a negative-variance case and a decorrelated corner.
Two mutants confirm failure by value, swapping two output terms and clamping negative variance to zero.
The clamp is why the negative-variance row exists -- it passes every well-behaved input, and negative
variance is the characteristic TCH failure.

Note for anyone extending this: `classic(Vab,Vac,Vbc)` is the kernel's variance-level entry while
`threeCorneredHat` takes three series, and comparing against the wrong one returns undefined on every
row. The brief stays PROPOSED because the N=10 to 15 re-fit remains genuinely blocked.

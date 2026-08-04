---
bump: minor
type: added
nodes: []
brief: TCH-CORRELATED-SOLVE-KNIFE-EDGE-FOLLOWUPS-2026-08-04-BRIEF.md
---

The correlated three-cornered-hat solve now publishes how sensitive its sigma is to the assumed
correlation, rather than refusing inside a margin of the singularity.

The brief asked for a refusal margin picked from the data. Measured, there is none to pick: the
sensitivity rises smoothly and monotonically all the way to the boundary, from -0.030 bpm per 0.01 of rho
at a distance of 0.200 to -0.324 at the measured operating point, with no regime change to threshold on.
That is the sibling lesson from the threshold-margin survey applying again, which this item had already
hedged for: state a margin only where the regimes separate, and publish the sensitivity where they do not.

So the question is re-framed. Not how close to the critical correlation is too close, but how precisely
the correlation is known, which only the caller can answer. The solve exposes the local derivative and
the correlation precision needed to pin sigma to a tenth of a beat per minute. At the measured operating
point that precision is three thousandths, which a night-level estimate from one recording does not come
close to, so the CPAP corner's sigma is not identifiable here and would not be even at a greater distance
from the boundary. That is a stronger statement than a refusal flag.

Gated by five further assertions, with the anti-vacuity leg carrying the meaning: far from the boundary
the same field reports a tenfold gentler slope and correspondingly tolerates a tenfold looser estimate.

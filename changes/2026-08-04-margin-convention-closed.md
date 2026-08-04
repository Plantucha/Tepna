---
bump: patch
type: changed
nodes: []
brief: EDR-THRESHOLD-MARGIN-FOLLOWUPS-2026-08-04-BRIEF.md
---

Closes the threshold-margin follow-up. Its two remaining items were a standing practice and a proposed
convention, and both are recorded as settled rather than left open.

The practice has now been applied three times and each time the kind of test changed rather than the
number: the harmonic check moved from a near-equality comparison to a sign test, the RR-regularity
constants gained a recorded exclusion fraction because no gap exists to place a threshold in, and the
correlated-hat solve gained a published sensitivity for the same reason. The through-line is that when
two regimes do not separate, the honest output is a measured quantity the caller can act on rather than
a boundary chosen to look principled.

The duration-sweep convention is recorded but deliberately not made a blanket gate. The test suite has
39 genSynthetic call sites across 15 distinct durations, and most are two to six seconds, being parser
and shape tests with no estimator value that could be phase-sensitive. Requiring every one of them to
carry a second duration would be exactly the over-generalisation this brief's own survey warns against.
The criterion is the property rather than the helper: an estimator needs a multi-length pin when its
answer depends on where a carrier's phase falls on a sampling grid, which is why the EDR estimator at
4 Hz needed one and a parse-shape assertion does not.

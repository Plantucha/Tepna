---
bump: patch
type: fixed
nodes: []
brief: WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md
---

Retracts a claim landed earlier the same day. The previous entry concluded that the three-source drift
closure cannot be run on this corpus, on the grounds that no night has both a host-referenced leg and an
interval-bearing device-axis export. The export-level facts are correct but the conclusion is not: leg C
never needed the exports. It comes from the raw captures, which carry a device nanosecond column beside
the phone timestamp, and 38 raw fragment pairs have more than thirty minutes of simultaneous H10 and
Verity coverage, the longest 563 minutes. Nothing about the corpus blocks the closure.

What was measured while establishing that. On 2026-08-01 the host legs read -20.9 ppm for the H10 and
-28.6 for the Verity over the same fragments, predicting +7.7 ppm between them. Beat extraction on each
device's own axis works, giving 30,222 and 30,616 beats. The mod-one-heartbeat ambiguity that defeats
whole-night comb matching does not apply at this span, since the expected divergence is about a quarter
of one interval.

No closure is claimed. A first per-block estimator read +9.6 ppm against the predicted +7.7, which is
close enough to be tempting, so truth was planted instead: with one clock running -20.0 ppm relative to
the other, the same estimator reports +17.9, inverting the sign and running eleven percent low. The
apparent agreement is therefore coincidence. This brief family already carries four retractions from
this stack and a number that looks right from an estimator that cannot recover planted truth would be
the fifth. What is owed is a matcher that recovers a planted rate in sign and magnitude.

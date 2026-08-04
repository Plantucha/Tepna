---
bump: patch
type: added
nodes: []
brief: R5-HR-TRIPLET-FOLLOWUPS-2026-08-04-BRIEF.md
---

Measures which epoch-HR estimator OxyDex should use, the last open half of the fleet-statistic
question. OxyDex has no intervals — only a 1 Hz rate column — so it cannot compute the fleet's
`60000/mean(RR)` and the question is which aggregation best estimates it. Over 726 paired epochs the
bias against ECGDex falls monotonically from median (−0.244, 5.7σ) through trimmed means to the
arithmetic mean (+0.013, 0.3σ), while spread grows only 6% (1.16 → 1.23). The robustness the median
buys costs 0.26 bpm of bias. The theoretically-correct harmonic mean loses (−0.083) for a measurable
reason: the ring's rate column is already smoothed, carrying the same overall SD as beat-to-beat ECG
but 5.1× less consecutive-sample jitter, so a convexity correction over-corrects. The switch is routed
rather than taken — it moves a published field and requires deciding what the mixed-statistic flag
should say when legs differ in name but agree to 0.3σ in value.

The same paired measurement retracts an attribution in a shipped brief. R5-HR-TRIPLET-REFERENCE §2
concluded that OxyDex's ~0.36 bpm HR under-read "is the device (or the pulse-oximetry HR path)". It is
the estimator: holding epochs, nights and pairing fixed and changing only the aggregation moves the bias
by 0.26 bpm, which no device property can do. The ring's firmware HR independently agrees with chest-ECG
to 0.6 sigma over 237 windows. PpgDex's row already used ECGDex's statistic and stands, so the ordering
of the two optical corners inverts rather than survives: both are unbiased against chest-ECG, and the
fleet's one measured HR bias was a comparison artifact. The parent is amended in place with a pointer;
its conclusion that the three-cornered hat is blind to bias is unchanged and reinforced.

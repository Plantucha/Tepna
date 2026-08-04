---
bump: patch
type: added
nodes: []
brief: R5-HR-TRIPLET-FOLLOWUPS-2026-08-04-BRIEF.md
---

Isolates the mechanism behind the cross-node epoch-HR gap, which two earlier passes declared
un-isolatable. Regressing the per-block gap on the block's own RR shape over 1670 real blocks gives
gap ≈ 0.2989 − 8.7175·CV + 0.2121·skew, R² = 0.601, with r(gap, CV) = −0.719 and r(gap, skew) = +0.690
while HR level is negligible. Substituting real overnight RR's mean CV 0.0522 and skew −0.671 yields
−0.298 against the measured −0.299. That also explains the three synthetic probes whose failure was the
evidence for "no mechanism": a smooth series has too little variability, and injected pauses are
positively skewed where real RR is negatively skewed, which flips the sign. Because the driver is now
known the number reproduces without a corpus — a shape-matched synthetic gives −0.307 — so the gate is
upgraded from a source scan to asserting the value. No closed form is claimed; 60% of variance from two
shape statistics is a driver, not a derivation.

---
bump: patch
type: added
nodes: []
brief: R5-HR-TRIPLET-FOLLOWUPS-2026-08-04-BRIEF.md
---

Extends the cross-node epoch-HR gate with a SECOND mismatch found in the same three hat corners:
precision. PpgDex rounds its epoch hr to an integer (`Math.round(hr)`), ECGDex keeps a decimal
(`.toFixed(1)`), and OxyDex inherits integers from the device's Pulse Rate column — measured over the
folded corpus, epoch hr is integer-valued in 100% of PpgDex epochs, 99% of OxyDex's and 10% of
ECGDex's. A uniform ±0.5 rounding carries SD 0.289 bpm, on two of the three legs of a hat resolving
σ ≈ 1.5–2.6, and it pushes the same way as the 0.489 bpm estimator gap already pinned. Also records
that PpgDex uses the same statistic as ECGDex (rate-of-mean), so OxyDex is the odd corner on statistic
and PpgDex the odd corner on precision. Pinned as source facts, mutation-verified; not fixed, because
un-rounding PpgDex moves every one of its epochs and nothing has yet established which precision the
fleet should standardise on.

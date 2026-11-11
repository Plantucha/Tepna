---
bump: patch
type: fixed
brief: none
---

The sensor-trio night page drew stale reference marks and ran its bootstrap with a fixed block. It now draws its marks from the published record, and the night's own series sets the block.

- Figure 3 drew the July corpus medians from 24 nights and a literature diamond for a different body site. It now draws two marks from `window.TCH_REFERENCE_RECORD`: the pooled hat median and the pooled σ against the firmware-RR reference. With no record, it draws no mark.
- The bootstrap block is 2 × the largest integrated autocorrelation time of the three pairwise differences. The floor is 30 s and the ceiling is n / 20. The caption prints the block, the three τ_int values and n_eff.
- Figure 5 is new. It shows σ̂ re-solved on τ-second means for τ of 1, 10, 30, 60 and 300 s. Each value has the white-noise expectation σ̂(1 s)/√τ beside it.
- The overlap KPI gives the share of each corner's own seconds that the three-way overlap kept.
- The reading note no longer claims that the corpus recovers the literature ranking.

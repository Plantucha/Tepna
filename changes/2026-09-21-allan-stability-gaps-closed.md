---
bump: minor
type: added
brief: ALLAN-STABILITY-GAPS-2026-09-07-BRIEF.md
---

ALLAN-STABILITY-GAPS closes. capture-host: holes in an arrival series are segmented at k×median and pooled (n-weighted σ² per τ), stability() carries provenance (tau0, n, span, estimator, version) and a real answer for a constant series, nightqc passes the host instants, the night report gets one clock line per stream. Measured on the box: max_gap ≤ 4× median holds on only 22.8 % of ECG/PPG arrival legs. The brief's prediction that a compacted hole reads as τ⁺¹ drift is corrected — a phase step is τ⁻¹ᐟ² energy, it inflates the level. Node lane: a PAT↛clock source-scan gate and §2.1's file-path export test. A nightqc test that passed over zero rows now plants a real night.

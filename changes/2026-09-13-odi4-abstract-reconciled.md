---
bump: patch
type: fixed
brief: PAPER-ODI4-REPRODUCIBILITY-2026-07-31-BRIEF.md
---

`papers/odi4-ahi-bias.html`: the abstract reported only synthetic figures (slope ≈0.23, R² 0.93) while
§3.2 carried a real-PSG replication giving 0.134 — a reader got one number in the abstract and a
different one in the results with no reconciliation. §6 still listed the SHHS replication as pending
work after it had been done.

Both corrected, and the reconciliation is the finding: against the expert's own desaturation index —
the quantity the detector actually computes — the real slope is **0.672 (R² 0.756, n=4932)**, against
a synthetic ceiling-fix prediction of ≈0.69. The synthetic result transfers to within 0.02. The
catastrophic-looking 0.134 is the definitional confound, not detector error.

Stays a draft. `papers.html` card updated with both slopes.

---
bump: patch
type: fixed
brief: ALLAN-STABILITY-GAPS-2026-09-07-BRIEF.md
---

allan.stability() on a constant phase series now returns a classification record saying 'no measurable instability' (noise None, slope None) instead of classification: None, which was the shape of an unmade fit; determinism (J) and the degenerate input (A) from ALLAN-STABILITY-GAPS §2.5 are pinned by tests.

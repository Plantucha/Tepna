---
bump: patch
type: changed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

ECGDex `accAnalyze` was pseudo-tested, and its `posture` output decides a sleep position the
Integrator weights osaConf/AHI by. The gravity-vector classifier is now gated by known answer — all
six orientations, both decision thresholds, the tilt formula, normalisation, and the entry guards
(fs default 4, the fs × 30 sample floor, durMin). Verified by re-applying 15 mutants: 14 killed, 1
unreachable because the 0.55 edge is not exactly representable after normalisation.

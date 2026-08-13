---
bump: patch
type: changed
brief: MUTATION-PROGRAM-FOLLOWUPS-2026-08-11-BRIEF.md
---

OxyDex `_flagSev`, `oxyPBConf` and `oxyBuildEpochSeries` were pseudo-tested — the severity a
finding shows the user, the confidence stamped on a periodic-breathing finding, and the per-epoch
HR series the Integrator's three-cornered-hat consumes, all computed on every night and asserted
by nothing. Now pinned by known answer, including the bad-before-warn scan order, the
NOCTURNAL_STRESS ≥80 bound at both sides, median-vs-mean on each epoch leg, and the ≥60-sample
coverage floor. Verified by re-applying 16 mutants: 13 killed, 2 proven equivalent only as a
mutually-masking pair (removing both together IS caught), 1 pattern absent.

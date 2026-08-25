---
bump: patch
type: changed
brief: OXYII-DAT-AUTO-HARVEST-REFINEMENT-2026-08-24-BRIEF.md
---

Record the run_status three-state decode and the two design rulings it settles (§14): the
close-triggered pull waits for run_status 3->1 rather than firing at the duration reset, because the
~110 s flush makes an early pull SYSTEMATICALLY pre-trailer; and it must be which=latest, because at
which=all the p90 pull exceeds the resulting 50 s window. Also rewrites §6a step 3: pull.on_doff is
now deliberately ON as a production awake-tail measurement, with its provenance recorded unsmoothed.

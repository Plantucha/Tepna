---
bump: patch
type: fixed
brief: none
---
`computeTIndex` and `computeHypoxicBurden` counted an absent second as maximally desaturated. `null < 80` is TRUE, so one missing sample was below EVERY threshold at once; `94 - null` is 94, so it added the largest possible hypoxic burden — on a metric whose own reference is ">25 %-min/hr is elevated". Measured on a committed twin: a healthy 98 % night with 40 % dropout reported **40 % of its time below 80 % SpO2**.

This is the third half-finished pass in this node. `computeStats` was repaired for exactly this defect (residue `2026-09-13-oxydex-stats-block-absence-to-number`) and its comment names the consequence — *"`v < 95` is TRUE for null … T95/T90 were inflated by the dropout fraction"* — but the pass did not reach these two functions, which compute the same class of metric over the same rows and also feed `computeDesaturationProfile`'s weighted AUC.

Both now aggregate over MEASURED samples and publish the denominator (`measured`, `measuredSec`); nothing measured refuses rather than reporting a perfect 0. Five consumers were guarded in the same change because `null < 5`, `null < 0.5` and `null < 1` are all TRUE — an unmeasured burden would have graded `proj-good` and an unmeasured T90 `good`.

⚠️ **Three model-written mutation properties pinned the defect as the spec** and are reconciled here. Each is marked *MODEL-WRITTEN provenance, not a reviewed claim* in its own header, and one states the value is *"correctly calculated as 0 instead of null"*. Their mutants are still killed.

⚠️ **No committed fixture moves** — `parseCSV` drops invalid rows, so the O2Ring corpus carries no null here (measured == rows on all four goldens) and the paths that do carry one (NSRR `to1Hz`, self-ingest, SignalFrame) are not in it. A corpus that cannot express a defect cannot catch its return, so the fix ships with an adversarial COMMITTED twin that can; planting the old arithmetic back reds it.

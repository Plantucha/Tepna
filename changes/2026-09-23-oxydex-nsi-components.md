---
bump: patch
type: fixed
brief: none
---
The Nocturnal Stress Index averaged four terms and silently substituted **0** for each one it could not compute. `nsi` is `goodDirection: 'down'`, so every absent component pulled the score toward the BEST value: a night with none of them measured scored 0 — "no nocturnal stress" — and rendered green at four sites. Measured on a twin: a night with three computable terms scores **67**, where the old code published **50** by averaging in a fabricated zero for the arousal index it never measured.

`couplingScore`, fifteen lines above in the same function, already refuses for exactly this reason and says so in its comment. These four are the siblings that pass never reached. ⚠️ The `aai` line even carried a comment NAMING the trap — *"`Math.min(null / 5, 1)` is 0, not absent"* — and then wrote `: 0` anyway: catching a coercion is not the same as refusing it.

The t95 term also counted an ABSENT second as desaturated (`null < 95` is true, with the row count as denominator) — the defect #2943 fixed in `computeTIndex`/`computeHypoxicBurden` and did not reach here, a fourth instance of the same half-finished pass. `sfi` refuses too: a per-hour rate with no duration is undefined, and 0/hr is the healthiest possible fragmentation reading.

NSI is now the mean of the components that exist, with `nsiComponents` publishing how many — a mean of two terms is a different statement from a mean of four. Four consumers were guarded in the same change because `null < 30` and `null < 20` are both TRUE.

⚠️ Two more model-written mutation properties reconciled. One names the very distinction it gets backwards — *"whether the nsi field is null or 0 when the input array is empty"*. The mutant it targeted sat on the `t95pct` line this change replaces, so that comparison is gone rather than guarded; recorded in the test so the next sweep is not read as having lost a kill.

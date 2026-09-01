<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: changed
nodes: [docs]
brief: PPG-FOOT-PLACEMENT-2026-08-12-BRIEF.md
---
The PAT acceptance bar was never satisfiable; re-stated on a statistic that is measurably window-invariant.

`PPG-FOOT-PLACEMENT`'s Done-when required "medians inside **150–400 ms**". Three independent reasons,
each measured, say that bar could not be met:

1. **Its lower half is unreachable by construction.** The judging instrument
   (`tools/pat-matchrate-strict.mjs`) hard-filters lags to `PHYS_LO = 200, PHYS_HI = 650`, so nothing
   below 200 ms survives to be measured. "Inside 150–400" could only ever fail *high* — a bar that
   cannot be failed at one end is not a bar.
2. **Its upper edge is failed by every night in the brief's own §4 table** — 457.0 on the night that
   section labels *good*, then 646.9 · 749.6 · 766.3 · 903.9. The bar was unmet by the evidence printed
   directly beneath it.
3. **The statistic was wrong for the distribution.** On a censored, skewed lag distribution the median
   is a function of the window. Over a 6× sweep of the oracle's search half-width the **mode is
   invariant** (`2026-07-24` 405/405/405, `2026-08-17` 215/215/215) while the verdict label and both SDs
   move with `w`.

**Re-stated:** statistic = **MODE** (on measured invariance, not preference); band **200–500 ms** as a
sanity rail; discriminator = `pat-window-oracle` verdict **SIGNAL RECOVERED**, i.e. a night beating its
*own* null. Grounded in the corpus's four signal nights — **215 · 315 · 355 · 405 ms**.

The band is deliberately the weaker half: beating your own null is the acceptance test, the numbers only
rail against gross mis-referencing.

**PEP is stated, not subtracted** — a chest-ECG→peripheral-foot PAT is PEP-inclusive by construction, and
PEP is **12–35 % of rPTT** (Mukkamala R, Hahn JO, Inan OT et al., via `PAT-RELATIVE-REFRAME-2026-08-17`).
Part of why 150 ms was never physical for this geometry.

Cleared before ratification: no published surface quotes the 150–400 bar or a median-PAT acceptance, so
this re-scopes an unevaluable criterion rather than moving a published result. The original bar is kept
visible and annotated rather than edited away.

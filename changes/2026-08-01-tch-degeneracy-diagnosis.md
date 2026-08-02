<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [Integrator]
brief: TRIO-ARTIFACT-GATE-AND-N15-POWER-2026-07-12-BRIEF.md
---
`tools/tch-degeneracy-stats.mjs` — the residual TCH degeneracy measured, and two of the brief's three claims about it do not survive.

**The Done-when box asserted three things; only one was a measurement.** Reproduced from `tools/tch-multinight.mjs --dir uploads/trio` (the shipped `IntegratorTCH.threeCorneredHat` does all the estimating; the new tool only counts and tests):

1. **"several nights"** → **8 of 39 (21 %)**. A fifth of the corpus. Every one is the same failure: negative classic variance, so the correlated fit lands on the non-negativity boundary and that member's σ is ~0 *by construction, not by measurement*.
2. **"which corner"** → **not attributable**. OxyDex 5, PpgDex 2, ECGDex 1 — and `P(X ≥ 5 | n=8, uniform ⅓) = 0.088`. OxyDex leading is tempting (it is the 1 Hz-quantised corner, so a quiet-order story writes itself), which is exactly why it is recorded as *not established* rather than as a mechanism.
3. **"the known quiet-order / correlated-error regime"** → **the one available proxy points the other way**. `ρ` (per-night co-motion correlation) is the parameter the correlated fit uses to *rescue* these nights. Degenerate nights: median **0.26**; estimated nights: **0.41**. Two-sided permutation p = **0.090** — suggestive, not significant, and two-sided on purpose because the direction was chosen after seeing the medians.

The honest reading, offered as hypothesis not result: these nights may fail **not** from more correlated error but from **too little co-motion for the ρ-correction to grip** — the rescue has nothing to work with, so the solve stays on the boundary. That inverts the box's attribution. At n = 8 it cannot be settled; separating a 5/8-style lead from chance needs ~25 degenerate nights, i.e. ~125 trio nights against the 40 available.

**Also reconciled two Done-when boxes with this brief's own ⚠️ banner.** The banner (added 2026-07-18) declares §3's cross-corner consensus gate **DISPROVEN** — `TCH-FUSED-ROBUST-HAT` prototyped it on the real corpus and found it *"either unreliable or biases the noisiest corner"*. But the Done-when list still asked for exactly that gate, and for a `SENSOR-TRIO-NIGHTS` re-run *"with the gate on"*. A reader working the list top-to-bottom would have built the thing the header forbids. Both are RETIRED in place, with the substance **re-homed rather than dropped**: the paper still owes both corrections (censoring of hard nights, epoch hygiene), now under the fused hat's own Done-when.

Tool + brief only — no shipped source, no `manifestHash` movement, no fixture re-recorded. The tool ships a `--selftest` with known answers for both statistics (`binomTail(5,8,⅓) ≈ 0.088`, plus separated/interleaved permutation cases) so a refactor cannot quietly move a published p-value, and it uses a seeded LCG rather than `Math.random` so the p-values are reproducible.

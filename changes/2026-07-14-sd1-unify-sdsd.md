<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: fixed
nodes: [PulseDex, ECGDex]
brief: DEEP-AUDIT-2026-07-14-BRIEF.md
---
Unify the Poincaré SD1 estimator fleet-wide on SDSD/√2 (÷N−1), closing the last DEEP-AUDIT-2026-07-14 finding (§8, code-health). PpgDex (`√0.5·std(Δ)`) was already the target; ECGDex's `poincareGeo` SDSD changed from ÷N to ÷N−1; PulseDex's SD1/SD2 spread changed from rMSSD (the RMS of the difference series, ÷N, no mean-centering) to SDSD (its sample SD, ÷N−1) via a new `sdsd()` helper — the geometric SD1²=SDSD²/2, SD2=√(2·SDNN²−SD1²) unchanged. rMSSD² = SDSD² + mean(Δ)², so the shift is mean(Δ)² ≈ 0 on a stationary night (negligible: real fixture sd1 18.74→18.75, synthetic 30.61→30.62), but the three nodes can no longer drift definitionally. Gated by a PulseDex assertion on a trending RR series (mean(Δ)≠0 ⇒ SDSD/√2 ≠ rMSSD/√2): exported sd1 must equal SDSD/√2 and sit below rMSSD/√2, RED on the old code. ECGDex is export-inert (its equiv clip has no sd1); PulseDex's sd1 IS exported so its two moving fixtures were regenerated via a new `tools/regen-pulsedex-goldens.mjs` (third sibling of the CPAP/GlucoDex regen pair), `verifiedUnder` re-stamped after a green corpus run. Re-bundled ECGDex + PulseDex + Data Unifier + OverDex + the 8 analysis tools that inline either DSP. With §8 done, all 8 DEEP-AUDIT-2026-07-14 findings are executed.

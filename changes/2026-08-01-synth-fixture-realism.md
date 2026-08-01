<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: patch
type: added
nodes: [PpgDex]
brief: SYNTH-GEN-FIXTURE-REALISM-FOLLOWUPS-2026-08-01-BRIEF.md
---
`SYNTH-GEN-DESAT-KINETICS` closed asking whether the PPG/ECG generators carry the defect it had just fixed in the SpO₂ one. That was left unasserted on purpose — claiming it untested would have been the error the parent brief exists to correct. Measured now.

**PPG: no defect.** Five synthetic nights through `PPGDSP.parsePPG → analyze` sit *inside* the 36-night real quality envelope — `correctionRate` 1.5–3.5 against a real median of 4.25, `analyzablePct` 98–99 against 97 — nowhere near rejection. Gated against the real p10/p90, in the rejection direction only, because that is the one that broke.

**RR: the opposite failure.** Synthetic intervals are **0.00 %** Malik-corrected on all five nights, against a real median of **4.73 %** (range 0.66–15.65). Recorded, deliberately not fixed: `correctRR` keeps its own injected-ectopic known-answer gate, injecting ectopy would move every HRV fixture for a realism gain nobody has asked for, and speculative fixture-tuning is precisely the habit under correction.

The two directions are named separately because they look alike in a summary and are not. A **rejected** fixture makes the measurement silently become a measurement *of the gate* — confidently wrong numbers, as the ODI-4 severity deficit was. An **over-clean** fixture yields no wrong number, only unwarranted confidence, because a path that matters on real data is never exercised end-to-end. An audit looking for one will call the other healthy.

Also discharges the follow-up brief owed by `IBI-ALIGNMENT-LIMIT`.

<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [ECGDex]
brief: TCH-REFERENCE-VALIDATION-2026-07-12-BRIEF.md
---
Put ECGDex's respiration on the ganglior bus — it derived respiratory rate two independent ways and exported neither.

`hrv.frequency` carried only `{lf, hf, lfhf, method}`. ECGDex has, all along, computed **two** respiration
estimates and shipped **zero**:

- `respRate` — HF-peak of the RR spectrum (respiratory sinus arrhythmia), a per-epoch EDR **median**.
- `respFromEDR` — R-peak **amplitude** modulation (`cardiorespCoupling`). Genuinely independent:
  morphology, not rhythm.

Both now ride the bus, each with an explicit `…Method` label so a consumer cannot conflate them. The
per-epoch series (`timeseries.epochs[].resp`) is exported too — it was computed and dropped by the export
map, and a night median cannot be correlated against anything.

Also fixes a **fabrication**: the night-level `respRate` fell back to `0` when unknown. Zero breaths per
minute is not a measurement; it is an invented number standing in for "don't know". Now `null`, per the
Clock Contract's never-fabricate discipline. Downstream is unaffected — `cardiorespCoupling`'s `respHint`
guard already fell back to 15 for both `0` and `null`.

Same bug class as `CPAP-REAL-CORPUS` §F1 (the ventilation lane: computed, then dropped), in a second node.

NOTE — the sibling fix for PpgDex was attempted and **retracted**. `PPGDSP.lombScargle` having no
respRate/peak path is a **deliberate, audited safety property** (`SYNTH-TEXTURE-FOLLOWUPS-II §2`), not a
defect: an HF-peak (0.15–0.40 Hz) respiratory rate is **blind to Cheyne–Stokes** (~0.022–0.05 Hz), and
unlike ECGDex, PpgDex has no dedicated apnea-band detector to cover it. PpgDex is unchanged; its
`manifestHash` did not move.

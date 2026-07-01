<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# HRV Age-Confound — Simulation Study (paper #1)

> Figure engine for **"Age confounds apnea-driven HRV suppression: why single-metric consumer
> HRV screening misattributes risk, and an age-adjustment that recovers it."** Open
> `hrv-confound-analysis.html` → **Run simulation**. 100% local; reuses `cohort-gen.js` + the real
> PulseDex DSP (`cohort-harness.html?node=pulsedex`).

---

## The claim
A low nocturnal **rMSSD** is structurally ambiguous: HRV declines with **age** *and* with **apnea
burden**, so one number can't tell *old-and-healthy* from *young-and-apneic*. A single-metric HRV
screen therefore misattributes risk. An **age-adjustment** (residual vs the healthy age reference)
recovers much of the lost discrimination.

## How it's measured (why it isn't circular at the detector level)
For N synthetic patients, each night's rendered RR is run through the **real PulseDex DSP** to get a
**measured** rMSSD (not the latent target). That measured value is paired with the patient's known
**age** and the night's known **AHI**, then analyzed:
- **Multiple regression** rMSSD ~ age + AHI (2-predictor OLS) — shows both carry independent weight.
- **The ambiguity, two views** — rMSSD vs age (coloured by AHI) and vs AHI (coloured by age).
- **ROC** for detecting moderate+ OSA (AHI ≥ 15) from raw rMSSD vs the age-adjusted residual.
- **Misattribution** — of the lowest-rMSSD quartile ("high-risk" under a naive screen), what fraction
  are actually non-apneic (AHI < 5), i.e. flagged for being old, not sick.

## Pilot result (120 patients → 626 real-PulseDex nights, ~90 s)
- **rMSSD = 64.6 − 0.38·age − 0.29·AHI** (R² 0.56) — the real detector recovers the planted couplings
  (latent −0.42/yr, −0.22/AHI) and confirms **comparable independent weight** for age and apnea.
- **−3.8 ms rMSSD per decade of age** vs **−2.9 ms per 10 AHI** — an aging effect of the same order as
  a 13-point AHI swing, hidden inside one number.
- **Single-metric screen is weak and confounded:** AUC **0.62** (raw rMSSD) → **0.68** (age-adjusted) for
  moderate+ OSA. **19%** of naive "high-risk" flags are old-and-healthy false positives.
- Scales up cleanly (slider to 800 patients → ~5k nights) to tighten the estimates for the paper.

## Outputs
- `hrv-confound-results.csv` — per-night `age, ahi, rmssd_measured, severity, cpap`.
- `hrv-confound-stats.json` — regression, age reference, AUCs, misattribution + the framing note.
- `hrv-confound-figures.png` — the 3-panel figure (two ambiguity scatters + ROC).

## Honest framing (ships in-page + in the JSON)
This is a **simulation study**. The age→HRV and apnea→HRV coupling magnitudes are *generator inputs*
anchored to literature effect sizes (editable in the panel for sensitivity analysis). The contribution
is **quantifying the screening error those plausible magnitudes imply, and the adjustment that recovers
it** — it is **not** a clinical validation. The measured rMSSD does come from the real PulseDex DSP, so
the confound survives an actual detector. To make it a clinical finding you'd replicate on a labelled
cohort (age + PSG-AHI + overnight HRV); the simulation motivates and powers that study.

## Venue fit
Methods / digital-health: *npj Digital Medicine*, *Sleep*, *J Clin Sleep Med*, *Physiological
Measurement*; or arXiv `q-bio.QM` / medRxiv as a preprint. The actionable contribution is the
age-adjustment recipe — a drop-in for any rMSSD-based screening rule.

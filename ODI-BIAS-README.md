<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# ODI-4 vs AHI — Bias Analysis (publishable lane)

> The figure-generating apparatus for the candidate paper **"Rolling-baseline ODI-4
> under-estimates AHI in severe OSA: a quantified bias and a recalibration."** Runs the
> **real** OxyDex ODI-4 detector against a reference AHI from three sources and produces
> the calibration scatter, Bland–Altman, by-severity, and correction-curve figures + CSV/JSON/PNG.
> 100% local. Open `odi-bias-analysis.html`.

---

## What it does
For each night it runs OxyDex's real `processNight` to get ODI-4, pairs it with a reference AHI,
and fits the calibration. OxyDex's *shipped* AHI surrogate is hard-coded `AHI ≈ ODI-4 × 1.1`
(`oxydex-dsp.js → computeAHIestimates`, line ~1340) — this page tests whether that holds and fits a
better correction.

### Three point sources (increasing publishability)
1. **SubjectA** — the 5 committed real O2Ring nights vs their known/planted AHI. Runs today, no
   downloads. *Proves the apparatus.* → button **"Run SubjectA corpus"**.
2. **Synthetic cohort** — points pulled from the cohort runner's IndexedDB (`ganglior_cohort_pilot`)
   if you've done a run. Large-N, but synthetic ground truth. → **"Load synthetic cohort"**.
3. **NSRR PSG** (SHHS / MESA / MrOS / CHAT) — you drop matching `*.edf` + `*-nsrr.xml` pairs; the XML's
   scored apneas+hypopneas ÷ staged sleep hours = reference AHI. **This is the lane that supports a
   real-world clinical claim.** Files are NOT bundled — NSRR access is free but requires your own DUA
   at sleepdata.org. Alternatively drop a `CSV(id,ahi)` (e.g. SHHS `ahi_a0h4`) + the EDFs.

---

## Pilot result (SubjectA, 5 real nights — runs today)
| night | OxyDex ODI-4 | reference AHI | ODI−AHI | ODI/AHI | severity |
|---|---|---|---|---|---|
| 1 | 6.4 | 22 | −15.6 | 0.29 | mod |
| 2 | 7.6 | 38 | −30.4 | 0.20 | severe |
| 3 | 0.9 | 7 | −6.1 | 0.13 | mild |
| 4 | 0.5 | 4 | −3.5 | 0.13 | none |
| 5 | 0.1 | 3 | −2.9 | 0.03 | none |

- **ODI-4 ≈ 0.23 · AHI** (R² 0.93) — the detector recovers only ~¼ of scored events; the gap **widens
  with severity** (mean under-count −30/h in the severe stratum).
- **The shipped ×1.1 surrogate is badly miscalibrated:** leave-one-out RMSE **15.2/h** (naive ×1.1)
  vs **7.2/h** (a re-fit linear model) — recalibration roughly **halves** the error.
- ⚠️ n=5 and the AHI here is planted, not PSG-scored — this proves the method and motivates the study;
  it is **not** the clinical result. Run the NSRR lane for that.

---

## Outputs
- **Calibration scatter** — ODI-4 vs reference AHI, coloured by severity; identity, shipped ×1.1, and
  OLS-fit lines. Below-identity points = under-count.
- **Bland–Altman** — mean bias + 95% limits of agreement; a downward trend with mean AHI = proportional
  (severity-dependent) bias.
- **Under-count by severity** — median ODI/AHI ratio per stratum (the headline mechanism).
- **Correction curve** — naive ×1.1 vs re-fit linear vs power, with leave-one-out RMSE.
- **Exports** — `odi-bias-results.csv` (per-record), `odi-bias-stats.json` (all fits + LoA + by-severity
  + LOO-RMSE), `odi-bias-figures.png` (2×2 figure panel).

## Files
- `odi-bias-analysis.html` — page + the real OxyDex stack (loaded alone in this realm → no global
  collision) + EDF reader + adapter.
- `odi-bias-analysis.js` — point collection, fits, four figures, exports.
- `nsrr-adapter.js` — `window.NSRR`: EDF→OxyDex rows (SpO₂ channel auto-detect, 1 Hz resample with
  forward-fill of dropouts, canonical `{tMs, t:Date, spo2, hr, motion}` rows) + NSRR XML parser
  (apnea/hypopnea events ÷ staged TST → reference AHI). Clock Contract honored.

## How to publish from here
1. Get NSRR access (sleepdata.org DUA — free, ~days). 2. Download a cohort's EDFs + annotation XMLs
   (SHHS n≈5,800 is the obvious first). 3. Drop them in → the figures + stats.json populate on real
   PSG. 4. If the bias replicates at n>1000, that's the paper; preprint on arXiv/medRxiv, then recruit
   a sleep-lab co-author for prospective validation. The recalibration curve is the actionable
   contribution (a drop-in fix for `computeAHIestimates`).

## Honest scope
SubjectA + synthetic points validate the **apparatus and the mechanism**, not clinical accuracy. Only
the **NSRR points** support a real-world claim. `stats.json` records the source mix so a reader can
see exactly what the fit rests on.

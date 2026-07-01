<!-- Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->

# ODI-4 vs AHI — Bias Analysis (paper apparatus)

> The figure-generating tool for the manuscript *"Rolling-baseline ODI-4 systematically
> under-estimates AHI in severe OSA."* Runs the **real** OxyDex detector and plots ODI-4 against a
> **reference AHI** from three sources. 100% local; NSRR/PhysioNet files are supplied by you under
> your own DUA and are never bundled.

## Files
- `odi-bias-analysis.html` + `odi-bias-analysis.js` — the analysis page (scatter, Bland–Altman,
  by-severity, correction curve, CSV/JSON/PNG export).
- `nsrr-adapter.js` — `window.NSRR`: EDF (via the suite's `CpapEdf.readEDF`) → OxyDex rows, and an
  NSRR profusion-XML parser → reference AHI (scored apneas+hypopneas ÷ staged sleep hours). Also
  accepts a harmonized-variable CSV (e.g. SHHS `ahi_a0h4`) paired by record id.

## Three point sources (increasing publishability)
1. **SubjectA** — the 5 committed real O2Ring nights vs their known/planted AHI. Runs today, no
   downloads. **Proves the apparatus**, not a clinical claim.
2. **Synthetic cohort** — points pulled from `cohort-runner.html`'s IndexedDB if present. Large-N but
   synthetic ground truth; plotted faded, reported as its own source.
3. **NSRR PSG (SHHS / MESA / MrOS / CHAT)** — you drop matched `*.edf` + `*-nsrr.xml` pairs (or EDFs +
   a scored-AHI CSV). **This is the publishable lane** — real PSG-scored AHI.

## What it computes
- **Calibration**: OLS of ODI-4 on reference AHI (slope, intercept, R²) + identity + the shipped
  `AHI = ODI-4 × 1.1` surrogate, **per source** (so the real anchor is never masked by the synthetic pool).
- **Bland–Altman**: mean bias, 95% limits of agreement, and the proportional-bias slope (bias vs mean) —
  a negative slope is the headline (disagreement grows with severity).
- **By severity**: median ODI-4 / AHI ratio per stratum (none/mild/mod/severe).
- **Correction**: leave-one-out RMSE comparing the shipped ×1.1 against fitted linear and power
  (`AHI ≈ a·ODI^b`) recalibrations.

## Apparatus shake-out (current numbers — SubjectA + synthetic, NOT a clinical result)
Running the 5 real SubjectA nights + the synthetic cohort produced: OLS slope ≈ **0.15**, R² ≈ **0.93**,
mean bias ≈ **−13 events/h**, severe-stratum median ratio ≈ **0.15** (≈85% under-count), Bland–Altman
proportional slope ≈ **−1.5**, power correction ≈ `AHI ≈ 6.5·ODI^1.0`. This confirms the mechanism and
that the tool works; **the manuscript numbers are whatever the NSRR lane produces.**

## To produce the actual paper result
1. Get NSRR access (free, DUA at sleepdata.org) — SHHS is the easiest start (single PSG/subject, large N).
2. **Scored-AHI CSV (one click):** load the cohort's harmonized CSV directly (e.g.
   `shhs1-dataset-*.csv`) — the tool auto-detects the id column (`nsrrid`/`pptid`/…) and the best AHI
   variable present, preferring the 4%-desat definition (`ahi_a0h4` → `ahi_a0h3` → `poohi4`/`rdi4p`/…).
   Then drop the matching EDFs; stems like `shhs1-200001` auto-pair to nsrrid `200001`. (A plain
   `id,ahi` two-column CSV still works as a fallback.)
3. Read the **nsrr** row in the Sources card and `stats.json → perSource.nsrr`; export `figures.png`.
4. Pre-register the analysis if you can — slope, LoA, and the correction are the primary endpoints.

## Honest scope (put this verbatim in Limitations)
ODI-4 is computed by the real OxyDex detector. Reference AHI: `subjectA`=planted, `synthetic`=cohort
ground truth, `nsrr`=PSG-scored. **Only the NSRR points support a real-world claim**; the other two
validate the pipeline. Single-pulse-oximetry ODI is not PSG and the correction is dataset-specific until
externally validated.

## Suggested manuscript skeleton
**Title** Rolling-baseline ODI-4 under-estimates AHI in severe OSA: quantification and a recalibration.
**Intro** consumer/home oximetry uses ODI as an AHI surrogate; the rolling baseline sags under
sustained desaturation. **Methods** OxyDex ODI-4 (cite the algorithm), NSRR cohort, reference AHI,
Bland–Altman + OLS + LOO-validated correction (this tool *is* the methods figure pipeline; cite the
synthetic harness for reproducibility). **Results** slope/LoA/by-severity/correction from the NSRR lane.
**Discussion** clinical risk of under-triage in severe OSA; the correction; limitations above.
**Venue** *J Clin Sleep Med* / *Sleep* / *Physiological Measurement* / *Sensors*; preprint on **medRxiv**
(clinical) — arXiv `eess.SP` works for the signal-processing framing if you prefer.

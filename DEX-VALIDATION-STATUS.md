<!--
  DEX-VALIDATION-STATUS.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# Tepna — Validation Status (WP-E)

**Date:** 2026-06-21 · **Answers external-review #2** ("publish validation numbers… even one cohort
moves trust more than any feature") and §E ("reproducibility of *science*… largely absent"). This doc
states, in one place and honestly, **what is validated, with numbers, and what is not** — so a reader
never has to guess which kind of evidence stands behind a metric.

> **The honest headline.** Tepna's pipelines are **internally validated against synthetic ground
> truth and known-answer DSP tests** — they certify *pipeline behavior and cross-node coherence*.
> They are **not** validated against real-world clinical gold standards (PSG / Kubios / CPET / cuff).
> That external gap is the single thing capping researcher trust, and it is **a data problem, not a
> code problem** — the harness is built to ingest paired reference data the moment it exists.

---

## 1 · What IS validated (with numbers)

### A. Real-corpus regression gate — `cohort-regression.html`
The 5 canonical SubjectA nights run through the **real** OxyDex + PulseDex pipeline and diff against
committed ground truth.
- **✓ all green — 26 / 26 checks · 5 nights** (live, 2026-06-21).
- **OxyDex ODI vs truth-AHI: R² = 0.944** across the 5 nights (gate ≥ 0.85) — the detector *tracks
  severity* tightly.
- Clock Contract checked end-to-end: parsed `t0Ms` equals each night's ground-truth `t0Ms`.

### B. Synthetic cohort harness — `cohort-runner.html` (all 7 nodes)
N seeded synthetic patients (age × sex × BMI × OSA × CPAP × glycemia × autonomic × artifact ×
missingness) through the **real headless** Dex pipeline. Frozen seeds, **byte-reproducible**
(worker-pool ≡ single-thread, verified); 10k FAST lane + ≤500 FULL lane (adds real ECGDex
Pan-Tompkins + PpgDex 176 Hz morphology). Surfaced numbers:
- **ECG beat-recovery median = 1.0** — Pan-Tompkins re-derives ~99.5% of the true beats from the
  synthesized PQRST, so the RR→ECG→detect round-trip is faithful and ECG HRV is trustworthy.
- **ECG−PPG rMSSD Δ ≈ −29 ms (median)** — PPG reports higher rMSSD than ECG on the same window
  (pulse-arrival-time jitter), a cross-node coherence finding (consistent with the WP-D audit's note
  that PpgDex uses a looser 30% ectopy threshold).
- **CPAP residual-AHI abs-err ≈ 1.5 / h (median)** vs the planted (capped) residual.
- **OxyDex ODI vs truth-AHI: strongly linear (R² ≈ 0.93) but systematically *under-scores*** the
  planted AHI (slope ≈ 0.14–0.21) — a **documented, surfaced est-vs-truth bias**, confirmed on the
  real SubjectA corpus (night 2: AHI 38 → `odi4` 7.6). The discrete ODI-4 detector undercounts dense
  sustained desats as the rolling baseline sags. *Named, not hidden.*
- **0 node throws · 0 kernel mismatches · fusion overlap on every multi-node patient.**

### C. Known-answer DSP unit tests — `Dex-Test-Suite.html` / `tests/dex-tests.js`
Deterministic, analytic-answer tests added in the review pass (run in Node CI + browser):
- **WP-C — spectral HRV:** synthetic single-tone RR → correct Task-Force band + peak (12/12).
- **WP-D — beat artifact/ectopy:** injected ectopic + range + SQI defects → correct Malik handling,
  ectopy counted separately (10/10).
- **WP-G — `parseTimestamp` conformance:** one truth table × every reachable copy + all 7 source
  mirrors (42/42).
- Whole suite **all green** alongside the cohesion/contract groups.

### D. Build provenance — `verify-provenance.html` (WP-F)
Every bundle exposes a template **`buildHash`** + a file-level **`manifestHash`** (executed-code
fingerprint); committed fixtures audited **reproducible, 0 mismatches**.

---

## 2 · What is NOT validated (the gap that blocks researcher trust)

**No agreement-vs-gold-standard numbers exist**, because the reference datasets are not in the repo:

| Claim a researcher wants | Reference needed | Status |
|---|---|---|
| ODI-4 / AHI-est accuracy | paired **PSG** (scored AHI, ODI) | ❌ none |
| Sleep staging (if ever surfaced) | paired **PSG** hypnogram | ❌ none (HR-staging demoted to research, WP-A) |
| HRV (rMSSD/SDNN/LF·HF) correctness | **Kubios / NeuroKit2** on the same RR | ❌ none |
| VO₂max estimate | **CPET** | ❌ none (VO₂ demoted to research, WP-A) |
| Blood pressure | **cuff** | n/a — **BP removed** (WP-A), not validated |

The cohort harness's own README says it plainly: results are validated against the **synthetic**
ground truth it plants — *"they certify pipeline behavior and internal coherence, not real-world
clinical accuracy."* This doc does not overclaim past that line.

---

## 3 · What would close the gap (smallest first — "even one cohort")

1. **One paired PSG night set** (e.g. an open PSG corpus with simultaneous SpO₂ + the scored
   AHI/ODI) → **Bland–Altman ODI-4-vs-PSG-ODI** + a slope/bias number that either confirms or
   recalibrates the documented undercount (slope ≈ 0.14–0.21). Highest trust-per-effort.
2. **Kubios/NeuroKit2 on the same RR recordings** → table of rMSSD/SDNN/LF·HF deltas. The harness
   already RR→ECG→re-detects beats, so feeding the same RR to a reference tool is a drop-in compare.
3. **A small CPET set** *(only if VO₂ is ever re-promoted above research depth)*.

**The harness is ready for this:** `cohort-runner.html` scores against ground truth via a pluggable
companion, and `cohort-regression.html` already diffs real recordings vs committed truth — swapping
the synthetic truth for **paired clinical truth** is the same code path. No re-architecture, just
data + a labelled corpus the license permits.

---

### Bottom line
Tepna is **honestly and reproducibly validated where it can be** — synthetic ground truth (R² 0.944
on the real SubjectA corpus, 26/26 regression checks), known-answer DSP unit tests, byte-reproducible
cohorts, and build provenance. The **external clinical-agreement numbers do not exist yet**, the doc
says so without hedging, and the path to the first one (a single paired-PSG cohort) is a data task the
harness is already built to run. This converts review #2 from "absent" to "scoped, honest, and
one dataset away."

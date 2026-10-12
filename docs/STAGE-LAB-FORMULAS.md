<!--
  STAGE-LAB-FORMULAS.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** REFERENCE (living — every published formula the stage lab uses, with its citation, where it enters, how its constants are obtained, and what it measured) · **last-verified:** 2026-10-12 · **Parent:** `briefs/STAGE-LAB-2026-09-27-BRIEF.md`

# Formulas used by the stage lab — what, whose, where, how

Rule of this page: a formula is listed only if code uses it. "Pinned" means the constants are the published ones; "fitted" means the structure is published and the constants were fitted here (as the cited authors fitted theirs), on which cohorts the brief says. Numbers quoted are from the brief and carry its pre-stated bands; nothing here is a published rate (P5 gate).

## 1 · Signal harmonisation (the ring's view of a PSG)

| formula | citation | where | how |
|---|---|---|---|
| Oximeter SpO₂ as reported by a fingertip device: 8-s moving mean, 1 Hz, integer percent | device behaviour, measured on the O2Ring (`o2ring/parse_dat.py`: 1 Hz bytes) | `harmonizeSpo2` (`tools/stage-lab-core.mjs`), feature tag `spo2h` | pinned (8 s, 1 Hz, whole %) |
| Instantaneous heart rate from beats: HR(t) = 60 / RR for the interval containing t, sampled at 1 Hz, then a 4-s mean | Sridhar et al., npj Digit Med 2020;3:106, doi:10.1038/s41746-020-0291-x (IHR from RR); the 4-s mean mimics an oximeter's PR | `ihrFromEcg` (`tools/stage-lab.mjs`), ECG cohorts only | pinned; beats from the suite's Pan–Tompkins (Pan & Tompkins, IEEE TBME 1985;32:230), validated Se/PPV ≥ 99 % on MIT-BIH, SLPDB, NSRDB (brief §9) |
| Activity per second = standard deviation of the acceleration magnitude |a| within the second (gravity drops out) | standard actigraphy pre-processing (cf. van Hees et al. 2013 PLoS ONE 8:e61691 for the magnitude-based measure) | `motion-prep.py` | pinned; the 1-bit flag = activity > 0.02 g (stated threshold, not tuned) |
| Per-night robust standardisation: z = (x − median) / IQR | subject-specific standardisation, as in Vaquerizo-Villar et al. 2025 (below) | `withContext` (`stage-lab-core.mjs`), every block | pinned |

## 2 · Per-epoch features (the literature terms)

| formula / quantity | citation | where | how | what it measured |
|---|---|---|---|---|
| SpO₂ variability over 1 min and 10 min windows (SD); roughness (MAD over 1 min); 90–10 percentile range; slope; lag-1 autocorrelation | stage-lab formula v8 (2026-09-27; the lab brief stays private until publication); physiology: irregular breathing raises short-window SpO₂ variance in REM and wake | `FORMULA_TERMS` (`stage-lab-core.mjs`), `TERMS` (`litstack.py`) | fitted coefficients (softmax), one per term and stage; signs checked against physiology (§5, §18) | measured in the stage-lab brief (private until publication) |
| Desaturation density (≥ 3 % drops per 10 min) and maximum drop depth | AASM scoring manual (3 % desaturation rule); Vaquerizo-Villar et al. 2025 (desaturation depth when ambiguous) | same | fitted | part of the 8-term formula |
| SpO₂ band power 0.02–0.05 Hz (cyclic desaturation) | Vaquerizo-Villar F et al., Eng Appl Artif Intell 2025;162:112562, doi:10.1016/j.engappai.2025.112562 (band 2 for SpO₂) | `spo2.lnpow.02-.05Hz` | fitted | |
| Pulse-rate variability: SD over 1 min and 5 min (SDNN proxy), MAD over 1 min (RMSSD proxy), 90–10 range, trend | Redmond & Heneghan, IEEE TBME 2006;53:485, doi:10.1109/TBME.2005.869773 (cardiorespiratory staging features); Vaquerizo-Villar 2025 (PR SD/RMSSD wake > REM > NREM) | pulse block | fitted | measured in the stage-lab brief (private until publication) |
| PR band powers: 0.004–0.020 Hz (macro band; wake high, REM 0.010–0.020), 0.01–0.04, 0.04–0.15 (NREM elevated: sympathetic depression), 0.18–0.40 Hz (respiratory modulation, NREM) | Vaquerizo-Villar et al. 2025 (explainability bands); Task Force, Circulation 1996;93:1043 (LF/HF conventions) | pulse block, feature set `oxy1` | fitted | measured in the stage-lab brief (private until publication) |
| Cole–Kripke weighted window: D = 10⁻⁵ (404 A₋₄ + 598 A₋₃ + 326 A₋₂ + 441 A₋₁ + 1408 A₀ + 508 A₊₁ + 350 A₊₂) | Cole RJ, Kripke DF et al., Sleep 1992;15:461, doi:10.1093/sleep/15.5.461 | `litstack.py` (`CK_W`), motion cohorts | the seven weights pinned (their published values); the term's stage coefficient fitted | measured in the stage-lab brief (private until publication) |
| Sadeh window statistics: mean activity, fraction of moving epochs over 5 and 10 min, SD over 10 min, seconds since last movement | Sadeh A et al., Sleep 1994;17:201, doi:10.1093/sleep/17.3.201 | motion block (`motion.*`, `mbit.*`) | fitted | |
| Context: each term also at ±2, ±10, ±30 epochs (means) and a 30-epoch contrast | multi-resolution context, as in Fonseca et al. 2017 (windows of several minutes around the epoch) | `withContext` | pinned windows, fitted weights | |

## 3 · Time-of-night and sequence formulas

| formula | citation | where | how | what it measured |
|---|---|---|---|---|
| Two-process model: Process S decays exponentially after sleep onset, e^{−t/τ}; early-night term e^{−t/0.25 h}; linear t | Borbély AA, Hum Neurobiol 1982;1:195 (two-process model); Daan, Beersma & Borbély, Am J Physiol 1984;246:R161 | `litstack.py` basis (`procS`, `early`, `t`); HSMM time prior (v13) | τ pinned at 1.5 h and 0.25 h (literature-scale constants), stage coefficients fitted | measured in the stage-lab brief (private until publication) |
| Hidden Markov smoothing: Viterbi over scaled likelihoods p(stage | x)/p(stage) with counted transitions | Rabiner, Proc IEEE 1989;77:257, doi:10.1109/5.18626 | `viterbi` (`stage-lab-core.mjs`, `seqnet.py`) | transitions counted on training nights | on every model |
| Explicit-duration HSMM with bout-length histograms | Yu, Artif Intell 2010;174:215 (HSMM review) | `hsmmFit/hsmmViterbi` (v13) | durations counted | measured in the stage-lab brief (private until publication) |
| Ultradian wave θ(t) = 2πt / (T₀(1 + g t)) + φ, T₀ ∈ 70–120 min, fitted per night by matched filter on REM − deep posterior | NREM–REM cycle: McCarley & Hobson, Science 1975;189:58, doi:10.1126/science.1135627 (reciprocal-interaction oscillator); cycle lengthening within the night: Feinberg & Floyd, Psychophysiology 1979;16:283; matched filtering = epoch folding (Leahy et al., ApJ 1983;266:160) | `waveform.py` (v15), `litstack.py --bridge` | T₀, g, φ fitted per night from the data, never labels | measured in the stage-lab brief (private until publication) |
| Auto-context: a model's own posteriors at ±1, 2, 5, 10, 20 epochs and window means (±5, 15, 40; bridge: ±60, 120, 240) feed a second pass, fitted on out-of-fold posteriors | Tu Z & Bai X, IEEE TPAMI 2010;32:1744 | `autoContext` (bench, trees), `ctx_basis` (`litstack.py`) | window offsets pinned, weights fitted | measured in the stage-lab brief (private until publication) |
| Cumulative stage mix so far (deep-so-far, REM-so-far) and the remainder of the night's mix | Process S written on the model's output (Borbély 1982; Achermann & Borbély, in Principles and Practice of Sleep Medicine) | `ctx_basis` with `--bridge` | fitted | v21 pending |
| Linear-chain CRF: p(y|x) ∝ exp(Σ U_t(y_t) + Σ T(y_{t−1}, y_t)); forward algorithm for the partition function, Viterbi decoding; identical to a 1-D Potts chain (Potts 1952, doi:10.1017/S0305004100027419) in an external field | Lafferty, McCallum & Pereira, ICML 2001; Potts, Proc Camb Phil Soc 1952;48:106 | `crf_fit/crf_decode` (`litstack.py`) | T initialised at counted transitions and fitted; per-stage bias fitted; unary scale FIXED at 1 (a free scale collapsed to 0.1, §18) | measured in the stage-lab brief (private until publication) |
| Bout-duration laws: wake bouts power-law (exponent ≈ 2.2), sleep bouts exponential | Lo CC, Ivanov PCh, Stanley HE et al., Europhys Lett 2002;57:625 | not yet used (candidate semi-Markov prior, v21b) | — | — |

## 4 · Fitting and learning formulas

| formula | citation | where | how |
|---|---|---|---|
| Multinomial logistic (softmax) regression over named terms, line + hinge (ReLU) basis | McFadden, in Frontiers in Econometrics 1974 (multinomial logit); Friedman, Ann Stat 1991;19:1 (MARS hinge basis) | `fitSoftmax` (core), `fit_softmax` (`litstack.py`) | coefficients fitted by L-BFGS (Liu & Nocedal, Math Program 1989;45:503) with strong-Wolfe line search; L2 10⁻³ and smooth-L1 10⁻⁴ penalties |
| Sign-constrained coefficients: w = sign · softplus(u) | monotonic/sign constraints as in constrained GLMs; softplus parametrisation standard | `Softmax.W()` with `--signed` | measured in the stage-lab brief (private until publication) |
| Class-balanced loss: weight_c ∝ 1/√freq_c | standard re-weighting (e.g. Cui et al., CVPR 2019 for the general form) | `seqnet.py`; `litstack.py --bridge` | pinned form |
| Knowledge distillation: loss = λ·CE(labels) + (1 − λ)·T²·KL(teacher ‖ student), T = 2, λ = 0.5 | Hinton, Vinyals & Dean, arXiv:1503.02531 (2015); Ba & Caruana, NeurIPS 2014 | `--distill` | measured in the stage-lab brief (private until publication) |
| Gradient-boosted decision trees (histogram, NaN-aware, softmax loss) | Friedman, Ann Stat 2001;29:1189, doi:10.1214/aos/1013203451; Ke et al., NeurIPS 2017 (histogram/LightGBM form) | `fitGBDT` (`stage-lab-core.mjs`) | lr 0.1, 200 rounds, 31 leaves, min 200 rows/leaf (pinned, stated) |
| Sequence network: dilated residual temporal convolutions + bidirectional GRU, AdamW, one-cycle LR | Bai, Kolter & Koltun, arXiv:1803.01271 (TCN); Cho et al., EMNLP 2014 (GRU); Loshchilov & Hutter, ICLR 2019 (AdamW); Smith & Topin, 2019 (one-cycle) | `seqnet.py` | the control; never shipped |
| Cohen's κ with night-level bootstrap CI; half-night-shift plant (must collapse κ) | Cohen, Educ Psychol Meas 1960;20:37, doi:10.1177/001316446002000104; Efron, Ann Stat 1979;7:1 | `kappa`, `bootstrapKappa`, P1 plant | every verdict |

## 5 · Benchmarks the bands are set against

| result | citation | used for |
|---|---|---|
| Human inter-scorer agreement on ISRUC (scorer 1 vs 2; the value is measured in the stage-lab brief, private until publication) | ISRUC-Sleep: Khalighi et al., Comput Methods Programs Biomed 2016;124:180, doi:10.1016/j.cmpb.2015.10.013 | the "half as good as human" gate (half of the measured inter-scorer κ) |
| PR + SpO₂ only, 17 303 PSGs, κ 0.73–0.78 four-class | Vaquerizo-Villar et al. 2025 (above) | the ceiling for OxyDex's two signals; justifies MESA/MrOS/CFS requests |
| IHR only, whole-night CNN, κ 0.66 on SHHS/MESA | Sridhar et al. 2020 (above) | the sequence-model route (v14) |
| Respiration-rate variability drives REM/wake on MESA | Krauss et al., Sleep 2025;48(9):zsaf091, doi:10.1093/sleep/zsaf091 | the 0.18–0.40 Hz PR band as a respiration proxy |
| Published oximeter-only staging figures of a proprietary model (κ 0.367 live / 0.390 offline) | SomnoStage v4.2.3-dev, published figures only (LICENSE-MODEL §3g: its model and outputs are never used) | comparator, with credit |

## 6 · Formulas considered and rejected by measurement

| formula | why rejected |
|---|---|
| Single ultradian wave on raw SpO₂ features (v15) | measured in the stage-lab brief (private until publication) |
| Explicit-duration HSMM with a time-of-night prior (v13) | measured in the stage-lab brief (private until publication) |
| Distillation into a closed-form student (v15, v19) | measured in the stage-lab brief (private until publication) |
| A third auto-context round (v15c) | measured in the stage-lab brief (private until publication) |

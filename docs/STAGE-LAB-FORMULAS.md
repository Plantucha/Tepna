<!--
  STAGE-LAB-FORMULAS.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** REFERENCE (living — every published formula the stage lab uses, with its citation, where it enters, how its constants are obtained, and what it measured) · **last-verified:** 2026-10-30 · **Parent:** `briefs/STAGE-LAB-2026-09-27-BRIEF.md`

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

**Audit of 2026-10-30 (lab brief §52.2).** Every citation key in the formula was resolved to its paper and the implementation
compared with the source's definition. The rule applied from here on: a term is named by what it computes, and a source is
cited only for what it defines — "after X" marks a term inspired by X that does not implement X's method. Earlier versions of
this page over-claimed fidelity for the Cole–Kripke window, the Sadeh statistics, the two-process time terms, the pulse-rate
"SDNN/RMSSD proxies" and the cardiopulmonary-coupling term; those rows are corrected below. No measured κ changed; the names
and attributions did.

| formula / quantity | citation | where | how | what it measured |
|---|---|---|---|---|
| SpO₂ variability over 1 min and 10 min windows (SD); roughness (mean absolute successive difference over 1 min); 90–10 percentile range; slope; lag-1 autocorrelation | project terms (stage-lab formula v8, 2026-09-27; the lab brief stays private until publication). Physiology: irregular breathing raises short-window SpO₂ variance in REM and wake | `FORMULA_TERMS` (`stage-lab-core.mjs`), `TERMS` (`litstack.py`) | fitted coefficients (softmax), one per term and stage; signs checked against physiology (§5, §18) | measured in the stage-lab brief (private until publication) |
| Desaturation events: count per 10 min, fraction of time inside events, maximum depth, mean duration, recovery slope, pulse-response latency | the ≥ 3 % criterion: Berry RB et al., J Clin Sleep Med 2012;8:597, doi:10.5664/jcsm.2172 (AASM 2012 respiratory rules). The detector itself is a project definition — implementations differ materially (Terrill PI, Respirology 2020;25:475, doi:10.1111/resp.13635). The earlier term counted any ≥ 3 % fall from a 10-min running maximum with no baseline, duration or recovery rule and was **not** an ODI; the `desat` block (2026-10-30) adopts OxyDex's one ceiling-baseline detector (p90 ceiling over 5 min, entry ≥ 3 % below it, re-rise close, ≥ 10 s measured) so lab and product count the same events | `desat` block (`stage-lab-core.mjs`); the old `spo2.desat3.*` columns stay in earlier caches | fitted | the old term: part of the 8-term formula; the new: v52 |
| SpO₂ band power 0.02–0.05 Hz (cyclic desaturation) | Vaquerizo-Villar F et al., Eng Appl Artif Intell 2025;162:112562, doi:10.1016/j.engappai.2025.112562 — their SpO₂ band 2 (0.020–0.050 Hz): **faithful** | `spo2.lnpow.02-.05Hz` | fitted | |
| Pulse-rate statistics on the 1 Hz device pulse rate: mean (1, 5 min), SD (1, 5 min), mean absolute successive difference (1 min), 90–10 range, trend | Vaquerizo-Villar et al. 2025 name the mean, SD and RMSSD of the standardised 1 Hz PR as the network's key features: **faithful to that**. They are *not* HRV: SDNN and RMSSD are beat-interval quantities (Task Force of the ESC and NASPE, Circulation 1996;93:1043, doi:10.1161/01.CIR.93.5.1043); Redmond & Heneghan (IEEE TBME 2006;53:485, doi:10.1109/TBME.2005.869773) used RR-interval features — cited as "after" | pulse block | fitted | measured in the stage-lab brief (private until publication) |
| PR band powers: 0.004–0.020, 0.020–0.100 and 0.180–0.400 Hz over 10 min | Vaquerizo-Villar et al. 2025, their PR bands BW PR-1/2/3: **faithful** (`pulsebw` block, 2026-10-30; the 0.02–0.10 Hz band was missing before). The earlier 0.01–0.04 and 0.04–0.15 Hz terms are the HRV LF band applied to a 1 Hz pulse rate — project bands, no longer attributed to the paper; the band conventions themselves: Task Force 1996 (above) | pulse / `pulsebw` blocks | fitted | measured in the stage-lab brief (private until publication) |
| Activity level (mean over 1 min), still-run length, SD over 10 min, fraction of moving epochs over 5 and 10 min, seconds since last movement | **after** Cole RJ, Kripke DF et al., Sleep 1992;15:461, doi:10.1093/sleep/15.5.461 and Sadeh A et al., Sleep 1994;17:201, doi:10.1093/sleep/17.3.201 — both score sleep/wake from 1-min wrist *counts* (Cole: a weighted window A₋₄…A₊₂ with D < 1 = sleep; Sadeh: PS = 7.601 − 0.065·MW5 − 1.08·NAT − 0.056·SD6 − 0.703·ln(act+1)); the lab's terms are analogues of their inputs (activity level; SD6 → SD over 10 min; NAT → moving fractions), not either algorithm | motion block (`motion.*`, `mbit.*`) | fitted | |
| ~~Cole–Kripke weighted window~~ | **retired 2026-10-30.** The term applied Cole's one-minute weights (10⁻⁵ · 404, 598, 326, 441, 1408, 508, 350) to 30-s epochs of per-night z-scored motion ×100 — half the window and not counts, so not Cole–Kripke | `litstack.py` (`CK_W`), off for the oximeter line since v43 | — | measured in the stage-lab brief (private until publication) |
| ECG line (feature set `ecg2r`): mean NN over 1 and 5 min | Trinder J et al., J Sleep Res 2001;10:253, doi:10.1046/j.1365-2869.2001.00263.x (HR falls across NREM, REM ≈ wake): **faithful** | `ecg-hrv` block | fitted | |
| SDNN (5 min), ln RMSSD (1 min), ln HF, ln LF/HF (5 min) | definitions: Task Force 1996 (above; 5-min short-term standard, LF 0.04–0.15, HF 0.15–0.40 Hz); stage effects: Bonnet MH, Arand DL, Electroencephalogr Clin Neurophysiol 1997;102:390, doi:10.1016/s0921-884x(96)96070-1 (5-min spectral HRV, HF ↑ / LF ↓ across NREM): **faithful**; the 1-min RMSSD is ultra-short-term and is named so | `ecg-hrv` block | fitted | |
| ~~ln VLF over 5 min~~ | **retired 2026-10-30**: VLF (≤ 0.04 Hz) from a 5-min window holds about one cycle; the Task Force does not recommend it from short recordings | `ecg-hrv` block (column stays in the cache, unused) | — | |
| DFA α1 over 5 min | **after** Penzel T et al., IEEE TBME 2003;50:1143, doi:10.1109/TBME.2003.817636 (scaling computed on sleep-stage segments, not 5-min windows); exploratory | `ecg-hrv` block | fitted | |
| NN–EDR coherence 0.1–0.4 Hz over 5 min (renamed from "cpc") | **after** Thomas RJ et al., Sleep 2005;28:1151, doi:10.1093/sleep/28.9.1151. The faithful quantity — coherence × cross-power on 2 Hz NN and EDR, 1024-sample windows advanced 256, LFC 0.01–0.1 vs HFC 0.1–0.4 Hz, log(HFC/LFC) — is the `cpc` block (2026-10-30), the same definition ECGDex ships | `ecg-hrv` (`nn_edr_coh_hf5`), `cpc` | fitted | |
| Heart-rate surge against the previous 60 s (≥ 10 bpm) and surge fraction | phenomenon: Sforza E et al., Clin Neurophysiol 2000;111:1611, doi:10.1016/s1388-2457(00)00363-1 (tachycardia then bradycardia at arousal); Bonnet & Arand 1997 (HR rises ≥ 10 beats before an EEG arousal). The detector (60-s median baseline, 3-beat mean, ≥ 10 bpm) is the lab's | `ecg-delta` block | fitted | |
| Respiratory rate over 5 min | Douglas NJ et al., Thorax 1982;37:840, doi:10.1136/thx.37.11.840 (rate rises and tidal volume falls in sleep, ventilation lowest in REM): **faithful** | `resp` block | fitted | |
| Breath-interval and amplitude irregularity (CV over 5 min) | the phenomenon: Rostig S et al., Sleep 2005;28:411, doi:10.1093/sleep/28.4.411 (non-random breath-to-breath variability in REM); Gutierrez G et al., Physiol Rep 2016;4:e12949, doi:10.14814/phy2.12949 (respiratory-rate variability lowest in N3); Cabiddu R et al., Front Physiol 2012;3:45, doi:10.3389/fphys.2012.00045 (regularity highest in deep sleep). Douglas 1982 reports means, not variability, and is no longer cited for these | `resp` block | fitted | |
| ~~Posture turns per 10 min, time since last turn~~ | **retired 2026-10-30**: De Koninck J et al., Sleep 1992;15:143, doi:10.1093/sleep/15.2.143 describe position shifts per hour by age, not stage markers; the lab's posture read did not keep posture (R1 − R2 = +0.0009) | `posture` block | — | measured in the stage-lab brief (private until publication) |
| Signal quality per epoch: finite, implausible and stuck fractions for SpO₂ and pulse (30 s / 5 min), usable-beat fraction for ECG — raw, never night-standardised | published precedent: Ganglberger W et al., Sleep 2024;47:zsae202, doi:10.1093/sleep/zsae202 (a scorability model from biosignal quality and model confidence) | `sqi` block (2026-10-30) | inputs and coverage reports | v52 |
| Context: each term also at ±2, ±10, ±30 epochs (means) and a 30-epoch contrast | multi-resolution context, as in Fonseca et al. 2017 (windows of several minutes around the epoch) | `withContext` | pinned windows, fitted weights | |

## 3 · Time-of-night and sequence formulas

| formula | citation | where | how | what it measured |
|---|---|---|---|---|
| Time-in-bed bases: e^{−t/1.5 h}, e^{−t/0.25 h} and linear t from recording start (renamed 2026-10-30 from "two-process") | **after** Borbély AA, Hum Neurobiol 1982;1:195 and Daan S, Beersma DG, Borbély AA, Am J Physiol 1984;246:R161, doi:10.1152/ajpregu.1984.246.2.R161 — the two-process model's S is sleep pressure with time constants fitted to EEG slow-wave decay and C a circadian phase; these are recording-time bases, and the lab found recording start to be a protocol variable (brief §46) | `litstack.py` basis (`tib_*`) | fitted | measured in the stage-lab brief (private until publication) |
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
| Published oximeter-only staging figures of a proprietary model (κ 0.367 live / 0.390 offline) | a proprietary oximeter-only stager, published figures only (LICENSE-MODEL §3g: its model and outputs are never used) | comparator, with credit |
| PSG finger PPG, raw waveform, 2 374 patients: κ 0.75 held-out, 0.74 on an external database after transfer | Kotzen K, Charlton PH, et al., IEEE J Biomed Health Inform 2023;27:924, doi:10.1109/JBHI.2022.3225363 | the PPG ceiling — finger, not wrist |
| Multi-source domain training for out-of-distribution PPG staging (up to +21 % κ) | Attia S, et al., Physiol Meas 2025;46:125001, doi:10.1088/1361-6579/ae1a34 | the published alternative to the lab's group-DRO switch (§50) |
| Finger-oximeter PPG, 894 suspected-OSA patients: κ 0.65 / 0.54 / 0.51 for 3 / 4 / 5 stages; TST bias 7.5 min | Korkalainen H, et al., Sleep 2020;43:zsaa098, doi:10.1093/sleep/zsaa098 | why endpoints beside κ are reported (§52.4) |
| Wrist PPG with ECG-to-PPG transfer: κ 0.65 ± 0.11 (60 healthy participants, 101 recordings); 0.57 without | Radha M, et al., npj Digit Med 2021;4:135, doi:10.1038/s41746-021-00510-8 | the wrist-line benchmark (§45, §48); healthy sample |
| Chest strap and optical wearable on 136 poor sleepers: κ 0.79 ECG · 0.76 H10 · 0.75 Verity | Topalidis PI, et al., Sensors 2023;23:9077, doi:10.3390/s23229077 | the H10 line |
| Chest accelerometer, 323 participants, two centres: κ 0.68 | Schipper F, et al., Sensors 2024;24:5717, doi:10.3390/s24175717 | the ACC-breathing arm |
| ECG + abdominal effort, 8 682 PSGs: κ 0.585 five-class, 0.760 three-class | Sun H, et al., Sleep 2020;43:zsz306, doi:10.1093/sleep/zsz306 | the ECG + effort arm |
| A scorability model (biosignal quality + model confidence) predicts model–expert agreement, R² 0.42 | Ganglberger W, et al., Sleep 2024;47:zsae202, doi:10.1093/sleep/zsae202 | the `sqi` block and the coverage-conditional reporting (§52.3) |
| Human ceilings: 82.6 % inter-scorer agreement over 2 500 scorers (N3 67.4 %, N1 63.0 %); κ 0.76 AASM / 0.68 R&K between experts | Rosenberg RS, Van Hout S, J Clin Sleep Med 2013;9:81, doi:10.5664/jcsm.2350; Danker-Hopfe H, et al., J Sleep Res 2009;18:74, doi:10.1111/j.1365-2869.2008.00700.x | what any machine κ is read against; why R&K and AASM cohorts are reported separately |
| Leakage taxonomy (eight types; 294 papers in 17 fields) | Kapoor S, Narayanan A, Patterns 2023;4:100804, doi:10.1016/j.patter.2023.100804 | the three cohort tiers (development / consulted / locked) of brief §52.6 |


**Data acknowledgement.** Where an SHHS number is named on this page or in the lab's briefs: the Sleep Heart Health Study data were obtained through the National Sleep Research Resource (NSRR) under its data access and use agreement; cite the SHHS references listed on its NSRR page, and carry the line **NSRR R24 HL114473: NHLBI National Sleep Research Resource**. Results of the analysis may be published; no part or excerpt of the data appears anywhere.

- Quan SF, Howard BV, Iber C, et al. The Sleep Heart Health Study: design, rationale, and methods.
  *Sleep.* 1997;20(12):1077–85. doi:10.1093/sleep/20.12.1077
- Zhang GQ, Cui L, Mueller R, et al. The National Sleep Research Resource: towards a sleep data
  commons. *J Am Med Inform Assoc.* 2018;25(10):1351–1358. doi:10.1093/jamia/ocy064

## 6 · Formulas considered and rejected by measurement

| formula | why rejected |
|---|---|
| Single ultradian wave on raw SpO₂ features (v15) | measured in the stage-lab brief (private until publication) |
| Explicit-duration HSMM with a time-of-night prior (v13) | measured in the stage-lab brief (private until publication) |
| Distillation into a closed-form student (v15, v19) | measured in the stage-lab brief (private until publication) |
| A third auto-context round (v15c) | measured in the stage-lab brief (private until publication) |
| ln VLF from a 5-min window (ECG line) | retired 2026-10-30: about one cycle per window; not recommended from short recordings (Task Force 1996) |
| Cole–Kripke weights on 30-s z-scored motion (`ck`) | retired 2026-10-30: not the algorithm (1-min counts, D < 1); off for the oximeter line since v43 |
| Posture turns and time since turn | not kept: the posture read gave R1 − R2 = +0.0009 (lab brief §46 read 1) |
| Distillation of the formula from the net (v46, all four lines) | lost on every line (Δ −0.0003 to −0.0038 against the +0.01 margin) |
| Wake-crop augmentation (v46) | below its pre-stated blind rule (+0.02): ECG net +0.009 on DREAMT with a CI including 0; wrist net −0.006 on the pool |

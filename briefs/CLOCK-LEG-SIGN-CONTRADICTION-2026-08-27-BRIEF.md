<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** PROPOSED · **Created:** 2026-08-27 · **Follows:** `CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md` §PAT-box · `WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md` §7.3

# The two clock methods disagree about DIRECTION on the night both are best measured

## The observation

Evaluating the host-leg closure over the box corpus (2026-08-27), **2026-08-13** produced a
contradiction rather than an imprecision:

| quantity | value |
|---|---|
| H10 vs host (legs A) | **−20.1 ppm**, 2 fragments, range **0.3** |
| Verity vs host (leg B) | **−26.6 ppm**, 3 fragments, range **0.4** |
| ⇒ predicted H10↔Verity | **+6.5 ppm** (Verity faster) |
| leg C, measured on device axes, 28 blocks | **−14.6 ppm** (Verity **slower**) |
| closure residual | **−21.1 ppm** against a 2σ band of **0.71** |

**The two methods disagree about the SIGN**, on the night with the most consistent host legs in the
entire corpus (ranges 0.3 and 0.4 ppm — the tightest of the seven bandable nights) and with 28 blocks
behind leg C. This is not noise: something is systematically wrong in one of the two methods, and
finding **which** is the prize.

## Why it cannot be dismissed

- **It is not the estimator.** `beat-leg-closure --selftest` recovers planted rates to **±0.0 ppm**
  across −40…+40 ppm under realistic HRV (CV 0.052), 2 % dropouts/side and ±20 ms PAT jitter, 7/7.
- **It is not a thin sample.** 28 blocks, 15,687 H10 beats, 15,295 Verity beats.
- **It is not a noisy night.** It has the *cleanest* legs measured; that is what makes the band 0.71 ppm
  and the contradiction unmissable.
- **It is not the drawn corner.** The O2Ring is not in this geometry at all — the ⛔ VOID in
  `CROSS-DEVICE-DRIFT-AND-CLOSURE` applies to the ring, and both legs here are Polar devices against a
  real host clock (0.008 ppm box).

## Candidate explanations, none yet tested

1. **Unwrap / aliasing in leg C.** `CROSS-DEVICE-DRIFT-AND-CLOSURE` §2.3 records that a missing
   whole-RR unwrap turned closure residuals into nonsense (*"754 ppm is not a crystal, it is a broken
   unwrap"*). A sign inversion is exactly what one wrong multiple produces. **Check first.**
2. **Fragment mismatch.** Legs A/B are a **median over fragments**; leg C is the **largest** ECG × the
   **largest** Verity file (the pre-stated rule). If those describe different parts of the night, the
   two are not measuring the same interval — a systematic, direction-capable error.
3. **A genuine device event** — a re-sync, a reconnect, a temperature excursion — that changed one
   device's rate mid-night, so a median leg and a block-wise leg legitimately disagree.
4. **Sign convention.** `dual-clock-rate` reports `(slope − 1)` and is NEGATIVE when the device runs
   fast; `beat-leg-closure`'s header warns both conventions were *"initially assumed wrong"*. The
   prediction reproduced on other nights (07-20 residual −1.8), which argues against a global sign
   error but not against a per-path one.

## Findings, 2026-08-27 — hypotheses 1 and 2 are REFUTED and the contradiction SURVIVES at 3.9σ

Three of the four Done-when items are answered. The headline: **the disagreement is real.** It is not the
unwrap, not a fragment mismatch, and not an artifact of leg C's uncertainty once that uncertainty is
measured properly — which nobody had done, because the tool reports a bare ppm with no error bar.

### 1 · The unwrap is SOUND — hypothesis 1 refuted (Done-when 1 & 3)

`legC` chooses a whole-RR wrap **once**, at block 0, then TRACKS (`ref = l`) block to block, so a
mid-night slip is the only way a sign can invert. The tracked series on 2026-08-13 shows none:

| quantity | value |
|---|---|
| blocks | 28 over 270 min |
| total lag change | **−204.2 ms = −0.187 RR** (rr = 1.0920 s) |
| largest single-block step | **0.29 RR** — below the ½-RR ambiguity threshold |
| end-to-end implied rate | **−12.6 ppm** |
| median-of-pairs (what the tool reports) | **−14.6 ppm** |

No step approaches a whole RR, and the two independent slope routes agree. The unwrap is not the cause.

### 2 · Not a fragment mismatch — hypothesis 2 refuted (Done-when 2)

The host legs were medians over all fragments while leg C used one file per device, so the two could have
described different intervals. They do not. The **exact files leg C used** —
`…20260813231740_ECG` and `…20260813231725_PPG`, starting 15 s apart and spanning 285.5 / 285.9 min —
give **H10 −20.1** and **Verity −26.4 ppm** vs host, i.e. a fragment-matched prediction of **+6.3 ppm**
against the median-based **+6.5**. The interval is the same one leg C measured.

### 3 · Leg C carries an unreported uncertainty, and it is AUTOCORRELATED

`beat-leg-closure` prints a bare ppm. Fitting the tracked series gives one:

| night | blocks | OLS ppm | scatter | SE(OLS) | ρ₁ | n_eff | **SE corrected** |
|---|---|---|---|---|---|---|---|
| 2026-07-20 | 36 | +7.7 | 7 ms | 0.20 | 0.706 | 6.2 | **0.47** |
| 2026-08-09 | 40 | +13.3 | 47 ms | 1.08 | 0.704 | 6.9 | **2.60** |
| 2026-08-13 | 28 | −13.5 | 93 ms | 3.61 | 0.318 | 14.5 | **5.02** |

The residuals **wander rather than scatter** — ρ₁ ≈ 0.7 on two of three nights — so the effective sample
size collapses (36 → 6.2) and a naive OLS SE understates the truth by up to **2.4×**. ⚠️ **Anyone quoting
leg C's ppm should quote an autocorrelation-corrected CI with it**; the block count is not the sample size.

### 4 · The contradiction survives, at ~4σ

Comparing with **both** sides' uncertainties, `σ_tot = √(σ_H10² + σ_Verity² + SE_C²)`:

| night | legC | predicted | diff | σ_tot | |
|---|---|---|---|---|---|
| 2026-07-20 | +7.7 | +9.4 | −1.7 | 6.26 | 0.27σ — consistent |
| 2026-08-09 | +13.3 | +6.5 | +6.8 | 3.33 | 2.04σ — marginal |
| **2026-08-13** | **−13.5** | **+6.3** | **−19.8** | **5.03** | **3.94σ — real** |

**So the sign disagreement is not an uncertainty artifact.** 2026-08-13's leg C 95% CI is
[−20.6, −6.4] ppm on the raw OLS SE and roughly [−23, −4] once inflated; the prediction **+6.3** lies far
outside either. The two methods genuinely disagree about direction.

### 5 · A correction owed to the PAT box, which does NOT change its verdicts

`CROSS-DEVICE-DRIFT-AND-CLOSURE` §PAT band used `σ_pred = √(σ_H10² + σ_Verity²)` — **leg C's own
uncertainty was implicitly zero**, justified by the ±0.0 ppm planted-recovery selftest. That selftest
measures estimator *bias* on synthetic data; it says nothing about the variance real block-to-block lag
wander induces. Folding SE_C in widens the bands (e.g. 08-09: 4.16 → 4.69; 08-13: 0.71 → 7.26) and
**changes no verdict** — PASS 3 / FAIL 2 stands, and the band↔verdict separation remains perfect
(passes 11.6–21.1, fails 4.7–7.3). Recorded because a correction that does not change the answer still
has to be reported.

### What remains

Hypotheses **3** (a genuine mid-night device event) and **4** (a per-path sign convention) are the
survivors, and both are now narrower: there is no step in the tracked series to support (3), and (4) must
explain why the same code path agrees to 0.27σ on 07-20 and disagrees by 3.94σ on 08-13. **The
disagreement is night-specific, not systematic** — which is the sharpest constraint any explanation now
has to satisfy.

## Done when

- [x] Leg C recomputed on 2026-08-13 with the unwrap explicitly verified, and the result stated either way. **Unwrap SOUND — hypothesis 1 refuted (§1).**
- [x] Legs A/B recomputed over the **same time interval** leg C used, not the night median — testing (2). **Fragment-matched prediction +6.3 vs median +6.5 — hypothesis 2 refuted (§2).**
- [x] Per-block leg C plotted/tabulated across the night to see whether the rate is stable or steps — testing (3). **No step; residuals wander with ρ₁=0.32 (§1, §3).**
- [ ] A statement of **which method is wrong on this night**, or an explicit "both are self-consistent and
      the disagreement is unexplained", which is itself a publishable negative.

## Why it matters beyond one night

The host-leg closure is the only non-void closure over the H10↔Verity↔host geometry, and it is what
`CROSS-DEVICE-DRIFT-AND-CLOSURE`'s PAT box now waits on. If leg C can invert on a clean night, no PAT
gate built on it is trustworthy until this is explained — and if instead the *host legs* are wrong, that
propagates to every drift figure derived from `dual-clock-rate`.

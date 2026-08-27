<!-- SPDX: Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0 -->
**Status:** DONE — 2026-08-27 · **Created:** 2026-08-27 · **Follows:** `CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md` §PAT-box · `WEARABLE-DRIFT-DIRECT-2026-08-02-BRIEF.md` §7.3

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

### 6 · A SECOND fragment pair on the same night reads +26.6 — leg C is not reproducible within a night

2026-08-13 carries a second matched pair: H10 `…203006` and Verity `…203037`, starting 31 s apart,
166.5 min each, host legs **−20.4** and **−26.8** ⇒ prediction **+6.4 ppm**. Leg C on that pair:

| pair | blocks | leg C | SE (corrected) | prediction | vs prediction |
|---|---|---|---|---|---|
| early `2030xx` | 16 | **+26.6** | 14.41 | +6.4 | 1.4σ — consistent |
| late `2317xx` | 28 | **−13.5** | 5.02 | +6.3 | 3.94σ — inconsistent |

**The two leg-C estimates differ from each other by 40.1 ppm — 2.6σ apart — on the same night, the same
two devices, hours apart.** They cannot both describe one pair of crystals. So "the two methods
contradict" is too kind to leg C: **leg C contradicts itself within a night**, while the host legs are
stable across the same two windows (H10 −20.1 / −20.4, Verity −26.4 / −26.8). Of the two methods, the
one that reproduces is the one that was being doubted.

### 7 · 🔑 New hypothesis 5, now the leading one: leg C fits a slope through the SAWTOOTH

The repo already characterised this signal. `PAT-SAWTOOTH-ANSWERS-THE-130MS-2026-08-10-BRIEF` (#1131)
established that the ECG↔PPG offset is a **sawtooth of peak-to-peak ≈ one RR** — 821–1162 ms, median
1064 — which **ramps for tens of minutes and wraps**. Leg C's observable is exactly that offset, and its
method is a least-squares slope through it.

**A slope through part of a ramping, wrapping sawtooth measures which portion of the ramp the fragment
happened to cover, not a crystal.** That predicts, with no new parameter:

- **fragment-dependence within a night** — observed, +26.6 vs −13.5;
- **residual scatter of order 100 ms, wandering rather than white** — observed, 93 ms with ρ₁ 0.32;
- **occasional sign inversion** — observed;
- **quiet nights looking clean** — observed, 2026-07-20 has 7 ms scatter and agrees to 0.27σ.

⚠️ **This subsumes the original "sign flip" as a symptom rather than a finding**, and demotes hypotheses
3 and 4: no mid-night device event is required, and no sign convention is wrong. It also means **§3's
AR(1) correction is still not enough** — a sawtooth is not AR(1) noise, so even the inflated SE
understates the uncertainty on a fitted slope, which is why a 3.94σ "contradiction" can sit beside a
40 ppm within-night swing without either being a mistake.

**Test that would settle it:** tabulate the raw (pre-unwrap) lag against time for both fragments and look
for the ramp-and-wrap directly, then check whether leg C's fitted slope tracks the fraction of a sawtooth
period each fragment spans.

🔴 **If it does, the consequence is much larger than one odd night: leg C is not a clock measurement on
this corpus, and the host-leg closure cannot be gated on it at all.** That would retire the
`CROSS-DEVICE-DRIFT-AND-CLOSURE` §PAT gate in its current form rather than merely leaving it blocked —
and it would explain the band↔verdict anti-correlation recorded there without needing the anti-selection
argument, since leg C's true uncertainty would exceed every host-leg band.

### 8 · The §7 mechanism is REFUTED in source — but the conclusion survives in a stronger, simpler form

§7 proposed that leg C inherits the `fs`-rounding sawtooth (#1121: ECGDex derived `fs` from the lossy
`timestamp [ms]` column and rounded to 130 Hz, running the axis 46–126 ppm fast). **Checked in source,
and it does not:**

- `h10Beats` derives `f = (n−1) / ((ns[last] − ns[0]) / 1e9)` — from the **`sensor timestamp [ns]`
  column, unrounded** — and returns `ns[peakIndex]/1e9`, i.e. real device stamps, never `t0 + i/fs`.
- `verityBeats` reads the device column directly and carries an explicit comment that it must **not**
  use `rec.relSec`, which is host-disciplined.

So both legs are genuinely host-independent and the #1121 artifact is absent. My §7 mechanism was wrong.

**What is right is simpler and needs no named mechanism: the signal is smaller than the noise.**

| 2026-08-13 | |
|---|---|
| clock difference to be measured (6.3 ppm × 270 min) | **≈ 102 ms** |
| observed offset **wander** across the night | **≈ 450 ms** (1.98 → 2.43 s) |
| block-to-block scatter | **93 ms** |
| net change the slope is fitted to | −204 ms |

**Leg C fits a slope through an observable whose wander is ~4× the quantity being measured.** The slope
therefore reports the wander. That is why 2026-07-20 — 7 ms scatter — agrees with its prediction to
**0.27σ** using the identical code, and why two fragments of 08-13 disagree by 40 ppm.

It also dissolves the apparent paradox in §3–§4: a "3.94σ contradiction" and a 40 ppm within-night swing
can coexist because the reported uncertainty is optimistic even after the AR(1) inflation — **wander is
not AR(1) noise**, so no fixed-order correction recovers the true error bar.

⚠️ **What causes the wander is NOT established.** PAT — the R-peak→pulse-foot delay leg C's observable
literally contains — moves with blood pressure, vascular tone and posture, and an evening fragment
(20:30, awake) versus a sleeping one (23:17) fits a 40 ppm difference. **But a −320 ms PAT excursion
would exceed typical whole-PAT magnitude**, so PAT probably does not account for all of it; beat-pairing
and foot-detection jitter remain live. Do not write PAT down as the cause. See
`PAT-SAWTOOTH-ANSWERS-THE-130MS` for how badly PAT statistics have misled here before.

### 9 · The actionable consequence

**`beat-leg-closure` reports a bare ppm with no uncertainty, and on this corpus that number is not a
clock measurement.** Two things follow:

1. **Never quote a leg-C ppm without the night's offset scatter beside it** — the block count is not the
   sample size, and a clean-looking figure from a noisy night is the failure mode.
2. **The `CROSS-DEVICE-DRIFT-AND-CLOSURE` §PAT gate cannot be repaired by widening bands.** It compares a
   stable quantity (host legs, reproducing to 0.3 ppm across fragments) against one whose per-night error
   is tens of ppm and unreported. The honest fix is for leg C to publish an uncertainty and refuse where
   the offset wander exceeds the clock signal — i.e. the `hostAxis` refusal discipline applied to itself.

### What remains

**Hypothesis 5 (§7) now leads and would subsume the rest.** Hypotheses **3** (a mid-night device event)
and **4** (a per-path sign convention) survive only weakly, and both are now narrower: there is no step in the tracked series to support (3), and (4) must
explain why the same code path agrees to 0.27σ on 07-20 and disagrees by 3.94σ on 08-13. **The
disagreement is night-specific, not systematic** — which is the sharpest constraint any explanation now
has to satisfy.

## 10 · The answer: leg C is the method that fails, and it fails by SNR, not by defect

**Which method is wrong on 2026-08-13: leg C.** Not because it contains a bug — the unwrap is sound (§1),
the fragments are matched (§2), the axes are genuinely device-side and the `fs` derivation is correct
(§8). It fails because **it cannot measure the quantity asked of it on that night**:

| | host legs | leg C |
|---|---|---|
| reproducibility across the night's two fragments | **−20.1 / −20.4** and **−26.4 / −26.8** ppm | **+26.6 / −13.5** ppm |
| spread | **0.3 / 0.4 ppm** | **40.1 ppm** |
| signal vs its own noise | residual 392 / 402 ms over 285 min | signal ≈102 ms vs wander ≈450 ms |

One method reproduces to a few tenths of a ppm across the same two windows; the other swings 40 ppm. The
disagreement was never symmetric, and framing it as "the two methods contradict" gave leg C a standing
its own reproducibility does not support.

**This is a publishable negative in the stronger sense:** the failure is characterised, not merely
observed. Leg C's observable is the ECG↔PPG-foot offset, whose night-dependent wander exceeds the clock
difference it is meant to resolve — so its slope is a measurement of the wander. On a quiet night
(2026-07-20, 7 ms scatter) the same code agrees with the host legs to **0.27σ**, which is the control
that makes the diagnosis stick rather than a story about one bad night.

### Deferred, deliberately — two threads this brief does not close

1. **What the wander IS remains open.** PAT is the leading candidate and is *not* established; a −320 ms
   excursion would exceed typical whole-PAT magnitude, so beat-pairing and foot-detection jitter are
   live. Recorded as open rather than asserted, because PAT statistics have misled here before.
2. **Leg C should publish an uncertainty and refuse when wander exceeds signal** — the `hostAxis`
   ≥3-anchor refusal discipline applied to itself. Today it prints a bare ppm, which is what let a
   40 ppm-unstable quantity be used as a gate input in the first place. That is a code change and
   belongs to whoever next touches `tools/beat-leg-closure.mjs`.

**Consequence already recorded upstream:** `CROSS-DEVICE-DRIFT-AND-CLOSURE` §PAT stays BLOCKED, and its
band↔verdict anti-correlation now has a direct explanation — leg C's true per-night error is tens of ppm,
so it exceeds every host-leg band and the passes were the nights whose bands happened to be widest.

## Done when

- [x] Leg C recomputed on 2026-08-13 with the unwrap explicitly verified, and the result stated either way. **Unwrap SOUND — hypothesis 1 refuted (§1).**
- [x] Legs A/B recomputed over the **same time interval** leg C used, not the night median — testing (2). **Fragment-matched prediction +6.3 vs median +6.5 — hypothesis 2 refuted (§2).**
- [x] Per-block leg C plotted/tabulated across the night to see whether the rate is stable or steps — testing (3). **No step; residuals wander with ρ₁=0.32 (§1, §3).**
- [x] A statement of **which method is wrong on this night**, or an explicit "both are self-consistent and
      the disagreement is unexplained", which is itself a publishable negative. **ANSWERED — see §10.**

## Why it matters beyond one night

The host-leg closure is the only non-void closure over the H10↔Verity↔host geometry, and it is what
`CROSS-DEVICE-DRIFT-AND-CLOSURE`'s PAT box now waits on. If leg C can invert on a clean night, no PAT
gate built on it is trustworthy until this is explained — and if instead the *host legs* are wrong, that
propagates to every drift figure derived from `dual-clock-rate`.

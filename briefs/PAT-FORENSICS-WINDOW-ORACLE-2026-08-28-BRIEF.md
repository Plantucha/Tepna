<!--
  PAT-FORENSICS-WINDOW-ORACLE-2026-08-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS · **Created:** 2026-08-28 · **Parent:** `PAT-ROOT-CAUSE-FORENSICS-2026-08-27-BRIEF.md` (§11/§13 oracle) · **Interlocks:** `PAT-FORENSICS-WINDOW-REGIMES-2026-08-28-BRIEF.md`

# There IS signal under the window — the acceptance window is mis-specified, not merely wide

> **In one line:** an **out-of-sample** per-night window (mode estimated on the first half, scored on
> the second) beats the shipped `[200, 650]` window by a **median 30.5 ms** of SD, recovers a
> null-beating improvement on **8 of 20 scored nights**, and puts **2 nights under 20 ms**. Four
> nights have their lag mode **outside** `[200, 650]` entirely.

## 1 · The design, and the circularity it exists to avoid

The tempting experiment — find each night's lag mode, wrap a narrow window round it, report the SD —
is **rigged**: fitting a window to the data's own mode guarantees a smaller number whether or not any
signal exists, and would "recover" a lag from pure noise.

So the window is chosen **out of sample**: the mode is estimated on the night's **first half** and
applied untouched to the **second**. No beat that positioned the window contributes to the statistic
scoring it. Two controls, both required:

- **full-window arm** on the *same* second half — the status quo, compared within-night;
- **circular-shift null** — the foot train rotated, receiving the identical procedure including its
  own out-of-sample mode estimate. A night counts only if it beats its own null.

⚠️ **The shift null relies on beat-interval irregularity, and the selftest found this the hard way.**
Against a *perfectly periodic* train a rotation is not a null: with RR = 900 ms and a 37000 ms shift,
37000 mod 900 = 100, so every foot lands a constant 100 ms from its R and the "destroyed"
correspondence is perfectly intact. The first selftest planted a metronome and **the null beat the
real arm**. Real HRV supplies the irregularity; the assumption is load-bearing and is now stated, with
the selftest planting an irregular train on purpose. `--selftest` 8/8, including the control that
matters: **pure noise must not read as recovered**.

## 2 · Result — 20 scored nights

| night | mode | narrow SD | full SD | null SD | margin (null−narrow) | full−narrow |
|---|---|---|---|---|---|---|
| 2026-07-24 | 405 | **15.3** | 39.2 | 59.5 | **44.2** | 23.9 |
| 2026-08-17 | 215 | **17.9** | 77.1 | 57.8 | **39.9** | 59.2 |
| 2026-07-18 | 295 | 27.9 | 31.7 | 57.8 | 29.9 | 3.8 |
| 2026-08-13 | 335 | 37.1 | 42.8 | 58.1 | 21.0 | 5.7 |
| 2026-07-28 | 395 | 37.2 | 47.8 | 56.7 | 19.5 | 10.6 |
| 2026-08-02 | 185 | 38.2 | 36.5 | 56.4 | 18.2 | −1.7 |
| 2026-07-20 | 355 | 42.3 | 51.1 | 57.2 | 14.9 | 8.8 |
| 2026-08-24 | 245 | 44.9 | 83.3 | 57.8 | 12.9 | 38.4 |

**8 STRONG** (margin ≥ 10 ms) · **7 MARGINAL** (0 < margin < 10) · **5 NONE** (margin ≤ 0).
Median `full − narrow` = **30.5 ms**, max **86.8 ms**, negative on only 2 of 20.

**Two nights clear the pre-stated ≤ 20 ms band**: 2026-07-24 at 15.3 ms and 2026-08-17 at 17.9 ms —
both beating their nulls by ~40 ms. On those nights a real, narrow R→foot lag exists and the shipped
window is throwing it away.

## 3 · 🔴 The marginal category is window-fill one level down

The 7 MARGINAL nights cluster at narrow SD **50–58 ms**, and a uniform distribution on a ±100 ms
window has SD **200/√12 = 57.7 ms**. They are not partially recovering signal — **they are filling the
new window exactly as they filled the old one.** The regimes brief's mechanism reproduces at the
smaller width, which is simultaneously a confirmation of that mechanism and the reason these nights
must not be counted as successes. Only the margin column separates them, which is why the band
required beating the null rather than merely landing under a threshold.

## 4 · The window is MIS-SPECIFIED, not merely wide

**Four of 20 scored nights place their lag mode outside `[200, 650]`:** 2026-08-01 at **165**,
2026-08-02 at **185**, 2026-08-06 at **25**, 2026-08-10 at **815**. A window that excludes the true
mode cannot admit the true lag at all; every beat it accepts on such a night is a wrong pairing. This
is direct evidence for the censoring mechanism `PAT-WINDOW-CENSORING` inferred and §8/§16 predicted,
now observed rather than argued.

## 5 · What this changes, and what it does not

- ✅ **Signal exists under the window** on a substantial minority of nights, and the estimator
  discards it. The failure is **recoverable in software** on those nights.
- ✅ **`[200, 650]` is mis-specified**, not merely generous — 20 % of scored nights have their mode
  outside it.
- ❌ **It does not reach the sensor floor.** The best recovered SD is 15.3 ms against a **~11 ms**
  measured floor, and most strong nights sit at 27–45 ms. Something beyond clock and fiducial is
  spending 20–40 ms, and this experiment does not name it.
- ❌ **It is not a recommendation.** §20 forbids optimising pass rate; a per-night adaptive window is
  a *hypothesis this supports*, not a change this brief proposes.

⚠️ **Attrition is severe and conditions everything above: 20 of 42 nights scored** — 15 excluded for
too few beats, 6 UNDEFINED (no beats in the narrow window), 1 unparsed. The excluded nights may
differ systematically, and nothing here establishes they do not.

⚠️ **±100 ms is a pre-stated choice, not an optimised one.** A different half-width would move the
MARGINAL/STRONG boundary — though not the strong nights, which sit well inside it. No sweep was run,
deliberately: sweeping the width against the outcome would re-introduce the circularity §1 exists to
prevent.

## 6 · §14 — the residual is a SLOW TREND, not respiration and not noise (and my own bands were too coarse)

The oracle left 20–40 ms unaccounted for against a ~11 ms sensor floor. §14 asks whether that
residual is **error** (unstructured) or **physiology** (structured). Measured on the out-of-sample
accepted lags of 8 nights, with a shuffle control:

| night | n | SD | ρ₁ | ρ₅ | ρ₂₀ | shuffled | zero-crossing | shape | ρ(RR,lag) |
|---|---|---|---|---|---|---|---|---|---|
| 2026-07-24 | 1476 | 15.3 | 0.943 | 0.816 | 0.545 | −0.001 | **none** | DRIFT-LIKE | +0.028 |
| 2026-07-28 | 3855 | 37.2 | 0.987 | 0.941 | 0.741 | 0.016 | **none** | DRIFT-LIKE | −0.086 |
| 2026-08-02 | 2167 | 38.2 | 0.985 | 0.963 | 0.908 | −0.034 | **none** | DRIFT-LIKE | −0.225 |
| 2026-08-13 | 6839 | 37.1 | 0.963 | 0.939 | 0.898 | 0.009 | **none** | DRIFT-LIKE | +0.462 |
| 2026-08-17 | 1622 | 17.9 | 0.754 | 0.587 | 0.504 | 0.005 | **none** | DRIFT-LIKE | +0.121 |
| 2026-08-24 | 5246 | 44.9 | 0.958 | 0.927 | 0.812 | 0.008 | **none** | DRIFT-LIKE | −0.008 |
| 2026-07-18 | 2415 | 27.9 | 0.981 | 0.929 | 0.710 | 0.022 | **none** | DRIFT-LIKE | +0.108 |
| 2026-07-20 | 7714 | 42.3 | 0.966 | 0.941 | 0.844 | 0.005 | **none** | DRIFT-LIKE | −0.343 |

**8 of 8 DRIFT-LIKE.** Shuffles collapse to ≈ 0 on every night, so the statistic is measuring temporal
order and nothing else.

**Two shapes eliminated:**
- **Not white noise** — ρ₁ ranges 0.75 – 0.99.
- **Not respiratory oscillation** — a 12-beat respiratory cycle gives ρ₁ = cos(2π/12) = **0.866** and
  crosses zero near a quarter period (~3 beats), rebounding negative. **No night crosses zero within
  40 beats**, and ρ₂₀ is still 0.50 – 0.91.
- **No coherent HR dependence** — ρ(RR,lag) scatters in sign across nights (+0.462 … −0.343). Real
  PAT–HR coupling would hold one sign.

### 🔴 But this does NOT settle error-vs-physiology, and my pre-stated bands assumed it would

The bands read *structured ⇒ physiological*. **That mapping is wrong**, and the shape result is what
exposed it. A slow monotone trend is produced by **both**:

- an **instrumental** drift — an uncorrected inter-device clock, a warming sensor; **error**; and
- a **slow physiological** trend — blood-pressure drift across the night, posture, sleep-stage
  transitions, vasomotor tone; **signal**.

Both are "structured", both are drift-shaped, and they mean opposite things for the budget. So the
honest verdict is narrower than either of the two the bands offered: **the residual is a slow trend
of unidentified origin.** Recording it as "physiology" would have been the inversion §14 exists to
prevent; recording it as "clock" would be the same error facing the other way.

**What would discriminate, named for the next pass:** a clock drift moves the *cross-device* lag while
leaving each device's *internal* intervals (RR, foot-to-foot) untouched; a physiological trend moves
the true lag and may co-vary with them. The per-LED arm cannot help — LEDs share a clock *and* a
pulse, so the drift is common-mode either way. Linearity is a weaker second cue: an uncorrected
crystal drifts at a fixed ppm, a vasomotor trend does not.

**Status of the 20–40 ms: still unexplained, but its SHAPE is now known** — a slow trend, not noise
and not respiration. That is two of three candidate shapes eliminated on 8 of 8 nights.

## 7 · Done when

- [x] Out-of-sample design, circular-shift null, gate-asserted with a noise control.
- [x] Full-corpus run; strong/marginal/none separated by null margin.
- [x] Mode-outside-window nights identified and counted.
- [x] The 20–40 ms residual's SHAPE: a slow trend on 8/8 nights — not white, not respiratory, no coherent HR dependence.
- [ ] Its SOURCE: instrumental drift vs slow physiological trend — the bands could not separate these and the discriminator is named in §6.
- [ ] Whether the 22 unscored nights differ systematically from the 20 scored.

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

## 6 · Done when

- [x] Out-of-sample design, circular-shift null, gate-asserted with a noise control.
- [x] Full-corpus run; strong/marginal/none separated by null margin.
- [x] Mode-outside-window nights identified and counted.
- [ ] What spends the 20–40 ms between the recovered SD and the ~11 ms sensor floor.
- [ ] Whether the 22 unscored nights differ systematically from the 20 scored.

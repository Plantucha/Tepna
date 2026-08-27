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

## Done when

- [ ] Leg C recomputed on 2026-08-13 with the unwrap explicitly verified, and the result stated either way.
- [ ] Legs A/B recomputed over the **same time interval** leg C used, not the night median — testing (2).
- [ ] Per-block leg C plotted/tabulated across the night to see whether the rate is stable or steps — testing (3).
- [ ] A statement of **which method is wrong on this night**, or an explicit "both are self-consistent and
      the disagreement is unexplained", which is itself a publishable negative.

## Why it matters beyond one night

The host-leg closure is the only non-void closure over the H10↔Verity↔host geometry, and it is what
`CROSS-DEVICE-DRIFT-AND-CLOSURE`'s PAT box now waits on. If leg C can invert on a clean night, no PAT
gate built on it is trustworthy until this is explained — and if instead the *host legs* are wrong, that
propagates to every drift figure derived from `dual-clock-rate`.

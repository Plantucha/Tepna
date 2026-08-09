<!--
  JOINT-UNWRAP-ATTEMPT-FOLLOWUPS-2026-08-08-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-08 · **Follows:** `JOINT-UNWRAP-ATTEMPT-2026-08-02-BRIEF.md` §5 · **Affects:** investigation only — no code change proposed

# What makes a night un-lockable? The estimator has no knob left.

`JOINT-UNWRAP-ATTEMPT` closed as an estimator problem and reopened as a data one. Its §5 measured the
two remaining candidate knobs and found neither moves anything:

- **Within-block drift is not the limit.** Removing the coarse ppm once (de1) or twice (de2) before
  blocking is slightly *worse* at 300 s and 900 s in both arms.
- **More beats per block is not the limit.** Concentration rises with block length (0.47 → 0.50 →
  0.58) while robust scatter stays flat (412 → 359 → 379 ms). Concentration was the right falsifier
  for *"is there a phase to regress"*; it is **not** a proxy for millisecond precision.

Every IQR spans roughly 250 → 700–1000 ms. That is not one distribution to be tightened by tuning —
it is **two populations**. About half the nights sit near 250–290 ms (inside the ~595 ms half-tooth)
at *any* block length in *any* arm; the other half sit near 700–950 ms at *every* setting. That
matches §3.5's corrected "viable on 3–4 of 6 nights" from a different corpus and a different
measurement, which is the strongest form of agreement available here.

## 1 · The question

**What distinguishes a lockable night from an un-lockable one?** Named candidates, none tested:
slip rate, coverage, posture, or a period where one device simply was not on the body.

## 2 · Why this is not another sweep

Four retractions in this brief family came from tuning a knob and reading the best cell. The
apparatus (`tools/integrator-block-precision.mjs`) already sweeps; the finding is that sweeping does
not separate the populations. So this must start from a **per-night covariate**, measured against the
existing per-night scatter, not from another parameter grid.

## 3 · Done when

- [ ] A per-night covariate is measured on all 12 nights and tested against the existing robust
      scatter — with an error bar, on both populations, not a point estimate from the better half.
- [ ] Either a covariate separates them (and then it is a precondition the unwrap can *check*), or it
      is recorded that none of the named candidates does.
- [ ] No unwrap is shipped on the strength of the lockable half alone.

## 4 · Explicitly out of scope

Re-attempting the unwrap. Two implementations were measured and both failed; a third is not warranted
until a night can be classified *before* the fit.

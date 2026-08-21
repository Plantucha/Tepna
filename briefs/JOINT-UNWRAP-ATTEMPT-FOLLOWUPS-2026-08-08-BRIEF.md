<!--
  JOINT-UNWRAP-ATTEMPT-FOLLOWUPS-2026-08-08-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-20 · **Created:** 2026-08-08 · **Follows:** `JOINT-UNWRAP-ATTEMPT-2026-08-02-BRIEF.md` §5 · **Affects:** investigation only — no code change proposed

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

## 2b · ✅ MEASURED 2026-08-20 — the test this brief specifies CANNOT be run on this corpus, and that is the finding

`tools/integrator-block-precision.mjs --dir uploads/trio` over all 12 nights. The populations are not
two halves. They are **11 and 1**:

| | lockable (n=11) | un-lockable (n=1) |
|---|---|---|
| robust scatter @300 s | 43 – 229 ms | **2737 ms** (12.0× the lockable max) |
| coarse drift | −20.3 … +26.1 ppm | **−165.6 ppm** (6.3× the lockable max \|ppm\|) |
| the night | the other eleven | **2026-06-19** |

🔴 **§3's box asks for "an error bar, on both populations". With n = 1 that is not a hard measurement,
it is an undefined one** — a single point has no interval, and *every* covariate that happens to be
extreme on 2026-06-19 separates the populations perfectly. Reporting such a separation as a tested
covariate would be precisely the failure §2 was written to prevent, one level up: not tuning a knob and
reading the best cell, but **reading a perfect split off a sample of one**. So the box is answered by
establishing that it is currently unanswerable, not by producing a number.

**What the data does support, stated as a hypothesis and not a result:** the separating quantity is
**already computed and is not among the four named candidates** (slip rate, coverage, posture,
off-body). It is the **coarse ppm** the estimator prints per night. −165.6 ppm is 6.3× the largest
magnitude in the lockable set and far outside any plausible crystal — CLAUDE.md §7 records that a
stalled link manufactures an arbitrarily large *apparent* rate while a crystal cannot, so the leading
reading is that 2026-06-19 is a **dropout night, not a drift night**. Cheap and decisive to check when
someone has a reason to: its arrival log, against the §7 `independent` / `spreadMs` discriminators.

**The concrete precondition this yields, if it survives more failing nights:** a night whose coarse
\|ppm\| lands far outside the corpus's own spread should be refused by the unwrap rather than attempted
— a check the estimator can already make, with no new instrumentation. **It must not be wired on n=1.**

**Also measured, and it closes a different question with a negative:** de-drifting does **not** beat
raw. Across 300–1800 s blocks the arms are 115–134 ms with raw at 118 ms and `de2` *worse* at 1800 s
(134 ms). By the tool's own stated criterion that means within-block drift was **not** the limit and
the residual is genuine per-block estimation noise. That bears on `JOINT-UNWRAP-ATTEMPT` §4 and is
recorded here rather than edited into that brief, which another thread may hold (§📌).

## 3 · Done when

- [x] **ANSWERED 2026-08-20** — measured on all 12 nights. The test as specified cannot be run: the
      populations are 11/1, and an error bar on a population of one does not exist.
- [x] **RECORDED 2026-08-20** — none of the four *named* candidates was testable, and the quantity that
      does separate (coarse \|ppm\|, already computed) separates on n=1, which makes it a hypothesis
      rather than a tested covariate. Written up above with the check that would settle it.
- [x] **HELD** — no unwrap shipped. Nothing was built on the lockable half; this brief's execution
      produced a measurement and a refusal, not a feature.

## 4 · Explicitly out of scope

Re-attempting the unwrap. Two implementations were measured and both failed; a third is not warranted
until a night can be classified *before* the fit.

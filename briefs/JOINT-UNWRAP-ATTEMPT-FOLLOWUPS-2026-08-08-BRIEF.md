<!--
  JOINT-UNWRAP-ATTEMPT-FOLLOWUPS-2026-08-08-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-20 (all three §3 items met: 16 covariates measured on **54 nights** at two block lengths, Holm-corrected, both populations reported with bootstrap CIs; **none separates**; no unwrap shipped. ⚠️ Read §5's power statement before quoting the negative — and §6, which questions the endpoint itself) · **Created:** 2026-08-08 · **Follows:** `JOINT-UNWRAP-ATTEMPT-2026-08-02-BRIEF.md` §5 · **Spawned:** `JOINT-UNWRAP-ATTEMPT-FOLLOWUPS-II-2026-08-20-BRIEF.md` · **Affects:** investigation only — no code change proposed

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

- [x] **A per-night covariate is measured and tested against the existing robust scatter — DONE
      2026-08-20.** Sixteen of them, on **54 nights** (not 12 — this corpus is larger than the one §1
      was written against), at **two** block lengths: 900 s and the brief's own 300 s. Every covariate
      carries a percentile-bootstrap CI on *both* a Spearman rho against the continuous scatter and an
      AUC between the two populations, with per-population medians printed side by side — §5.
- [x] **Recorded: none of the named candidates does.** Holm-adjusted across the 16, nothing separates,
      in either arm. §4.
- [x] **No unwrap is shipped**, and none is proposed. §7 of this brief keeps that out of scope and
      nothing here reopens it.

## 4 · The answer: no covariate separates them, in either arm

`tools/unwrap-night-covariates.mjs --dir uploads/trio` (18 selftest assertions; seeded bootstrap, so
the CIs are reproducible rather than merely plausible). The estimator is held **fixed** at one block
length per arm — §2 is explicit that another sweep is not the answer.

| | 900 s | 300 s (the brief's own setting) |
|---|---|---|
| nights scored | 54 | 54 |
| scatter median | **119 ms** (IQR 77–217, range 20–2256) | **113 ms** (IQR 79–199, range 8–2737) |
| lockable (< 450 ms) | 50 | 49 |
| un-lockable (≥ 450 ms) | **4** | **5** |
| covariates tested | 16 | 16 |
| **separators after Holm** | **0** | **0** |

The strongest raw signals, both of which die under correction and neither of which is one of the four
named candidates:

| covariate | arm | rho [95 % CI] | raw p | **p (Holm)** |
|---|---|---|---|---|
| `hostClockPresent` | 900 s | **+0.36 [0.10, 0.58]** | 0.006 | **0.104** |
| `hostClockPresent` | 300 s | +0.26 [−0.00, 0.50] | 0.057 | 0.904 |
| `axisQuantizedShare` (AUC) | 300 s | 0.29 [0.11, 0.49] | 0.044 | 0.712 |

**The four named candidates are flat in both arms.** Slip rate `rho` 0.04 / −0.01, coverage −0.09 /
−0.04, posture (`posChangesPerHr`) 0.20 / 0.15, off-body (`gapFracPpgPct`) 0.26 / 0.20 — every CI spans
zero, every Holm-adjusted p is 1.000.

## 5 · ⚠️ Read the negative with its power — the two populations did not reproduce

**This corpus is not the corpus §1 describes, and that is the single most important caveat here.** §1
reports *"about half the nights"* at 700–950 ms against the other half at 250–290 ms. On these 54
nights **50 are under the 450 ms bar with a median of 119 ms**, and the un-lockable group is **n = 4**
(five at 300 s). Nothing was tuned to produce that — it is the same estimator, the same scatter
definition, and the brief's own split.

So the honest reading of the negative is **"not detectable at this contrast"**, not "refuted":

- With 4–5 nights on one side, every AUC CI is wide — the widest spans 0.05 → 0.78. A covariate would
  have to be nearly deterministic to clear Holm at that n.
- Two covariates are **near-constant on this corpus** and the tool now says so beside their p, because
  a null there describes the corpus rather than the covariate: `coverageEcgPct` (54 % of nights share
  one value) and `ledAgreementPct` (56 %, 5 distinct values).
- The four named candidates were tested at genuine contrast, which is what makes their nulls worth
  something: `slipEcgPct` 54 distinct values, `posChangesPerHr` 38, `gapFracPpgPct` 38, `motionP90` 54.

**A method note that nearly cost a named candidate.** Posture was first summarised as the *median*
per-epoch `motionIndex` — which is **0 on all 54 nights**, because a sleeping body is still for most
epochs. It reported as `constant across nights` and would have retired one of the four named
candidates on an artefact of the summariser. The per-epoch series is not flat at all (38–39 distinct
values spanning 0–100 on the two nights checked). A zero-inflated variable needs an upper quantile and
a burden share, and `motionP90` (IQR 24.2, 54 distinct) is a real test where the median was a dead row.

## 6 · The finding that outlives the question: the ENDPOINT may be measuring capture mode

The one covariate that moves is not about the night's signal at all — it is about **how the night was
captured** — and **its sign is backwards** from the naive expectation:

```
scatter median   box   (device+host)  161 ms   (n=29)      300 s arm: 125 ms
                 phone (device only)   93 ms   (n=25)                  97 ms
```

A night with a genuinely independent host clock scores **worse**. CLAUDE.md §7 says exactly why that
should happen: a phone-captured recording **has no second clock** — its host column is the device stamp
rounded, *"the absence of a measurement wearing the shape of one"*. Two series that agree because one
was derived from the other will show a tight per-block offset, and that tightness is not a lock.

**If that reading is right, per-block scatter partly measures capture provenance rather than
lockability, and the population split this brief is built on is contaminated at its root.** It would
also explain the missing upper population: this corpus is 25/54 phone nights, whose scatter cannot be
large because there is only one clock in it.

🔴 **This is NOT established and must not be quoted as if it were.** Holm-adjusted it is not
significant in either arm, and the cross-tab is nothing: **3 of 29 box nights un-lockable against 1 of
25 phone nights** (4/29 vs 1/25 at 300 s). It is a mechanism with a matching sign and a plausible
story — the weakest of the three kinds of evidence this repo accepts. It is carried into
`JOINT-UNWRAP-ATTEMPT-FOLLOWUPS-II-2026-08-20-BRIEF.md` as a question about the endpoint, which is
where it belongs, rather than being smuggled in here as a conclusion.

## 7 · Explicitly out of scope

Re-attempting the unwrap. Two implementations were measured and both failed; a third is not warranted
until a night can be classified *before* the fit.

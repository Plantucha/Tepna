<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-10 · **Created:** 2026-08-10

# `driftRange` saturates at the physiological window — replace the statistic, keep the bar

Phase 0 of `INTEGRATOR-PAT-VASCULAR` has never returned a single GO. After the `sharedClock` overlap
fix (#1143) the other three criteria clear comfortably — coupling 89–99.9 % against a 55 bar, residual
IQR 6.1–24.4 ms against 60 — and **`driftRange` is the sole remaining blocker**, reading 72–442 ms
against `DRIFT_MAX_MS = 60`.

This brief argues `driftRange` is not measuring what the gate needs it to measure, gives the evidence,
and proposes replacing the statistic **without moving the 60 ms bar**.

Corpus: `boxcaps/` box captures 2026-07-25 → 2026-08-09, H10 ECG × {Verity ankle, O2Ring finger},
post-#1121 DSPs. Phone-tree nights are excluded — they carry no second clock (CLAUDE.md §7).

## 1 · What `driftRange` is, and why it cannot fail safe

`coupledPAT` bins paired beats into 5-minute bins, takes each bin's median R→foot lag, and reports
`max − min` over those medians. Pairing is confined to the physiological window `PHYS_LO = 200`,
`PHYS_HI = 650`, so **every bin median lies in a 450 ms-wide interval by construction** and
`driftRange` is bounded above by 450.

Measured on the nine recordings longer than ~6 h:

```
442  431  430  427  427  425  423  423  420        hard ceiling = 450
```

93–98 % of the ceiling, nine times. Those are not nine measurements of drift; they are the window
width reported nine times. **A statistic that pins to a constant for any sufficiently long recording
cannot rank nights and cannot fail safe** — a night that is genuinely drift-free and a night whose
capture collapsed both read ~425 once they are long enough.

**This was already known, and written down.** `pat-align.js:246` has said since 2026-08-04:

> ⚠️ `driftRange` is still NOT a clock-drift estimator — post-fix it tracks the window width under
> low coupling (~420 ms vs a 450 ms window). It is returned for continuity, never as drift.

The observation never reached the gate: `pat-gate.js` reads the same field into `driftMs` and rejects
nights on it. Two things are new here. The saturation is **not** confined to low coupling — 2026-08-01
finger qualifies 78 % of its bins and still reads 442 — and it has a mechanism (§2) rather than being
an association with poor capture.

## 2 · Why it saturates: it is the envelope of a random walk

The bin-to-bin *step* is small and has no trend. Theil–Sen slope of the bin medians against time is
−6.9 to +24.8 ppm across the corpus, median ≈ −1 — i.e. no ramp. The median |step| between adjacent
qualified bins is 6–35 ms. A driftless walk's range grows as `σ·√N`, so a long enough recording fills
whatever interval confines it.

Order check on 2026-08-02 finger: 22 bins, median |step| 12 ms ⇒ σ ≈ 17.8 ms, expected range
`√(8N/π)·σ ≈ 133 ms`; measured **125 ms**. The model is order-correct across the corpus, though it
under-predicts the longest nights (07-27 finger predicts 119, measures 206), so a slow real component
sits on top of the walk. The saturation evidence in §1 does not depend on this model.

**This explains every failed diagnosis** attempted before the statistic itself was questioned:

| hypothesis | prediction | measured |
|---|---|---|
| residual clock ramp (ppm) | clean slope | slope ≈ 0, sign varies |
| span-scaling ⇒ window the analysis | range ∝ span | 08-04 ankle 420 (whole) → 401 (30 min) |
| whole-RR beat-slip | bimodal at one RR | already excluded by `PHYS_LO/HI` |
| PPG detector doubling | PPI/RR ≈ 0.5, alternation | **PPI/RR = 1.00, altIdx = 0.02** on every night |
| wrong foot chosen in window | tracking rule changes the answer | changes **0 %** of beats — ≤1 foot per window |
| physiological, tracks heart rate | consistent ρ(lag, RR) | ρ = −0.63…+0.32, sign varies; residual range after removing lag~RR is **unchanged** (07-28: 72 → 78) |

A walk predicts exactly this pattern of nulls: no trend to find, only √2 from halving the span,
nothing from re-selecting beats, and no covariate.

## 3 · A second, independent defect: bins are admitted with no minimum

`BIN_MIN = 5` in `pat-feasibility-worker.js` is the bin **width in minutes**, not a pair count. No
minimum count is applied anywhere — **a bin holding a single paired beat contributes a full median**
to a max−min range.

The consequence is not theoretical. On 2026-08-03 finger the bins producing the extremes hold 6, 9,
17 and 24 paired beats out of ~238 ECG beats in the same 5 minutes (3–10 % match) with within-bin IQR
of 106–228 ms, while the bins at 100 % match have IQR 7–26 ms. Worse, those survivors are
**edge-censored**: when the true lag approaches 650 ms only the beats whose foot happens to land under
the ceiling are paired, so the surviving median is dragged toward the window edge — which is why those
bins read 619 and 630 ms.

Qualifying bins on match **rate** and their own IQR, alone, moves 2026-08-03 finger 404 → 222 and
2026-08-01 ankle 245 → 179.

## 4 · Proposal

Three changes. **`DRIFT_MAX_MS` stays at 60** — only the quantity compared against it changes, and the
change is justified by saturation (§1), not by wanting more nights to pass.

- **P1 — qualify bins.** A bin enters the drift statistics only if its paired-beat count is ≥ 80 % of
  the ECG beats in the same bin **and** its within-bin IQR ≤ `BEAT_IQR_MAX_MS` (60, already published).
  A count-based floor is explicitly rejected: it is the defect in §3 restated.
- **P2 — report `stepP95`**, the 95th percentile of `|Δ median|` between **temporally adjacent**
  qualified bins (adjacent in bin index, so a recording gap is never counted as a step), and gate on
  it in place of `driftRange`. Duration-independent by construction.
- **P3 — keep `driftRange` in the payload** as a diagnostic, documented as duration-dependent and
  window-saturating, so historical Phase 0 runs stay readable. `DRIFT_DOMINATED_MS = 250` must move
  onto `stepP95` with it, or it will classify every long night as drift-dominated.

### Measured effect (qualified bins; the 60 bar unchanged)

| night · site | `driftRange` shipped | `driftRange` qualified | **`stepP95`** |
|---|---|---|---|
| 2026-08-02 finger | 125 | 125 | **18** |
| 2026-07-27 finger | 223 | 206 | **23** |
| 2026-07-28 finger | 72 | 72 | **23** |
| 2026-08-01 finger | 442 | 414 | **27** |
| 2026-08-03 finger | 404 | 222 | **31** |
| 2026-08-05 finger | 423 | 324 | **31** |
| 2026-08-06 finger | 425 | 318 | **31** |
| 2026-08-02 ankle | 129 | 129 | **29** |
| 2026-07-28 ankle | 103 | 75 | **47** |
| 2026-08-04 finger | 427 | 366 | 63 |
| 2026-08-06 ankle | 431 | 358 | 71 |
| 2026-08-07 finger | 423 | 318 | 74 |
| 2026-08-04 ankle | 420 | 341 | 86 |

The range cannot separate 2026-08-01 finger from 2026-08-02 finger (414 vs 125) though both are quiet
steppers (27 and 18). The step can.

### Phase 0 re-run, through the shipped engine (30 pairings, `boxcaps/` 2026-07-25 → 08-09)

| | before | after |
|---|---|---|
| **GO / FEASIBLE** | **0** | **8** — 5 finger, 3 ankle |
| PROMISING | 20 | 15 |
| DRIFT-DOMINATED | 3 | **0** |
| NO OVERLAP | 7 | 7 |

FEASIBLE: 2026-07-25 ankle + finger · 07-27 finger · 07-28 ankle + finger · 08-01 finger · 08-02
ankle + finger. **The first GO this project has produced.**

I predicted 9 (7 finger, 2 ankle) before running it; the answer is 8, distributed differently. The
prediction is recorded because it was wrong in a way worth keeping: I assumed the nights that clear the
drift leg would clear everything.

**Drift is no longer the binding constraint anywhere.** 2026-08-03 / 05 / 06 finger now pass the drift
leg at `stepP95` 29 / 63 / 31 and fail on **coupling** — `matchRate` 54.1 %, 34.2 %, 42.1 % against the
55 % bar. 2026-08-03 finger misses by 0.9 points. Whatever blocks PAT next, it is not this.

## 5 · What this does NOT claim

- **Not** that the underlying wander is an artifact. On 2026-07-28 finger the lag walks 428 → 369 →
  441 ms across three hours at 97–100 % match with 7–39 ms within-bin IQR. That is a clean measurement
  of something real; peripheral vasomotor tone is the obvious candidate and this brief does not test
  it. The claim is only that a **range** is the wrong instrument for reading it.
- **Not** that 60 ms is the right bar for `stepP95`. It is the bar inherited unchanged so the proposal
  cannot be accused of retuning. Whether 60 is right for a step is a separate question, and answering
  it needs a night with an independently known PAT — which this corpus does not have.
- **Not** that the finger/ankle split (18–31 vs 47–86 ms) is a capture-quality fact. Ankle PAT is a
  longer, more vasoactive path; the split may be physiology. It is reported, not interpreted.

## Done when

- [x] `coupledPAT` qualifies bins per P1 and reports `stepP95`, `binsQualified`, `binsTotal`
- [x] `PATGate.verdict` gates on `stepP95`; `driftRange` retained in the payload as a diagnostic
- [x] `DRIFT_DOMINATED_MS` applies to the same quantity as `DRIFT_MAX_MS`
- [x] `tests/dex-tests.js` covers: a saturating walk (range ≥ 400, steps ≤ 11) passing; a 300 ms step
      failing; a bin at 3 % match excluded; a recording gap not counted as a step
- [x] Phase 0 re-run on `boxcaps/` recorded above — **0 → 8 GO**
- [x] `npm run check` green

The new logic lives in **`pat-gate.js` (`PATGate.driftStats`)**, not in the worker, for the reason
`sharedClock` moved there in #1143: `pat-feasibility-worker.js` is in no test lane, so logic left in it
is logic nothing executes. The worker builds the per-bin records and delegates; absent `pat-gate.js` the
drift fields go undefined and `verdict` falls back to `driftRange` — the exact pre-2026-08-10 behaviour.

**The assertions were mutation-checked, and the first version did not bite.** Zeroing `BIN_MATCH_MIN`
left the §3 tests green, because the fixture bin failed the IQR rule as well as the match-rate rule and
so tested only the former. Re-cut with the real 2026-08-03 geometry — 6 pairs of 238 with within-bin
IQR **38 ms**, which *passes* the beat bar — the same mutant kills four assertions. Four mutants are now
killed: gate reads `driftRange` (2), no match-rate floor (4), steps taken across a gap (6), p95→median (4).

Related: [`PAT-COMPENDIUM-2026-08-10-BRIEF.md`](PAT-COMPENDIUM-2026-08-10-BRIEF.md) ·
[`INTEGRATOR-PAT-VASCULAR-2026-07-18-BRIEF.md`](INTEGRATOR-PAT-VASCULAR-2026-07-18-BRIEF.md)

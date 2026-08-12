<!--
Copyright 2026 Michal Planicka
SPDX-License-Identifier: Apache-2.0
-->

**Status:** IN-PROGRESS · **Created:** 2026-08-12

# Stop hand-rolling clock statistics — the field has a standard tool and we keep re-deriving it badly

Three clock analyses in one session (2026-08-11/12) reached wrong or unsafe conclusions, all by asking
"does this drift?" with ad-hoc statistics. The question has a canonical answer — **Allan deviation** —
and this suite has been circling it for months without naming it.

## 1 · What we keep doing, and why it fails

| what was asked | how it was asked | what went wrong |
|---|---|---|
| "does the PAT residual average down?" | SD of block means vs σ/√N | contaminated by mis-pairing; the conclusion was retracted twice |
| "is the offset constant within a connection?" | fit halves, compare | had to be redone because each half was quoted at its own centroid |
| "what is the H10's rate?" | one ppm number | meaningless without a span, as Clock Contract §7 already says |

**Allan built this exact tool because standard deviation DIVERGES for these noise types as the sample
count grows** (NIST/Riley, *Handbook of Frequency Stability Analysis*). Every failure above is a case
of using a statistic whose value depends on how much data you happened to have.

Clock Contract §7's rule — *"never quote a `ppm` without the span beside it"* — is a hand-derived
special case of the τ-dependence Allan deviation makes explicit. §7 also warns the H10 "reads −20.3 ppm
over 373 min and −65.8 over 10.9"; that IS a σ_y(τ) curve, reported as two disconnected anecdotes.

## 2 · What Allan deviation gives that a ppm cannot

σ_y(τ) plotted against averaging time τ **classifies the noise by its slope**, so the answer is a
mechanism rather than a number:

| slope of σ_y(τ) | noise type | what it means here |
|---|---|---|
| τ^−1 | white / flicker **phase** | jitter — averages away fast |
| τ^−1/2 | white **frequency** | the well-behaved case; averaging helps as √N |
| τ^0 (flat) | flicker frequency | a floor — more averaging buys NOTHING |
| τ^+1/2 | random-walk frequency | wanders; a long fit is worse than a short one |
| τ^+1 | **deterministic drift** | fit and remove it; do not average through it |

The flat and rising regions are the ones that matter operationally: they say **where averaging stops
helping**, which is exactly the question "should PAT use 5-minute windows or the whole night?" — asked
three times this session and never answered on principle.

## 3 · The input already exists

The arrival sidecar (`PAT-PACKET-ARRIVAL`) writes `host arrival` against `device timestamp` per packet.
`arrival − device` IS a **phase (time-error) series**, which is the native input to ADEV. Nothing new
needs capturing: 2026-08-11 alone carries 159,607 rows across five streams.

## 4 · Scope — a module and a report, not a gate

- `capture-host/allan.py` — **overlapping** ADEV from a phase series (overlapping, not plain: it uses
  every available sample pair at each τ and is the standard estimator for real data), plus a slope
  classifier that names the dominant noise type over a τ range.
- Reported per stream beside `offset`/`jitter` in `nightqc`.
- ⚠️ **NOT wired into any pass/fail.** The last two arrival diagnostics that shipped with thresholds
  (`floor_ok < 5 ms`; the SMEARED canary) both fired on every stream of the first real night because
  the premise was unmeasured. A bar comes after there is a τ-curve from several nights, not before.

## 5 · What this is expected to settle

- **Whether the H10's ~14 ms within-connection wander is drift or random walk.** Drift (τ^+1) is
  removable by the fitted line already in `clock_offset`; random walk (τ^+1/2) is not, and would cap
  PAT precision no matter how the fit is done.
- **The optimal averaging time** — the τ at which σ_y(τ) is minimised is the window length a PAT
  measurement should use. That replaces the 5-minute figure, currently chosen by intuition.
- **Whether the ring's 3851 ppm is a rate error or a wander.** §6.2 of `PAT-PACKET-ARRIVAL` calls it a
  rate; its per-hour spread (13 ppm to 14030 ppm across seven hours) looks nothing like a stable rate.

## Done when

- [x] `allan.py` — overlapping ADEV + noise-type classification, refusing rather than guessing
- [x] known-answer tests: white-PM/white-FM/random-walk-FM/drift recover −1.000 / −0.545 / +0.462 /
      +1.000 against theory's −1 / −0.5 / +0.5 / +1, and the canary asserts all four map to DIFFERENT
      names — a classifier returning one label would satisfy any single-series test
- [x] run on the real arrival sidecars — all four Polar streams white/flicker PHASE, slope −0.99 to
      −1.00, ADEV 0.023–0.094 ms; ring white FREQUENCY at 615 ms
- [x] reported in `nightqc` as `stability`, gated by nothing
- [ ] Clock Contract §7's "quote the span" rule cross-referenced to this

Related: [`PAT-OFFSET-ESTIMATOR-2026-08-11-BRIEF.md`](PAT-OFFSET-ESTIMATOR-2026-08-11-BRIEF.md) ·
[`PAT-PACKET-ARRIVAL-2026-08-11-BRIEF.md`](PAT-PACKET-ARRIVAL-2026-08-11-BRIEF.md)

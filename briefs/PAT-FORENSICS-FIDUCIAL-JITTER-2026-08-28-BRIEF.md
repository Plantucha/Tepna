<!--
  PAT-FORENSICS-FIDUCIAL-JITTER-2026-08-28-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** IN-PROGRESS · **Created:** 2026-08-28 · **Parent:** `PAT-ROOT-CAUSE-FORENSICS-2026-08-27-BRIEF.md` (phase (b): §7 fiducial family, §6 R-jitter) · **Interlocks:** `EXTERNAL-METHODS-SURVEY-2026-08-20-BRIEF.md` §1, `PAT-FORENSICS-AXIS-LEG-ASYMMETRY-2026-08-28-BRIEF.md`

# The fiducial family is not a lever — every family agrees to under 6.2 ms

> **In one line:** across eight fiducial families on real pulses, the largest clock-free
> beat-to-beat disagreement between any two is **6.22 ms**. Changing which feature defines the
> "foot" therefore cannot move PAT by more than a few ms, and the standing **38.0 ms** residual IQR
> is **not** explained by fiducial choice.

**Label: not a defect.** This closes a candidate mechanism rather than finding one — §7 was the
charter's nominated "most likely fundamental limit", and on the *differential* question it is ruled
out. The *absolute* question survives, and §4 says why it must.

## 1 · The measurement, and why it excludes both known artefacts by construction

Two prior artefacts made every earlier §7 attempt answer a different question:

- **`pat-sd-is-the-window`** — every PAT SD previously reported measured the 450 ms PHYS window
  (450/√12 = 129.90 ms), i.e. the window's variance, not physiology.
- **EXTERNAL-METHODS-SURVEY §1** — comparing fiducials by *recovery rate* cannot work: the families
  differ by a near-constant translation (foot→half = **89.5 ms**, spread 22 ms over 30 nights) and
  the strict statistic's leave-one-block-out centre **absorbs a constant by design**. A
  translation-invariant estimator cannot see a translation.

**The fix is to compare two fiducials of the SAME beat.** They share the clock, `t0`, the axis and
the sample grid, so their difference is free of every clock term **identically** — not after
correction. No acceptance stage runs, so the PHYS window never enters either. This is the only §7
statistic in the repo that excludes both artefacts *by construction*.

That property is **gate-asserted**, not asserted in prose: `pat-fiducial-jitter.mjs --selftest`
plants a large varying clock shift on every beat and requires every pairwise SD to stay at 0, and a
**positive control** plants ±1 sample on one family and requires it to be seen. 11/11.

## 2 · Result — eight families, 8968 beats, 8 fragments

Clock-free beat-to-beat SD, computed **within** each file and reported as the median across files
(see §3 for why that qualifier is load-bearing):

| pair | within-file SD | between-file SD | band |
|---|---|---|---|
| `pct10\|pct25` | **0.88 ms** | 2.95 | NOT-DOMINANT |
| `tangent\|pct10` | 1.00 | 6.39 | NOT-DOMINANT |
| `pct25\|pct50` | 1.09 | 3.87 | NOT-DOMINANT |
| `tangent\|pct50` | 2.17 | 2.74 | NOT-DOMINANT |
| `maxSlope\|tangent` | 2.79 | 6.63 | NOT-DOMINANT |
| `min\|tangent` | 3.01 | 10.18 | NOT-DOMINANT |
| `min\|maxSlope` | 5.32 | 16.02 | NOT-DOMINANT |
| **`pct75\|d2max`** (worst of 28) | **6.22 ms** | 5.24 | NOT-DOMINANT |

**All 28 pairs land NOT-DOMINANT** against bands pre-stated before the first run
(≥20 MATERIAL · 10–20 INTERMEDIATE · <10 NOT-DOMINANT, closed, no gaps).

`tangent` is the **shipped** foot — `refineFeet`'s `cross = ms − (bp[ms]−mv)/msv` is exactly the
intersecting-tangent method, so the fiducial Tepna already uses is one of the eight compared, not an
outsider to them.

## 3 · Two methodological results worth more than the headline

**(a) Pool within files, never across them.** Pooling all 8968 beats into one difference distribution
gave **SD 41–56 ms (MATERIAL)** — the opposite verdict. The tell was that the pooled **IQR stayed at
1–8 ms** while the SD hit 56: a tight bulk with a between-group shift, i.e. `V_pool = within +
between` with the between term dominating. Each file carries its own near-constant family offset
(the survey's 89.5 ms ± 22 ms across nights), so pooling measures *that* spread. One tool, two
contradictory answers, and only the sign of `SD ≫ IQR` distinguished them. The between-file column
above is that quantity, reported separately because it is real — just not beat-to-beat jitter.

**(b) The three-cornered hat REFUSED on all three triples, and the refusal is the finding.** Every
triple returned a negative variance. The header pre-declared why: TCH assumes **independent** leg
errors, and fiducial families on one pulse share morphology — when a beat broadens or an artefact
tilts the upstroke, they all move together. `tch-corners-are-coupled` records coupling breaking this
assumption as a live failure mode here. The negatives were **surfaced, never clamped to zero**, and
they confirm the coupling rather than measuring around it.

## 4 · 🔴 What this does NOT establish — the common-mode limit is untouched

The pairwise difference sees only the **non-common** part of two fiducials' error. If every family is
wrong *together* — the whole upstroke displaced by noise, a slow rise, an artefact — that error
**cancels in the difference and is invisible here**. So:

- ✅ **Proven:** the fiducial *family* is not a lever. No choice among these eight buys more than
  ~6 ms, which corroborates the survey's paired Δ of **−0.0000** by a completely independent route.
- ❌ **Not proven:** that the foot contributes < 10 ms of absolute uncertainty. The 38.0 ms residual
  IQR could still be largely fiducial, if it is common-mode.

**Only an independent reference can separate those**, which is precisely §12/§13's oracle (perfect
beat labels / manually-reviewed feet). Reporting this bound as if it were the absolute answer would
be the same over-claim the axis brief had to correct one day earlier.

## 5 · §6 — ECG R-peak jitter

⬜ Pending in this brief; the ECG population work is recorded below and in §6 of the parent.

## 6 · Done when

- [x] Per-family beat-to-beat variability measured, clock excluded by construction, gate-asserted.
- [x] Pre-stated closed bands; all 28 pairs classified.
- [x] Pooling hazard found, corrected, and documented.
- [x] TCH independence violation surfaced as refusals rather than clamped.
- [ ] §6 ECG R-fiducial jitter in ms.
- [ ] Common-mode fiducial error via the §12/§13 oracle.

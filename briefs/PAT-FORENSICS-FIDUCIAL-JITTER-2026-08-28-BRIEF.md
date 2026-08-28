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

## 5 · §6 — the ECG axis: the comment's claim is VERIFIED on an independent population

`ecgRpeakTimes`' source comment claims *"on 160 of 187 real ECG fragments the ppm path is REFUSED by
its 40-min span gate … median divergence 48 ms on refused fragments (max 1479 ms)"*. The charter
forbids accepting that on faith. Re-measured on a **different** corpus — 505 `*_ECG.txt` under
`tepna-smoketest/captures` (`find -L`), 448 parsed:

| | comment (187 fragments) | this measurement (448 fragments) |
|---|---|---|
| ppm **refused** | 160/187 = **85.6 %** | 371/448 = **82.8 %** |
| median divergence on refused | **48 ms** | **42.5 ms** |
| max | 1479 ms | 3128 ms |

**VERIFIED.** Two populations, ~2.4× apart in size, agreeing to 3 points of percentage and 5.5 ms of
median. The mechanism is confirmed too: of the gate's four conditions, **`spanMs >= 2400 s` passes
only 77/448** while **`independent === false` is 0/448** — the span gate is the *sole* binding
constraint here, exactly as claimed. (`spanMs` median 427 s against a 2400 s bar; `ppm` median
−34.9, p10 −815, p90 +257.)

⚠️ **Two false starts got there, and both are the same error.** First `tMsCorrected` → "93.7 %
applied", which reads as a clean *refutation* — but it is a different gate, and the source says so
outright: *"the ppm is span-gated, the interpolation is not."* Then `hostAxis.totalMs` as the span →
"0/448 pass", with anchor spans of −0 s against 349 s fragments: not credible, wrong field again. The
rec exposes **`applied`** and **`spanMs`** *by name*. **Three times in this campaign, reading the
named field instead of a plausible proxy changed the answer** — and here the proxy manufactured a
false refutation, the more dangerous direction.

🔴 **42.5 ms is the fragment-END divergence, NOT what PAT eats** — the same discipline the axis brief
had to apply to its own 34.5 ms. `coupledPAT` centres within a 5-minute bin, so the decision-relevant
quantity is `|ppm| × 300 s`, not `|ppm| × span`. At the median ppm that is ~10 ms per bin; in the p10
tail (−815 ppm) it is ~245 ms. **That within-bin figure is not yet computed per fragment** and is
carried forward — quoting 42.5 ms as the PAT error term would repeat the mistake this campaign has
now caught twice.

**Label: ENGINEERING LIMITATION, not a bug.** The span gate is deliberate and correct — a *rate*
needs a baseline, and the source records the measurement behind the 2400 s knee. Refusing to quote a
rate from a 427 s fragment is the honest behaviour; the cost is that 83 % of fragments carry an
uncorrected axis.

## 5b · §17 — the two corpora differ in clock provenance

| corpus | `independent` | reading |
|---|---|---|
| `uploads/` Polar PPG (phone) | **false 8/8** (spreadMs 0.98–1.00 ms) | no second clock |
| `tepna-smoketest/captures` ECG (box) | **false 0/448** | two real clocks |

The comment's *"every H10 ECG capture in this corpus is a phone capture"* is true of **its**
population and false of this one. **Every claim here must carry its population** — the box/phone
split is not a detail, it decides whether a second clock exists at all.

## 6 · Done when

- [x] Per-family beat-to-beat variability measured, clock excluded by construction, gate-asserted.
- [x] Pre-stated closed bands; all 28 pairs classified.
- [x] Pooling hazard found, corrected, and documented.
- [x] TCH independence violation surfaced as refusals rather than clamped.
- [x] §6 ECG axis: the 160/187 @ 48 ms claim VERIFIED on an independent 448-fragment population (82.8 % @ 42.5 ms).
- [ ] The within-5-min-bin ECG residual (|ppm| × 300 s) per fragment — the decision-relevant figure.
- [ ] Common-mode fiducial error via the §12/§13 oracle.

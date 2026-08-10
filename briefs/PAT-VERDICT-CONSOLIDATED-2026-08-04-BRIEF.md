<!--
  PAT-VERDICT-CONSOLIDATED-2026-08-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-10 · **Superseded-by:** `PAT-COMPENDIUM-2026-08-10-BRIEF.md` · **Created:** 2026-08-04 · **Follows:** `PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md` §3c–§3j, `PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md`, `INTEGRATOR-PAT-VASCULAR-2026-07-18-BRIEF.md` §2-RESULT-II, `PAT-FEASIBILITY-2026-07-08-BRIEF.md`

# PAT is blocked by ~90 ms of beat-to-beat scatter that is downstream of the heart — every other candidate has now been measured and eliminated

> ⚠️ **SUPERSEDED 2026-08-10 — AND ITS CENTRAL CLAIM IS WITHDRAWN.** This brief concluded the ~90 ms
> scatter was *"not a clock problem, not an alignment problem, and not a method problem. It is the
> signal."* All three of those were the cause: ECGDex rounded its `fs` to the nominal 130 (46–126 ppm,
> 1.25–4.16 s/night, fixed in #1121), the O2Ring's ROW rate was read as its sample rate (~6900 ppm),
> and `PHYS`'s 450 ms window reports `450/√12 = 129.90 ms` by construction. On box captures with the
> axis fixed the same interval measures **10–23 ms on three of six nights**. §2's elimination table and
> §5's method warnings stand and are carried forward. See `PAT-COMPENDIUM-2026-08-10-BRIEF.md`.

> **What this is.** A **consolidation, not a replacement.** Five PAT verdicts have been published from
> this repo and the reasoning is now spread across four briefs, one of whose title claims is withdrawn
> and three of which carry retractions. Each remains the primary record for its own measurement; this
> states what they jointly establish, in one place, with every number traceable to the brief that
> measured it. Nothing here is new evidence.

## 1 · The verdict

**Coupling between the ECG R-peak and the peripheral pulse foot is real in this corpus. PAT as a
*measurement* is not available, and the binding constraint is the beat-to-beat scatter of the R→foot
interval — ~84–99 ms against `pat-gate.js`'s ≤60 ms bar — which is downstream of the heart.**

It is not a clock problem, not an alignment problem, and not a method problem. It is the signal.

## 2 · Every candidate blocker, measured and eliminated

| candidate | measured | where |
|---|---|---|
| **crystal drift** | `halfDrift` passes **47/54**, median 19.7 ms, implied **1.46 ppm** — excludes the 47.7 ppm once claimed, on 51/54 pairings | `INTEGRATOR-PAT-VASCULAR` §2-RESULT-II.3 |
| **beat-slip in the coupler** | the 2000 ms search vs a 200–650 ms report paired each beat with the NEXT one — *"1147 ms IS one RR"*. Real, fixed, 16 gated assertions | `PAT-FEASIBILITY` §CAUSE-CORRECTED (2026-07-29) |
| **the alignment** (ACC anchors) | anchors disagree with **themselves** by **1171–3094 ms** inside one pair — 13–34× the ±90 ms tolerance; no model on them can work, and `interp`/`const`/`zero` come out three coin-flips | `PAT-UNDER-PERBLOCK-ALIGNMENT` §3e |
| **pair selection** | legacy `matchRate` spans **0–77 %** across pairs of ONE night, and the largest-overlap rule sits near the bottom every time | ibid. §3c |
| **offset identifiability** | knowable only to a **~450 ms band mod one RR**; the host-stamp route reaches 39–128 ms but clears 60 ms on 3/8 nights | ibid. §3e.4, §3g.2 |
| **the host clock itself** | the phone tree has **no** independent host column — 76/76 files agree with the device to 1 ms; 0/104 declared independent | `PAT-NO-VALID-ANCHOR` §8, §11 |
| **no valid non-beat anchor** | one was **derived** (`offset_ACC + Δ_Verity − Δ_H10 = −199 ms`) and still recovers plausible PAT on **6/38** nights, **0/13** box | ibid. §7, §10 |
| **the PPG timing point** | foot vs peak indistinguishable over 45 comparable windows: paired **−0.5 ± 5.1** points, 40/45 significant each | `PAT-UNDER-PERBLOCK-ALIGNMENT` §3g (corrected) |
| **pre-ejection period** | arm→finger **cancels PEP by construction** and the scatter does **not** collapse: **92 ms** vs 84 ms, **1/43** windows clearing the bar | ibid. §3j |

## 3 · What remains, and why it is not a software problem

`residIQR` ≈ **96 ms** (whole nights, `INTEGRATOR-PAT-VASCULAR`) / **84 ms** (60-min windows, this
family's §3i) / **92 ms** (arm→finger, §3j), against a **60 ms** bar. Measured three ways, in two
harnesses, offset-free by construction in all of them.

The R→foot interval is **stable in its centre and loose in its detail** — `INTEGRATOR-PAT-VASCULAR`
§II.3's phrase, and the exact opposite of what PAT needs, since the physiology of interest lives in the
beat-to-beat variation. §3j places the looseness **downstream of the heart**: vascular variability,
foot-detection noise, or both.

**Windowing helps and is not enough.** 60-min windows clear the bar on **10/52** against **0/54** whole
nights — a real gain from the offset wandering less inside an hour, and an order of magnitude short.

## 4 · What would change this verdict

Only two things, and neither is analysis:

1. **A tighter foot.** If a meaningful share of the ~90 ms is *detection* noise rather than vascular,
   a better timing point moves it. `PPG-SAMPLE-RATE-AND-PAT-2026-08-03` is the live thread — the Verity
   now runs at **176 Hz** where the corpus above is largely 55 Hz, and at 55 Hz one sample is 18 ms.
   **This is the single most promising open item and it is already someone's.**
2. **A better site pair.** Everything here is arm/wrist and finger — peripheral, with a short transit and
   therefore a poor signal-to-scatter ratio. A proximal-to-distal pair with a longer path would raise
   the signal without raising the noise.

What will **not** change it: more clock work, a better anchor, a different alignment, or dual-site
differencing. Each is measured above.

## 5 · Method warnings this family paid for, worth keeping

- **A statistic whose reference comes from the data it is testing cannot fail.** Twice: `matchRate`'s
  stage two (a 30 s local median of the lags it filters) and `strictMatchRate.residIQR` (an IQR over
  only the residuals it accepted, so bounded by its own ±40 ms window — it reads 31–44 ms regardless of
  signal and **must never be compared to the 60 ms bar**).
- **Concluding from the best available case.** Named in `PAT-NO-VALID-ANCHOR`'s header after four
  retractions; four more followed on 2026-08-04, each corrected only by widening the sample. Widen
  before publishing, not after.
- **Selecting on the outcome.** Choosing a pair by `matchRate` and then reporting `matchRate` is the
  same disease one level up. The fix is not a better selection rule but **enumeration** — score every
  pair and window and report the distribution.
- **Read the sibling briefs first.** §3c–§3g were written without reading `PAT-NO-VALID-ANCHOR`, which
  sits in the same family, names the brief being edited, and already contained parts of them at larger n.

## 6 · Status of the five published verdicts

| verdict | stands? |
|---|---|
| `PAT-FEASIBILITY` — no-go from ~48 ppm drift | **cause retracted** (beat-slip); the measurement stands |
| `WEARABLE-HOST-AXIS-FOLLOWUPS` §F3-ter — "not alignment-limited" | **retracted** — its harness fitted a free per-block offset |
| `PAT-UNDER-PERBLOCK-ALIGNMENT` — "blocked by PTT itself" | **title withdrawn**; §1–§2's IQR/drift legs stand |
| `PAT-NO-VALID-ANCHOR` §7 — "PAT is demonstrated" | **corrected at §10** — 6/38 nights, 0/13 box |
| this one | *stands until §4.1 or §4.2 is measured* |

## Done when
- [ ] §4.1 — re-measure the scatter on **176 Hz** Verity captures (`PPG-SAMPLE-RATE-AND-PAT`). If it
      falls materially below ~90 ms, §1 is wrong and PAT re-opens.
- [ ] §4.2 — a proximal→distal site pair, if the hardware ever allows one.
- [ ] The **differenced** dual-site form (one R → two feet) for completeness — `INTEGRATOR-PAT-VASCULAR`
      §4's exact shape. §3j.1 argues it cannot change the verdict; it is cheap and both legs exist.

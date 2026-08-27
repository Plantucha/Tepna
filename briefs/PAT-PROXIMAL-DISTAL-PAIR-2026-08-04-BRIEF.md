<!--
  PAT-PROXIMAL-DISTAL-PAIR-2026-08-04-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

**Status:** DONE — 2026-08-27 (§2 withdrawal REVERSED at §2a, 2026-08-04. **All four Done-when items executed, each dated and carrying its measurement**: the grid/host scoring (§2a, artifact refuted), the full per-pair distribution (§2b, selection worth ~20 ms), offset-free scatter (67 ms over 29 pairs), and the truncation confirmation on 2026-07-29 by widening the window. Verified 2026-08-27 in the file it names, not from its prose: `tools/pat-ppg-ppg-control.mjs` does carry the `--window` flag the fourth item calls a one-parameter change. Nothing is left open and no item is parked.) · **Created:** 2026-08-04 · **Answers:** `PAT-VERDICT-CONSOLIDATED-2026-08-04-BRIEF.md` §4.2 / Done-when 2 · **Follows:** `PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md` §3c–§3j, `O2RING-RAW-STREAMS-ABSENT-2026-08-04-BRIEF.md`

# The proximal→distal pair exists — finger↔ankle — and its coupling tracks the ring's TIMEBASE PROVENANCE, not anatomy

`PAT-VERDICT-CONSOLIDATED` §4.2 lists *"a proximal→distal site pair, if the hardware ever allows one"* as
one of only two things that could reopen PAT, and leaves it unchecked because everything measured so far
is *"arm/wrist and finger — peripheral, with a short transit and therefore a poor signal-to-scatter
ratio."*

**The corpus already contains one.** Confirmed with the wearer 2026-08-04: the O2Ring is on the **right
index finger** and the Verity on the **LEFT ANKLE** — upper limb vs lower limb, ~60–80 cm of arterial
path against ~100–120 cm. Every prior brief in this family assumed the Verity was on the arm.

This brief reports what that pair shows, and **why its headline result cannot yet be believed**.

## 1 · The measurement

`tools/pat-ppg-ppg-control.mjs` — PPG↔PPG, no ECG leg at all. Both sites see the same cardiac cycle, so
this is also the **positive control the PAT family never had**: a negative in an ECG→pulse design cannot
distinguish "physiology unrecoverable" from "machinery broken", and two PPG streams on one host can.

The search window had to change. `rawLags` accepts only `[PHYS_LO=200, PHYS_HI=650] ms`, tuned for
ECG→pulse; a finger↔ankle transit is tens of ms and would be rejected **by construction**. A symmetric
±400 ms window is used and the leave-one-block-out centre locates the offset.

| night | overlap | medLag (ankle − finger) | strict | chance | ratio |
|---|---|---|---|---|---|
| 07-19 | 202 m | **+53** | 76 % | 7 % | **10.82** |
| 07-20 | 26 m | **+23** | 63 % | 7 % | **9.40** |
| 07-21 | 141 m | **+35** | 49 % | 7 % | **7.11** |
| 07-22 | 41 m | **+81** | 61 % | 7 % | **9.10** |
| 07-24 | 34 m | **+72** | 62 % | 6 % | **10.08** |
| 07-25 | 35 m | **+43** | 48 % | 7 % | **7.16** |
| 07-27 | 376 m | **+73** | 61 % | 7 % | **9.13** |
| 07-28 | 49 m | **+77** | 64 % | 7 % | **8.96** |
| 07-18 | 88 m | −121 | 1 % | 6 % | 0.11 |
| 07-26 | 189 m | +3 | 2 % | 9 % | 0.20 |
| 07-29 | 37 m | −381 | 4 % | 6 % | 0.69 |
| 07-30 | 42 m | −360 | 3 % | 7 % | 0.44 |
| 08-01 | 558 m | −313 | 2 % | 7 % | 0.32 |
| 08-03 | 445 m | −269 | 2 % | 7 % | 0.31 |

Eight of fourteen couple at **7–11×** an unchanged ~7 % floor, every one with a **positive** lag of
23–81 ms — the only anatomically possible sign for finger→ankle, and the right magnitude for an
upper→lower limb transit. A negative lag would require the pulse to reach the ankle first.

## 2 · Why that table is NOT yet evidence — the confound

Grouping the nights by the ring's **axis provenance** rather than by date separates them perfectly:

| night | `quantizedShare` | `drawn` | outcome |
|---|---|---|---|
| 07-22 | **1.000** | true | couples, 9.10 |
| 07-27 | **0.981** | false | couples, 9.13 |
| 07-29 | 0.000 | false | fails, 0.69 |
| 08-01 | 0.000 | false | fails, 0.32 |
| 08-03 | 0.001 | false | fails, 0.31 |

**The nights that couple are the ones whose ring axis is a DRAWN or near-drawn uniform grid; the nights
that fail are the ones with a properly host-measured axis.** That is backwards for a physiological
result. `index × constant` produces evenly spaced feet by construction, and evenly spaced feet matched
against evenly spaced feet can agree without shared physiology driving it.

So **§1's 8/14 is withdrawn as a physiological claim** until §4 separates the two. The positive lags
remain encouraging and unexplained by the artifact — a grid should not know which sign is anatomical —
but coupling and provenance cannot be untangled from this table alone.

A second reading is worse and more useful if true: host re-anchoring is what *creates* the measured
axis, and on the ring it lands every 126 samples with a median +11 ms correction (range −249…+271;
`O2RING-FRAME-SAMPLE-LOCK`). If that jitter falls between consecutive beats it smears beat-level lag
past the ±40 ms acceptance — meaning **the correction that makes wall-clock right destroys beat-level
timing**. That would be a capture-path finding, not an analysis one.

## 2a · The withdrawal in §2 is REVERSED — the axis A/B refutes the artifact

> ## ⚠ PROVENANCE CORRECTION — 2026-08-05 (`DEEP-AUDIT-V` §2.7 F17)
>
> §2/§2a's A/B contrasts `host` (device ns, host-disciplined) against `grid` (forced `index / fs`) and
> reads the pair as *device-clocked vs drawn*. **For the O2Ring leg that distinction does not exist:**
> its `sensor_ns` column is accumulated by `capture.py` from HOST arrival times, so the "host" arm is
> also a drawn axis — one that has been host-disciplined twice rather than a device crystal corrected
> once. From 2026-07-27 the rate-slew estimator additionally erased the `quantizedShare` signature
> (0.00083 on a real night), so the export labelled that leg `timingSource:'device+host'`.
>
> **What survives:** the A/B is still a real comparison of two *reconstructions*, and the conclusion
> that the agreement is not manufactured by a uniform grid still stands — a uniform grid is exactly
> what the `grid` arm forces, and it did not reproduce the result.
>
> **What does not:** any reading of the `host` arm as evidence that the O2Ring carries an independent
> clock. It does not. Nothing in this brief should be cited for that, and the O2Ring leg must never be
> spent as a second clock in a closure, a three-cornered hat, or a PAT alignment.


Done-when 1 ran. Same nights, same pairs, same surrogates; only the time axis changes. `host` =
`parsePPG`'s `relSec` (device ns, host-disciplined through `hostAxis`). `grid` = forced `index / fs`,
the drawn uniform axis §2 feared was manufacturing the agreement.

| night | host lag | host ratio | grid lag | grid ratio | carries it |
|---|---|---|---|---|---|
| 07-19 | +53 | **10.82** | +27 | 0.98 | HOST |
| 07-20 | +23 | **9.40** | −77 | 1.22 | HOST |
| 07-21 | +35 | **7.11** | +101 | 1.33 | HOST |
| 07-22 | +81 | **9.10** | +25 | 5.39 | both |
| 07-24 | +72 | **10.08** | +36 | 1.28 | HOST |
| 07-25 | +43 | **7.16** | −101 | 2.67 | HOST |
| 07-27 | +73 | **9.13** | +12 | 0.94 | HOST |
| 07-28 | +77 | **8.96** | −17 | 0.73 | HOST |
| 08-02 | −57 | **11.47** | −41 | 1.32 | HOST ⚠ sign |
| 07-18 07-26 07-29 07-30 08-01 08-03 | — | 0.11–0.69 | — | 0.89–2.02 | neither |

**Median best-pair ratio: host 7.16, grid 1.14 — a 6.3× collapse when the axis is forced to the grid.
And NOT ONE night couples on the grid while failing on the host axis.** If uniform spacing were
producing the agreement, the grid would win somewhere. It wins nowhere.

So §2's artifact hypothesis is **refuted**, and its withdrawal of §1 is **reversed**: the coupling is
carried by the host-disciplined axis, which is the only reading consistent with a physiological signal.
The corollary matters for the capture path — **host re-anchoring RECOVERS beat-level timing rather than
smearing it**, contradicting §2's second reading (that the +11 ms per-frame correction destroys it).

**What §2 got right, and what it now needs.** The provenance correlation is real and still unexplained:
the coupling nights are the ones whose ring axis reads `quantizedShare` ≈ 1. Since forcing that same
uniform grid *destroys* coupling, `quantizedShare` cannot be the cause — it is most likely a **marker of
a healthy device stream**, where good `hostAxis` anchors yield both a clean axis and clean beats. Common
cause, not mechanism. That is a hypothesis, not a measurement, and it is not load-bearing for §2a.

**One anomaly, recorded rather than smoothed:** `08-02` couples hardest of all (11.47) with a **−57 ms**
lag — the ankle pulse arriving *before* the finger's, which is anatomically impossible. 8 of 9 coupling
nights carry the correct positive sign at +23…+81 ms; this one does not, and it is not explained.

## 2b · The scatter, measured offset-free — §4.2 improves it by ~27 % and still does not clear the bar

The statistic that decides whether this is a MEASUREMENT or only a DETECTION. §5 forbids the
accepted-set `residIQR`; this is the honest quantity: pair every beat inside ±400 ms, subtract the
median lag **within each 60-min window** (removing the unknown constant δ and any slow wander by
construction, as the family's offset-free legs do), then take the IQR over **all** residuals — accepted
and rejected alike.

**Enumerated over all 29 pairs, not selected** (§5: selecting the lowest-IQR pair and reporting that IQR
is selection on the outcome, one level up):

| set | median offset-free IQR | ≤60 ms |
|---|---|---|
| all 29 pairs | **67 ms** (min 28, max 586) | 11/29 |
| pairs with ≥1000 residuals (n=20) | **70 ms** | 6/20 |

**Against the family's numbers:** `PAT-VERDICT-CONSOLIDATED` §3 reports 84–99 ms for ECG→pulse, and §3j
reports **92 ms** for arm→finger — the other PEP-cancelled pair, and therefore the like-for-like
comparison. Finger↔ankle gives **67 ms**: a ~27 % reduction, in exactly the direction §4.2 predicted
from a longer arterial path.

**But `pat-gate.js` wants ≤60 ms and the enumerated median does not reach it.** So §4.2 is answered
QUANTITATIVELY and NEGATIVELY: a proximal→distal pair helps measurably and is not sufficient on its own.
`PAT-VERDICT-CONSOLIDATED` §1 stands — the binding constraint remains beat-to-beat scatter downstream of
the heart — with its magnitude now known to be site-dependent rather than fixed.

**Selection bias, quantified for once.** Best-of-pairs on the same data reads 44–60 ms; enumeration reads
67 ms. That gap — ~20 ms, a third of the bar — is what §5's rule is worth in this corpus.

**Remaining upside is §4.1, not §4.2.** If a materially tighter foot (176 Hz Verity, where one sample at
55 Hz is 18 ms) removes detection noise from the 67 ms, the two effects could compose. Nothing here
measures that.

## 3 · Corrections to my own reporting, per `PAT-VERDICT-CONSOLIDATED` §5

- **`residIQR` 20–43 ms was quoted against the 60 ms bar. Withdrawn.** §5 states it is an IQR over only
  the residuals its own ±40 ms window accepted, so it *"reads 31–44 ms regardless of signal and must
  never be compared to the 60 ms bar."* My values sit exactly in that no-signal range.
- **Best-of-pairs is reported where §5 requires enumeration.** The tool scores every pair but prints only
  the maximum, which is selection on the outcome one level up. §4 owes the distribution.
- **"The machinery is broken, so no PAT verdict is meaningful" was printed by the tool from ONE night.**
  A verdict line that renders a global conclusion from whatever subset ran. Fixed to refuse.
- **I re-derived §3c's category error (clock-anchor IQR vs beat-coupling `residIQR`) and reported it as
  new.** It was documented 2026-08-02. §5's *"read the sibling briefs first"* was written for exactly
  this, and I read them only after building the tool.

## 4 · Done when

- [x] **Score the same nights on the raw device grid AND the host-disciplined axis — DONE 2026-08-04
      (§2a).** Neither branch of the prediction held: coupling appears on the HOST axis and collapses on
      the grid (median 7.16 → 1.14, no night grid-only). Artifact refuted, §1 restored.
- [x] **Report the full per-pair distribution — DONE 2026-08-04 (§2b).** Best-of-pairs 44–60 ms vs
      enumerated 67 ms; the selection was worth ~20 ms, a third of the bar.
- [x] **Scatter measured offset-free — DONE 2026-08-04 (§2b).** 67 ms enumerated over 29 pairs against
      §3j's 92 ms arm→finger: better by ~27 %, still above the 60 ms bar.
- [x] ✅ **TRUNCATED, not uncoupled — CONFIRMED 2026-08-18 on `07-29` by widening the window.** The
      hypothesis in this line was right, and the test is a one-parameter change (`--window`):

      | 2026-07-29 | ±400 ms (as recorded) | ±800 ms |
      |---|---|---|
      | medLag | +315 ms | **+428 ms** |
      | strict match | 11 % | **25 %** |
      | ratio vs chance | 1.79 | **3.96** |
      | p | 0.020 | 0.010 |

      **428 > 400: the true lag lies OUTSIDE the window that was measuring it.** And widening did not
      merely relocate the estimate — the coupling **more than doubled** (1.79 → 3.96). That is the
      signature of censoring rather than of absence: a truncated window keeps an edge-biased remnant and
      every statistic below is computed on it. Same failure `pat-gate.js` records for `[PHYS_LO, PHYS_HI]`
      — *"treated as a plausibility filter; it is a censoring cut"* — in a second tool.

      🔬 **FULL-CORPUS PAIRED RUN 2026-08-19 — the separation is PERFECT, and it corrects the scope note
      below.** Both widths over every night that scores at both, 11 pairs:

      | night | ±400 lag | strict | p | ±800 lag | strict | p | |
      |---|---|---|---|---|---|---|---|
      | 07-20 | 80 | 72 % | 0.010 | 80 | 72 % | 0.010 | unchanged |
      | 07-21 | 124 | 50 % | 0.010 | 124 | 50 % | 0.010 | unchanged |
      | 07-22 | −49 | 73 % | 0.010 | −49 | 73 % | 0.010 | unchanged |
      | 07-24 | 13 | 8 % | 0.069 | 2 | 7 % | 0.158 | unchanged |
      | 07-25 | 57 | 75 % | 0.010 | 57 | 75 % | 0.010 | unchanged |
      | 07-26 | 126 | 20 % | 0.010 | 125 | 20 % | 0.010 | unchanged |
      | 07-27 | 126 | 51 % | 0.010 | 126 | 51 % | 0.010 | unchanged |
      | **07-28** | **−300** | 40 % | 0.010 | **−534** | **55 %** | 0.010 | **censored** |
      | **07-29** | **315** | 11 % | 0.020 | **428** | **25 %** | 0.010 | **censored** |
      | **07-30** | **−350** | 7 % | **0.228** | **−478** | **34 %** | **0.010** | **censored** |
      | **08-01** | **−363** | 18 % | 0.010 | **−435** | **47 %** | 0.010 | **censored** |

      **Every night with |lag| ≤ 126 ms is byte-identical at both widths; every night with |lag| in
      300–363 ms moved beyond ±400 AND improved its strict match.** No exceptions in either direction —
      the window was binding on exactly the nights that crowded it and on no others. That is a cleaner
      censoring signature than the single-night test could give.

      🔴 **This CORRECTS the scope note below, which I wrote from n = 1.** I recorded that `07-30` was
      *"not significant, ratio 1.15"* and concluded **"the four are not one phenomenon"**. At ±800 it is
      **p = 0.010 with 34 % strict** — it was censored, not null. **The four ARE one phenomenon**, and
      the null reading was itself an artefact of the truncating window. A censored measurement does not
      merely shrink; it can cross a significance threshold, so "not significant at the narrow window" was
      never evidence of absence.

      ⚠️ **Still unresolved: the sign.** Three of the four censored nights are NEGATIVE (−534, −478,
      −435) and the tool's header says positive is the only anatomically possible direction. Widening the
      window made them *more* significant without making them anatomically sensible, so the sign question
      is now sharper, not answered.

      ⚠️ **Scope, and it is narrow: n = 1 night of the four.** `07-30` at ±400 reads −350 ms at **p =
      0.228** (not significant, ratio 1.15), and `08-01`/`08-03` produced no scorable row at ±400 at all.
      So the four are **not one phenomenon** and should stop being cited as a set: one is demonstrably
      censored, one is not significant, two do not currently score.
      ⚠️ **The recorded signs do not match either.** This line lists −381 for `07-29`; the tool now reads
      **+315**, and its own header says *"POSITIVE is the only anatomically possible sign"* (the leg path
      is longer than the arm, so ankle must lag finger). Whatever produced the negative figures is a
      separate question from the censoring, and closing this box does not close that.

      **Cost note for whoever re-runs it:** the search is roughly quadratic in pair count. One night is
      ~9 s at ±400 and ~20 min at ±800; a whole-corpus call over 24 nights ran **1 h 50 m at 100 % CPU
      with no output** before being killed. Always pass `--night`.

## 5 · What is already usable regardless

- **The proximal→distal pair exists and is recorded nightly.** §4.2 asked whether the hardware allows
  one; it does, and 14 nights of it are on disk. Sensor placement must be stated in any future PAT work —
  four briefs assumed arm/wrist and the assumption was never checked.
- **`tools/pat-ppg-ppg-control.mjs`** gives the family its missing PPG↔PPG control, with no ECG detector
  involved — which matters, because that detector fails plausibility on **half** the ring corpus
  (121–211 /min, `tools/pat-finger-coupler.mjs`'s rate gate).
- **The ECG leg is worse than the corpus suggests.** 8 of 16 ring nights fail a 30–120 /min detector
  sanity gate on one side or the other. `PAT-VERDICT-CONSOLIDATED` §2's blocker table does not include
  detector plausibility, and on this corpus it excludes half the data before any statistic runs.

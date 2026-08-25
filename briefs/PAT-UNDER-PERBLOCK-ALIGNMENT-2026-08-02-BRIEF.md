<!--
  PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-15 (**all seven Done-when boxes are closed**, the last of them a recorded owner-style decision — *"DECIDED 2026-08-08 — NO, not as a shipped whole-night metric. The evidence is sufficient"* — which is a resolution, not an omission. ⚠️ **DONE does not mean the PAT question is settled**: §3f.4 *What is NOT claimed* deliberately parks two items, and they are parked rather than owed — (a) the 20/57 count is a magnitude and the binomial tail is **not quotable** because windows from one night and from overlapping pairs are not independent; (b) **the intermittency is not attributed**, and the tool already carries per-window `ppm` for that test — it has simply not been run. Anyone reviving PAT should start there. Related and newer: `INTEGRATOR-PAT-VASCULAR-2026-07-18` §2-RESULT-III…XII, which reaches the same conclusion about window-dependence from a different direction and records the `w/√12` ratio test as the recommended gate.) · **Created:** 2026-08-02 · **Executes:** `CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md` §3.2 · **Corrects:** `WEARABLE-DRIFT-FIT-2026-08-01-BRIEF.md` §3, `CLOCK-CLOSURE-THREE-SOURCE-2026-08-01-BRIEF.md`, and §3.2 of the brief it executes

# PAT is not blocked by alignment. It is blocked by pulse transit time itself.

> ### ⚠ THE TITLE CLAIM IS WITHDRAWN — §3c–§3g (2026-08-04)
> It was blocked by alignment after all, and by offset *identifiability*. The IQR/driftRange legs §1–§2
> report are real, but the **coupling** leg they rest beside was measuring alignment error: §3a's
> negative reverses under a better pair (§3c), under no alignment at all (§3d), and under a matched-null
> offset scan on **47 of 57** windows (§3g). The ACC anchors it used disagree with *themselves* by
> **1171–3094 ms** (§3e). Coupling is real; **absolute PAT remains blocked**, now for the stated reason
> that the offset is knowable only to a **~450 ms band mod one RR** (§3g.2).
> **Read §3h before §3g** — §3c–§3g were written without reading `PAT-NO-VALID-ANCHOR-2026-08-02`, which
> is IN-PROGRESS in this same family and already contains parts of them at larger n. Where the two speak
> to the same question, that one wins.

§3.2 says the alignment precision PAT needs *"is reachable on this hardware, which the previous
measurement concluded it was not"*, citing **43–112 ms, median ≈50 ms**. That citation traces back to
`WEARABLE-DRIFT-FIT` §3 — **and it is the wrong quantity.** The 50 ms is the residual of the
*block-offset fit*. `pat-gate.js` scores the *beat-to-beat pulse-arrival* IQR. Two different numbers
with the same units.

Measured properly — per-block alignment, then the first pulse foot after each R-peak, scored through
the repo's own `PatGate.verdict`:

| night | matchRate | residIQR | median lag | driftRange | **verdict** | chance matchRate |
|---|---|---|---|---|---|---|
| 2026-07-20 | 95 % | **181 ms** | 424 ms | **488 ms** | WEAK COUPLING | 60 % |
| 2026-07-22 | 90 % | **197 ms** | 429 ms | **472 ms** | WEAK COUPLING | 60 % |
| 2026-07-23 | 94 % | **177 ms** | 405 ms | **535 ms** | WEAK COUPLING | 53 % |
| 2026-07-25 | 93 % | **174 ms** | 417 ms | **325 ms** | WEAK COUPLING | 69 % |
| 2026-07-26 | 96 % | **139 ms** | 496 ms | **442 ms** | WEAK COUPLING | 62 % |
| 2026-07-28 | 94 % | **145 ms** | 489 ms | **384 ms** | WEAK COUPLING | 60 % |

Bars: coupling ≥ 0.55, beat IQR ≤ 60 ms, median lag ∈ [60, 700] ms, drift ≤ 60 ms.

## 1 · What passes, and what does not

**The median lag passes on every night — 405–496 ms, squarely inside the physiological window.** That
is a real pulse arrival time, and it is the first time this corpus has produced one that survives its
own gate's `physical` check under an alignment that is not itself suspect.

**The IQR fails by 2.3–3.3×** (139–197 ms against ≤60), and **`driftRange` fails by 5–9×** (325–535 ms
against ≤60). `driftRange` here is the spread of the per-block PAT *medians* across the night.

## 2 · And that failure is PHYSIOLOGY, not clocks

This is the finding. Alignment is no longer the limiting term: correspondence is 90 %+ per block, and
the offset is refit locally so no drift accumulates inside a block. What remains is **pulse transit
time varying by 325–535 ms across a night and 139–197 ms beat to beat** — which is what PTT does.
Posture changes venous return, blood pressure moves through the night, vasomotor tone shifts with
sleep stage. A single-site PAT with a ≤60 ms stability bar is asking the vasculature to hold still.

**So §3.2's conclusion inverts.** PAT was not *"closed on a measurement artifact"*. Removing the
artifact makes the alignment good and reveals the real obstacle, which is larger and is not a
software problem. The gate is behaving correctly on all six nights.

> **Caveat, stated because it weakens the coupling leg.** `matchRate` as computed here is the fraction
> of R-peaks with *any* pulse foot in the 640 ms physiological window, and its **chance control runs
> 53–69 %** — a 640 ms window with ~1 s beats fills easily. So 90–96 % is only ~1.5× chance, not the
> strong margin it looks like. The coupling leg needs a stricter definition before it is evidence;
> the IQR and driftRange legs do not depend on it.

## 3 · What this corrects

- `WEARABLE-DRIFT-FIT` §3 and `CLOCK-CLOSURE-THREE-SOURCE`: *"`medianIqrMs` 52 ms, inside
  `pat-gate.js`'s ≤60 ms bar … the alignment precision PAT needs is reachable"* — **wrong quantity**.
  That 52 ms is a fit residual; PAT's bar is on the pulse-arrival distribution, which is 139–197 ms.
- `CROSS-DEVICE-DRIFT-AND-CLOSURE` §3.2, which cites those numbers in good faith.

Both were honest readings of a number that was measuring something else. The tell was available and
missed: a *fit residual* and a *physiological interval* have no reason to share a threshold.

## 3a · The stricter `matchRate` — built and measured 2026-08-03 (`tools/pat-matchrate-strict.mjs`)

**The floor has two causes, and §2's caveat names only the first.**

1. **The window is wide relative to a beat.** Stage one accepts the first foot with a lag in
   `[PHYS_LO=200, PHYS_HI=650]` — 450 ms against a ~750–1000 ms RR.
2. **Stage two is self-referential, so it cannot repair stage one.** It keeps a beat whose lag is
   within `LAG_TOL_MS=90` of a **30 s local median of those same lags**. Feed it noise and the median
   tracks the noise. *A test whose reference is derived from the data it is testing cannot fail.*

**The strict definition** fixes (2), which is what actually matters: each 5-min block's acceptance
centre is the median lag of **the other blocks** (leave-one-block-out), window ±40 ms. A night with
no real R↔foot relationship has no centre that generalises across blocks. Chance for **both** comes
from **circular-shift surrogates of the real foot train** — which preserve its rate, regularity and
dropouts and destroy only the R↔foot phase. An idealised Poisson floor would understate chance
wherever the feet are regular, which for a pulse train is everywhere.

Alignment is via the repo's own `PATAlign.alignByAnchors` on the **chest/arm accelerometers**, applied
once before surrogation — so every surrogate is a rotation of the same aligned train, and whatever
favour alignment grants the observation it grants the null identically.

| night | overlap | anchors | beats | legacy | its chance | strict | its chance | ratio | p |
|---|---|---|---|---|---|---|---|---|---|
| 2026-07-20 | 365 m | 17 | 18155 | 33 % | 19 % | 8 % | 7 % | 1.22 | 0.03 |
| 2026-07-22 | 266 m | 9 | 13328 | 25 % | 20 % | 6 % | 7 % | **0.85** | 1.00 |
| 2026-07-23 | 37 m | 7 | 1798 | 24 % | 18 % | 5 % | 7 % | **0.74** | 1.00 |
| 2026-07-25 | 153 m | 7 | 7542 | 42 % | 20 % | 9 % | 7 % | 1.35 | 0.03 |
| 2026-07-26 | 177 m | 29 | 12919 | 33 % | 23 % | 7 % | 9 % | **0.80** | 1.00 |
| 2026-07-28 | 182 m | 6 | 8837 | 30 % | 18 % | 6 % | 6 % | **0.93** | 0.83 |

**The open item is answered: yes, such a definition exists — chance floor 6–9 %, not 60 %.**

**And under it the coupling leg does not survive.** Observed strict `matchRate` is 5–9 %, i.e. *at*
its own floor; **four of six nights score BELOW chance** and only two reach p<0.05, at ratios 1.22
and 1.35. There is no R→foot coupling here beyond what a phase-randomised foot train produces.

> ### ⚠️ Do not read that as settled — this harness does not reproduce §2's own numbers.
> §2 reports legacy `matchRate` **90–96 %** with a **53–69 %** chance floor. The same statistic, ported
> verbatim, reads **24–42 %** here with an **18–23 %** floor — a ~3× disagreement on the *observed*
> value and a ~3× disagreement on the *floor*, on the same six nights.
>
> So one of two things is true, and this brief cannot yet say which: either §2's pairing/alignment is
> better than this harness's (in which case the strict result is measuring a worse alignment, not an
> absence of coupling), or §2's numbers are inflated by a wider effective window or a weaker chance
> control. **The ratio agrees even where the levels do not** (1.2–2.1 legacy here vs ~1.5 there), which
> is mildly reassuring and is not a reconciliation.
>
> **Until the 24–42 % vs 90–96 % gap is explained, the strict numbers above are a method result, not a
> verdict on PAT.** The likeliest source is pair selection: a night here is dozens of BLE-reconnect
> fragments (2026-07-18: 110 ECG × 414 Verity PPG) and this tool picks the largest-true-overlap pair,
> which need not be the one §2 scored.

## 3b · A shipped defect found while building §3a — the denominator counted uncoverable beats

Fixed 2026-08-04 in **both** copies of the coupler (`pat-align.js coupleRtoFoot`,
`pat-feasibility-worker.js coupledPAT`).

`matchRate` was `pairs / (every R-peak in the ECG recording)` — including beats the PPG recording does
not span at all. Those cannot be paired, so each was counted as a **coupling failure**. The statistic
therefore measured **recording overlap** as much as coupling, and the two devices routinely disagree on
length (batteries, BLE reconnects; a night in this corpus is dozens of fragments per device).

It flipped the gate, measured through `PATGate.verdict` itself: a perfectly-coupled 2 h ECG paired with
the 1 h PPG overlapping it scores 0.50 against `COUPLING_MIN 0.55`, **fails `goodMatch`, and drops from
`go`/FEASIBLE to `maybe`/PROMISING** — with `tightBeat`, `physical` and `driftOK` all identical. The only
thing separating the two verdicts was how long the ECG ran. And `overlap()` already reports the shared
span as its **own** gate leg (`ov.min`), so the overlap fact was counted twice while coupling was not
measured at all.

The denominator is now the R-peaks the PPG could physically have covered — `[F.first − hi, F.last − lo]`,
since a foot for beat *r* can only exist at *r*+[lo,hi]. No new parameter; `matchRateRaw` keeps the old
value. Where the trains have equal extent the two are identical, **which is why nothing caught it**:
every pre-existing assertion used equal-extent trains, and the corpus runs read the deflated number as a
finding about the vasculature.

> **This does NOT close the §2 reconciliation below — it slightly widens it.** The old denominator
> *deflates* `matchRate`, so §2's 90–96 % is a lower bound on its own pairs, while §3a's 24–42 % was
> already computed on beats clipped to the shared window (i.e. the corrected basis). Fixing the defect
> can only raise §2's numbers, not lower them toward §3a's. The gap remains unexplained.

## 4 · Done when

- [x] PAT scored by `pat-gate.js` itself, not by a hand-rolled proxy, under per-block alignment.
- [x] Six nights, each with a chance control.
- [x] The over-claim in three briefs corrected at its source.
- [x] A stricter `matchRate` whose chance floor is not 60 % — **DONE 2026-08-03** (§3a).
      `tools/pat-matchrate-strict.mjs`: leave-one-block-out acceptance centre, ±40 ms, scored against
      circular-shift surrogates. Measured floor **6–9 %**. Gate-backed in the Node lane by a synthetic
      group that pins the self-referential flaw rather than a corpus number.
- [x] **A shipped defect in the coupler's denominator, found while building §3a** — fixed 2026-08-04
      in both copies, gate-backed through `PATGate.verdict` (§3b).
- [x] **Reconcile this harness with §2 — DONE 2026-08-04 (§3c).** It is **pair selection**, measured:
      legacy `matchRate` spans **0-77 %** across candidate pairs *within a single night*, it is
      inversely related to overlap length, and §3a selects on maximum overlap — so §3a sits near the
      bottom of that range on all four nights checked and §2 (hand-loaded short fragments) near the top.
      The port and the ACC alignment were both confirmed identical and explain nothing.
      **§3c.3: this inverts §3a's coupling verdict** — on a better pair of the same night, strict reads
      29-35 % against an unchanged 7 % floor (ratio 4.19 / 5.27) where §3a read 0.79-1.22.
      **§3c.4: neither rule is principled.**
      **§3d (2026-08-04) then WITHDRAWS §3c.5's proposed fix and finds the real term:** signal quality
      does not vary (28 pairs — ECG continuity 100 % in every one, feet/beat 0.91-1.00, all |r| <= 0.22
      against a matchRate spanning 1-99 %), while scoring the SAME pair with and without the ACC
      alignment moves it by up to **+53 / -72 points** and yields **94-100 %** on four pairs — §2's
      range, reproduced. So §3a's negative measures **alignment error, not absence of coupling** —
      which was §3a's own first listed possibility. No coupling verdict is quotable from §2, §3a or
      §3c until the per-pair offset is measured directly (§3d.4).
- [x] **DECIDED 2026-08-08 — NO, not as a shipped whole-night metric. The evidence is sufficient and
      it is not close.** The prerequisite above is closed (§3d), and the §3d caveat does not reach the
      evidence this rests on: §3d voids verdicts drawn from *offset-dependent* measurements, while
      `couplingStable` cancels the offset **by construction** (fraction of beats within ±100 ms of the
      night's own modal lag). So a verdict is quotable from §3i, and it is the same verdict from two
      independent harnesses:

      | | coupling level | bar | verdict |
      |---|---|---|---|
      | `INTEGRATOR-PAT-VASCULAR`, offset-free | 18.8 / 19.2 / 19.0 % | ≥ 55 % | **0 / 54** |
      | here, best-scan | median 15–16 % | ≥ 55 % | 0 / 54 whole nights |

      And on the binding number, `residIQR` against a 60 ms bar: theirs **95.6–98.7 ms, 0/54**; here
      **84 ms median (36–99)**. The gap is not marginal — it is a third to a half of the quantity,
      in the same direction, on both harnesses, at the more generous acceptance band.

      **Dual-site does not rescue it (§3j).** Arm→finger scatter is **≤ 92 ms** against the same 60 ms
      bar, and the scatter is demonstrably **not** the pre-ejection period — so the obvious hardware
      answer removes a confound that is not present. The differenced form is still worth running for
      completeness since both legs exist, but it must take 92 → ≤ 60 ms to matter, and removing an
      absent confound cannot do that. It is a completeness run, not a live hypothesis.

      **What is decided:** no PAT metric ships from single-site optical on this corpus, at any evidence
      tier. The harnesses (`pat-gate.js`, `pat-matchrate-strict.mjs`) stay as **diagnostics** — they are
      how this was measured and how it would be re-measured — and nothing surfaces a PAT number to a
      user. The obstacle is PTT variability, which is physiology, not instrumentation; no better
      alignment, longer block, or second optical site addresses it.

      **What is NOT decided, and must not be read into this.** The negative is about **whole-night**
      PAT. At 60-min granularity **10 of 52 windows DO clear the 60 ms bar** (§3i.2) — windowing helps,
      just not enough to gate a night. So a *per-window* PAT, gated per window and honest about
      covering a minority of the night, is **not refuted by this evidence**; it was never measured
      against its own bar. That is a different question and would need its own brief. Recording it
      because the tempting misreading of this decision is "PAT is dead", and what the data says is
      "whole-night PAT is dead, and the windowed form is untested".

      **What would overturn it:** an offset-free `residIQR` at or under 60 ms on whole nights. That is
      the single number; everything else is commentary on it.

      ### ⚠ STATUS DOWNGRADED 2026-08-09 — the decision above is UNVERIFIED, and there is now a
      ### specific reason to expect it is measuring the capture path, not the physiology

      **(a) I did not reproduce it.** Every number in the decision came from §3i/§3j tables. Attempted
      independently: the committed `uploads/trio/` and `acc-corpus/` night dirs hold **node-exports
      only** — 5-min epochs, no beat train — so `residIQR`, a beat-level statistic, is not computable
      from them at all. Rebuilt night dirs from the raw `_ECG`/`_PPG`/`_ACC` captures instead;
      `pat-matchrate-strict.mjs` then refuses with *"no overlapping ACC on one or both devices"* on a
      night where **both ACC files are present**, so its alignment precondition — not the data — is
      the blocker. Reproduction incomplete. Treat the verdict as provisional.

      **(b) The corpus it was measured on has NO SECOND CLOCK.** Measured directly, host column against
      device column, on the H10 ECG captures: spread is **0.98 ms on every night** (06-06, 06-07,
      06-10, 06-11 ×2, 06-12). Clock Contract §7 fixes the discriminator — phone captures span
      **0.13–1.00 ms**, box captures **101.89–5124 ms** — and 0.98 ms is one stamp quantum, i.e. the
      host column IS the device stamp rounded. `independent = false`. These are phone captures, so the
      two devices were never placed on a common timebase; §7 records the consequence directly, an
      H10↔Verity offset of **~3.3 s on phone nights against ~0.2 s on box nights**.

      That matters because `residIQR` is **beat-level scatter between two devices**. With no shared
      clock, per-device timebase wander lands in the lag distribution and is **indistinguishable from
      PTT variability** in that statistic. The decision above attributes 84–99 ms to physiology. On
      this corpus that attribution is not identifiable — the confound and the claim have the same
      signature.

      ### The proposed route, and it is cheap

      1. **Capture on the box, not the phone.** The vigil host is chrony/local-stratum-1 at 0.008 ppm
         and re-syncs both Polar clocks on every connect, so its host column is a genuine second clock
         (`independent = true`, spread ≫ 2 ms) and both devices ride ONE timebase.
      2. **Refuse the verdict where the clock does not exist.** `DexClock.hostAxis` already publishes
         `independent` and `spreadMs`. A PAT/coupling gate should decline to report on a night with
         `independent === false` rather than quote a number built on a single clock. That is a
         shippable guard and it does not need new data.
      3. **Re-run offset-free `residIQR` on box nights only**, against the same 60 ms bar.
      4. **The discriminator is sharp.** If `residIQR` falls materially below 84–99 ms on box nights,
         the scatter was the timebase and PAT is reachable. If it does not move, the physiology verdict
         stands — and is then actually earned, on a corpus where it could have failed.

      Until (3) is run, the decision above should not be cited as settled, and nothing about PAT should
      be shipped either way.

---

## 3c · RECONCILED 2026-08-04 — the gap is pair selection, and §3a's rule picks the WORST pair

§3a's open item ("**until the 24–42 % vs 90–96 % gap is explained, the strict numbers are a method
result, not a verdict on PAT**") is closed. Its own guess was right, and the consequence is larger than
the guess: the selection rule is **anti-correlated with the statistic it feeds**.

### 3c.1 · §3a reproduces exactly — so the port and the alignment are not the difference
Re-running §3a's own code reproduces its table row-for-row on every night checked
(2026-07-20 `365 m / 18 155 / 33 %`, 07-22 `266 m / 13 328 / 25 %`, 07-25 `153 m / 7 542 / 42 %`,
07-26 `177 m / 12 919 / 33 %`). Both harnesses were also confirmed to share stage-one acceptance
verbatim (`PHYS_LO=200`, `PHYS_HI=650`, `LAG_SEARCH_MS=2000`, identical break conditions) and the
**same** `PATAlign.alignByAnchors` ACC alignment — `pat-feasibility-worker.js` contains no per-block
beat-fitted refit, so §2's "the offset is refit locally" describes those ACC anchors, not a second
mechanism. **Neither the port nor the alignment explains anything.**

### 3c.2 · Pair choice alone spans the gap  `[CORPUS]`
Legacy `matchRate`, every candidate pair of the 10 largest ECG × 10 largest Verity-PPG fragments:

| night | §3a's pick (largest overlap) | range across pairs | best pair |
|---|---|---|---|
| 2026-07-20 | 33 % (365 m) | **20 – 77 %** | 77 % (30 m) |
| 2026-07-22 | 25 % (266 m) | **0 – 74 %** | 74 % (45 m) |
| 2026-07-25 | 42 % (153 m) | **13 – 72 %** | 72 % (16 m) |
| 2026-07-26 | 33 % (177 m) | **0 – 72 %** | 72 % (20 m) |

**`matchRate` is inversely related to overlap length**, and §3a selects on *maximum* overlap — so on
all four nights it picks a pair near the bottom of the available range. §2, driven by hand in
`PAT Feasibility.html` one file at a time, would have loaded a short well-matched fragment: the high
end of exactly this distribution. **§3a's numbers are a lower bound and §2's an upper bound of one
quantity**, which is why "the ratio agrees even where the levels do not".

### 3c.3 · And it inverts §3a's coupling verdict  `[CORPUS]`
Same night, same code, same surrogates — only the pair rule changes:

| night | rule | beats | legacy | chance | **strict** | **chance** | **ratio** |
|---|---|---|---|---|---|---|---|
| 2026-07-20 | largest overlap | 18 155 | 33 % | 19 % | 8 % | 7 % | **1.22** |
| 2026-07-20 | best legacy | 1 584 | 77 % | 26 % | **29 %** | 7 % | **4.19** |
| 2026-07-26 | largest overlap | 12 919 | 33 % | 23 % | 7 % | 9 % | **0.79** |
| 2026-07-26 | best legacy | 1 366 | 51 % | 26 % | **35 %** | 7 % | **5.27** |

§3a concluded *"there is no R→foot coupling here beyond what a phase-randomised foot train
produces."* On a better pair of the same night there plainly is — 29 % and 35 % against an unchanged
**7 %** floor. **That conclusion was drawn on the least favourable pair available, every night.**

### 3c.4 · What this does NOT license
**Selecting a pair BY `matchRate` and then reporting `matchRate` is circular** — the same
self-reference §3a diagnosed in stage two, moved up a level. 4.19 is an upper bound exactly as 1.22 is
a lower bound, and neither p-value accounts for the selection. The best pairs are also **short**
(16–45 min, 1.3–2.6 k beats against 12–18 k), so they are noisier and give leave-one-block-out only a
handful of blocks.

**The real finding is that `matchRate` is not well defined without a pair-selection rule, and neither
existing rule is a principled one** — one is arbitrary (longest), one is circular (highest-scoring).

### 3c.5 · What to do
Select the pair on **signal quality computed independently of the PAT statistic** — continuous
presence of both recordings across the window (no dropout), ECG SNR, PPG perfusion — then re-run both
definitions on that pair and let the strict statistic answer with the selection no longer free. Until
that lands, **no coupling verdict should be quoted from either §2 or §3a**, including §3a's negative
and including `O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS` §5.4's, which inherits the same rule.

## 3d · The signal-quality rule §3c.5 asked for cannot be built — and the real term is ALIGNMENT

§3c.5 recommended selecting the pair on signal quality computed independently of the statistic. That
recommendation is **withdrawn: there is no quality variation to select on.** Measured over **28
candidate pairs** on the six nights, every outcome-independent quality feature is near-constant while
`matchRate` spans almost the whole range `[CORPUS]`:

| feature | range across 28 pairs | pooled r vs `matchRate` |
|---|---|---|
| ECG continuity (30 s epochs ≥ 20 beats) | **100 % in every pair** | — (constant) |
| feet-per-beat ratio | 0.91 – 1.00 | +0.22 |
| PPG continuity | 92 – 100 % | −0.06 |
| overlap minutes | 11 – 365 | −0.19 |
| ACC anchor count | 0 – 29 | −0.22 |
| **legacy `matchRate`** | **1 % – 99 %** | — |

Both detectors work in *every* pair, at ~1:1 feet per beat. The obvious mechanism — a PPG dropout
capping `matchRate` — would show as a feet/beat deficit, and there is none.

### 3d.1 · Same pair, aligned vs unaligned — the alignment is the term  `[CORPUS]`
Scoring each pair **both ways** removes the short-fragment confound (the pairs whose ACC alignment
fails are all short, so §3c's aligned/unaligned split was entangled with duration). Pairs where the
alignment could not run score **+0** by construction, which validates the probe. Where it did run:

| pair | ACC-aligned | zero-offset | Δ |
|---|---|---|---|
| 2026-07-20 30 m | 77 % | **100 %** | +23 |
| 2026-07-26 26 m | 51 % | **99 %** | +49 |
| 2026-07-28 51 m | 45 % | **94 %** | +48 |
| 2026-07-20 91 m | 30 % | **83 %** | +53 |
| 2026-07-22 266 m | 25 % | 52 % | +27 |
| 2026-07-22 45 m | 74 % | **2 %** | −72 |
| 2026-07-20 365 m | 33 % | 26 % | −7 |

**Removing the ACC alignment produces 94–100 % `matchRate` on four pairs** — §2's 90–96 % range,
reproduced. It also destroys others (74 % → 2 %). The distribution is **bimodal**: when the raw
offset lands inside the `[200, 650]` ms window coupling is near-total, and when it does not it
collapses. The ACC correction pulls both cases toward the mediocre middle §3a reported.

### 3d.2 · What this means for §3a's verdict
§3a listed two possibilities and could not choose between them:

> either §2's pairing/alignment is **better** than this harness's (in which case the strict result is
> measuring a worse alignment, not an absence of coupling), or §2's numbers are inflated …

**The first one.** There is strong R→foot coupling in this corpus — up to **100 %** `matchRate` — and
§3a's harness is measuring alignment error on top of it. Its negative is **not** evidence that pulse
transit is uncoupled from the ECG.

### 3d.3 · Why zero-offset is a legitimate comparison and not another circular choice
Picking the best pair *by* `matchRate` is circular (§3c.4). **Zero offset is not fitted to anything**
— it is the a-priori model for a **box-captured** pair: both streams are stamped by the *same*
NTP-disciplined daemon, so the offset between them should already be ~0 and the ACC estimate is
correcting a quantity that was not wrong. That is a hypothesis about the capture path, testable
without reference to the outcome, which is why it may be tested against the outcome.

It is **not** a proposed default: it fails badly on some pairs, so a per-pair residual (differential
BLE delivery latency) plainly exists.

### 3d.4 · What to do instead of §3c.5
1. **Measure the per-pair offset directly** rather than estimating it from ACC — for box captures the
   two host-stamp series are the measurement, and `DexClock.hostAxis` already formalises this shape.
2. **Then** re-run both `matchRate` definitions under it, with the pair rule fixed a priori.
3. Until (1) lands, **no coupling verdict from §2, §3a or §3c is quotable** — nor
   `O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS` §5.4's, whose zero-offset run now looks like the *right*
   model for a box capture rather than a compromise forced by the ring having no ACC.

## 3e · §3d.4 step 1, answered: the ACC anchors cannot supply an offset at PAT precision

§3d blamed the ACC correction's *wander* and asked for the per-pair offset to be measured directly.
Measured — and the framing in §3d was too generous. **There is no stable offset for the interpolation
to wander around.** Over the **18 pairs** that produce anchors at all `[CORPUS]`:

| | measured | PAT's requirement | ratio |
|---|---|---|---|
| **offsetRange** (max − min of the anchor offsets **within one pair**) | **1171 – 3094 ms** | stage-two tolerance ±90 ms | **13 – 34×** |
| | | whole acceptance window 450 ms | **2.6 – 6.9×** |
| | | `pat-gate.js` `residIQR` bar 60 ms | **19 – 51×** |
| median anchor offset, across pairs | −91 … +1400 ms | — | — |

The anchors inside a single fragment disagree with **each other** by one to three *seconds* about a
quantity that must be known to tens of milliseconds. `offsetRangeMs` is exactly `max − min` of those
offsets (`pat-align.js`), so this is not a derived or modelled figure.

### 3e.1 · Which is why no offset model wins
Three models over the **same** anchors — piecewise-linear `interp` (what ships), a single `const` =
median of the same anchors, and `zero` (the a-priori box-capture model):

```
mean legacy matchRate     interp 37 %      const 35 %      zero 42 %
head-to-head              const > interp  9/18      zero > interp  8/18      zero > const  8/18
```

Three coin-flips. That is the signature of all three being **noise around the same mid-range**, not of
one model being better — and it is what §3d's "no consistent winner" looked like before the anchor
spread explained it.

### 3e.2 · What survives
- **The 94–100 % pairs of §3d.1 remain the only direct evidence of real R→foot coupling in this
  corpus** — and they are evidence *because* they applied **no estimated offset at all**, not because
  zero is the right model (§3d.3 already said it is not a default; §3e.1 confirms it wins only 8/18).
- **§3a's negative is confirmed uninterpretable**, now with a number: its alignment carries 1.2–3.1 s
  of internal inconsistency against a 450 ms window.
- **Nothing here indicts `PATAlign.alignByAnchors` outside this use.** Anchoring two accelerometers on
  shared movement is sound for coarse work; it is being asked here for ~30× more precision than it
  delivers on this corpus.

### 3e.3 · The remaining route, and why it is different in kind
Stop *estimating* the inter-device offset and *read* it. On a **box** capture both streams are stamped
by the **same** daemon, so what separates them is each device's own BLE delivery latency — and each
device carries the pair needed to measure it: `sensor timestamp [ns]` (its counter) against
`Phone timestamp` (that one host clock). `DexClock.hostAxis` §7 already formalises exactly this shape
and publishes `independent` / `spreadMs` to say whether the second clock is real. The difference
between the two devices' host-axis mappings **is** the offset, measured rather than inferred from
motion.

Until that exists, **no PAT coupling verdict from this brief's harness family is quotable** — §2, §3a,
§3c, §3d and `O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS` §5.4 alike.

### 3e.4 · The host-stamp route, scouted: 15–79× better than ACC, but it clears the bar on 3 of 8 nights

§3e.3 named the remaining route. Scouted `[CORPUS]`. Both Polars do carry a genuine `{devMs, hostMs}`
pair on the **same row** (`sensor timestamp [ns]` vs `Phone timestamp`) and both read **independent**
(post-line residual sd 114–161 ms, far above `hostAxis`'s 2 ms quantum test), so the route exists.

Applying `hostAxis`'s contract to each device — running median of measured divergence, linear between,
flat outside — and taking **the difference between the two devices' corrections**, which is exactly the
inter-device offset PAT needs:

| night | overlap | median offset | **IQR** | vs `residIQR ≤ 60 ms` |
|---|---|---|---|---|
| 2026-07-24 | 123 m | −113 ms | **39** | inside 1.6× |
| 2026-07-21 | 153 m | +274 ms | **54** | inside 1.1× |
| 2026-07-28 | 182 m | −50 ms | **54** | inside 1.1× |
| 2026-07-22 | 266 m | +66 ms | **67** | out 1.1× |
| 2026-07-27 | 373 m | −155 ms | **77** | out 1.3× |
| 2026-07-20 | 365 m | +257 ms | **83** | out 1.4× |
| 2026-08-03 | 446 m | +163 ms | **126** | out 2.1× |
| 2026-08-01 | 563 m | +392 ms | **128** | out 2.1× |

**Against ACC's 1171–3094 ms internal spread this is 15–79× better** — the route is real. But the bar
is cleared on **3 of 8 nights**, and missed by up to 2.1× on the longest. This is *at* the requirement,
not inside it.

**And it explains §3c.2 mechanically.** The IQR grows monotonically with overlap length (123 m → 39 ms;
563 m → 128 ms): the inter-device offset **wanders over hours**, so a long fragment accumulates more
offset variation and scores lower. That is precisely the inverse length↔`matchRate` relationship §3c.2
measured and could not explain — and it is why §3c's "shorter pairs score better" is not a selection
artefact but a real property of the timebase.

**So the actionable form of PAT on this corpus is a short window, not a whole night** — roughly ≤ 3 h,
where the offset is stable to the gate's tolerance. A 9 h night cannot be scored as one block at this
precision by any method examined here.

⚠️ Scouting only, and it does not license a verdict: `hostAxis`'s contract was **re-implemented** for
this measurement rather than called, one pair per night was used, and the offset difference was sampled
at 10 s. A shipped result must drive `DexClock.hostAxis` itself.

## 3f · The shipped measurement, run over both corpora — coupling is REAL, INTERMITTENT, and mostly absent

`tools/pat-host-offset.mjs` (§3e.4's route, shipped): the inter-device offset is **read** from
`DexClock.hostAxis`, scoring is **windowed**, and **no pair is selected — every pair and every
non-overlapping window is scored**. §3c.4's circularity is answered by enumerating rather than by a
better rule; a distribution cannot be cherry-picked.

### 3f.1 · The phone-captured corpus cannot support this measurement AT ALL  `[CORPUS]`
34 nights of the older tri-device tree (`Ecg nightly`, 208 ECG/PPG/ACC files): **29 refusals, 100 % of
them `NOT INDEPENDENT`, zero windows scored.** Measured residual spread **exactly 1.00 ms ≤ 2 ms** —
one stamp quantum. The host column *is* the device stamp rounded, so there is no second clock to read
an offset from.

This is `clock.js`'s documented phone/box bimodality (§7: box 101.89–5124 ms, phone 0.13–1.00 ms)
reproduced on an independent corpus by a tool that had no knowledge of which tree was which. **Any PAT
attempt on phone-captured nights is measuring nothing**, and the guard says so rather than silently
falling back to an uncorrected axis.

### 3f.2 · The box-captured corpus: 20 of 57 windows beat their own null  `[CORPUS]`
20 nights, 14 with scorable pairs, **57 windows / 179 389 beats**, 60-min windows, 40 surrogates:

| | |
|---|---|
| strict beats its own circular-shift null at p<0.05 | **20 / 57 (35 %)** — against ~1.4 expected |
| **median** strict `matchRate` | **7 %** — *exactly its chance floor* |
| windows at or below chance | **33 / 57** |
| windows > 2× chance | 8 / 57 |
| strongest windows | **48 %** and **47 %**, against a 7 % floor |

**Both halves are the finding.** The typical window shows nothing; a minority show coupling far above
chance. This is not "PAT works" — it is "PAT is present intermittently and absent most of the time",
which is the first statement in this brief with a shape a verdict could eventually be built on.

Per night it concentrates: 2026-08-01 **7/9**, 08-03 **4/6**, 07-22 **3/4**, while 07-18, 07-25, 07-26
and 07-28 are **0 / N**.

### 3f.3 · A consistency check that runs the RIGHT way
The two nights carrying the most significant windows — **08-01 and 08-03** — are exactly the two with
the **worst whole-night offset IQR** in §3e.4 (**128 ms** and **126 ms**), while 07-24, the best
(**39 ms**), scores **0/1**. Windowing rescues precisely the nights whose whole-night offset was least
stable, which is what §3e.4's mechanism predicts and the opposite of what "those nights just had better
clocks" would produce.

### 3f.4 · What is NOT claimed
- **The 20/57 count is a magnitude, not a p-value.** Windows from one night and from overlapping pairs
  are **not independent**, so the binomial tail this invites (2.8 × 10⁻¹⁸) is not quotable and is
  deliberately not quoted.
- ~~**The intermittency is not yet attributed.**~~ **RUN 2026-08-25 — see §3f.5. It is NOT differential
  clock drift.** Physiology coming and going, and the offset wandering in and out of the `[200, 650]` ms
  window, both predict this shape; the per-window `ppm` test discriminates a third candidate and
  eliminates it.
- **A defect this run found in the tool itself**, now gated: `strictMatchRate` returns `NaN` on an empty
  lag list, and a permutation p of `count(surrogate ≥ NaN)+1` over `n+1` is `(0+1)/41` = **0.024** — so
  **two of sixty windows reported NO DATA as SIGNIFICANT** in the first pass. Windows with < 50 lags or
  a non-finite rate are now refused loudly. The corrected figure is 20/57, not the 22/60 that pass gave.

### 3f.5 · The per-window `ppm` test, RUN — differential drift is an order of magnitude too small

§3f.4 parked this: *"the tool already carries per-window `ppm` for that test; it has not been run."* Run
2026-08-25 with `tools/pat-host-offset.mjs --dir <box captures> --json`.

⚠️ **On a DIFFERENT corpus from §3g's, and that matters both ways.** §3g scored 57 windows over 11
nights; this is **22 windows over 10 device-pairs across 9 nights** of **box** captures (2026-08-09 →
08-19). Smaller — but box captures are the ones with a genuine second clock (§7's `independent`), so a
drift question is answerable there and only weakly answerable on phone nights. The two results are
adjacent, not nested.

**`ppmE`/`ppmP` are per-PAIR, not per-window** — constant across a night's windows — so the quantity
that can move the offset is the **differential**, `|ppmE − ppmP|`, integrated over the window.

| | |
|---|---|
| `\|Δppm\|` | median **10.56**, range 0.47 – 18.43 |
| predicted offset drift over a 120-min window | median **76.1 ms**, max **132.7 ms** |
| the identifiability band §3g.2 cites | **~450 ms** (mod one RR) |
| windows whose predicted drift exceeds that band | **0 / 22** |

**Differential crystal drift moves the offset by ~76 ms in two hours. The band it would have to cross is
~450 ms.** It is roughly six times too small, on every window measured.

**And it does not discriminate the coupling, either.** Split by strict significance:

| | n | `\|Δppm\|` median | range |
|---|---|---|---|
| strict-significant (p ≤ 0.05) | 12 | 10.47 | 0.47 – 14.63 |
| non-significant | 10 | 10.65 | 0.47 – 18.43 |

The medians differ by **0.18 ppm — 1.3 ms over a window** — and the ranges overlap across the entire
span. If drift drove the intermittency, the quiet windows should carry the larger differential. They do
not.

**⚠️ What this does NOT eliminate, stated because a linear model is doing the work.** The prediction
assumes drift accumulates *linearly* at the pair's measured rate. `CLAUDE.md` §7 records that this is
false for at least one device in the fleet: the O2Ring holds **sub-ppm for hours and then degrades at
~12.5 s/h from the first BLE dropout**, so a single ppm renders a stall as a smooth slope. A **stalled
link** can therefore produce an excursion this test would not predict — and `hostAxis` already publishes
`maxStepMs` precisely to surface a step smeared across one anchor gap. **That is the next candidate, and
it is instrumented.** What is eliminated is the steady-crystal explanation.

### 3f.6 · The stalled-link candidate, tested — and why BOTH clock diagnostics are the wrong GRANULARITY

§3f.5 eliminated steady drift and left one clock-side candidate standing: a **stalled link**, which
`CLAUDE.md` §7 records the O2Ring producing (sub-ppm for hours, then ~12.5 s/h from the first BLE
dropout). `hostAxis` already computes `maxStepMs` for exactly this — *"a genuine clock STEP smeared
across one anchor gap rather than hidden in a slope"* — and `pat-host-offset.mjs` simply never emitted
it. It does now (same 22 windows / 9 nights of box captures).

**Magnitude: the candidate SURVIVES where drift did not.**

| | drift (§3f.5) | step (this) |
|---|---|---|
| median | 76.1 ms predicted | **117.8 ms** |
| max | 132.7 ms | **53 090.9 ms** (53 s) |
| windows exceeding the ~450 ms band | **0 / 22** | **5 / 22** |

So a stalled link *can* cross the identifiability band — two orders of magnitude past it, in the worst
case. Unlike differential drift, it is not too small.

🔴 **But it cannot be the driver, and the reason is STRUCTURAL rather than statistical.** Both
diagnostics are **per-PAIR constants** — one `ppm` and one `maxStepMs` per device-pair, repeated across
every window of that night — while **the intermittency is WITHIN-night**. A constant cannot explain a
variable. The corpus shows it directly:

| night | `maxStepMs` (worst) | win 0 | win 120 |
|---|---|---|---|
| **2026-08-17** | **53 090.9 ms** | strict **p = 0.0196** | strict **p = 1.0000** |
| **2026-08-14** | 1 257.2 ms | p = 0.5294 | strict **p = 0.0196** |

**A 53-second step coexists with significant coupling in one window and none in the next, on the same
night, with the same step value.** And of the five windows carrying a step > 450 ms, **2 are
significant and 3 are not** — against a 12/22 base rate, that is nothing.

**What this closes.** The clock-side attribution attempted with the instrumentation that exists is
**exhausted**: drift is too small, steps are big enough but cannot discriminate, and neither field has
the *time resolution* the question needs. §3f.4's invitation is answered — not by finding the culprit,
but by showing this pair of diagnostics structurally cannot name one.

**What it leaves.** A within-window clock diagnostic (per-anchor residual rather than a per-pair
summary) would be a genuine test; `hostAxis` computes the anchors but publishes only the summary. Short
of that, the remaining candidates are physiological PAT variation — which would be **signal, not
noise** — and alignment/anchor error, which §3e already measured at 1171–3094 ms of ACC self-disagreement.

## 3g · VERDICT — the coupling is real and the intermittency is the OFFSET; absolute PAT stays blocked

§3f left one thing between this brief and a quotable statement: whether the 20/57 intermittency was
the physiology coming and going or the residual offset wandering. `--scan` answers it — sweep a
constant δ, take the max, and take the **null's max the same way** so scanning favours observation and
null identically. Over all **57 windows** `[CORPUS]`:

| | |
|---|---|
| strict significant at δ = 0 | **18 / 57** |
| strict significant under the offset scan | **47 / 57** |
| δ=0 failures **rescued** by allowing a constant offset | **29 / 39** |
| windows showing nothing at **any** offset | **10 / 57** |
| best-scan `matchRate` | median **15 %**, max **74 %** (scan chance ~8 %) |

**The intermittency is the offset, not the physiology.** In 29 of the 39 windows that failed at δ=0,
there is a constant offset at which coupling appears against a matched null. A third candidate — that
the PPG *timing point* degrades — was tested with `--timing-point peak` and is **not supported**: over
**45 comparable windows** the two are statistically indistinguishable (paired foot − peak **−0.5 ± 5.1
points**, median **0.0**; **40/45 significant under scan for each**; mean best-scan foot 20.4 % vs peak
21.0 %). Neither timing point is the limiting factor.

> ⚠ **A one-night version of this said the opposite and was wrong.** On 2026-07-22 alone the foot
> scored "as well or better on every comparable window and the peak lost one outright" — at corpus
> scale the peak produces *more* scorable windows (48 vs 47) and wins slightly more head-to-heads
> (21 vs 12). **The conclusion survives; the reason given for it did not.** Fourth single-night result
> in this session to fail on widening (cf. §3e.4's 53.9 ms → 3/8 nights, §3f's 22/60 → 20/57).

Corroborated by the identifiable offset itself: reduced mod RR, the per-window offsets are **stable
within a night on 4 of 11 nights and exceed the plateau on 7**, i.e. the offset genuinely moves within
most nights.

### 3g.1 · What this DOES license
**R-peak → pulse-foot coupling in this corpus is real, and `PAT-UNDER-PERBLOCK-ALIGNMENT` §3a's
negative was an artefact of its alignment.** §3a's own first listed possibility was the right one, and
this is now measured three independent ways: pair selection (§3c), aligned-vs-unaligned on the same
pair (§3d), and a matched-null offset scan over every window (§3g).

### 3g.2 · What it does NOT license — and this is the load-bearing caveat
**Allowing a free constant offset per window means we are no longer measuring PAT.** The scan
establishes that the two beat trains are *temporally coupled*; it says nothing about the **magnitude**
of the lag, because §3f's plateau result caps what the offset can be known to: **a ~450 ms band, mod
one RR** (any δ keeping the lag inside `[PHYS_LO, PHYS_HI]` scores identically, and a periodic train
cannot distinguish δ from δ ± RR).

Pulse arrival time is a *magnitude* — 405–496 ms on §2's table, and the physiology of interest lives in
its 139–197 ms beat-to-beat variation. **A quantity known only to ±450 ms cannot report it.** So:

- **Coupling leg: PASSES.** 47/57 windows, matched null.
- **Absolute PAT: STILL BLOCKED**, and now blocked for a *stated, measured* reason — offset
  identifiability — rather than by an alignment nobody had characterised.

### 3g.3 · ~~What would unblock it~~ — **RETRACTED, see §3i**
> This section said an aperiodic offset was the last obstacle and that *"closing that last factor of ~2
> is the whole remaining problem"*. **It is not.** `INTEGRATOR-PAT-VASCULAR` §2-RESULT-II.3 had already
> measured the binding constraint offset-free, and §3i reproduces it here: **beat-to-beat scatter**,
> not the offset. A perfect offset does not move it. Retained for the record; do not act on it.


## 3h · CORRECTION — §3c–§3g were written without reading `PAT-NO-VALID-ANCHOR`, and partly duplicate it

`PAT-NO-VALID-ANCHOR-2026-08-02-BRIEF.md` is **IN-PROGRESS**, sits in this brief family, names this brief
in its own header, and was not read before §3c–§3g were written. Parts of §3f–§3g re-derive it at smaller
n. Recorded here rather than quietly cross-referenced, because the omission is the finding.

| published here | already there, with more data |
|---|---|
| §3f.1 — phone tree not independent (29 refusals, spread 1.00 ms) | **§8**: 76/76 files, median range **1 ms**; **§11**: **0/104** declared independent, box 82/82 |
| the mod-RR aliasing caveat | a `k ∈ [−4,4]` search over a **measured 384 ms quantum** |
| §3g.2 — a free offset means we are no longer measuring PAT | **§1**: *"a per-block offset absorbs exactly the quantity PAT is"* — the trap behind a **retracted** verdict |
| §3g.3 — "what would unblock it: an aperiodic anchor" | **§7**: one is already **derived** — `offset_ACC + Δ_Verity − Δ_H10 = −199 ms` |

### 3h.1 · Reconciling §3g's 47/57 with its 0/13
They are **not** in conflict, and §3g is the weaker claim. `PAT-NO-VALID-ANCHOR` §10 reports a derived
anchor recovering a *locked, plausible PAT magnitude* on **0 of 13 box nights**. §3g reports *coupling*
under a **free per-window offset** — which its own §3g.2 says is not a PAT measurement, and which §1 of
that brief identifies as the specific move that produced a retracted verdict. **Where the two speak to
the same question, the published one wins**: PAT magnitude is not established on box nights.

### 3h.2 · What survives as new
- **§3c** — the harness reconciliation. Legacy `matchRate` spans **0–77 %** across pairs of one night and
  §3a's largest-overlap rule selects near the bottom every time. Specific to *this* brief's harness.
- **§3e** — the ACC anchors' **internal** disagreement, 1171–3094 ms *within a single pair*. That brief's
  §4 finds the ACC anchor does not transfer to the ECG/PPG streams; this measures how badly.
- **`tools/pat-host-offset.mjs`** and its gates.
- **One possibly-useful overlap:** that brief's §10.1 concludes *"per-fragment Δ is the more likely
  requirement"* after box nights failed on fragmentation (one night carries 24 ECG × 68 PPG fragments).
  This tool computes `hostAxis` **per file**, and every window lives inside one fragment pair — so it may
  already have the shape §10.1 asks for. **Untested against their pipeline; a hypothesis, not a result.**

### 3h.3 · The habit, now measured
That brief's header reads: *"Fourth retraction in this brief family from the same habit: concluding from
the best available case."* §3c–§3g then repeated it four more times — the O2Ring buffering mechanism, the
signal-quality pair rule, "the wander is the defect", and the foot-vs-peak claim — each corrected only by
widening the sample. **Reading the family's own prior brief would have supplied the warning before the
first of them.** Check the sibling briefs before measuring, not after publishing.

## 3i · RECONCILED with `INTEGRATOR-PAT-VASCULAR` §2-RESULT-II — the binding constraint is SCATTER, not the offset

That brief re-measured Phase 0 **offset-free** on 2026-07-29 (`couplingStable` = fraction of beats within
±100 ms of the night's own modal lag, so the offset cancels by construction) and found **0 of 54 pairings**
clear the gate. §3g reported 47/57 windows beating a matched null. Reconciled `[CORPUS]`:

### 3i.1 · The two agree on the LEVEL; only the bar differs
| | theirs, offset-free | here, best-scan |
|---|---|---|
| coupling level | **18.8 / 19.2 / 19.0 %** | median **15–16 %** |
| acceptance band | ±100 ms of the modal lag | ±40 ms, leave-one-block-out |
| bar | **≥ 55 %** | "beats a matched null" |
| verdict | **0 / 54** | 47 / 57 |

Their band is the **more generous** of the two and still yields ~19 %. **§3g's 47/57 means *above chance*,
not *high*** — and it was written in a way that invited the stronger reading. Against the gate's 55 % bar
both harnesses say the same thing.

### 3i.2 · Their binding number, reproduced from a different harness
`residIQR` ≈ 96 ms is the constraint they identify. Measured here the same way — IQR of (lag − modal lag)
over beats within ±100 ms, at the best-scan offset, over 52 windows:

| | median | range | clears the 60 ms bar |
|---|---|---|---|
| **theirs** (whole-night pairings) | **95.6 – 98.7 ms** | — | **0 / 54** |
| **here** (60-min windows) | **84 ms** | 36 – 99 | **10 / 52** |

**Reproduced.** The one nuance windowing adds: at 60-min granularity **10 of 52 windows do** clear the bar,
against 0 of 54 whole nights — so windowing helps, and not nearly enough.

### 3i.3 · ⚠ A trap in a shipped tool — `strictMatchRate.residIQR` is NOT gate-comparable
This was nearly published as a contradiction of their result. `pat-matchrate-strict.mjs` builds `residIQR`
**only from residuals it already accepted**, and acceptance is `|d0| ≤ STRICT_W_MS` (40 ms):

```js
if (Math.abs(d0) <= STRICT_W_MS) { kept++; resid.push(d0); }
residIQR: quantile(resid, .75) - quantile(resid, .25)
```

So it is bounded by its own window — measured **31–44 ms on all 52 windows regardless of signal**, and read
against a 60 ms bar it reports **52/52 passing**. That is a tautology, and it is the *inverse* of the truth.
The tool built to expose a self-referential statistic carries one on a different field. **Never compare
`strictMatchRate.residIQR` to `pat-gate.js`'s bar**; use the wide-band scatter (`scatterIQRms`, added here).

### 3i.4 · Consequences
- **§3g.3 retracted.** The offset is not the last obstacle. Beat-to-beat scatter is, they measured it three
  independent ways (`halfDrift` passes 47/54, median 19.7 ms, implied **1.46 ppm**), and this reproduces it.
- **The remaining problem is not capture-side clock work.** It is that the R→foot interval is *stable in its
  centre and loose in its detail* — their §II.3's phrase, and the opposite of what PAT needs.
- **Their H10→O2Ring finger leg already exists** (n=11, 19.2 % offset-free, `residIQR` 98.7 ms, 0/11), which
  `O2RING-FRAME-SAMPLE-LOCK-FOLLOWUPS` §5 treated as open. That scoping was also a duplicate.

## 3j · The scatter is NOT the pre-ejection period — dual-site does not rescue PAT

§3i located the blocker as ~84–96 ms of beat-to-beat scatter and could not say whether it is cardiac or
downstream. **PAT = PEP + PTT**, and the pre-ejection period varies beat-to-beat with contractility and
preload — so an arm→finger interval, which cancels PEP by construction, decides it. Run over the
Verity-arm → O2Ring-finger corpus (**40.6 h, 8 nights**, no ECG in the chain) `[CORPUS]`:

| | ECG → foot (§3i) | **arm foot → finger foot** |
|---|---|---|
| gate-comparable `scatterIQR` | median **84 ms** | median **92 ms** (53–100) |
| windows clearing the 60 ms bar | 10 / 52 | **1 / 43** |
| best-scan `matchRate` | median 15–16 % | median **10 %** |
| significant vs matched null | 47 / 57 | **0 / 43** |

**The scatter does not collapse — it is 8 ms WORSE with PEP removed.** So the looseness in the R→foot
interval is **not** the pre-ejection period; it is downstream of the heart — vascular variability, or
foot-detection noise, or both. **`INTEGRATOR-PAT-VASCULAR` §4's differentiator does not differentiate.**

That brief's Phase 2 — *"dual-site PAT (one R-peak → two peripheral feet), whose difference cancels the
pre-ejection-period"* — was parked behind a NO-GO Phase 0 and never measured. Measured now, in its
direct form: it removes the confound and the number gets no better.

### 3j.1 · The one caveat, and why it does not rescue the idea
The **differenced** form matches each site to the **same R-peak** and subtracts; the **direct** form run
here matches arm feet to finger feet. Algebraically identical when the matching is right, but the direct
form leans on a foot↔foot nearest-neighbour step, which is the aliasing-prone one — so this measurement
may be *pessimistic* about coupling.

It is **not** pessimistic about the thing that matters. `scatterIQR` is an IQR about the modal lag, and a
mismatch inflates it; the honest reading is that arm→finger scatter is **≤ 92 ms**, still far above the
60 ms bar, and nothing here suggests the remaining gap is PEP. The differenced form is worth running for
completeness — cheaply, since both legs already exist — but it must clear ~92 → ≤60 ms to change the
verdict, and removing a confound that is demonstrably not present cannot do that.

<!--
  PAT-UNDER-PERBLOCK-ALIGNMENT-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-02 · **Executes:** `CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md` §3.2 · **Corrects:** `WEARABLE-DRIFT-FIT-2026-08-01-BRIEF.md` §3, `CLOCK-CLOSURE-THREE-SOURCE-2026-08-01-BRIEF.md`, and §3.2 of the brief it executes

# PAT is not blocked by alignment. It is blocked by pulse transit time itself.

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
- [ ] *(open)* Whether PAT is worth pursuing at all on single-site optical, given that the obstacle is
      PTT variability rather than instrumentation. That is a scientific call, not an engineering one.
      §3a *weakens* the case further — under a definition that can fail, the coupling leg does fail —
      but the item above must close before that is used as an argument.

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

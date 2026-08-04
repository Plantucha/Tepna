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

## 4 · Done when

- [x] PAT scored by `pat-gate.js` itself, not by a hand-rolled proxy, under per-block alignment.
- [x] Six nights, each with a chance control.
- [x] The over-claim in three briefs corrected at its source.
- [x] A stricter `matchRate` whose chance floor is not 60 % — **DONE 2026-08-03** (§3a).
      `tools/pat-matchrate-strict.mjs`: leave-one-block-out acceptance centre, ±40 ms, scored against
      circular-shift surrogates. Measured floor **6–9 %**. Gate-backed in the Node lane by a synthetic
      group that pins the self-referential flaw rather than a corpus number.
- [ ] *(open)* **Reconcile this harness with §2** — legacy `matchRate` reads 24–42 % here against
      90–96 % there, and its chance floor 18–23 % against 53–69 %, on the same six nights. Most likely
      pair selection among the BLE-reconnect fragments. **This blocks the coupling verdict**, not the
      method: §3a's floor result stands on its own.
- [ ] *(open)* Whether PAT is worth pursuing at all on single-site optical, given that the obstacle is
      PTT variability rather than instrumentation. That is a scientific call, not an engineering one.
      §3a *weakens* the case further — under a definition that can fail, the coupling leg does fail —
      but the item above must close before that is used as an argument.

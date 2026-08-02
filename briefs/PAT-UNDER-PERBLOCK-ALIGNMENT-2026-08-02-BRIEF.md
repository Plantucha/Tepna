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

## 4 · Done when

- [x] PAT scored by `pat-gate.js` itself, not by a hand-rolled proxy, under per-block alignment.
- [x] Six nights, each with a chance control.
- [x] The over-claim in three briefs corrected at its source.
- [ ] *(open)* A stricter `matchRate` whose chance floor is not 60 %. Until then the coupling leg is
      not evidence either way.
- [ ] *(open)* Whether PAT is worth pursuing at all on single-site optical, given that the obstacle is
      PTT variability rather than instrumentation. That is a scientific call, not an engineering one.

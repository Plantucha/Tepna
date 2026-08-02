<!--
  JOINT-UNWRAP-ATTEMPT-2026-08-02-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** PROPOSED · **Created:** 2026-08-02 · **Executes:** `CROSS-DEVICE-DRIFT-AND-CLOSURE-2026-08-01-BRIEF.md` §5 (joint unwrap) + §3.1 (precondition) · **Affects:** `integrator-dsp.js`, `tests/dex-tests.js`

# The unwrap is not the blocker — per-block offset precision is, and `concentration` measures it.

`CROSS-DEVICE-DRIFT-AND-CLOSURE` §5 asks for an unwrap that uses the closure constraint across all
three pairs jointly, "which is over-determined and can reject a bad multiple". Two implementations
were tried. **Both fail, and the second says why.**

## 1 · Attempt 1 — sequential per-pair unwrap. Worse.

Greedily step each block by whole RRs to minimise its jump from the previous. Three-source closure
degraded **101 / 101 / 58 ppm → −266 / 209 / −202**: one wrong multiple on a weakly-locking pair rides
the cumulative sum for the rest of the night. Reverted.

## 2 · Attempt 2 — wrapped-residual slope regression. No propagation, and still no lock.

Remove the sequential accumulation entirely: grid-search the **slope** and score each candidate by its
residuals taken **modulo one RR**. A whole-RR fallback then costs nothing (it wraps to the same
residual) while a wrong slope misaligns every block at once. No step can propagate because no step is
taken. It also leaves **closure intact as a free check** — each pair is fitted independently, so the
constraint is one the fit never used and cannot have fabricated.

It does not work on this corpus, and the shipped `concentration` metric is why:

| | 2026-07-25 | 2026-07-26 | 2026-07-28 |
|---|---|---|---|
| closure, raw slope | 101.2 | 100.9 | 58.5 |
| closure, wrapped slope | −494.0 | 457.0 | −44.0 |
| min phase concentration | 0.21 | 0.15 | 0.25 |

**Concentration is 1 when every block agrees on the phase.** At 0.15–0.38 the wrapped residuals are
near-uniform around the circle: there is no phase to regress.

### The sweep that locates the blocker

A 3 × 3 sweep of `blockMs` × `tolMs` on 2026-07-28:

```
closure (wrapped):  77, -164, -44, -10, 268, 0, 70, -142, -451 ppm
concentration:      0.29 … 0.59, rising monotonically with block length
```

Concentration rises with block length exactly as "more beats per block ⇒ better offset estimate"
predicts. **So the blocker is the PRECISION OF THE PER-BLOCK OFFSET relative to one RR, not the unwrap
algorithm.** Until a block offset is good to well under an RR, no unwrap — sequential or
phase-regressed — has a signal to unwrap.

> One of those nine closures lands on **0**. Picking it would be cherry-picking from nine tries
> scattered ±450 ppm, and is exactly the point-estimate-without-error-bar failure this brief family has
> retracted four times. It is recorded, not used.

`_wrappedSlopeFit` ships as a **diagnostic**: `wrappedDriftPpm` rides beside `driftPpm` with its own
`concentration`, so a caller sees both and trusts neither without a closure residual.

## 3 · The precondition — §3.1's "luck, not design", corrected

§3.1 notes the CPAP transit measurements are in the safe regime "but that is luck, not design". It is
not luck. The tolerance is a property of the **consumer's resolution**, and the CPAP path clears it by
three orders of magnitude:

| consumer | resolution | max drift over a 7 h night | measured pair |
|---|---|---|---|
| `runFusion` event pairing | ±120 s | **4,762 ppm** | safe |
| desat↔apnea coupling | −15…+60 s | ~2,400 ppm | safe |
| `fitClockOffsetPooled` support | ~30 s | ~1,200 ppm | safe for CPAP (−9…−29 ppm) |
| `fitClockDrift` beat matching | ±80 ms | **3.2 ppm** | **unsafe** (wearables 100+) |
| `pat-gate.js` | ≤60 ms | **2.4 ppm** | **unsafe** |

`maxTolerableDriftPpm(spanSec, resolutionSec)` is exported and gated, so a caller asks instead of
assuming. **Only beat-resolution consumers are affected** — which is precisely the two that matter for
PAT, and nothing coarser needs changing.

## 4 · Done when

- [x] Joint/robust unwrap attempted — twice — and both attempts measured rather than asserted.
- [x] The blocker located and quantified (`concentration`, 0.15–0.59) rather than left as "it fails".
- [x] `_wrappedSlopeFit` shipped as a diagnostic beside the raw slope, never replacing it.
- [x] The constant-offset precondition made checkable, and §3.1's "luck" corrected to "three orders of
      magnitude".
- [ ] *(open, and now better specified)* The joint unwrap needs per-block offsets good to well under
      one RR. That is an estimator problem — more beats per block trades against drift within the
      block — not a search problem. Concentration is the metric to optimise against.

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

## 3.4 · ⛔ §3.5's BOUND IS RETRACTED — it was slip-inflated and used the wrong RR

Reconciling with `papers/wearable-clock-drift.html`'s scope note, which reports residual SD **91–241 ms**
against a **~1190 ms** tooth on the same pair and the same nights. That is 3–4× tighter than §3.5's
315–1034 ms, on identical data — so one of the two is measuring wrong, and it is this one.

**Error 1 — the residual was slip-inflated.** §3.5 used RMS about the fitted line, computed on the
**un-unwrapped** series. RMS counts each one-RR slip at its full ~1190 ms. So the number is dominated
by exactly the artifact unwrapping exists to remove, and was then used to argue that unwrapping is
impossible. **Circular.** A robust spread (1.4826 × MAD of residuals) separates them:

| night | RMS (§3.5) | **robust** | slipped blocks |
|---|---|---|---|
| 2026-07-20 | 473 ms | **127 ms** | 2 / 91 |
| 2026-07-26 | 315 ms | **274 ms** | 3 / 88 |
| 2026-07-28 | 562 ms | 362 ms | 20 / 96 |
| 2026-07-25 | 865 ms | 482 ms | 33 / 102 |
| 2026-07-23 | 688 ms | 795 ms | 27 / 62 |
| 2026-07-22 | 1034 ms | 1014 ms | 67 / 108 |

**Error 2 — the tooth was wrong.** §3.5 said "half an RR is ~450 ms", assuming RR ≈ 900 ms. The
measured RR on these nights is **990–1286 ms** (this subject runs ~50 bpm, matching the paper's
51.9 bpm), so the half-tooth is **~595 ms**. The bound was compared against a threshold 25 % too tight.

**Corrected reading.** Robust scatter is **127–274 ms on the low-slip nights** — inside the paper's
91–241 ms — and 795–1014 ms on 07-22/07-23, where 25–62 % of blocks are displaced and the scatter is
genuine. So unwrapping is **viable on 3–4 of 6 nights and hopeless on two**, which is exactly the split
the paper reports (R² 0.92–0.99 on 07-25…07-28; R² 0.11/0.46 on the two that fail, and those are the
same two that fail closure).

**So the paper's 87–216 ppm figures are NOT overturned.** §3.5's "there is no phase to unwrap" is false
as a general statement — true for the high-slip nights, false for the rest.

> **The same mistake twice in one brief.** §3.5 already flagged that raw MAD conflates the drift TREND
> with scatter, and corrected it. It then shipped a residual that conflates SLIPS with scatter. Both are
> the same failure — a summary statistic absorbing the very artifact under investigation — and the
> second one survived because fixing the first felt like having dealt with it.

## 3.5 · The (retracted) bound, and a refuted hypothesis — added 2026-08-02

§2 located the blocker as per-block offset precision. Here is the number, and it closes the question.

**Hypothesis tested and REFUTED.** An ECG↔optical offset is clock + pulse-arrival-time(t), and PTT was
measured wandering 325–535 ms across a night — a large fraction of one RR. So an optical↔optical pair,
carrying PTT on both sides, should partially cancel it and concentrate better. **It does not:** pooled
over legs with ≥70 % correspondence, optical↔optical is **0.61×** — *wider*, not tighter. (n = 1
qualifying optical pair, so this is directional, not settled; it is recorded because it is the obvious
explanation and it is wrong.)

**The bound that matters.** Per-block offset scatter about the fitted drift line — drift removed, so
this is noise not trend — is **315–1034 ms** across the six nights:

```
07-26 H10↔VER  315 ms      07-20  473 ms      07-28  562 ms
07-23          688 ms      07-25  865 ms      07-22 1034 ms
```

**Half an RR is ~450 ms.** So on every night except the best one or two, consecutive blocks disagree by
around a whole comb tooth. **There is no phase to unwrap** — not because the algorithm is wrong, but
because the quantity being unwrapped is not determined to better than the tooth spacing. That is why
attempt 1 propagated errors and attempt 2 found concentration 0.15–0.59.

> **A metric flaw worth recording.** The first version of this measurement used the MAD of the RAW
> per-block offsets, which **conflates the drift trend with the scatter** — a pair drifting 2 s across a
> night has a large raw MAD by construction, and 2026-07-20 duly showed MAD 730 ms alongside the *best*
> concentration seen (0.79). The residual about the fitted line is the right quantity and is what the
> numbers above report.

**The concrete target this sets:** get per-block residual scatter well below ~450 ms and the unwrap
becomes possible; until then no search strategy helps. That is an estimator problem — more beats per
block trades against drift *within* the block — and `concentration` is the metric to optimise against.

## 4 · Done when

- [x] Joint/robust unwrap attempted — twice — and both attempts measured rather than asserted.
- [x] The blocker located and quantified (`concentration`, 0.15–0.59) rather than left as "it fails".
- [x] `_wrappedSlopeFit` shipped as a diagnostic beside the raw slope, never replacing it.
- [x] The constant-offset precondition made checkable, and §3.1's "luck" corrected to "three orders of
      magnitude".
- [⛔] ~~The bound quantified (§3.5)~~ — **RETRACTED, see §3.4.** The residual was slip-inflated and the
      tooth was 25 % too tight. Corrected: robust scatter **127–274 ms** on low-slip nights against a
      **~595 ms** half-tooth, so unwrapping is viable on 3–4 of 6 nights.
- [x] The obvious explanation (PTT contamination) tested and **refuted** — optical↔optical is wider,
      not tighter.
- [ ] *(open, now with a target)* Get per-block residual scatter well below ~450 ms. Estimator problem:
      more beats per block trades against drift within the block. `concentration` is the metric.

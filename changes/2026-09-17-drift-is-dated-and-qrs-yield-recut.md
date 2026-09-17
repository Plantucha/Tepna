---
bump: patch
type: changed
brief: COHORT-GEN-2.0-PAPER-RERUN-2026-09-15-BRIEF.md
---

The drift is dated, the last configuration question is settled, and `qrs-yield` is re-cut.

## The drift has a date and a size

`papers/RERUN-RESULTS.md` records a **full six-paper rerun on 2026-07-07** with the exact published
values. That closes the window: every paper's numbers predate **218 DSP commits, 134 of them `fix(...)`**.

Then-vs-now at the **same** generator:

| | 2026-07-07 | now |
|---|---|---|
| `rmssd-equivalence` optical bias | +0.3 ms | **+3.14 ms** |
| `nights-icc` ODI-4 ICC₁ | 0.745 | **0.9228** |
| `treatment-response` counts | 912 / 918 | **233 / 239** |

**The drift is probably improvement, and that is not the same as harmless.** 21 of the 218 are
§∅-shaped — an absent value had been published as a number — and those necessarily move results, in
the direction of correctness. But no single cause is implied and none is asserted.

⚠️ I first read the *head* of that log and took §∅ fixes for the majority; the last fortnight is
§∅-heavy and unrepresentative. Counting gave **21/218**. A visible head is not a sample.

## treatment-response: the configuration was never the unknown

Per your steer, `minNights` was established first. `RERUN-RESULTS.md` and the paper's Table 2 agree
independently on ~900/arm at ≥10 nights. Driving exactly that today gives **233 + 239** — a **3.9×**
shortfall.

So the config is correct and still doesn't reproduce. That doesn't recover the published numbers, but
it converts `2026-09-17-treatment-response-three-cohort-sizes` from an open question into a measured
one: **the qualification path drifted.** The run was worth it for that.

## qrs-yield re-cut, with the drift disclosed

Per your steer, the same treatment `rmssd-equivalence` received. The ECG arm is unchanged (362
windows, ~100 % recall, apnea-invariant). The optical arm moved — precision 88.8 → 98.8 %, SQI apnea
0.78 → 0.98, rMSSD bias +83.0 → −10.4 % — and the 1.9 A/B shows the generator contributed +0.01 pp.

The published row is retained beneath the current one as an explicitly dated 2026-07-07 measurement,
rather than deleted. **Recall is essentially unchanged (96.4 → 96.1 %), so the paper's beat-yield
thesis stands**; what moved is precision, SQI and the rMSSD inflation.

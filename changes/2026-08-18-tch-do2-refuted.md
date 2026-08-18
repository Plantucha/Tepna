---
bump: patch
type: changed
---

**`TCH-FUSED-ROBUST-HAT-FOLLOWUPS` Do 2 (PulseDex/HRVDex robust HRV) is MEASURED and REFUTED**, on the same
discriminator that refuted Do 4 and at essentially the same value. The brief's own instruction was to
*"measure the ratio before writing the fix"*; this is that measurement, on **38 real H10 RR nights**.

Do 2 proposes `beatConfidence`-weighted robust `RMSSD`/`SDNN` **on top of** the existing pipeline, so the
leverage has to be measured **after** `correctRR`:

| measured on | SD/MADn |
|---|---|
| RR levels, whole night, post-`correctRR` | 1.349 |
| successive differences (what `RMSSD` estimates) | 1.144 |
| **per 5-min epoch — the grain HRV is reported at** | **1.077** |
| *Do 4's refuting value* | *1.074* |

`correctRR` already does the robust job — it gates each interval against the median of the last 7
**accepted** values (0.20 Malik for ECG-derived RR) and substitutes the reference on rejection. Median
rejection rate **12.7 %**; `RMSSD` already falls **51.2 → 33.5 ms** from that correction alone. A second
robust layer has nearly nothing left to take.

⚠ **The first measurement said the opposite.** Raw whole-night RR **levels** give SD/MADn **1.438** (max
3.049) with `RMSSD` inflated 67 % — which reads as strong support for Do 2, and would have justified a
compute-path change across two nodes. It measures the wrong quantity: whole-night RR levels legitimately
span the range as HR tracks sleep stage, so a heavy-tailed *level* distribution is physiology, not artifact.
`RMSSD` is a **successive-difference** statistic reported **per epoch**; measured there the support
disappears. The confound was caught only by asking what the estimator actually consumes.

**Not a blanket no:** per-epoch **p90 = 1.332**, so ~10 % of epochs carry real excess. That is a targeted
flag-or-down-weight opportunity, not a case for changing the fleet's variance estimators — which is what
Do 2 as written proposes.

Do 1/3/5 still stand unmeasured. Gate: docs-ledger, release-ledger.

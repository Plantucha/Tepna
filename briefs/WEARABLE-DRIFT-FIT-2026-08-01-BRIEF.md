<!--
  WEARABLE-DRIFT-FIT-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-01 · **Created:** 2026-08-01 · **Executes:** `ENVELOPE-ANCHOR-EXPORT-2026-08-01-BRIEF.md` §3.7 · **Affects:** `integrator-dsp.js`, `tools/trio-batch.mjs`, `tests/dex-tests.js`

# One number cannot hold a night: the wearables drift 87 ppm, and fitting for it takes correspondence from 16 % to 89 %.

`ENVELOPE-ANCHOR-EXPORT` §3.7 measured that the H10 and the Verity agree on ~90 % of heartbeats once
the offset is refitted locally — and that a **constant-offset** fit reports 16 % on the same data,
because the pair drifts **2.26 s across a night**, more than an RR interval, so the match walks off the
correct beat partway through. That finding was **recorded and not used**. This brief uses it.

## 1 · `fitClockDrift` — offset and drift from one fit

Refits the offset in 5-minute blocks and regresses block offset against block time, the same shape
`alignEnvelopes` uses for accelerometer envelopes, applied to beat times.

**It needs no contract change and no raw files.** `timeseries.rr.tSec` (ECGDex) and
`timeseries.ppi.tSec` (PpgDex) are already in the node-export — the sub-second shared channel was on
the bus the whole time. Only beats each node says it OBSERVED (`corrected === 0`) are used: 99.7 % of
RR, 97.5 % of PPI.

**Real night, through `trio-batch`:**

```
⏱ H10↔Verity drift: 80 ppm (2.13 s over 444 min), offset -0.12 s
   corr 89% vs chance 21%   IQR 52 ms
```

## 2 · Gated by PLANTED recovery, and the controls found two real defects

A correspondence number means nothing unless the instrument can recover a known answer:

| planted | recovered |
|---|---|
| −500 ms / 0 ppm | **−500 ms / 0 ppm** — exact |
| +300 ms / −60 ppm | **+300 ms / −60 ppm** — exact |
| 0 ms / **250 ppm** | flattens to 33 ppm — **out of range, and says so** |

**Two implementation defects were caught by those controls and fixed rather than shipped:**

1. **Argmax on a plateau.** Correspondence is flat over a window ~`tolMs` wide — every offset inside
   it keeps the same beats matched — so the argmax lands arbitrarily within it. Measured as a
   **~330 ms offset bias**. Replaced by a **support centroid**, the same fix `POOLED-CLOCK-FIT`
   applied after its own planted control caught a 37 s argmax bias. Two of four planted cases went
   from biased to **exact**.
2. **Block time.** The fitted offset describes the block's **midpoint**, not its start; regressing it
   against the start tilted the drift by half a block.

Neither was visible without a planted answer. This is the third time in this brief family that a
control changed a conclusion, and the second time it changed the *code*.

## 3 · What the result publishes about its own limits

- **`maxDriftPpm`** — the search window bounds what drift can be seen (119 ppm at ±3 s over 7 h). A
  pair drifting faster walks out of range mid-night and the regression flattens toward zero, which is
  exactly what the 250 ppm control shows. Publishing the bound lets a caller distinguish *"no drift"*
  from *"drift beyond my reach"* — the distinction a bare number hides.
- **`chanceCorrespondence`** — the identical block search run on a deliberately wrong alignment,
  shipped beside every result. The fit maximises the statistic it reports, so a high number alone
  means nothing; `confident` requires it to beat its own control by **≥2×** (measured pair: 89 % vs
  21 %, a 4.2× margin).
- **`medianIqrMs`** — 52 ms on the real pair, inside `pat-gate.js`'s ≤60 ms bar. **This is not a PAT
  pass:** the gate also wants `coupling ≥ 55 %` and a median lag in [60,700] ms measured as a real
  pulse-arrival delay. It does mean the alignment precision PAT needs is reachable on this pair.

## 4 · Wiring

Called from `tools/trio-batch.mjs` per night, and deliberately **ungated from `--cpap`**: it aligns
two wearables from their own beat times and needs no CPAP anchors. Gating it on the CPAP would be the
same fusion-precondition confusion `--allow-partial` exists to undo — a night that cannot be
clock-fitted can still be drift-fitted, and on this corpus that is most of them.

**Not wired into `runFusion`.** The Integrator's recs deliberately drop `timeseries` to avoid
retaining multi-MB arrays per recording, so beat times are not reachable there without carrying a slim
beat array back onto the rec. That is a memory trade-off with its own justification and belongs in its
own work-unit, not smuggled into this one.

## 5 · Done when

- [x] Offset **and** drift come from one fit, on data already in the export contract.
- [x] Planted offset+drift recovered exactly where it is in range, and **declared** where it is not.
- [x] A chance control ships with every result, and `confident` is defined against it.
- [x] The two defects the controls exposed fixed, not shipped.
- [x] A real caller (`trio-batch`), not a gated function with no consumer.
- [x] 4886/4886 zero skips on the real corpus · typecheck · biome · all three drift guards current.
- [ ] *(next)* Carry a slim beat array onto the fusion rec so `runFusion` can use this too.
- [ ] *(next)* Run it across all 24+ corpus nights — this brief validates one night plus planted controls.

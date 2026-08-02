<!--
  CLOCK-CLOSURE-THREE-SOURCE-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-01 · **Created:** 2026-08-01 · **Follows:** `WEARABLE-DRIFT-FIT-2026-08-01-BRIEF.md` · **Affects:** `integrator-dsp.js`, `tools/trio-batch.mjs`, `tests/dex-tests.js`

# Three clocks must close to zero. On six real nights they never do — and once with every leg confident.

A pairwise clock fit cannot check itself. With three interval sources it can:

```
d(A,B) + d(B,C) + d(C,A) ≡ 0        because (dA−dB)+(dB−dC)+(dC−dA) = 0
```

so a non-zero **closure error** proves one of the three measurements is wrong — **with no reference
clock and no ground truth**. `fitClockClosure` runs every pair through `fitClockDrift` and reports the
closure of each triple.

## 1 · Six nights, three sources — H10 chest RR, Verity wrist PPI, O2Ring finger PPI

| night | H10↔VER | H10↔O2R | VER↔O2R | **closure** | all legs confident |
|---|---|---|---|---|---|
| 2026-07-20 | 96.6 ppm (99 %) | 27.6 (54 %) | −32.7 (52 %) | **36.3** | no |
| 2026-07-22 | 28.5 (98 %) | −15.1 (21 %) | 14.5 (23 %) | **58.1** | no |
| 2026-07-23 | −7.3 (100 %) | −3.7 (2 %) | −2.5 (6 %) | **−6.1** | no |
| 2026-07-25 | 93.9 (77 %) | 3.8 (30 %) | 11.1 (35 %) | **101.2** | no |
| 2026-07-26 | 80.1 (89 %) | −14.8 (47 %) | 6.0 (49 %) | **100.9** | no |
| **2026-07-28** | 39.2 (85 %) | 90.2 (**95 %**) | 109.4 (**83 %**) | **58.4** | **YES** |

*(percentages are median per-block beat correspondence; each leg's own chance control ran 13–22 %.)*

**Three results.**

1. **H10↔Verity is reliable on every night** — 77–100 % correspondence. The Polar pair aligns, always.
2. **The O2Ring is night-dependent, not simply worse.** Usually weak (2–54 %), but on 2026-07-28 both
   its legs are strong (95 % / 83 %). So its poor showing on 07-26 is a property of that night, not of
   the sensor — which corrects the impression left by a single-night look.
3. **The drift is not a hardware constant.** H10↔Verity reads −7.3, 28.5, 39.2, 80.1, 93.9, 96.6 ppm
   on six consecutive-ish nights. It must be fitted per night; no stored calibration would hold.

## 2 · The finding that justifies the test: 2026-07-28

On the one night where **all three legs clear their own chance control**, closure still misses by
**58.4 ppm**. Per-leg confidence is *necessary and not sufficient* — three individually-defensible fits
can still be mutually impossible, and only closure sees it. That is the whole argument for computing
it: it is information no per-leg statistic contains.

## 3 · The blind spot, found by a control that REFUSED to fire

The first planted control stepped one clock 900 ms mid-night — a re-sync, exactly what the capture
host does on reconnect — and expected closure to break. **It did not: closure stayed at −0.10 ppm.**

That is not a bug, it is the method's boundary. A clock that is genuinely wrong is measured
*faithfully* by both of its pairs, so the error cancels — the identity holds for **any** dC whatsoever.

> **Closure tests the MEASUREMENTS, never the clocks.** It catches a bad fit. It is structurally
> incapable of catching a bad clock that both of its pairs agree about.

Only degrading a source until its *fits* became unreliable made it fire: **−50.6 ppm, both weak legs
named, `consistent: false`** — the same signature as the real nights above. That is now the gate's
control, and the boundary is documented in the function rather than discovered again later.

## 4 · What ships

- `IntegratorDSP.fitClockClosure(sources, opts)` — pairwise fits + per-triple closure, `consistent`
  judged against a tolerance scaled to **the legs' own drift magnitudes** (a triple of weak fits earns
  a looser bar than a triple of sharp ones; a fixed threshold would excuse one and condemn the other).
  Refuses rather than guesses with fewer than three sources.
- Gated: planted three-clock set closes to **−0.10 ppm** with both drifts recovered exactly; an
  unreliable leg is caught; <3 sources refuses.
- Printed per night by `tools/trio-batch.mjs` beside the per-leg drift line.

## 5 · Done when

- [x] Closure computed from three real interval sources, all already in the node-export.
- [x] Six nights measured, not one.
- [x] The blind spot found by a control that refused to fire, and documented in the code.
- [x] A real caller, not a gated function with no consumer.
- [x] 4892/4892 zero skips on the real corpus · typecheck · biome · all three drift guards current.
- [ ] *(open)* Closure is never zero on any real night. Whether that is residual fit error or a real
      non-linearity (a clock that is stepped **and** drifting) is unresolved — it needs a night where
      an independent reference exists, which this corpus does not have.

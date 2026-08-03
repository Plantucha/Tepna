<!--
  CLOCK-CLOSURE-THREE-SOURCE-2026-08-01-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-08-01 (⚠ §1 drift columns superseded — see §5; ⛔ **every O2Ring-containing result VOIDED 2026-08-03** — see the banner) · **Created:** 2026-08-01 · **Follows:** `WEARABLE-DRIFT-FIT-2026-08-01-BRIEF.md` · **Affects:** `integrator-dsp.js`, `tools/trio-batch.mjs`, `tests/dex-tests.js`

> ### ⛔ VOID — TWO OF THE THREE LEGS WERE NEVER CLOCKS (added 2026-08-03)
> Every three-source result in this brief includes an **O2Ring** leg, and the O2Ring's
> `sensor timestamp` column is **drawn, not measured**: the device emits no per-sample timestamp, so
> capture constructed the axis as `sample_index × an assumed rate`. Its apparent ppm is the error in
> that constant, which is why the same night reads **+783 ppm** on a fragment written at 125.738 Hz and
> **+92 ppm** on one written at ~128.024 Hz. Two of the three pairs here contain that leg, so two of
> three "rates" were comparisons against a drawing.
>
> **What that does to the conclusions below:**
> - the closure residuals are **not measurements of clock disagreement** — do not cite them;
> - the −2.2 ppm residual on 2026-07-27 is best read as **coincidence**, not as a night that closed;
> - the correspondence figures (2–54 % against a 13–22 % chance floor) have a **mechanism** now: the
>   axis, not sensor quality, physiology, or the night;
> - the **Polar↔Polar** leg is untouched — neither of its ends is the ring.
>
> The detection is computed rather than remembered: `quality.timingSource` (`device+host` · `host` ·
> `none`) and `hostAxis`'s `independent`/`spreadMs`, gated by `ppgdex · axis-provenance`. See
> `O2RING-SYNTHESISED-AXIS-2026-08-02-BRIEF.md` and `WEARABLE-HOST-AXIS-FOLLOWUPS-2026-08-02` §F1.
> **Do not respond by re-calibrating the constant** — a better constant makes the drawn axis more
> plausible without making it a measurement.

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
- [x] **ANSWERED by `CROSS-DEVICE-DRIFT-AND-CLOSURE` §2.2/§2.3 — it was a missing PHASE UNWRAP.** The
      per-block offset is a phase on a comb one RR wide; the argmax falls back a whole RR as the offset
      drifts past a tooth, so a raw slope measures the sawtooth. That brief unwraps first and closure
      then holds to **≤7 ppm** on the nights with high correspondence and enough blocks (07-27: −2.2;
      07-28: −7.0). **Every closure figure in §1 above is therefore the BEFORE-unwrap regime**, and the
      drift columns beside them are not quotable per that brief's §6 guardrail.
      A naive per-pair unwrap was tried here and made closure **worse** (−266/209/−202 ppm), which is
      evidence for their §5 open item that the unwrap must use the closure constraint **jointly**.
- [ ] *(open, inherited)* Joint three-pair unwrap. Whether that is residual fit error or a real
      non-linearity (a clock that is stepped **and** drifting) is unresolved — it needs a night where
      an independent reference exists, which this corpus does not have.

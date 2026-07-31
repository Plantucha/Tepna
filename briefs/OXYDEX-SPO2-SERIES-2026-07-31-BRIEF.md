<!--
  OXYDEX-SPO2-SERIES-2026-07-31-BRIEF.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->
**Status:** DONE — 2026-07-31 · **Created:** 2026-07-31 · **Found while executing:** `WEARABLE-SYNC-APPLIED-2026-07-31-BRIEF.md` §3 · **Affects:** `oxydex-dsp.js`, `ganglior.node-export` (additive)

# The oximeter's primary signal never left the node

OxyDex exported SpO₂ **nowhere**. Its entire `timeseries` block was 89 five-minute epochs of
`{hr, motionIndex}` — for a night in which the device recorded **~26,500 SpO₂ samples**. A ~300×
reduction applied at the **export boundary**, not by the sensor.

Every cross-node question needing oxygen saturation in time was therefore unanswerable. The
apnea→desaturation transit measurement resolved **3 nights of 39** for exactly this reason: it had a
dozen `desat_event` timestamps standing in for a continuous signal.

## What shipped

`timeseries.spo2 = { doc, hz: 1, n, values[] }` — a uniform 1 Hz grid from `recording.startEpochMs`.
Measured on 2026-07-26: **26,546 samples, 98.7 % non-null, 298× the epoch count**, range 89–99 %.

**Additive.** `epochs` is untouched — `adaptEnvelopeNode` reads it and must not move. The block is
*absent* rather than empty when it cannot be built, so a reader can distinguish "this export predates
the field" from "this night had no usable SpO₂".

**Holes stay holes.** A second the device never reported is `null` — not `0`, which reads as the most
severe desaturation physically possible, and not the previous value, which reads as stable oxygen.
Both are the fabricated-absence class this suite keeps finding, and both are gated.

## Why 1 Hz, when 1 Hz is measurably oversampled

The honest version of this decision, because the measurement argues the other way.

Measured on 2026-07-26 (26,546 samples): only **6.5 %** of adjacent seconds differ, the median run of
an identical value is **8 s**, and 2 s bins keeping the minimum have a worst-case within-bin spread of
**1 percentage point** (mean 0.03). Binning to 2 s would halve the cost and lose nothing detectable on
this night.

It is still emitted at 1 Hz, because **that 8 s figure is one subject, one oximeter, one night**. A
patient with faster desaturations, or a device with less internal averaging than the O2Ring's, would be
silently degraded by a bin size baked into an export contract — and invisibly, because the export is
all a consumer ever sees. Choosing a rate from an n=1 bandwidth measurement is the same generalisation
error this suite keeps finding. Downsampling stays available to any consumer; recovering what an export
dropped does not.

**The cost is real and was underestimated once already.** The first estimate was ~2×; measured it is
~5× (80.9 → 393 KB), because the writers pretty-print — the array alone is 78 KB compact against 156 KB
indented. These are local files with no network in the path, so the trade is storage against
information.

## Fixture impact: none, and that is itself a finding

**No committed OxyDex fixture carries a timeseries block at all** — all three are built through the
app's light path, which never opts into `rich`. So the change moves no fixture, reds no gate, and
`regen-oxydex-goldens` reports `content unchanged`.

That is clean, but it means the field would have shipped **completely ungated** on the strength of the
suite staying green. A green suite that never exercised the new code is not evidence. `oxyBuildSpo2Series`
is therefore exposed on `OxyDex._bare` purely so it can be gated — **11 assertions**, including that a
dropout is neither zeroed nor carried forward, that an implausible span is refused rather than
allocated, and that no anchor yields `null` rather than an invented origin.

## Done when

- [x] SpO₂ emitted at the recorded rate on a uniform grid with explicit holes.
- [x] Additive — `epochs` unchanged, block absent rather than empty.
- [x] Gated (11 assertions), because no fixture would have exercised it.
- [x] The rate decision recorded **with the measurement that argues against it**.
- [ ] Re-run the apnea→desaturation transit against the series rather than `desat_event`, and restate
      `WEARABLE-SYNC-APPLIED` §3. *(The reason this brief exists; not done here.)*
- [ ] Consider whether the other nodes leak the same way — PpgDex and ECGDex also summarise to 5-min
      epochs, and nobody has checked what their primary signals cost at that boundary.

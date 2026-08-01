<!-- SPDX-License-Identifier: Apache-2.0 -->
---
bump: minor
type: added
nodes: [ECGDex, PpgDex]
brief: none
---
ECGDex and PpgDex now export **per-beat intervals** on the bus: `timeseries.rr` (chest ECG, Pan–Tompkins R-peaks, Malik-corrected) and `timeseries.ppi` (optical spine — 3-LED consensus → `buildPPI` → `correctRR`, with `spine` naming which fiducial won).

Both were computed and then unreachable. ECGDex's RR left only through the app's **⬇ RR** button — a human clicking, producing a file no headless caller could read. PpgDex computed PPI **twice** (pulse feet and peaks), voted a spine, corrected it, and exported neither — and for that sensor the computed series is not a second opinion but the **only** one, since the device `_PPI.txt` is often header-only and its `_HR.txt` all-zero.

Measured on 2026-07-26: **ECGDex 22,460 RR** over 7.40 h (median 1189 ms) and **PpgDex 22,145 PPI** over 7.56 h (median 1188 ms) — chest and arm agreeing to 1 ms.

`tSec` (beat time) and `ms` (interval) are **both** carried and are not interchangeable: only 75 % of intervals equal the `tSec` delta and the worst mismatch is **71 seconds**, a dropout. Reconstructing one from the other would publish a 71 s "interval" — 0.85 bpm — as a measurement.

Rides under `rich`, so the light path stays inert and no committed fixture moves. Gated with 8 assertions, because nothing else exercises it.

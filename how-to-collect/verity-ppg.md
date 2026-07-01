<!--
  how-to-collect/verity-ppg.md — Tepna
  Copyright 2026 Michal Planicka
  SPDX-License-Identifier: Apache-2.0
-->

# How to collect — Polar Verity Sense PPG (overnight)

**Device:** Polar **Verity Sense** optical armband.
**Signal:** multi-channel **PPG** (`ppg`) at ~176 Hz + **ACC**/**GYRO** motion + optional device PPI →
PpgDex (pulse-rate variability, apnea-band, limb posture). The armband alternative to the chest strap.
**Adapter / path:** the `ppg` path → PpgDex's `compute()` on the canonical ppg frame (the multi-channel
optical waveform packed as typed arrays); or open **`PpgDex.html`** directly.

## Capture — two good options
**A — Onboard offline (reliable, needs a button):** press the Verity button before bed to start
**offline recording** (PPG+ACC+HR to internal flash), sync in the morning via Polar Flow / Polar Sensor
Logger, export. Survives any host hiccup — but you must remember the press.

**B — Live stream (auto, via the host):** the `tepna-capture` daemon subscribes to PMD **PPG** (type
0x01) + **ACC** (type 0x02), arrival-stamps, and writes the **PSL layout** (`*_PPG`, `*_ACC`, `*_HR`).
No button, but needs the bedside link held all night.

## File layout & naming
PSL `*_PPG` / `*_ACC` / `*_HR` layouts. Name device-id + 14-digit stamp so the motion/HR sidecars pair
to the PPG primary:
`Polar_VeritySense_<DeviceId>_YYYYMMDDHHMMSS_PPG.txt` (+ `_ACC`, `_HR`). One device-id per physical
armband so a Verity sidecar never cross-pairs onto an H10 ECG (the `ECG-INGEST-FOLLOWUPS` device-filter
relies on this).

## Clock Contract
Same rule as the H10: `Phone timestamp` = zone-free local-civil ISO → floating `tMs`; `getUTC*` on
read-back → viewer-timezone-independent. Dropped windows are **gaps**, never fabricated rows. PPG is
nominally fixed-rate but tolerate dropped/duplicated samples (per-sample cadence allowed).

## Where it goes
Drop the `*_PPG` (+ `_ACC`) into the **Data Unifier** / **OverDex** → routes to the `ppg` path → PpgDex
computes a `ganglior.node-export`; the paired `_ACC` adds the motion gate + limb posture (a Unifier-routed
PPG without its companion keeps event-based apnea fusion but loses posture — pair the sidecar). Or open
**`PpgDex.html`** for the full single-night dashboard.
